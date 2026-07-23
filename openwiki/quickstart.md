# OpenWiki Quickstart

Voice Everywhere is a macOS Electron menubar app for global voice input. It records microphone audio, streams it to Soniox for speech-to-text and optional native translation, then inserts the result at the cursor or opens it in a new TextEdit draft when no input field is focused.

## At a glance

- **Runtime**: Electron main process + renderer windows (`electron/main.js`, `ui/*.js`)
- **Primary flow**: mic → Soniox STT/native translation → cursor paste or TextEdit draft
- **Configuration**: `config.json` for STT defaults
- **Credentials**: saved locally in the Electron user-data path (`electron/credentials.js`)
- **Tests**: Node test runner under `tests/`
- **Packaging**: `electron-builder` for macOS in `package.json`

## Start here

- [Architecture](architecture.md) — how the two-window Electron app is wired
- [Workflows](workflows.md) — launch, setup, dictation, insertion, and settings flows
- [Integrations](integrations.md) — Soniox, macOS permissions, clipboard, AppleScript
- [Testing](testing.md) — current test coverage and verification guidance

## What the app does

From `README.md` and the source:

1. The user starts dictation from the global shortcut `Control+Option+Command+V` or the mic UI.
2. `ui/stt.js` opens the microphone with the Web Audio API and streams PCM audio to Soniox over WebSocket.
3. Soniox returns final and interim tokens. Native translation mode returns original and translated tokens together, which `ui/stt.js` separates.
4. `electron/text-inserter.js` uses an Accessibility check to paste the selected result into a focused input, open a new TextEdit draft for a confirmed non-input target, or preserve the text on the clipboard when the check is uncertain.

## Important constraints

- This app is designed to work in **any** macOS app, so focus-stealing UI interactions are intentionally minimized.
- Text insertion is conservative: the transcript stays on the clipboard when TextEdit is used or when target detection is uncertain, so dictated text is not lost.
- Accessibility permission is required for insertion; microphone access is requested for the STT pipeline.
- The current credential store is a plain JSON file in the Electron user-data path, not Keychain.

## Repository map

### Main process
- `electron/main.js` — app startup, tray, windows, permissions, IPC, shortcut registration
- `electron/credentials.js` — credential storage and retrieval
- `electron/text-inserter.js` — clipboard paste and editability checks
- `electron/preload.js` — IPC bridge for the UI

### Renderer UI
- `ui/index.html`, `ui/renderer.js`, `ui/styles.css` — settings and setup window
- `ui/bar.html`, `ui/bar-renderer.js`, `ui/bar-styles.css` — floating dictation bar
- `ui/stt.js` — Soniox WebSocket client and audio capture
- `ui/setup.html`, `ui/setup.js` — first-run credential entry flow

### Tests and docs
- `tests/*.test.js` — Node tests around Soniox config and text insertion behavior
- `README.md` — user-facing overview and install instructions
- `lt-memory/` — legacy project memory that still explains some design decisions and pitfalls

## Current architecture summary

The app uses two windows:

- **Settings window**: visible, focusable window for credentials and app settings
- **Floating bar**: always-on-top, non-focusable overlay that tracks dictation state without stealing focus from the target app

That split exists because the core product requirement is to insert text into other apps without breaking the user’s current focus.

## How to change things safely

- If you touch audio capture or Soniox config, check `ui/stt.js` and the Soniox contract test in `tests/soniox-config.test.js`.
- If you touch insertion behavior, review `electron/text-inserter.js` and its tests; clipboard restoration is intentionally conditional.
- If you touch settings or credential flow, inspect `electron/main.js`, `electron/credentials.js`, and the setup/renderer pages together.
- If you change defaults in `config.json`, make sure the renderer settings migration/versioning still makes sense.
- If you change the bar state machine, verify the interaction between `ui/bar-renderer.js` and `electron/main.js` IPC.

## Useful source evidence

- `package.json` for scripts and packaging metadata
- `config.json` for Soniox defaults
- `electron/main.js` for app lifecycle and window model
- `ui/bar-renderer.js` for the dictation pipeline state machine
- `electron/text-inserter.js` for clipboard behavior and Accessibility gating
- `tests/` for executable contracts
