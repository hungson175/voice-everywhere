/**
 * Soniox STT config contract — guards v4→v5 migration settings.
 *
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8")
);

test("soniox uses stt-rt-v5 with soft language hints", () => {
  const { soniox } = config;

  assert.equal(soniox.model, "stt-rt-v5");
  assert.deepEqual(soniox.language_hints, ["vi", "en"]);
  assert.equal(
    soniox.language_hints_strict,
    undefined,
    "strict language gating hurts mixed vi/en speech on v5"
  );
  assert.equal(soniox.sample_rate, 16000);
  assert.equal(soniox.num_channels, 1);
  assert.equal(soniox.audio_format, "pcm_s16le");
});
