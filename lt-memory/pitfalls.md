# Pitfalls

Known gotchas and hard-earned lessons. Read before modifying tricky areas.

## Soniox STT

- WebSocket URL must be `wss://stt-rt.soniox.com/transcribe-websocket` (NOT old `wss://api.soniox.com/...`)
- Sending JSON after initial config message crashes the connection silently — first message is JSON config, then ONLY binary audio frames
- Translation terms format: `[{source, target}]` array, NOT `{key: value}` map
- Native translation tokens share the same response stream as original tokens. Filter on `translation_status === "translation"`; otherwise the result contains both languages.
- One-way translation is configured in the first WebSocket message. There is no documented WebSocket parameter for guaranteed filler/disfluency removal.
- Max stream duration: 300 minutes per connection; the bar reconnects on its own (see "Dropped connections")
- **Endpoint detection (2026-09-28, from AI-teams-controller 6bd7703e).** Without `enable_endpoint_detection`, Soniox keeps the last words — the stop word with them — non-final for ~6 s, and the bar only checks the stop word on final text. Measured live, same recorded command, end of speech → command sent: **off 6.1–6.2 s, on 0.52–0.54 s**. With it on, Soniox ends each utterance with a final `<end>` token in the SAME message as the stop word; `SonioxSTT._handleMessage` drops whole-token markers (`/^<[a-z]+>$/`: `<end>`, `<fin>`), else "thank you.<end>" never matches and NOTHING is sent. A mid-sentence pause now finalizes early; the next words arrive with a leading space, so they still join into one command. Rollback: `"enable_endpoint_detection": false` in `config.json`. Never benchmark with a forced end-of-audio signal — it makes both settings look fast.

## Grok (xAI) engine

- **Key stays in main.** xAI's socket authenticates with an `Authorization` header (a browser WebSocket cannot set one) and xAI says never to ship the key to a client. `electron/grok-relay.js` holds `XAI_API_KEY` (project `.env`); the bar streams PCM over IPC (`grok-open` / `grok-audio` / `grok-close`, events on `grok-event`). `GrokIpcSocket` (`ui/grok-stt.js`) makes the IPC session look like a WebSocket so `MicStreamSTT` runs unchanged.
- **Ready = `transcript.created`.** Audio sent before it is lost; the relay resolves `grok-open` only after it.
- **Protocol:** an interim carries the PIECE's `start`; a finished piece (`is_final`) carries the TURN's `start` and ONLY its own text; `speech_final` repeats the whole turn. Never key pieces by `start` — that cut the middle out of commands in AI-teams-controller. `ui/grok-transcript.js` appends pieces and ignores a recap unless its turn had no piece (fixture `tests/fixtures/grok-turn-three-pieces.json`).
- **Node's WebSocket (Electron main) reports a refused handshake with an `error` event and NO `close`.** Handle both, or `grok-open` hangs until its 10 s timeout.
- **xAI answers an incorrect key with HTTP 400** ("Incorrect API key provided"), not 401. On a failed handshake the relay asks `GET /v1/models` once: 400/401/403 → "Grok key rejected" (definite, not retried). Test a key: `curl https://api.x.ai/v1/models -H "Authorization: Bearer $XAI_API_KEY"`.
- Latency, same recording, end of speech → command sent: Grok ~0.95 s (endpointing 300 ms) vs Soniox ~0.53 s. Soniox stays the default.
- Grok takes keyterms only (≤100 terms, ≤50 chars); Soniox `translation_terms` do not apply to it.

## Dropped connections

- Before 2026-09-28 a socket that closed on its own was only logged: the bar stayed on LISTENING with the mic on and audio going nowhere. And an STT error stopped the mic, but the ERROR auto-timer flipped the bar back to LISTENING — a "listening" bar that could not hear.
- Now each engine tags errors `transient` (retry) or definite (bad key, no mic permission). `ui/reconnect-policy.js`: backoff 1, 2, 4, 8, 16 s, then give up; the count resets only after 30 s up. After SUCCESS/CLIPBOARD/ERROR the bar goes to LISTENING only if the engine is live, to "Reconnecting…" if a reconnect is scheduled **or in flight** (`sttConnecting` — the e2e caught the feedback timer switching the bar off mid-reconnect), else HIDDEN.
- The mic is released while waiting to reconnect; a command already being pasted is left to finish.

## API Keys / Credentials

- The app reads the Soniox key **exclusively** from `~/Library/Application Support/voice-everywhere/credentials.json` (`sonioxKey`). By design there is **no shell-env / `.env` fallback** (see `electron/main.js` `loadApiKeys`).
- Symptom → cause: bar shows **"STT error"** = Soniox WebSocket/key problem (invalid key returns `error_message: "Incorrect API key provided"`); **"Mic error: …"** = mic permission/getUserMedia. They are distinct.
- Recovery when the key goes stale (keys rotate/expire): reset credentials in the app, enter a fresh Soniox key, then restart the app because it loads the key once at startup.
- v2 removes the external LLM layer. On first v2 launch, the legacy `geminiKey` field is deleted from `credentials.json`.

## Floating bar position

- Bar must sit bottom-center of the **cursor display's `workArea`** (`electron/bar-position.js`), repositioned on every show-bar — NOT pinned once at launch to `getPrimaryDisplay()` with `bounds` math. On stacked monitors (ultrawide above laptop) the old math put the bar on the wrong screen, flush with the edge; `workArea` excludes menu bar + Dock and carries the display offset.
- Never pass computed `x/y` only at `new BrowserWindow` time; call `win.setPosition()` in the show-bar IPC handler so the bar follows the user across monitors on every toggle.

## Electron

- Audio uses Web Audio API in renderer (MediaDevices.getUserMedia), NOT SoX — no native dependencies needed
- WebSocket for Soniox STT runs in renderer (browser WebSocket) — `ws` npm package does not work in renderer with contextIsolation
- Build: Must use `CSC_IDENTITY_AUTO_DISCOVERY=false` or electron-builder hangs on code signing
- `app.on("window-all-closed", () => {})` is required — without it, macOS quits when window closes
- UI buttons that trigger IPC calls (like resend/insert) steal focus from the target app — avoid action buttons that need the target app focused
- Text fallback: a confirmed non-editable target, no focused element, or AX result that remains uncertain after one retry opens the disposable in-app scratchpad and keeps the transcript on the clipboard. This avoids an intermittent manual Cmd+V fallback when macOS Accessibility checks time out.
- Chromium auto-enables `ScreenCaptureKitPickerScreen` + `ScreenCaptureKitStreamPickerSonoma` on macOS — GPU process burns ~18% CPU doing nothing. Fix: `app.commandLine.appendSwitch("disable-features", "ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma")` and `app.commandLine.appendSwitch("disable-gpu")` for audio-only apps
