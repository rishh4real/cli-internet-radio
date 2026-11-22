#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { appDir, controlPath, loadConfig, saveConfig } from "./config.js";
import { allStations, createPreset, findStation, removeCustomStation, addCustomStation, renamePreset, reorderPreset } from "./library.js";
import { searchDirectory } from "./directory.js";
import { readStatus, send, serve } from "./player.js";
import { openTui } from "./tui.js";
import type { Station } from "./types.js";

const usage = `Dialshift — internet radio for the terminal

Usage:
  dialshift                         Open the interactive radio tuner
  dialshift search <name-or-genre>  Find stations in the public directory
  dialshift play <preset|station>   Start a preset or saved station in the background
  dialshift pause | resume | next | stop | status

Library:
  dialshift favorite <station>      Toggle a favorite
  dialshift add <name> <url> [genre]
  dialshift edit <id> <name> <url> [genre]
  dialshift remove <id>
  dialshift preset create <name> [station...]
  dialshift preset rename <old> <new>
  dialshift preset delete <name>
  dialshift preset reorder <name> <station-id...>

`;
const printStatus = (status: Awaited<ReturnType<typeof readStatus>>) => {
  const station = status.station ? ` — ${status.station.name}` : ""; console.log(`${status.phase.toUpperCase()}${station}${status.track ? ` · ${status.track}` : ""}${status.error ? `\n${status.error}` : ""}`);
};
async function ensureSession(): Promise<void> {
  try { await send({ action: "status" }); return; } catch { /* stale or absent socket */ }
  await mkdir(appDir(), { recursive: true }); if (existsSync(controlPath())) await rm(controlPath(), { force: true });
  const child = spawn(process.execPath, [process.argv[1], "__daemon"], { detached: true, stdio: "ignore" }); child.unref();
  for (let i = 0; i < 20; i += 1) { await new Promise(resolve => setTimeout(resolve, 100)); try { await send({ action: "status" }); return; } catch { /* wait for server */ } }
  throw new Error("Dialshift could not start its local playback session.");
}
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2); if (command === "__daemon") return serve();
  if (!command) return openTui(ensureSession);
  if (["--help", "-h", "help"].includes(command)) { console.log(usage); return; }
  const { config, recovery } = await loadConfig(); if (recovery) console.error(`Dialshift: ${recovery}`);
  if (command === "search") { const query = args.join(" "); if (!query) throw new Error("Provide a station name or genre. Example: dialshift search jazz"); const found = await searchDirectory(query); if (!found.length) console.log("No stations found."); else found.forEach(s => console.log(`${s.name}\t${s.genre}\t${s.url}`)); return; }
  if (command === "status") { try { const reply = await send({ action: "status" }); printStatus(reply.status || await readStatus()); } catch { printStatus(await readStatus()); } return; }
  if (["pause", "resume", "next", "stop"].includes(command)) { await ensureSession(); const reply = await send({ action: command as "pause" | "resume" | "next" | "stop" }); if (!reply.ok) throw new Error(reply.error); printStatus(reply.status!); return; }
  if (command === "play") { const selector = args.join(" "); if (!selector) throw new Error("Choose a preset or saved station to play."); const preset = config.presets.find(p => p.name.toLowerCase() === selector.toLowerCase()); const station = findStation(config, selector); if (!preset && !station) throw new Error(`No preset or saved station named “${selector}”. Use quotes for names with spaces.`); const stations: Station[] = preset ? preset.stationIds.map(id => allStations(config).find(s => s.id === id)).filter((x): x is Station => Boolean(x)) : [station!]; await ensureSession(); const reply = await send({ action: "play", stations, preset: preset?.name }); if (!reply.ok) throw new Error(reply.error); printStatus(reply.status!); return; }
  if (command === "favorite") { const station = findStation(config, args.join(" ")); if (!station) throw new Error("Saved station not found."); const { toggleFavorite } = await import("./library.js"); const favorited = toggleFavorite(config, station.id); await saveConfig(config); console.log(favorited ? `Saved ${station.name}.` : `Removed ${station.name}.`); return; }
  if (command === "add") { if (args.length < 2) throw new Error("Usage: dialshift add <name> <url> [genre]"); const station = addCustomStation(config, args[0], args[1], args.slice(2).join(" ")); await saveConfig(config); console.log(`Added ${station.name} (${station.id}).`); return; }
  if (command === "edit") { if (args.length < 3) throw new Error("Usage: dialshift edit <id> <name> <url> [genre]"); const { updateCustomStation } = await import("./library.js"); const station = updateCustomStation(config, args[0], { name: args[1], url: args[2], genre: args.slice(3).join(" ") }); await saveConfig(config); console.log(`Updated ${station.name}.`); return; }
  if (command === "remove") { removeCustomStation(config, args[0] || ""); await saveConfig(config); console.log("Custom station removed."); return; }
  if (command === "preset") { const [operation, name, ...more] = args; if (operation === "create") { const ids = more.map(item => findStation(config, item)?.id || item); createPreset(config, name || "", ids); } else if (operation === "rename") renamePreset(config, name || "", more.join(" ")); else if (operation === "delete") { const index = config.presets.findIndex(p => p.name.toLowerCase() === (name || "").toLowerCase()); if (index < 0) throw new Error("Preset not found."); config.presets.splice(index, 1); } else if (operation === "reorder") reorderPreset(config, name || "", more); else throw new Error("Use create, rename, delete, or reorder."); await saveConfig(config); console.log("Preset saved."); return; }
  throw new Error(`Unknown command: ${command}\n\n${usage}`);
}
main().catch(error => { console.error(`Dialshift: ${(error as Error).message}`); process.exitCode = 1; });
