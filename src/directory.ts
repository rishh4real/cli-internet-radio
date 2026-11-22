import type { Station } from "./types.js";

const endpoint = "https://all.api.radio-browser.info/json/stations/search";
export async function searchDirectory(query: string, timeoutMs = 8000): Promise<Station[]> {
  const text = query.trim(); if (!text) return [];
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", "user-agent": "Dialshift/0.1 (terminal radio)" }, body: JSON.stringify({ name: text, tag: text, hidebroken: true, limit: 18, order: "clickcount", reverse: true }) });
    if (!response.ok) throw new Error(`Radio directory returned HTTP ${response.status}.`);
    const data: unknown = await response.json(); if (!Array.isArray(data)) throw new Error("Radio directory sent an unexpected response.");
    return data.flatMap((item: any): Station[] => {
      if (!item || typeof item.name !== "string" || typeof item.url_resolved !== "string") return [];
      try { const url = new URL(item.url_resolved); if (!/^https?:$/.test(url.protocol)) return []; return [{ id: `radio-browser-${item.stationuuid || Buffer.from(item.url_resolved).toString("base64url")}`, name: item.name.trim() || "Untitled station", url: url.toString(), genre: String(item.tags || item.country || "Internet radio").split(",")[0], source: "directory" }]; } catch { return []; }
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("Radio directory timed out. Saved stations are still available.");
    throw error;
  } finally { clearTimeout(timer); }
}
