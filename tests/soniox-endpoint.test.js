/**
 * Soniox endpoint detection — the stop word is sent ~0.5 s after you stop
 * speaking, not ~6 s.
 *
 * Without `enable_endpoint_detection`, Soniox keeps the last words (the stop
 * word with them) non-final for ~6 s, and the bar only checks the stop word on
 * final text. With it on, Soniox finalizes at the end of an utterance and adds
 * a final "<end>" token in the SAME message as the stop word. That token is not
 * speech: if it reaches the transcript, "thank you.<end>" never matches the
 * stop word and nothing is ever sent.
 *
 * Learned from AI-teams-controller (6bd7703e). The fixture is real Soniox
 * traffic captured there (stt-rt-v5, vi+en hints, endpoint detection on).
 *
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const SonioxSTT = require("../ui/stt.js");
const StopWordDetector = require("../ui/stopword.js");
const endpointStreams = require("./fixtures/soniox-endpoint-detection.json");

const config = require("../config.json");

function createStt() {
  const stt = new SonioxSTT();
  stt.setConfig(config.soniox);
  return stt;
}

/** The bar's pipeline: check the stop word on final text, then start over. */
function wireLikeBar(stt) {
  const detector = new StopWordDetector(config.voice.stop_word);
  const commands = [];
  const shown = [];
  stt.onTranscript = (full, final, hasFinal) => {
    shown.push(full);
    if (!hasFinal) return;
    const result = detector.process(final);
    if (result.detected && result.command) {
      commands.push(result.command);
      stt.resetTranscript();
    }
  };
  return { commands, shown };
}

function send(stt, message) {
  stt._handleMessage({ data: JSON.stringify(message) });
}

test("the first Soniox message turns endpoint detection on", () => {
  const msg = createStt()._buildInitMessage("k", undefined);
  assert.equal(msg.enable_endpoint_detection, true);
});

test("config.json can switch endpoint detection off (rollback lever)", () => {
  const stt = new SonioxSTT();
  stt.setConfig({ ...config.soniox, enable_endpoint_detection: false });
  assert.equal(stt._buildInitMessage("k", undefined).enable_endpoint_detection, false);
});

for (const [name, stream] of Object.entries(endpointStreams.streams)) {
  test(`${name}: sends exactly the spoken commands (real Soniox capture)`, () => {
    const stt = createStt();
    const { commands, shown } = wireLikeBar(stt);

    for (const message of stream.messages) send(stt, message);

    assert.deepEqual(commands, stream.expected_commands);
    assert.deepEqual(shown.filter((t) => t.includes("<")), [], "a control token was shown");
    assert.equal(stt.originalTranscript, "");
  });
}

test("an endpoint that arrives on its own adds nothing", () => {
  const stt = createStt();
  const { commands } = wireLikeBar(stt);

  send(stt, { tokens: [{ text: "fix the bug", is_final: true }] });
  send(stt, { tokens: [{ text: "<end>", is_final: true }] });
  send(stt, { tokens: [{ text: " thank you.", is_final: true }] });

  assert.deepEqual(commands, ["fix the bug"]);
});

test("any whole-token control marker is dropped, not only <end>", () => {
  const stt = createStt();
  const { commands } = wireLikeBar(stt);

  send(stt, {
    tokens: [
      { text: "run the tests thank you.", is_final: true },
      { text: "<fin>", is_final: true },
    ],
  });

  assert.deepEqual(commands, ["run the tests"]);
});

test("text that merely contains angle brackets is still speech", () => {
  const stt = createStt();
  wireLikeBar(stt);

  send(stt, { tokens: [{ text: "a <b> c", is_final: true }] });

  assert.equal(stt.originalTranscript, "a <b> c");
});
