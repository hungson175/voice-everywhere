/**
 * Bar-window positioning tests — bottom-center of the cursor display.
 *
 * REGRESSION (2026-09-08): the bar was pinned once at launch to the PRIMARY
 * display using bounds-bottom with no display offset:
 *   barX = (primary.workAreaSize.width - 600) / 2   // missing bounds.x
 *   barY = primary.bounds.y + primary.bounds.height - 56  // behind Dock
 * On stacked multi-monitor setups (ultrawide on top of the laptop) the bar
 * landed on the wrong screen entirely, flush with the screen edge. The bar
 * must sit bottom-center of the CURSOR display's workArea (which excludes
 * the menu bar + Dock and carries the display offset), repositioned on
 * every show so it follows the user across monitors.
 *
 * Targets electron/bar-position.js — pure + unit-testable without Electron.
 *
 * Run: npm test (node --test tests/*.test.js)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  BAR_WIDTH,
  BAR_HEIGHT,
  BOTTOM_MARGIN,
  calcBarBounds,
  chooseDisplay,
  placeBarWindow,
} = require("../electron/bar-position.js");

// Ground truth from Boss's machine (2026-09-08, Electron screen API):
const LAPTOP = {
  // primary, below
  bounds: { x: 0, y: 0, width: 1728, height: 1117 },
  workArea: { x: 0, y: 33, width: 1728, height: 1084 },
};
const ULTRAWIDE = {
  // stacked on top, cursor lives here
  bounds: { x: -1525, y: -1440, width: 5120, height: 1440 },
  workArea: { x: -1525, y: -1410, width: 5120, height: 1410 },
};

function fakeScreen({ cursorDisplay, primaryDisplay }) {
  return {
    getCursorScreenPoint() { return { x: 890, y: -138 }; },
    getDisplayNearestPoint() { return cursorDisplay; },
    getPrimaryDisplay() { return primaryDisplay; },
  };
}

function fakeWin() {
  const calls = [];
  return {
    calls,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    setPosition(x, y) { calls.push(["setPosition", x, y]); },
  };
}

describe("calcBarBounds — bottom-center of workArea", () => {
  test("laptop: centered horizontally, above bottom edge with margin", () => {
    const b = calcBarBounds(LAPTOP);
    assert.equal(b.width, BAR_WIDTH);
    assert.equal(b.height, BAR_HEIGHT);
    assert.equal(b.x, Math.round(0 + (1728 - 600) / 2)); // 564
    assert.equal(b.y, 33 + 1084 - 56 - BOTTOM_MARGIN); // 1049, not 1061 (old bounds-bottom)
  });

  test("ultrawide with negative offset: honors workArea.x", () => {
    const b = calcBarBounds(ULTRAWIDE);
    // Old code produced x=564 (primary-centered, off-center here) and y on
    // the wrong screen; must be centered on THIS display instead.
    assert.equal(b.x, Math.round(-1525 + (5120 - 600) / 2)); // 735
    assert.equal(b.y, Math.round(-1410 + 1410 - 56 - BOTTOM_MARGIN)); // -68
  });

  test("sits inside workArea, never flush with the physical screen edge", () => {
    for (const d of [LAPTOP, ULTRAWIDE]) {
      const b = calcBarBounds(d);
      assert.ok(b.x >= d.workArea.x, "left edge inside workArea");
      assert.ok(
        b.x + b.width <= d.workArea.x + d.workArea.width,
        "right edge inside workArea"
      );
      assert.equal(
        b.y + b.height,
        d.workArea.y + d.workArea.height - BOTTOM_MARGIN,
        "bottom edge exactly margin above workArea bottom (above Dock)"
      );
    }
  });

  test("missing workArea falls back to origin instead of NaN", () => {
    const b = calcBarBounds({});
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  });
});

describe("chooseDisplay — cursor display wins, primary is fallback", () => {
  test("returns the display nearest the cursor", () => {
    const screen = fakeScreen({ cursorDisplay: ULTRAWIDE, primaryDisplay: LAPTOP });
    assert.equal(chooseDisplay(screen), ULTRAWIDE);
  });

  test("falls back to primary when cursor APIs are missing", () => {
    const screen = { getPrimaryDisplay: () => LAPTOP };
    assert.equal(chooseDisplay(screen), LAPTOP);
  });

  test("falls back to primary when cursor APIs throw (shutdown races)", () => {
    const screen = {
      getCursorScreenPoint() { throw new Error("gone"); },
      getDisplayNearestPoint() { throw new Error("gone"); },
      getPrimaryDisplay: () => LAPTOP,
    };
    assert.equal(chooseDisplay(screen), LAPTOP);
  });

  test("null-safe", () => {
    assert.equal(chooseDisplay(null), null);
    assert.equal(chooseDisplay(undefined), null);
  });
});

describe("placeBarWindow — position-only move, never throws", () => {
  test("moves the window to the cursor display bottom-center", () => {
    const win = fakeWin();
    const screen = fakeScreen({ cursorDisplay: ULTRAWIDE, primaryDisplay: LAPTOP });
    const bounds = placeBarWindow(win, screen);
    assert.deepEqual(bounds, {
      x: Math.round(-1525 + (5120 - 600) / 2),
      y: Math.round(-1410 + 1410 - 56 - BOTTOM_MARGIN),
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
    });
    assert.deepEqual(win.calls, [["setPosition", bounds.x, bounds.y]]);
  });

  test("skips destroyed windows", () => {
    const win = fakeWin();
    win.destroyed = true;
    const screen = fakeScreen({ cursorDisplay: ULTRAWIDE, primaryDisplay: LAPTOP });
    assert.equal(placeBarWindow(win, screen), null);
    assert.equal(win.calls.length, 0);
  });

  test("null-safe (shutdown races)", () => {
    const screen = fakeScreen({ cursorDisplay: ULTRAWIDE, primaryDisplay: LAPTOP });
    assert.equal(placeBarWindow(null, screen), null);
    assert.equal(placeBarWindow(fakeWin(), null), null);
    assert.equal(placeBarWindow(null, null), null);
  });
});
