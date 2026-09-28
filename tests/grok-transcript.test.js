/**
 * Assembling a transcript from Grok Voice Transcribe's streaming messages.
 *
 * Grok's protocol, as captured live (fixture: grok-turn-three-pieces.json):
 * - interim      — the piece being spoken; `start` is the PIECE's start.
 * - is_final     — a finished piece; `start` is the TURN's start (shared by
 *                  every piece of the turn); text is ONLY that piece.
 * - speech_final — end of turn; the WHOLE turn's text again, as a recap.
 *
 * Keying pieces by `start` made each piece of a turn overwrite the one before,
 * and commands lost their middles (AI-teams-controller 82e79005, 2026-09-24).
 * Ported with its tests and fixture.
 *
 * Run: npm test
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const GrokTranscript = require("../ui/grok-transcript.js");
const capture = require("./fixtures/grok-turn-three-pieces.json");

const interim = (text, start, duration) =>
  ({ type: "transcript.partial", text, start, duration, is_final: false, speech_final: false });
const piece = (text, turnStart, end) =>
  ({ type: "transcript.partial", text, start: turnStart, duration: end - turnStart, is_final: true, speech_final: false });
const recap = (text, turnStart, end) =>
  ({ type: "transcript.partial", text, start: turnStart, duration: end - turnStart, is_final: true, speech_final: true });

function feed(t, msgs) {
  for (const m of msgs) t.apply(m);
  return t;
}

describe("GrokTranscript", () => {
  test("keeps every piece of a real captured turn, in order, once", () => {
    const t = feed(new GrokTranscript(), capture.messages);
    assert.equal(t.finalText, capture.expected);
  });

  test("does not lose the middle of a turn (the 2026-09-24 bug)", () => {
    const t = feed(new GrokTranscript(), [
      piece("Ok, cho tao hỏi là hiện giờ tao đang...", 0.001, 4.2),
      recap("Ok, cho tao hỏi là hiện giờ tao đang...", 0.001, 4.7),
      interim("dùng Grok", 4.9, 0.8),
      piece("dùng Grok hay là", 4.9, 6.5),
      interim("Soniox ấy", 6.5, 0.9),
      piece("Soniox ấy?", 4.9, 8.3),
    ]);
    assert.equal(t.finalText, "Ok, cho tao hỏi là hiện giờ tao đang... dùng Grok hay là Soniox ấy?");
  });

  test("shows the piece being spoken after what is already final", () => {
    const t = feed(new GrokTranscript(), [piece("Kiểm tra backend.", 0.001, 3), interim("Rồi restart", 3, 1)]);
    assert.equal(t.displayText, "Kiểm tra backend. Rồi restart");
    assert.equal(t.finalText, "Kiểm tra backend.");
  });

  test("reports what each message was", () => {
    const t = new GrokTranscript();
    assert.equal(t.apply(interim("a", 0, 1)), "interim");
    assert.equal(t.apply(piece("a b", 0, 2)), "final");
    assert.equal(t.apply(recap("a b", 0, 2.5)), null);
    assert.equal(t.apply({ type: "transcript.created" }), null);
  });

  test("uses the recap when a turn arrives only as a recap", () => {
    const t = feed(new GrokTranscript(), [recap("Chỉ có recap.", 0.001, 2)]);
    assert.equal(t.finalText, "Chỉ có recap.");
  });

  test("counts a short turn once although it arrives as a piece and a recap", () => {
    const t = feed(new GrokTranscript(), [piece("Một câu.", 0.001, 4.2), recap("Một câu.", 0.001, 4.2)]);
    assert.equal(t.finalText, "Một câu.");
  });

  test("ignores a repeated delivery of the same piece", () => {
    const t = feed(new GrokTranscript(), [piece("Một.", 0, 2), piece("Một.", 0, 2), piece("Hai.", 0, 4)]);
    assert.equal(t.finalText, "Một. Hai.");
  });

  describe("after a command is sent (consume)", () => {
    test("the recap of the sent turn does not come back", () => {
      const t = feed(new GrokTranscript(), [piece("Lệnh một.", 0.001, 3), piece("Thank you.", 0.001, 4)]);
      t.consume();
      t.apply(recap("Lệnh một. Thank you.", 0.001, 4.5));
      assert.equal(t.finalText, "");
    });

    test("speech that continues in the same turn is kept for the next command", () => {
      const t = feed(new GrokTranscript(), [piece("Lệnh một. Thank you.", 0.001, 4)]);
      t.consume();
      t.apply(piece("Lệnh hai", 0.001, 6));
      assert.equal(t.finalText, "Lệnh hai");
    });
  });

  describe("clear", () => {
    test("drops speech that was still in flight, keeps what comes after", () => {
      const t = feed(new GrokTranscript(), [piece("Giữ lại?", 0.001, 2), interim("câu nói nhầm", 2, 1.5)]);
      t.clear();
      assert.equal(t.displayText, "");
      t.apply(piece("câu nói nhầm", 0.001, 4)); // its final lands after the clear
      assert.equal(t.finalText, "");
      t.apply(piece("câu mới", 0.001, 7));
      assert.equal(t.finalText, "câu mới");
    });
  });
});
