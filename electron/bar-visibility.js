/**
 * Bar-window visibility helpers — testable show/hide contract.
 *
 * SPACES CONTRACT (regression 2026-09-05): the bar window must stay SHOWN
 * for the lifetime of the app. An earlier idle-CPU fix called win.hide() on
 * HIDDEN and the hide/show cycle broke macOS Spaces pinning — the bar then
 * appeared on only one Space. The idle-CPU root cause was stacking rAF
 * loops + incomplete audio teardown (see ui/audio-lifecycle.js), NOT the
 * shown window, so HIDDEN only flips CSS (.bar.hidden = opacity 0 +
 * pointer-events none) and makes the window click-through. Never hide —
 * hiding drops the window from every Space but the current one.
 *
 * Used by electron/main.js for the show-bar/hide-bar IPC handlers and the
 * initial state. Null-safe for shutdown races.
 */

"use strict";

function hideBarWindow(win) {
  if (!win) return;
  try {
    // Click-through while CSS-hidden; the window itself stays shown so macOS
    // keeps it pinned to all Spaces.
    if (typeof win.setIgnoreMouseEvents === "function") {
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  } catch {
    // shutdown races must never throw out of IPC handlers
  }
}

function showBarWindow(win) {
  if (!win) return;
  try {
    // showInactive first (never steals focus), then re-pin to all Spaces —
    // pinning must be (re-)applied to a shown window to stick across Spaces
    // and fullscreen.
    if (typeof win.showInactive === "function") {
      win.showInactive();
    } else if (typeof win.show === "function") {
      win.show();
    }
    if (typeof win.setVisibleOnAllWorkspaces === "function") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  } catch {
    // shutdown races must never throw out of IPC handlers
  }
}

function setBarVisible(win, visible) {
  if (visible) showBarWindow(win);
  else hideBarWindow(win);
}

module.exports = { hideBarWindow, showBarWindow, setBarVisible };
