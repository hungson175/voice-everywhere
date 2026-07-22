# Workflows

## First launch and setup

On startup, `electron/main.js` decides whether to show `ui/setup.html` or `ui/index.html` based on whether stored credentials exist.

First launch flow:

1. The settings window loads the setup page.
2. The user enters a Soniox key.
3. The setup page saves them via the preload bridge.
4. The main process persists them in `credentials.json` under the Electron user-data path.
5. The settings window reloads to the main UI.

This replaced older assumptions about Keychain storage. The current implementation intentionally uses a local JSON store because the repo history records problems with safeStorage across rebuild/signing changes.

## Dictation flow

The dictation bar is controlled by the global shortcut and by UI buttons in the floating bar.

Typical sequence:

1. User triggers `Control+Option+Command+V` or the mic button.
2. `electron/main.js` sends `toggle-mic` to the bar window.
3. `ui/bar-renderer.js` enters `CONNECTING` and starts `ui/stt.js`.
4. `ui/stt.js` opens the microphone, connects to Soniox, and streams audio.
5. Soniox returns final and interim tokens; translation modes return original and translated tokens in one stream.
6. The STT client separates the token streams and the bar displays live text and waveform feedback.
7. The stop word completes the original command; translated modes briefly wait for the matching translated command.
8. The text is inserted into the frontmost app.
9. The UI either restores to listening or falls back to a clipboard-preserving state.

## Stop word behavior

The user-specified stop word is stored in `config.json` as `voice.stop_word`. It terminates dictation and proceeds to translation/insertion. Detection always uses the original speech stream so translated output cannot hide the control phrase.

## Settings workflow

`ui/renderer.js` owns the editable settings experience:

- enter mode is persisted in `localStorage`
- output language is persisted in `localStorage`
- Soniox correction terms and translation terms are edited in a modal dialog
- settings can be reset to defaults
- the user can reset credentials or quit the app from the UI

The term lists are versioned with a localStorage migration key, so changes to default curated terms can refresh stale user state.

## Insertion workflow

`electron/text-inserter.js` implements a safety-first clipboard contract:

- the app checks the frontmost Accessibility focus to see whether the current target appears editable
- if editable is confirmed, the clipboard is restored after the paste
- if not confirmed, the inserted text remains on the clipboard so it is not lost
- Enter mode is only used on confirmed editable targets

This behavior is important enough that the README and recent git commits both call it out as a core contract rather than a minor detail.

## Output-language workflow

- `auto` keeps Soniox's original transcript.
- `english` enables Soniox one-way translation with target `en`.
- `vietnamese` enables Soniox one-way translation with target `vi`.

Soniox context terms improve vocabulary and translation choices. There is no external LLM rewrite and no guaranteed filler/repetition cleanup stage.

## Operational workflow

Useful commands from `package.json` and the repo docs:

- `npm start` — run the Electron app in development
- `npm test` — execute Node tests in `tests/`
- `npm run build` — build the macOS app via electron-builder
- `bash install.sh` — one-line local install path used in the README

## What to watch out for

- Never change focus-stealing behavior casually; this app is built around not interrupting the target app.
- Do not restore the clipboard unless insertion succeeded in a confirmed editable target.
- If you change default term lists, update the localStorage migration version so old state refreshes.
- If you change Soniox protocol details, review the config contract test and the STT client together.

## Source evidence

- `README.md`
- `package.json`
- `config.json`
- `electron/main.js`
- `ui/renderer.js`
- `ui/bar-renderer.js`
- `electron/text-inserter.js`
