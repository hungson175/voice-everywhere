# Architecture

Voice Everywhere is structured as an Electron macOS menubar app with two distinct renderer surfaces and a small main-process orchestration layer.

## High-level shape

```text
Global shortcut / tray / startup
        ↓
   electron/main.js
   ├─ Settings window (ui/index.html + ui/renderer.js)
   └─ Floating bar (ui/bar.html + ui/bar-renderer.js)
             ↓
         ui/stt.js
             ↓
        Soniox WebSocket STT
      + optional native translation
             ↓
   electron/text-inserter.js
      ├─ editable target → frontmost macOS application
      └─ no input target → disposable in-app scratchpad
```

## Why the app is split this way

The app needs a visible settings surface, an always-available dictation surface, and a file-free fallback editor. That is why `electron/main.js` creates:

- a **focusable settings window** for API keys and preferences
- a **non-focusable floating bar** for recording/transcript feedback
- a **focusable scratchpad window** only when there is no editable target

The bar is intentionally kept non-interactive at the window level (`focusable: false`, ignored mouse events) so dictation can continue while the user keeps working elsewhere.

## Main process responsibilities

`electron/main.js` owns the system-level orchestration:

- resolves `config.json` differently in dev vs packaged mode
- loads stored credentials and exports them to environment variables for the renderer/service layer
- checks Accessibility permission on startup
- grants microphone permission requests through the Electron session handler
- creates the tray icon and the two BrowserWindows
- registers the global shortcut `Control+Option+Command+V`
- handles IPC for showing/hiding the bar, saving/resetting credentials, copying to clipboard, and quitting

It also disables certain ScreenCaptureKit features on macOS because the repository history documents CPU burn issues on newer Electron/macOS combinations.

## Renderer responsibilities

### Settings window
`ui/renderer.js` handles settings and first-run configuration:

- manages Soniox correction terms and translation terms in `localStorage`
- manages the output language and enter-mode preferences
- opens the settings modal for editing terms
- sends credential updates to the main process through the preload bridge

### Floating bar
`ui/bar-renderer.js` implements the dictation state machine:

- `HIDDEN`
- `CONNECTING`
- `LISTENING`
- `PROCESSING`
- `INSERTING`
- `SUCCESS`
- `CLIPBOARD`
- `ERROR`

It also renders waveform feedback, transcript status, and the auto-return to listening after success/error.

### STT client
`ui/stt.js` is the Soniox streaming client:

- captures microphone audio via the Web Audio API
- converts audio to PCM and streams it over WebSocket
- separates original and translated Soniox tokens using `translation_status`
- rebuilds final/interim text for each token stream
- exposes an analyser node for the bar waveform

## Service-layer responsibilities

### Native translation
`ui/bar-renderer.js` maps the output-language setting to Soniox one-way translation (`en` or `vi`). `ui/stt.js` keeps original and translated tokens separate and falls back to the original command if translated tokens do not arrive after the stop word.

### Text insertion
`electron/text-inserter.js` is the most safety-critical module. It performs an Accessibility-based editability check before inserting text:

1. It copies dictated text to the clipboard.
2. For a confirmed editable target, it issues Cmd+V, optionally presses Enter, and restores the old clipboard.
3. For a confirmed non-editable target or no focused element, it opens the disposable scratchpad with the transcript prefilled.
4. If Accessibility is uncertain, it tries Cmd+V in the current target and keeps the transcript on the clipboard.

The scratchpad and uncertain-target paths both keep the transcript on the clipboard as a recovery mechanism. The scratchpad is renderer-only temporary state: closing it does not save or create a file.

### Credential storage
`electron/credentials.js` persists keys as JSON in the Electron user-data directory. The recent git history shows this replaced a Keychain/safeStorage approach because unsigned rebuilds broke decryption across code-signing identity changes.

## Important design constraints

- Focus must remain on the user’s target app while dictating.
- Clipboard state is part of the insertion contract, not a side effect to ignore.
- Soniox config is source-controlled in `config.json`, but the credential is local machine state.
- The renderer uses localStorage for user preferences and term lists, which means migrations need to account for stale stored defaults.

## Change hotspots

- `electron/main.js` — window lifecycle, permissions, shortcuts, IPC
- `ui/bar-renderer.js` — dictation state transitions and UI feedback
- `ui/stt.js` — microphone and Soniox protocol changes
- `electron/text-inserter.js` — clipboard and Accessibility behavior
- `electron/credentials.js` — local credential storage behavior

## Source evidence

- `electron/main.js`
- `ui/bar-renderer.js`
- `ui/stt.js`
- `electron/text-inserter.js`
- `electron/credentials.js`
- git commits `0df2837`, `e222549`, `7196f84`, `4188d04`
