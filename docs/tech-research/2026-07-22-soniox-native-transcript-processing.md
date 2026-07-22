# Soniox-native transcript processing for Voice Everywhere

**Date:** 2026-07-22

## TL;DR

Top pick: Soniox original transcription plus native one-way translation (92/100). It removes the extra provider and preserves the app's Original/English/Vietnamese output modes. Soniox does not expose a documented real-time API option that guarantees removal of fillers, repetitions, false starts, or rambling, so native STT is not a full replacement for semantic LLM cleanup.

The removed Gemini layer was failing for a simpler reason: on 2026-07-22 the key stored in `credentials.json` returned HTTP 400, `Please pass a valid API key`, against the exact endpoint and model configured by v1. The model name and request path were not the observed failure.

## Constraints

| Constraint | Value |
|---|---|
| Platform | macOS Electron renderer using browser WebSocket |
| Runtime | JavaScript, no new native dependency |
| Service | Keep existing Soniox account; remove external LLM dependency |
| Latency | Streaming/low-latency; stop-word workflow must remain usable |
| Languages | Mixed Vietnamese/English; original, English, and Vietnamese output |
| Safety | Never mix original and translation tokens or lose transcript text |

## Comparison

| # | Candidate | Type | External service | Filler cleanup | P0 | Score |
|---|---|---|---|---|---|---:|
| 1 | Soniox original + one-way translation | managed service | Soniox only | Not guaranteed | — | 92 |
| 2 | Soniox original transcript only | managed service | Soniox only | Not guaranteed | Loses forced-language output | 86 |
| 3 | Soniox + deterministic local filler list | built in-house | Soniox only | Narrow/fragile | Can delete meaningful discourse words | 68 |
| 4 | Soniox + Gemini rewrite | managed services | Soniox + Google | Semantic cleanup | Current stored key invalid; user requested removal | 53 |
| 5 | Soniox + local LLM | built in-house | Soniox only | Semantic cleanup | Packaging/resource/latency cost | 42 |

- Soniox native STT/translation: [real-time translation documentation](https://soniox.com/docs/translation/stt-translation/rt-translation), checked 2026-07-22.
- Token separation contract: [speech-to-text translation token format](https://soniox.com/docs/translation/stt-translation), checked 2026-07-22.
- Supported Vietnamese and English translation: [supported languages](https://soniox.com/docs/stt/concepts/supported-languages), checked 2026-07-22.
- Complete WebSocket configuration surface: [WebSocket API reference](https://soniox.com/docs/api-reference/stt/websocket-api), checked 2026-07-22.

## Top picks

### 1. Soniox original + native translation — 92/100

- **Why:** One-way translation accepts a target language and works in the existing `stt-rt-v5` WebSocket session. English (`en`) and Vietnamese (`vi`) are supported.
- **Important implementation detail:** Soniox emits spoken and translated tokens in the same stream. The client must keep `translation_status: original|none` separate from `translation_status: translation`; concatenating all tokens duplicates the utterance in two languages.
- **Caveat:** Translation tokens trail spoken tokens and are not one-to-one aligned. The stop word should be detected on the original stream, then the app should briefly wait for its translated counterpart and retain a raw fallback.
- **Filler behavior:** The documented WebSocket parameter list contains no filler/disfluency-removal mode. The model may naturally omit some fillers, but this is not a configurable contract.

### 2. Soniox original transcript only — 86/100

- **Why:** Lowest complexity and latency; preserves exactly the STT result.
- **Caveat:** Cannot honor “Always English” or “Always Vietnamese” when speech is in another language.
- **Best use:** The app's `Original (match input)` setting.

## Why not

- **Deterministic filler list:** Safe only for unambiguous hesitation tokens. Vietnamese words such as “ừ”, “à”, and English “like” can carry meaning; regex removal cannot reliably distinguish discourse from content or repair false starts.
- **Gemini rewrite:** The v1 stored API key is invalid, and the user explicitly requested removal of the complete LLM layer. Even with a fresh key it adds latency, another credential, another failure mode, and semantic rewriting risk.
- **Local LLM:** Avoids a second SaaS credential but adds a model download, memory pressure, packaging complexity, and slower cold starts to a small menubar app.

## Candidate data sheets

| Field | Soniox native | Deterministic filter | Gemini rewrite | Local LLM |
|---|---|---|---|---|
| Type | managed-service | built-in | managed-service | built-in/model |
| Primary URL | Soniox docs above | repository code | Google API endpoint | n/a |
| Language/runtime | WebSocket/JS | JS | HTTP/JS | model-dependent |
| License | proprietary service | repository license | proprietary service | model-dependent |
| Maintenance | active `stt-rt-v5` docs | owned locally | service-managed | model-dependent |
| OSV/OpenSSF | n/a (no package) | n/a | n/a (no package) | n/a until a model/runtime is selected |
| Self-host | no | yes | no | yes |
| Deal breaker | no guaranteed filler cleanup | semantic false positives | invalid stored key/user removal request | resource and distribution cost |

## Methodology

- Read current official Soniox real-time translation, token format, supported-language, and WebSocket API documentation.
- Inspected the v1 pipeline, credential loading, and exact Gemini request implementation.
- Sent one minimal diagnostic request using the stored Gemini key without logging the secret; response was HTTP 400 with `INVALID_ARGUMENT` and `Please pass a valid API key`.
- No package candidate was installed. OSV and OpenSSF checks are not applicable to the selected direct WebSocket integration.
- Next review trigger: a Soniox release that documents configurable disfluency/filler removal, or a change to the v5 translation token contract.

## Sources

- https://soniox.com/docs/translation/stt-translation/rt-translation
- https://soniox.com/docs/translation/stt-translation
- https://soniox.com/docs/stt/concepts/supported-languages
- https://soniox.com/docs/api-reference/stt/websocket-api
