# Testing

The repository has a small but meaningful test surface focused on the highest-risk contracts.

## Current test command

From `package.json`:

- `npm test` → `node --test tests/*.test.js`

That means the tests are plain Node test files, not a framework-specific suite.

## Existing tests

### Soniox config contract
`tests/soniox-config.test.js` was added when the STT pipeline moved from Soniox v4 to v5.

Its purpose is to keep the config shape aligned with the renderer STT client and the checked-in defaults in `config.json`.

Why it matters:

- the STT client expects specific keys and values
- the app depends on soft language hints for mixed Vietnamese/English speech
- a mismatch here would break dictation at startup rather than produce a clean UI error

### Soniox transcript/translation token contract

`tests/soniox-transcript.test.js` verifies that original and translated tokens are accumulated separately and that the translated stream is selected only when native translation is active.

### Text insertion contract
`tests/text-inserter.test.js` covers the clipboard and editability behavior in `electron/text-inserter.js`.

This is the repo’s most safety-sensitive behavior because a failed paste can permanently lose dictated text if the clipboard is restored too aggressively.

The contract emphasized by the implementation and the recent commit history is:

- confirmed editable target → paste, then restore clipboard
- confirmed non-editable target or no focused element → open the disposable scratchpad and keep the transcript on the clipboard
- uncertain Accessibility state → try the current target and keep text on the clipboard
- Enter mode only on confirmed editable targets

## What is not heavily tested yet

Based on the source layout and current test files, the repo still relies on manual verification for much of the end-to-end macOS experience:

- tray and window behavior
- accessibility permission prompts
- microphone permission behavior
- live Soniox audio streaming
- live Soniox translation behavior against real speech
- packaging and signing edge cases

## Recommended validation when changing code

- Run `npm test` after changing STT defaults or insertion logic.
- Manually verify the app on macOS after changing permissions, windows, or global shortcut handling.
- Re-check the dictation flow if you change the state machine in `ui/bar-renderer.js`.
- Re-run packaging-related checks if you touch `package.json`, `install.sh`, or `electron/main.js`.

## High-signal history

Recent commits show the test strategy is driven by regressions in production behavior:

- `7196f84` — added unit/integration tests for the clipboard contract
- `4188d04` — added a Soniox config contract test during the v4 → v5 migration

## Source evidence

- `package.json`
- `tests/soniox-config.test.js`
- `tests/soniox-transcript.test.js`
- `tests/text-inserter.test.js`
- git commits `7196f84`, `4188d04`
