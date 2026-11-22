export type Station = {
  id: string;
  name: string;
  url: string;
  genre: string;
  source: "starter" | "directory" | "custom";
};

export type Preset = { name: string; stationIds: string[] };
export type DialshiftConfig = { version: 1; favorites: string[]; customStations: Station[]; presets: Preset[] };
export type PlayerPhase = "idle" | "connecting" | "playing" | "paused" | "stopped" | "failed";
export type PlayerStatus = {
  phase: PlayerPhase;
  station?: Station;
  preset?: string;
  index?: number;
  track?: string;
  error?: string;
  updatedAt: string;
};

export const STARTER_STATIONS: Station[] = [
  { id: "groove-salad", name: "Groove Salad", genre: "Ambient / Chill", url: "https://ice1.somafm.com/groovesalad-128-mp3", source: "starter" },
  { id: "drone-zone", name: "Drone Zone", genre: "Ambient", url: "https://ice1.somafm.com/dronezone-128-mp3", source: "starter" },
  { id: "secret-agent", name: "Secret Agent", genre: "Downtempo", url: "https://ice1.somafm.com/secretagent-128-mp3", source: "starter" },
  { id: "jazz-groove", name: "Jazz Groove", genre: "Jazz", url: "https://ice1.somafm.com/jazzgroove-128-mp3", source: "starter" }
];
