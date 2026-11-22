import { STARTER_STATIONS, type DialshiftConfig, type Preset, type Station } from "./types.js";
import { stationId, validateStreamUrl } from "./config.js";

export const allStations = (config: DialshiftConfig): Station[] => [...STARTER_STATIONS, ...config.customStations];
export const findStation = (config: DialshiftConfig, query: string): Station | undefined => allStations(config).find(s => s.id === query || s.name.toLowerCase() === query.toLowerCase());
export const favoriteStations = (config: DialshiftConfig) => allStations(config).filter(s => config.favorites.includes(s.id));
export function toggleFavorite(config: DialshiftConfig, id: string): boolean {
  const at = config.favorites.indexOf(id);
  if (at >= 0) { config.favorites.splice(at, 1); return false; }
  config.favorites.push(id); return true;
}
export function addCustomStation(config: DialshiftConfig, name: string, url: string, genre = "Custom"): Station {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("A station name is required.");
  if (allStations(config).some(s => s.name.toLowerCase() === cleanName.toLowerCase())) throw new Error("A station with that name already exists.");
  const station: Station = { id: stationId(cleanName), name: cleanName, url: validateStreamUrl(url), genre: genre.trim() || "Custom", source: "custom" };
  config.customStations.push(station); return station;
}
export function updateCustomStation(config: DialshiftConfig, id: string, fields: Partial<Pick<Station, "name" | "url" | "genre">>): Station {
  const station = config.customStations.find(s => s.id === id);
  if (!station) throw new Error("Custom station not found.");
  if (fields.name !== undefined) { if (!fields.name.trim()) throw new Error("A station name is required."); station.name = fields.name.trim(); }
  if (fields.url !== undefined) station.url = validateStreamUrl(fields.url);
  if (fields.genre !== undefined) station.genre = fields.genre.trim() || "Custom";
  return station;
}
export function removeCustomStation(config: DialshiftConfig, id: string): void {
  const at = config.customStations.findIndex(s => s.id === id);
  if (at < 0) throw new Error("Custom station not found.");
  config.customStations.splice(at, 1);
  config.favorites = config.favorites.filter(item => item !== id);
  config.presets.forEach(p => p.stationIds = p.stationIds.filter(item => item !== id));
}
export function createPreset(config: DialshiftConfig, name: string, stationIds: string[] = []): Preset {
  const clean = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/.test(clean)) throw new Error("Preset names use letters, numbers, spaces, underscores, or hyphens.");
  if (config.presets.some(p => p.name.toLowerCase() === clean.toLowerCase())) throw new Error("That preset already exists.");
  const preset = { name: clean, stationIds: [...new Set(stationIds)] }; config.presets.push(preset); return preset;
}
export function renamePreset(config: DialshiftConfig, oldName: string, nextName: string): Preset {
  const preset = config.presets.find(p => p.name.toLowerCase() === oldName.toLowerCase());
  if (!preset) throw new Error("Preset not found.");
  if (config.presets.some(p => p !== preset && p.name.toLowerCase() === nextName.trim().toLowerCase())) throw new Error("That preset already exists.");
  preset.name = nextName.trim(); return preset;
}
export function reorderPreset(config: DialshiftConfig, name: string, ids: string[]): Preset {
  const preset = config.presets.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!preset) throw new Error("Preset not found.");
  const contained = new Set(preset.stationIds); if (ids.length !== preset.stationIds.length || ids.some(id => !contained.has(id))) throw new Error("Reorder must contain every current preset station exactly once.");
  preset.stationIds = [...ids]; return preset;
}
