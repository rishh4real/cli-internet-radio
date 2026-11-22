import readline from "node:readline";
import { allStations, favoriteStations, toggleFavorite } from "./library.js";
import { loadConfig, saveConfig } from "./config.js";
import { searchDirectory } from "./directory.js";
import { send } from "./player.js";
import type { PlayerStatus, Station } from "./types.js";

const supportsColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const paint = (code: string | number, value: string) => supportsColor ? `\x1b[${code}m${value}\x1b[0m` : value;
const mint = (value: string) => paint("38;2;142;240;188", value); const dim = (value: string) => paint(2, value); const invert = (value: string) => supportsColor ? `\x1b[48;2;142;240;188m\x1b[30m${value}\x1b[0m` : `> ${value}`;
const ellipsis = (value: string, width: number) => [...value].length <= width ? value : [...value].slice(0, Math.max(1, width - 1)).join("") + "…";

export async function openTui(ensureSession: () => Promise<void>): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Dialshift’s interactive UI needs a terminal. Use `dialshift --help` for shell commands.");
  const loaded = await loadConfig(); let config = loaded.config; let view = 0; const views = ["Browse", "Search", "Favorites", "Presets"] as const;
  let selected = 0; let results: Station[] = []; let status: PlayerStatus = await (async () => { try { return (await send({ action: "status" })).status!; } catch { return { phase: "idle", updatedAt: new Date().toISOString() }; } })();
  let message = loaded.recovery || "Select a station and press Enter."; let searching = false; let query = ""; let prompt: { label: string; value: string; done: (value: string) => Promise<void> } | undefined;
  const stationList = () => view === 0 ? allStations(config) : view === 1 ? results : view === 2 ? favoriteStations(config) : [];
  const render = () => {
    const width = Math.max(36, process.stdout.columns || 80); const height = Math.max(14, process.stdout.rows || 24); const list = stationList(); selected = Math.max(0, Math.min(selected, Math.max(0, list.length - 1)));
    const lines: string[] = [];
    lines.push(`${mint("◉")}${"  " + paint(1, "DIALSHIFT")}  ${dim("internet radio for the terminal")}`);
    lines.push(dim("─".repeat(width)));
    lines.push(views.map((name, index) => index === view ? mint(`[ ${name} ]`) : dim(`  ${name}  `)).join(" "));
    lines.push("");
    if (prompt) lines.push(`${mint(prompt.label)} ${prompt.value}${paint(7, " ")}`);
    else if (searching) lines.push(`${mint("Search")} ${query}${paint(7, " ")}`);
    else if (view === 3) {
      if (!config.presets.length) lines.push(`${dim("No presets yet.")}  ${mint("Create one from Favorites with P.")}`);
      else config.presets.forEach((preset, i) => lines.push(i === selected ? invert(`${preset.name}  ${dim(`${preset.stationIds.length} stations`)}`) : `  ${preset.name}  ${dim(`${preset.stationIds.length} stations`)}`));
    } else if (!list.length) {
      lines.push(view === 1 ? dim("Type a station name or genre, then press Enter.") : dim("No favorites yet. Browse stations and press F to save one."));
    } else {
      const room = Math.max(3, height - 10); const start = Math.max(0, Math.min(selected - Math.floor(room / 2), Math.max(0, list.length - room)));
      list.slice(start, start + room).forEach((station, index) => {
        const actual = start + index; const now = status.station?.id === station.id; const label = `${now ? mint("● ") : ""}${ellipsis(station.name, Math.max(14, width - 29))}${width > 54 ? dim("  " + station.genre) : ""}`;
        lines.push(actual === selected ? invert(label) : `  ${label}`);
      });
    }
    lines.push(""); lines.push(dim("─".repeat(width)));
    const playing = status.station ? `${status.phase.toUpperCase()}  ${status.station.name}${status.track ? ` · ${status.track}` : ""}` : `${status.phase.toUpperCase()}  No station selected`;
    lines.push(`${mint("NOW")}  ${ellipsis(playing, width - 7)}`); lines.push(`${dim(message)}`);
    lines.push(dim(width < 60 ? "↑↓ move · ↵ play · / search · space pause · q quit" : "↑↓ move  Tab views  Enter play  Space pause/resume  / search  F favorite  P preset  S stop  Q quit"));
    process.stdout.write("\x1b[?25l\x1b[2J\x1b[H" + lines.slice(0, height).join("\n"));
  };
  const refreshStatus = async () => { try { status = (await send({ action: "status" })).status || status; } catch { /* daemon has not been started */ } };
  const play = async () => {
    if (view === 3) { const preset = config.presets[selected]; if (!preset) return; const stations = preset.stationIds.map(id => allStations(config).find(s => s.id === id)).filter((x): x is Station => Boolean(x)); await ensureSession(); const response = await send({ action: "play", stations, preset: preset.name }); if (!response.ok) throw new Error(response.error); status = response.status!; message = `Tuning ${preset.name}…`; return; }
    const station = stationList()[selected]; if (!station) return; await ensureSession(); const response = await send({ action: "play", stations: [station] }); if (!response.ok) throw new Error(response.error); status = response.status!; message = `Tuning ${station.name}…`;
  };
  const ask = (label: string, done: (value: string) => Promise<void>) => { prompt = { label, value: "", done }; render(); };
  const onKey = async (_: string, key: readline.Key) => {
    try {
      if (prompt) { if (key.name === "escape") { prompt = undefined; } else if (key.name === "return") { const current = prompt; prompt = undefined; await current.done(current.value); } else if (key.name === "backspace") prompt.value = prompt.value.slice(0, -1); else if (key.sequence && !key.ctrl && key.sequence >= " ") prompt.value += key.sequence; render(); return; }
      if (searching) { if (key.name === "escape") { searching = false; } else if (key.name === "return") { message = "Searching the radio directory…"; render(); results = await searchDirectory(query); selected = 0; message = results.length ? `${results.length} stations found.` : "No stations found. Try another name or genre."; searching = false; } else if (key.name === "backspace") query = query.slice(0, -1); else if (key.sequence && !key.ctrl && key.sequence >= " ") query += key.sequence; render(); return; }
      if (key.name === "q" || (key.ctrl && key.name === "c")) { cleanup(); return; }
      if (key.name === "up") selected -= 1; else if (key.name === "down") selected += 1;
      else if (key.name === "tab") { view = (view + 1) % views.length; selected = 0; }
      else if (key.name === "return") await play();
      else if (key.name === "space") { await ensureSession(); const action = status.phase === "paused" ? "resume" : "pause"; const reply = await send({ action }); if (!reply.ok) throw new Error(reply.error); status = reply.status!; }
      else if (key.name === "/") { view = 1; searching = true; query = ""; }
      else if (key.name === "f") { const station = stationList()[selected]; if (station) { const favorite = toggleFavorite(config, station.id); await saveConfig(config); message = favorite ? `${station.name} saved to Favorites.` : `${station.name} removed from Favorites.`; } }
      else if (key.name === "s") { await ensureSession(); const reply = await send({ action: "stop" }); status = reply.status || status; message = "Playback stopped."; }
      else if (key.name === "p" && view === 2) ask("New preset name:", async name => { const { createPreset } = await import("./library.js"); const selectedStation = stationList()[selected]; createPreset(config, name, selectedStation ? [selectedStation.id] : []); await saveConfig(config); message = `Preset ${name} created.`; view = 3; selected = 0; });
      render();
    } catch (error) { message = (error as Error).message; render(); }
  };
  let ticker: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => { if (ticker) clearInterval(ticker); process.stdin.setRawMode?.(false); process.stdin.pause(); process.stdout.write("\x1b[?25h\x1b[0m\n"); process.exit(0); };
  process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.setEncoding("utf8"); readline.emitKeypressEvents(process.stdin); process.stdin.on("keypress", onKey); ticker = setInterval(async () => { await refreshStatus(); render(); }, 1200); render();
}
