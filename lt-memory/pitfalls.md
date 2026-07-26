# Pitfalls

Known gotchas and hard-earned lessons. Read before modifying tricky areas.

## Soniox STT

- WebSocket URL must be `wss://stt-rt.soniox.com/transcribe-websocket` (NOT old `wss://api.soniox.com/...`)
- Sending JSON after initial config message crashes the connection silently — first message is JSON config, then ONLY binary audio frames
- Translation terms format: `[{source, target}]` array, NOT `{key: value}` map
- Native translation tokens share the same response stream as original tokens. Filter on `translation_status === "translation"`; otherwise the result contains both languages.
- One-way translation is configured in the first WebSocket message. There is no documented WebSocket parameter for guaranteed filler/disfluency removal.
- Max stream duration: 300 minutes per connection; reconnect for longer sessions

## API Keys / Credentials

- The app reads the Soniox key **exclusively** from `~/Library/Application Support/voice-everywhere/credentials.json` (`sonioxKey`). By design there is **no shell-env / `.env` fallback** (see `electron/main.js` `loadApiKeys`).
- Symptom → cause: bar shows **"STT error"** = Soniox WebSocket/key problem (invalid key returns `error_message: "Incorrect API key provided"`); **"Mic error: …"** = mic permission/getUserMedia. They are distinct.
- Recovery when the key goes stale (keys rotate/expire): reset credentials in the app, enter a fresh Soniox key, then restart the app because it loads the key once at startup.
- v2 removes the external LLM layer. On first v2 launch, the legacy `geminiKey` field is deleted from `credentials.json`.

## Electron

- Audio uses Web Audio API in renderer (MediaDevices.getUserMedia), NOT SoX — no native dependencies needed
- WebSocket for Soniox STT runs in renderer (browser WebSocket) — `ws` npm package does not work in renderer with contextIsolation
- Build: Must use `CSC_IDENTITY_AUTO_DISCOVERY=false` or electron-builder hangs on code signing
- `app.on("window-all-closed", () => {})` is required — without it, macOS quits when window closes
- UI buttons that trigger IPC calls (like resend/insert) steal focus from the target app — avoid action buttons that need the target app focused
- Text fallback: a confirmed non-editable target or no focused element opens the disposable in-app scratchpad. An uncertain AX result must not open the scratchpad automatically; try the current target and keep the transcript on the clipboard instead.
- Chromium auto-enables `ScreenCaptureKitPickerScreen` + `ScreenCaptureKitStreamPickerSonoma` on macOS — GPU process burns ~18% CPU doing nothing. Fix: `app.commandLine.appendSwitch("disable-features", "ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma")` and `app.commandLine.appendSwitch("disable-gpu")` for audio-only apps
