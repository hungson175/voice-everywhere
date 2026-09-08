/**
 * Bar-window positioning — bottom-center of the display the user is on.
 *
 * POSITION CONTRACT (regression 2026-09-08): the bar must appear at the
 * bottom-center of the CURSOR display's workArea, repositioned on every
 * show. The old code pinned it once at launch to the PRIMARY display using
 * bounds-bottom with no display offset:
 *
 *   barX = (primary.workAreaSize.width - 600) / 2   // missing bounds.x
 *   barY = primary.bounds.y + primary.bounds.height - 56  // behind dock
 *
 * On stacked multi-monitor setups (e.g. ultrawide on top of the laptop)
 * that lands the bar on the wrong screen entirely — the user never looks
 * there — and flush with the screen edge (under the Dock). workArea
 * excludes the menu bar + Dock and already carries the display offset, so
 * bottom-center of workArea is correct on any display. Null-safe and
 * unit-testable without a live Electron runtime.
 */

"use strict";

const BAR_WIDTH = 600;
const BAR_HEIGHT = 56;
const BOTTOM_MARGIN = 12;

/**
 * Bottom-center bounds for the bar inside a display's workArea.
 * Pure function — takes the Electron Display object (or any { workArea }).
 */
function calcBarBounds(
  display,
  barWidth = BAR_WIDTH,
  barHeight = BAR_HEIGHT,
  margin = BOTTOM_MARGIN
) {
  const area = (display && display.workArea) || {};
  const ax = typeof area.x === "number" ? area.x : 0;
  const ay = typeof area.y === "number" ? area.y : 0;
  const aw = typeof area.width === "number" ? area.width : barWidth;
  const ah = typeof area.height === "number" ? area.height : barHeight;
  return {
    x: Math.round(ax + (aw - barWidth) / 2),
    y: Math.round(ay + ah - barHeight - margin),
    width: barWidth,
    height: barHeight,
  };
}

/**
 * Display the user is actually looking at: nearest to the mouse cursor,
 * falling back to primary when cursor APIs are unavailable or throw
 * (shutdown races, unit tests with stub screens).
 */
function chooseDisplay(screen) {
  if (!screen) return null;
  try {
    if (
      typeof screen.getCursorScreenPoint === "function" &&
      typeof screen.getDisplayNearestPoint === "function"
    ) {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    }
  } catch {
    // fall through to primary
  }
  try {
    if (typeof screen.getPrimaryDisplay === "function") {
      return screen.getPrimaryDisplay();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Move an existing bar BrowserWindow to the cursor display's bottom-center.
 * Never steals focus (position-only, no show). Returns the applied bounds,
 * or null when there is nothing to do. Never throws (IPC/shutdown safe).
 */
function placeBarWindow(win, screen, opts = {}) {
  if (!win || !screen) return null;
  try {
    if (typeof win.isDestroyed === "function" && win.isDestroyed()) return null;
    const display = chooseDisplay(screen);
    if (!display) return null;
    const bounds = calcBarBounds(
      display,
      opts.width || BAR_WIDTH,
      opts.height || BAR_HEIGHT,
      opts.margin !== undefined ? opts.margin : BOTTOM_MARGIN
    );
    if (typeof win.setPosition === "function") {
      win.setPosition(bounds.x, bounds.y);
    }
    return bounds;
  } catch {
    return null;
  }
}

module.exports = {
  BAR_WIDTH,
  BAR_HEIGHT,
  BOTTOM_MARGIN,
  calcBarBounds,
  chooseDisplay,
  placeBarWindow,
};
