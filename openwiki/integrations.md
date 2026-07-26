# Integrations

Voice Everywhere depends on a small set of external services and macOS system APIs. These integrations are central to the product, so each one is documented here rather than buried in implementation notes.

## Soniox STT

`ui/stt.js` streams microphone audio to Soniox over WebSocket.

Configured values come from `config.json`:

- `soniox.ws_url`
- `soniox.model`
- `soniox.sample_rate`
- `soniox.num_channels`
- `soniox.audio_format`
- `soniox.chunk_size`
- `soniox.language_hints`

The recent history shows the repo migrated from Soniox v4 to v5 and now relies on soft `language_hints` for mixed Vietnamese/English speech. The config contract test exists to keep the protocol assumptions stable.

### Soniox protocol notes

- The first WebSocket message must be JSON configuration.
- After that, the stream is binary PCM audio only.
- Output modes can add a one-way `translation` block targeting English or Vietnamese.
- Translation responses contain original and translated tokens together; `ui/stt.js` separates them by `translation_status`.
- Soniox does not document a WebSocket switch that guarantees filler/disfluency removal.
- The renderer logs the model name on final transcript events for traceability.

## macOS Accessibility and text insertion

`electron/text-inserter.js` depends on macOS Accessibility permission to inspect the frontmost app and to issue paste/Enter keystrokes through System Events.

The insertion contract is deliberately conservative:

- confirm editability when possible
- open the disposable scratchpad when the current focus is confirmed non-editable or absent
- keep the clipboard safe if the target is uncertain
- only press Enter when the target is confirmed editable

`electron/main.js` checks this permission on startup and prompts the user if needed.

## Microphone permission

`electron/main.js` uses `session.defaultSession.setPermissionRequestHandler` to allow `media` requests. This is the main browser-style permission path used by the renderer’s microphone capture.

## Clipboard

`electron/text-inserter.js` uses the Electron clipboard API as part of the paste contract. It carries text into the focused input, remains populated while the scratchpad is open, and is the recovery mechanism when insertion is uncertain.

## Disposable scratchpad fallback

macOS note applications auto-save notes or files, which conflicts with the
temporary edit-copy-discard workflow. Voice Everywhere therefore owns a small
scratchpad `BrowserWindow`. The main process sends it the transcript through an
isolated preload bridge; the renderer holds the text only in memory. Closing
the window discards it immediately without a save prompt or filesystem write.

## Packaging and build integration

`package.json` configures `electron-builder` for macOS and includes `config.json` as an extra resource.

Notable packaging details:

- app identifier: `com.voiceeverywhere.app`
- product name: `Voice Everywhere`
- macOS category: productivity
- targets: `dmg` and `zip`

The build also carries microphone and Apple Events usage descriptions for the macOS permission prompts.

## Where to look when changing integrations

- Soniox protocol or audio settings: `ui/stt.js`, `config.json`, `tests/soniox-config.test.js`
- Soniox translation and token grouping: `ui/stt.js`, `ui/bar-renderer.js`, `tests/soniox-transcript.test.js`
- Insertion behavior or accessibility handling: `electron/text-inserter.js`, `electron/main.js`, `tests/text-inserter.test.js`
- Permissions or packaging: `electron/main.js`, `package.json`

## Source evidence

- `config.json`
- `ui/stt.js`
- `electron/text-inserter.js`
- `electron/main.js`
- `package.json`
