/**
 * Bar-window visibility tests — Spaces-pinning contract.
 *
 * REGRESSION (2026-09-05): the idle-CPU fix called win.hide() on HIDDEN.
 * The hide/show cycle broke macOS Spaces pinning — the bar then appeared
 * only on one Space instead of all of them (pre-fix, always-shown behavior).
 * The 30% idle CPU was caused by stacking rAF loops + incomplete audio
 * teardown (covered by audio-lifecycle/stt-teardown tests), NOT by the
 * shown window — so HIDDEN must NEVER hide the window. CSS opacity 0 +
 * pointer-events none (bar-styles.css .bar.hidden) is the invisibility
 * mechanism; the window stays shown and pinned to all Spaces 24/7.
 *
 * These tests target electron/bar-visibility.js so the contract is
 * unit-testable without a live Electron runtime.
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
    ignoreMouseEvents: false,
    isVisible() { return this.visible; },
    hide() { this.visible = false; calls.push("hide"); },
    showInactive() { this.visible = true; calls.push("showInactive"); },
    setIgnoreMouseEvents(ignore, opts) {
      this.ignoreMouseEvents = ignore;
      calls.push(["setIgnoreMouseEvents", ignore, opts]);
    },
    setVisibleOnAllWorkspaces(flag, opts) {
      calls.push(["setVisibleOnAllWorkspaces", flag, opts]);
    },
  };
}

describe("bar-visibility — window stays shown on all Spaces, CSS hides it", () => {
  test("hideBarWindow NEVER hides the window (Spaces pinning would break)", () => {
    const win = fakeBarWindow();
    hideBarWindow(win);
    assert.ok(!win.calls.includes("hide"), "HIDDEN hid the window — bar breaks across Spaces");
    assert.equal(win.isVisible(), true);
  });

  test("hideBarWindow makes the window click-through while CSS-hidden", () => {
    const win = fakeBarWindow();
    hideBarWindow(win);
    const mouse = win.calls.find(
      (c) => Array.isArray(c) && c[0] === "setIgnoreMouseEvents"
    );
    assert.ok(mouse, "hidden bar must ignore mouse events (CSS is opacity-only)");
    assert.equal(mouse[1], true);
  });

  test("hideBarWindow is null-safe (called during shutdown races)", () => {
    hideBarWindow(null);
    hideBarWindow(undefined);
  });

  test("showBarWindow re-shows without focus and re-pins to all Spaces", () => {
    const win = fakeBarWindow();
    hideBarWindow(win);
    showBarWindow(win);
    assert.ok(win.calls.includes("showInactive"), "re-show must use showInactive (never steal focus)");
    const pin = win.calls.find(
      (c) => Array.isArray(c) && c[0] === "setVisibleOnAllWorkspaces"
    );
    assert.ok(pin, "setVisibleOnAllWorkspaces not re-applied");
    assert.equal(pin[1], true);
    assert.equal(pin[2]?.visibleOnFullScreen, true);
    assert.equal(win.isVisible(), true);
  });

  test("setBarVisible(false) keeps window shown; setBarVisible(true) restores", () => {
    const win = fakeBarWindow();
    setBarVisible(win, false);
    assert.equal(win.isVisible(), true);
    assert.ok(!win.calls.includes("hide"));
    setBarVisible(win, true);
    assert.equal(win.isVisible(), true);
    assert.ok(win.calls.includes("showInactive"));
  });
});
