import { createConnection, createServer, type Server } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appDir, controlPath, statusPath } from "./config.js";
import type { PlayerStatus, Station } from "./types.js";

type Command = { action: "play"; stations: Station[]; preset?: string } | { action: "pause" | "resume" | "stop" | "next" | "status" };
type Reply = { ok: boolean; status?: PlayerStatus; error?: string };
const initial = (): PlayerStatus => ({ phase: "idle", updatedAt: new Date().toISOString() });

export async function readStatus(): Promise<PlayerStatus> {
  try { return JSON.parse(await readFile(statusPath(), "utf8")) as PlayerStatus; } catch { return initial(); }
}

class RadioPlayer {
  private child?: ChildProcess;
  private status: PlayerStatus = initial();
  private playlist: Station[] = [];
  private position = 0;
  private preset?: string;
  private switchId = 0;
  private started = false;
  private playerSocket = join(appDir(), "mpv.sock");

  private async saveStatus(): Promise<void> {
    this.status.updatedAt = new Date().toISOString();
    await mkdir(appDir(), { recursive: true });
    await writeFile(statusPath(), `${JSON.stringify(this.status, null, 2)}\n`, { mode: 0o600 });
  }
  private async mpv(command: unknown[]): Promise<void> {
    if (!existsSync(this.playerSocket)) throw new Error("mpv control socket is unavailable.");
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.playerSocket); const timer = setTimeout(() => { socket.destroy(); reject(new Error("mpv control timed out.")); }, 1000);
      socket.once("error", reject); socket.once("connect", () => { socket.write(`${JSON.stringify({ command })}\n`); setTimeout(() => { clearTimeout(timer); socket.end(); resolve(); }, 80); });
    });
  }
  async play(stations: Station[], preset?: string): Promise<PlayerStatus> {
    if (!stations.length) throw new Error(preset ? `Preset “${preset}” is empty.` : "No station selected.");
    this.playlist = stations; this.position = 0; this.preset = preset;
    this.status = { phase: "connecting", station: stations[0], preset, index: 0, updatedAt: new Date().toISOString() };
    await this.saveStatus();
    void this.startCurrent();
    return this.status;
  }
  private async startCurrent(): Promise<void> {
    const generation = ++this.switchId;
    const station = this.playlist[this.position];
    await this.kill(); this.started = false;
    this.status = { phase: "connecting", station, preset: this.preset, index: this.position, updatedAt: new Date().toISOString() }; await this.saveStatus();
    try { await rm(this.playerSocket, { force: true }); } catch { /* socket can be gone */ }
    try {
      this.child = spawn("mpv", ["--no-video", "--no-terminal", "--force-window=no", "--input-ipc-server=" + this.playerSocket, "--metadata-codepage=utf-8", station.url], { stdio: "ignore" });
    } catch {
      this.status = { ...this.status, phase: "failed", error: "Could not start mpv. Install it with: brew install mpv" }; await this.saveStatus(); return;
    }
    this.child.once("error", async () => {
      if (generation !== this.switchId) return;
      this.status = { ...this.status, phase: "failed", error: "mpv is not installed. Install it with: brew install mpv" }; await this.saveStatus();
    });
    this.child.once("exit", async (code) => {
      if (generation !== this.switchId) return;
      if (!this.started && this.position + 1 < this.playlist.length) { this.position += 1; await this.startCurrent(); return; }
      this.status = { ...this.status, phase: this.status.phase === "stopped" ? "stopped" : "failed", error: this.started ? "The stream ended or mpv stopped." : `Could not start ${station.name}${code === null ? "" : ` (mpv exited ${code})`}.` }; await this.saveStatus();
    });
    // A control socket proves mpv launched; `file-loaded` from that socket proves the stream is actually playable.
    for (let attempts = 0; attempts < 16 && generation === this.switchId; attempts += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (existsSync(this.playerSocket)) {
        this.watchMetadata(generation); return;
      }
    }
  }
  private watchMetadata(generation: number): void {
    const socket = createConnection(this.playerSocket);
    socket.on("error", () => undefined);
    socket.on("connect", () => socket.write(`${JSON.stringify({ command: ["observe_property", 1, "media-title"] })}\n`));
    let buffer = "";
    socket.on("data", async data => {
      if (generation !== this.switchId) { socket.destroy(); return; }
      buffer += data.toString();
      const records = buffer.split("\n"); buffer = records.pop() || "";
      for (const line of records) {
        try {
          const event = JSON.parse(line);
          if (event.event === "file-loaded") { this.started = true; this.status = { ...this.status, phase: "playing", error: undefined }; await this.saveStatus(); }
          if (event.event === "property-change" && event.name === "media-title" && typeof event.data === "string") { this.status.track = event.data; await this.saveStatus(); }
        } catch { /* Ignore malformed events and keep the connection open. */ }
      }
    });
  }
  private async kill(): Promise<void> {
    if (!this.child) return;
    const active = this.child; this.child = undefined;
    try { await this.mpv(["quit"]); } catch { active.kill("SIGTERM"); }
  }
  async pause(): Promise<PlayerStatus> { if (this.status.phase === "playing") { await this.mpv(["set_property", "pause", true]); this.status.phase = "paused"; await this.saveStatus(); } return this.status; }
  async resume(): Promise<PlayerStatus> { if (this.status.phase === "paused") { await this.mpv(["set_property", "pause", false]); this.status.phase = "playing"; await this.saveStatus(); } return this.status; }
  async stop(): Promise<PlayerStatus> { ++this.switchId; await this.kill(); this.status = { phase: "stopped", updatedAt: new Date().toISOString() }; await this.saveStatus(); return this.status; }
  async next(): Promise<PlayerStatus> {
    if (!this.playlist.length) throw new Error("No preset is playing.");
    if (this.position + 1 >= this.playlist.length) throw new Error("This is the final station in the preset.");
    this.position += 1;
    this.status = { phase: "connecting", station: this.playlist[this.position], preset: this.preset, index: this.position, updatedAt: new Date().toISOString() };
    await this.saveStatus();
    void this.startCurrent();
    return this.status;
  }
  getStatus(): PlayerStatus { return this.status; }
}

export async function serve(): Promise<void> {
  await mkdir(appDir(), { recursive: true }); await rm(controlPath(), { force: true });
  const player = new RadioPlayer(); let server: Server;
  server = createServer(socket => {
    let buffer = "";
    socket.on("data", async data => { buffer += data.toString(); if (!buffer.includes("\n")) return; const line = buffer.slice(0, buffer.indexOf("\n")); buffer = "";
      let reply: Reply;
      try { const command = JSON.parse(line) as Command; let status: PlayerStatus;
        if (command.action === "play") status = await player.play(command.stations, command.preset);
        else if (command.action === "pause") status = await player.pause();
        else if (command.action === "resume") status = await player.resume();
        else if (command.action === "stop") status = await player.stop();
        else if (command.action === "next") status = await player.next();
        else status = player.getStatus(); reply = { ok: true, status };
      } catch (error) { reply = { ok: false, error: (error as Error).message, status: player.getStatus() }; }
      socket.end(`${JSON.stringify(reply)}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(controlPath(), resolve); });
  const close = async () => { await player.stop(); server.close(); await rm(controlPath(), { force: true }); process.exit(0); };
  process.on("SIGTERM", close); process.on("SIGINT", close);
}

export async function send(command: Command): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(controlPath()); let raw = ""; const timer = setTimeout(() => { socket.destroy(); reject(new Error("Dialshift session did not reply.")); }, 3500);
    socket.once("error", error => { clearTimeout(timer); reject(error); }); socket.on("data", data => raw += data.toString()); socket.once("end", () => { clearTimeout(timer); try { resolve(JSON.parse(raw) as Reply); } catch { reject(new Error("Dialshift sent an invalid control reply.")); } }); socket.once("connect", () => socket.write(`${JSON.stringify(command)}\n`));
  });
}
