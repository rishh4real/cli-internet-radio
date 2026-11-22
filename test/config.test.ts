import test from "node:test";
import assert from "node:assert/strict";
import { validateStreamUrl } from "../src/config.js";
test("stream URLs accept http(s) only", () => {
  assert.equal(validateStreamUrl("https://example.test/a"), "https://example.test/a");
  assert.throws(() => validateStreamUrl("file:///etc/passwd"), /http/);
});
