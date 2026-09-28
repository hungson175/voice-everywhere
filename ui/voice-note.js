/**
 * The line that tells the reader a command was spoken, not typed.
 *
 * Speech-to-text makes typos, so every inserted command ends with this note on
 * its own line (Boss, 2026-09-28; same note as AI-teams-controller). Added
 * after the DeepSeek post-step, right before insertion.
 *
 * Loaded in bar.html (browser global) and requireable from Node tests.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.VoiceNote = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VOICE_INPUT_NOTE = "— voice input, be careful with typos";

  function markAsVoiceInput(command) {
    const text = String(command || "").trimEnd();
    return text ? `${text}\n${VOICE_INPUT_NOTE}` : "";
  }

  return { VOICE_INPUT_NOTE, markAsVoiceInput };
});
