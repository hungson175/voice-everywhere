/**
 * Tests for the text inserter's clipboard contract.
 *
 * Unit tests inject fake osascript/clipboard so NO real keystrokes are sent
 * and the real clipboard is untouched. The one integration test runs the real
 * AX osascript check (read-only) and only asserts the result is a valid value.
 *
 * Run: npm test  (node --test tests/*.test.js)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// text-inserter requires("electron") at module load; in plain Node that
// resolves to the electron package's index.js (a path string) so `clipboard`
// is undefined — fine, because every test injects its own clipboard.
const {
  insertText,
  checkFocusedEditable,
  parseEditability,
} = require("../electron/text-inserter.js");

// --- Test doubles ---

function fakeClipboard(initial = "") {
  let content = initial;
  const writes = [];
  return {
    readText: () => content,
    writeText: (t) => { content = t; writes.push(t); },
    get current() { return content; },
    get writes() { return writes; },
  };
}

/** osascript double: returns axResult for the AX check, records keystrokes. */
function fakeOsascript(axResult) {
  const calls = [];
  const fn = async (script) => {
    calls.push(script);
    if (script.includes("AXFocusedUIElement")) {
      if (axResult instanceof Error) throw axResult;
      return axResult;
    }
    return "";
  };
  fn.calls = calls;
  fn.pastes = () => calls.filter((s) => s.includes('keystroke "v"')).length;
  fn.enters = () => calls.filter((s) => s.includes("key code 36")).length;
  return fn;
}

function fakeDraftOpener() {
  const texts = [];
  const fn = async (text) => {
    texts.push(text);
    return { draftApp: "Scratchpad" };
  };
  fn.texts = texts;
  return fn;
}

const noSleep = async () => {};

// --- Unit: parseEditability classification ---

describe("parseEditability", () => {
  test("text-input roles are editable", () => {
    for (const role of ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"]) {
      assert.equal(parseEditability(`${role}|true`), "editable", role);
    }
  });

  test("non-input roles are not editable", () => {
    for (const role of ["AXButton", "AXWebArea", "AXStaticText", "AXImage", "AXWindow"]) {
      assert.equal(parseEditability(`${role}|false`), "not_editable", role);
    }
  });

  test("a settable AXValue is editable even for a non-standard role", () => {
    assert.equal(parseEditability("AXWebArea|true"), "editable");
  });

  test("no focused element is classified separately", () => {
    assert.equal(parseEditability("NO_FOCUS|false"), "no_focus");
  });

  test("empty/garbage output is never treated as editable", () => {
    assert.equal(parseEditability(""), "unknown");
    assert.notEqual(parseEditability("garbage"), "editable");
    assert.notEqual(parseEditability(undefined), "editable");
  });
});

// --- Unit: insertText clipboard contract ---

describe("insertText — editable target", () => {
  test("pastes, presses Enter, and restores the old clipboard", async () => {
    const clip = fakeClipboard("OLD CLIPBOARD");
    const osa = fakeOsascript("AXTextField|true");

    const result = await insertText("hello world", { enterMode: true },
      { osascript: osa, clipboard: clip, sleep: noSleep });

    assert.equal(result.clipboardFallback, false);
    assert.equal(result.editability, "editable");
    assert.equal(result.openedDraft, false);
    assert.equal(osa.pastes(), 1);
    assert.equal(osa.enters(), 1);
    // text was put on clipboard for the paste, then old content restored
    assert.deepEqual(clip.writes, ["hello world", "OLD CLIPBOARD"]);
    assert.equal(clip.current, "OLD CLIPBOARD");
  });

  test("no Enter when enterMode is off", async () => {
    const clip = fakeClipboard("x");
    const osa = fakeOsascript("AXTextArea|true");
    await insertText("hi", { enterMode: false },
      { osascript: osa, clipboard: clip, sleep: noSleep });
    assert.equal(osa.enters(), 0);
  });
});

describe("insertText — non-editable target", () => {
  test("opens the disposable scratchpad and keeps the transcript on the clipboard", async () => {
    const clip = fakeClipboard("OLD CLIPBOARD");
    const osa = fakeOsascript("AXButton|false");
    const openDraft = fakeDraftOpener();

    const result = await insertText("dictated text", { enterMode: true },
      { osascript: osa, clipboard: clip, sleep: noSleep, openDraft });

    assert.equal(result.clipboardFallback, false);
    assert.equal(result.editability, "not_editable");
    assert.equal(result.openedDraft, true);
    assert.equal(result.draftApp, "Scratchpad");
    assert.deepEqual(openDraft.texts, ["dictated text"]);
    assert.equal(osa.pastes(), 0);
    assert.equal(osa.enters(), 0);
    assert.equal(clip.current, "dictated text");
  });

  test("AX check failure falls back safely (unknown)", async () => {
    const clip = fakeClipboard("OLD CLIPBOARD");
    const osa = fakeOsascript(new Error("osascript timed out"));

    const result = await insertText("dictated text", { enterMode: true },
      { osascript: osa, clipboard: clip, sleep: noSleep });

    assert.equal(result.clipboardFallback, true);
    assert.equal(result.editability, "unknown");
    assert.equal(result.openedDraft, false);
    assert.equal(osa.pastes(), 1);
    assert.equal(osa.enters(), 0);
    assert.equal(clip.current, "dictated text");
  });

  test("no focused element opens the disposable scratchpad", async () => {
    const clip = fakeClipboard("OLD");
    const osa = fakeOsascript("NO_FOCUS|false");
    const openDraft = fakeDraftOpener();
    const result = await insertText("t", {},
      { osascript: osa, clipboard: clip, sleep: noSleep, openDraft });
    assert.equal(result.clipboardFallback, false);
    assert.equal(result.editability, "no_focus");
    assert.equal(result.openedDraft, true);
    assert.deepEqual(openDraft.texts, ["t"]);
    assert.equal(clip.current, "t");
  });
});

// --- Integration: real AX check (read-only, macOS only) ---

describe("integration — real osascript AX check", { skip: process.platform !== "darwin" }, () => {
  test("checkFocusedEditable returns a valid classification", async () => {
    const result = await checkFocusedEditable();
    assert.ok(
      ["editable", "not_editable", "no_focus", "unknown"].includes(result),
      `unexpected: ${result}`
    );
  });
});
