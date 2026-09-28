/**
 * Every voice command ends with a short note, on its own line, so the reader
 * (usually an AI agent) knows it was spoken and may contain STT typos.
 * Same note as AI-teams-controller (9547d7b6).
 *
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { VOICE_INPUT_NOTE, markAsVoiceInput } = require("../ui/voice-note.js");

test("the note is short", () => {
  assert.equal(VOICE_INPUT_NOTE, "— voice input, be careful with typos");
});

test("goes on its own last line", () => {
  assert.equal(markAsVoiceInput("fix the bug"), "fix the bug\n— voice input, be careful with typos");
});

test("trailing whitespace of the command is dropped first", () => {
  assert.equal(markAsVoiceInput("fix the bug,  \n"), "fix the bug,\n— voice input, be careful with typos");
});

test("an empty command stays empty (nothing is inserted)", () => {
  assert.equal(markAsVoiceInput("   "), "");
});
