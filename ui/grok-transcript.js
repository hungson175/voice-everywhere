/**
 * Assembles a transcript from Grok Voice Transcribe's streaming messages.
 *
 * Pure (no socket, no mic), so the protocol handling is tested directly
 * against captured Grok traffic. Grok's messages, as captured live:
 *
 * - interim (is_final=false): the piece being spoken. `start` is the PIECE's
 *   start; the text grows every ~0.5 s.
 * - finished piece (is_final=true, speech_final=false): `start` is the TURN's
 *   start — shared by every piece of that turn — and the text is ONLY this
 *   piece. `start + duration` is where the piece ends.
 * - end of turn (speech_final=true): the whole turn's text again, as a recap.
 *
 * So: finished pieces are appended in order; a recap is ignored unless its turn
 * never produced a piece. Keying pieces by `start` made each piece of a turn
 * overwrite the one before, and commands lost their middles.
 *
 * Ported from AI-teams-controller (frontend/lib/stt/grok-transcript.ts).
 * Loaded in bar.html (browser global) and requireable from Node tests.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.GrokTranscript = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** Timestamps are floats in seconds; treat anything closer than this as equal. */
  const EPSILON = 0.01;

  class GrokTranscript {
    constructor() {
      this.pieces = []; // { text, end }
      this.interim = "";
      this.interimStart = 0;
      /** Where the last piece of each turn ended — i.e. where its next piece begins. */
      this.turnEnds = new Map();
      /** Stream time before which everything is already sent or cleared. */
      this.consumedUntil = 0;
      /** Furthest stream time any message has covered. */
      this.heardUntil = 0;
    }

    /** @returns {"final"|"interim"|null} what the message did */
    apply(msg) {
      if (msg.type !== "transcript.partial") return null;

      const start = msg.start ?? 0;
      const end = start + (msg.duration ?? 0);
      const text = (msg.text ?? "").trim();
      this.heardUntil = Math.max(this.heardUntil, end);

      if (!msg.is_final) {
        this.interim = text;
        this.interimStart = start;
        return "interim";
      }

      if (msg.speech_final && this.turnEnds.has(start)) {
        // Recap of a turn whose pieces we already have.
        this.interim = "";
        return null;
      }

      const begin = this.turnEnds.get(start) ?? start;
      if (end <= begin + EPSILON) return null; // a piece we already have, delivered again
      this.turnEnds.set(start, end);
      this.interim = "";

      if (begin < this.consumedUntil - EPSILON || !text) return null; // already sent or cleared
      this.pieces.push({ text, end });
      this.pieces.sort((a, b) => a.end - b.end);
      return "final";
    }

    /** Finished text, in spoken order. */
    get finalText() {
      return this.pieces.map((p) => p.text).join(" ");
    }

    /** Finished text plus the piece still being spoken. */
    get displayText() {
      const live = this.interimStart >= this.consumedUntil - EPSILON ? this.interim : "";
      return [this.finalText, live].filter(Boolean).join(" ");
    }

    /**
     * Everything final has been sent as a command; speech still in flight is
     * kept. The sent turn's recap is already ignored (turnEnds has it), and its
     * later pieces begin where the sent one ended.
     */
    consume() {
      this.pieces = [];
    }

    /** Discard everything heard so far, including speech still in flight. */
    clear() {
      this.consumedUntil = Math.max(this.consumedUntil, this.heardUntil);
      this.pieces = [];
      this.interim = "";
    }
  }

  return GrokTranscript;
});
