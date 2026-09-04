/**
 * Bar-window visibility helpers — testable show/hide contract.
 *
 * Idle-CPU fix: the bar is a transparent always-on-top window with
 * backdrop-filter:blur(20px). Keeping it "shown" 24/7 with only CSS opacity
 * hiding it forces the Chromium compositor/GPU to composite it every frame
 * while the mic is OFF. HIDDEN must REALLY hide the window; toggle re-shows
 * with showInactive() (never steals focus) + setVisibleOnAllWorkspaces so
 * cross-Spaces pinning survives the hide/show cycle (hide() preserves the
 * flag; we re-apply defensively).
 *
 * Used by electron/main.js for the show-bar/hide-bar IPC handlers and the
 * initial hidden state. Null-safe for shutdown races.
 */

"use strict";

function hideBarWindow(win) {
  if (!win || typeof win.hide !== "function") return;
  try {
    win.hide();
  } catch {
    // shutdown races must never throw out of IPC handlers
  }
}

function showBarWindow(win) {
  if (!win) return;
  try {
    if (typeof win.setVisibleOnAllWorkspaces === "function") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (typeof win.showInactive === "function") {
      win.showInactive();
    } else if (typeof win.show === "function") {
      win.show();
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
