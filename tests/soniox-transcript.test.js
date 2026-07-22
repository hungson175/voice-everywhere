const { test } = require("node:test");
const assert = require("node:assert/strict");

const SonioxSTT = require("../ui/stt.js");

function createStt({ translationEnabled = false } = {}) {
  const stt = new SonioxSTT();
  stt.setConfig({
    model: "stt-rt-v5",
    sample_rate: 16000,
    num_channels: 1,
    audio_format: "pcm_s16le",
    language_hints: ["vi", "en"],
  });
  stt.translationEnabled = translationEnabled;
  return stt;
}

test("adds native one-way translation to the initial Soniox config", () => {
  const stt = createStt();
  const translation = { type: "one_way", target_language: "en" };
  const message = stt._buildInitMessage(
    "test-key",
    { terms: ["Claude Code"] },
    { translation }
  );

  assert.deepEqual(message.translation, translation);
  assert.equal(message.enable_language_identification, true);
  assert.deepEqual(message.language_hints, ["vi", "en"]);
  assert.equal(message.audio_format, "pcm_s16le");
});

test("accumulates ordinary Soniox tokens as the original transcript", () => {
  const stt = createStt();
  let received;
  stt.onTranscript = (...args) => { received = args; };

  stt._handleMessage({
    data: JSON.stringify({
      tokens: [
        { text: "Xin chào", is_final: true },
        { text: " bạn", is_final: false },
      ],
    }),
  });

  assert.equal(received[0], "Xin chào bạn");
  assert.equal(received[1], "Xin chào");
  assert.equal(received[2], true);
  assert.deepEqual(received[3], {
    originalFull: "Xin chào bạn",
    originalFinal: "Xin chào",
    translationFull: "",
    translationFinal: "",
    hasOriginalFinal: true,
    hasTranslationFinal: false,
  });
});

test("separates original and translated Soniox token streams", () => {
  const stt = createStt({ translationEnabled: true });
  let received;
  stt.onTranscript = (...args) => { received = args; };

  stt._handleMessage({
    data: JSON.stringify({
      tokens: [
        { text: "Xin chào thank you", is_final: true, translation_status: "original", language: "vi" },
        { text: "Hello thank you", is_final: true, translation_status: "translation", language: "en", source_language: "vi" },
      ],
    }),
  });

  assert.equal(received[0], "Hello thank you");
  assert.equal(received[1], "Hello thank you");
  assert.equal(received[3].originalFinal, "Xin chào thank you");
  assert.equal(received[3].translationFinal, "Hello thank you");
  assert.equal(received[3].hasOriginalFinal, true);
  assert.equal(received[3].hasTranslationFinal, true);

  stt.resetTranscript();
  assert.equal(stt.originalTranscript, "");
  assert.equal(stt.translationTranscript, "");
});
