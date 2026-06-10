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

  test("no focused element is unknown", () => {
    assert.equal(parseEditability("NO_FOCUS|false"), "unknown");
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

describe("insertText — non-editable target (the bug this guards against)", () => {
  test("keeps text on clipboard, does NOT restore, does NOT press Enter", async () => {
    const clip = fakeClipboard("OLD CLIPBOARD");
    const osa = fakeOsascript("AXButton|false");

    const result = await insertText("dictated text", { enterMode: true },
      { osascript: osa, clipboard: clip, sleep: noSleep });

    assert.equal(result.clipboardFallback, true);
    assert.equal(result.editability, "not_editable");
    // paste still attempted (harmless no-op; covers AX false-negatives)
    assert.equal(osa.pastes(), 1);
    // Enter suppressed — could trigger a default button on unknown targets
    assert.equal(osa.enters(), 0);
    // THE core guarantee: dictated text survives on the clipboard
    assert.equal(clip.current, "dictated text");
  });

  test("AX check failure falls back safely (unknown)", async () => {
    const clip = fakeClipboard("OLD CLIPBOARD");
    const osa = fakeOsascript(new Error("osascript timed out"));

    const result = await insertText("dictated text", { enterMode: true },
      { osascript: osa, clipboard: clip, sleep: noSleep });

    assert.equal(result.clipboardFallback, true);
    assert.equal(result.editability, "unknown");
    assert.equal(osa.enters(), 0);
    assert.equal(clip.current, "dictated text");
  });

  test("no focused element falls back safely", async () => {
    const clip = fakeClipboard("OLD");
    const osa = fakeOsascript("NO_FOCUS|false");
    const result = await insertText("t", {},
      { osascript: osa, clipboard: clip, sleep: noSleep });
    assert.equal(result.clipboardFallback, true);
    assert.equal(clip.current, "t");
  });
});

// --- Integration: real AX check (read-only, macOS only) ---

describe("integration — real osascript AX check", { skip: process.platform !== "darwin" }, () => {
  test("checkFocusedEditable returns a valid classification", async () => {
    const result = await checkFocusedEditable();
    assert.ok(
      ["editable", "not_editable", "unknown"].includes(result),
      `unexpected: ${result}`
    );
  });
});
