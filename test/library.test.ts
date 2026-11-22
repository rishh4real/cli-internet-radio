import test from "node:test";
import assert from "node:assert/strict";
import { addCustomStation, createPreset, removeCustomStation, reorderPreset } from "../src/library.js";
import { defaultConfig } from "../src/config.js";

test("custom stations validate input and cascade cleanly on removal", () => {
  const config = defaultConfig(); const station = addCustomStation(config, "Campus FM", "https://example.test/live", "College");
  createPreset(config, "focus", [station.id]); config.favorites.push(station.id); removeCustomStation(config, station.id);
  assert.equal(config.customStations.length, 0); assert.deepEqual(config.favorites, []); assert.deepEqual(config.presets[0].stationIds, []);
  assert.throws(() => addCustomStation(config, "Broken", "ftp://example.test/live"), /http/);
});
test("preset reorder requires the same station set", () => {
  const config = defaultConfig(); const preset = createPreset(config, "focus", ["one", "two"]);
  reorderPreset(config, "focus", ["two", "one"]); assert.deepEqual(preset.stationIds, ["two", "one"]);
  assert.throws(() => reorderPreset(config, "focus", ["two"]), /every current/);
});
