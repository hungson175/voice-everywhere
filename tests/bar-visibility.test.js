/**
 * Bar-window visibility tests (TDD — must FAIL before the fix).
 *
 * Suspect in electron/main.js: barWin is a transparent always-on-top
 * visibleOnAllWorkspaces window kept "shown" 24/7 via showInactive() with
 * only CSS opacity hiding it. A transparent + backdrop-filter:blur(20px)
 * window that is never really hidden keeps the Chromium compositor/GPU
 * working while the mic is OFF. Expected: HIDDEN really hides the window
 * (near-0 CPU/GPU); toggle re-shows with showInactive() +
 * setVisibleOnAllWorkspaces so cross-Spaces behavior is preserved.
 *
 * These tests target the extracted helper electron/bar-visibility.js so the
 * show/hide contract is unit-testable without a live Electron runtime.
 *
 * Run: npm test (node --test tests/*.test.js)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  hideBarWindow,
  showBarWindow,
  setBarVisible,
} = require("../electron/bar-visibility.js");

function fakeBarWindow() {
  const calls = [];
  return {
    calls,
    visible: true,
    isVisible() { return this.visible; },
    hide() { this.visible = false; calls.push("hide"); },
    showInactive() { this.visible = true; calls.push("showInactive"); },
    setVisibleOnAllWorkspaces(flag, opts) {
      calls.push(["setVisibleOnAllWorkspaces", flag, opts]);
    },
  };
}

describe("bar-visibility — really hide when HIDDEN, restore on toggle", () => {
  test("hideBarWindow really hides the window (no 24/7 compositor work)", () => {
    const win = fakeBarWindow();
    hideBarWindow(win);
    assert.ok(win.calls.includes("hide"), "HIDDEN did not hide the window — compositor keeps running");
    assert.equal(win.isVisible(), false);
  });

  test("hideBarWindow is null-safe (called during shutdown races)", () => {
    hideBarWindow(null);
    hideBarWindow(undefined);
  });

  test("showBarWindow re-shows without focus and restores cross-Spaces pinning", () => {
    const win = fakeBarWindow();
    hideBarWindow(win);
    showBarWindow(win);
    assert.ok(win.calls.includes("showInactive"), "re-show must use showInactive (never steal focus)");
    const pin = win.calls.find(
      (c) => Array.isArray(c) && c[0] === "setVisibleOnAllWorkspaces"
    );
    assert.ok(pin, "setVisibleOnAllWorkspaces not re-applied — bar breaks across Spaces");
    assert.equal(pin[1], true);
    assert.equal(pin[2]?.visibleOnFullScreen, true);
    assert.equal(win.isVisible(), true);
  });

  test("setBarVisible(false) hides; setBarVisible(true) restores", () => {
    const win = fakeBarWindow();
    setBarVisible(win, false);
    assert.equal(win.isVisible(), false);
    setBarVisible(win, true);
    assert.equal(win.isVisible(), true);
    assert.ok(win.calls.includes("showInactive"));
  });
});
