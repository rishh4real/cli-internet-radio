import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { DialshiftConfig, Preset, Station } from "./types.js";

export const appDir = () => process.env.DIALSHIFT_HOME || join(process.env.XDG_CONFIG_HOME || join(process.env.HOME || tmpdir(), ".config"), "dialshift");
export const configPath = () => join(appDir(), "stations.json");
export const controlPath = () => join(appDir(), "control.sock");
export const statusPath = () => join(appDir(), "status.json");

export const defaultConfig = (): DialshiftConfig => ({ version: 1, favorites: [], customStations: [], presets: [] });
const isStation = (value: unknown): value is Station => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.url === "string" && typeof item.genre === "string" && ["starter", "directory", "custom"].includes(String(item.source));
};
const isConfig = (value: unknown): value is DialshiftConfig => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 && Array.isArray(item.favorites) && item.favorites.every(x => typeof x === "string") && Array.isArray(item.customStations) && item.customStations.every(isStation) && Array.isArray(item.presets) && item.presets.every(p => p && typeof p === "object" && typeof (p as Preset).name === "string" && Array.isArray((p as Preset).stationIds));
};

export async function loadConfig(): Promise<{ config: DialshiftConfig; recovery?: string }> {
  const file = configPath();
  if (!existsSync(file)) return { config: defaultConfig() };
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isConfig(parsed)) throw new Error("It does not match the Dialshift config format.");
    return { config: parsed };
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    await rename(file, backup);
    return { config: defaultConfig(), recovery: `Your malformed config was moved to ${backup}. A fresh library is ready.` };
  }
}

export async function saveConfig(config: DialshiftConfig): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true });
  const pending = `${configPath()}.tmp`;
  await writeFile(pending, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(pending, configPath());
}

export function validateStreamUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Stream URLs must use http:// or https://.");
  return url.toString();
}

export function stationId(name: string): string {
  return `custom-${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
}
