# Pitfalls

Known gotchas and hard-earned lessons. Read before modifying tricky areas.

## Soniox STT

- WebSocket URL must be `wss://stt-rt.soniox.com/transcribe-websocket` (NOT old `wss://api.soniox.com/...`)
- Sending JSON after initial config message crashes the connection silently — first message is JSON config, then ONLY binary audio frames
- Translation terms format: `[{source, target}]` array, NOT `{key: value}` map
- Max stream duration: 300 minutes per connection; reconnect for longer sessions

## API Keys / Credentials

- The app reads API keys **exclusively** from `~/Library/Application Support/voice-everywhere/credentials.json` (`geminiKey`, `sonioxKey`). By design there is **no shell-env / `.env` fallback** (see `electron/main.js` `loadApiKeys`) — so a stale key in `credentials.json` keeps failing even if `~/dev/.env` has a good one.
- Symptom → cause: bar shows **"STT error"** = Soniox WebSocket/key problem (invalid key returns `error_message: "Incorrect API key provided"`); **"Mic error: …"** = mic permission/getUserMedia. They are distinct.
- Recovery when a key goes stale (keys rotate/expire): write a fresh key into `credentials.json` then **restart the app** (it loads keys once at startup). Valid keys live in `~/dev/.env` — Soniox at `SONIOX_API_KEY`, Gemini at `GEMINI_API_KEY`/`GOOGLE_API_KEY` (the macOS `~/dev/.env` Gemini key was expired once; the working one came from **local-pc** `~/dev/.env` `GOOGLE_API_KEY`).
- LLM provider migrated xAI Grok → Gemini 2.5 Flash Lite via Google's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `reasoning_effort: "none"`).

## Electron

- Audio uses Web Audio API in renderer (MediaDevices.getUserMedia), NOT SoX — no native dependencies needed
- WebSocket for Soniox STT runs in renderer (browser WebSocket) — `ws` npm package does not work in renderer with contextIsolation
- Build: Must use `CSC_IDENTITY_AUTO_DISCOVERY=false` or electron-builder hangs on code signing
- `app.on("window-all-closed", () => {})` is required — without it, macOS quits when window closes
- UI buttons that trigger IPC calls (like resend/insert) steal focus from the target app — avoid action buttons that need the target app focused
- Chromium auto-enables `ScreenCaptureKitPickerScreen` + `ScreenCaptureKitStreamPickerSonoma` on macOS — GPU process burns ~18% CPU doing nothing. Fix: `app.commandLine.appendSwitch("disable-features", "ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma")` and `app.commandLine.appendSwitch("disable-gpu")` for audio-only apps
