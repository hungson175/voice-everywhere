# CLAUDE.md

## What Is This

Global voice input app for macOS. Speech-to-text → insert text at cursor position in ANY app (VS Code, terminal, browser, notes, etc.). Electron menubar app.

**Pipeline code**: Reference voice-vs-extension (`/Users/sonph36/tools/voice-vs-extension`) — nearly identical logic, adapt as needed for standalone Electron context.
**UI/UX**: Reference voice-terminal (`/Users/sonph36/tools/voice-terminal`) — same menubar app pattern, but discard terminal-specific features.

## OpenWiki

This repository has documentation located in the /openwiki directory.

Start here:
- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.

## Commands

```bash
# Build & install
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
cp -R dist/mac-arm64/Voice\ Everywhere.app /Applications/

# Dev
npm install                       # Install dependencies
npm start                         # Launch Electron app (dev mode, opens DevTools)
```

## Architecture

```
Mic (Web Audio) → Soniox STT + optional native translation → Stop Word ("thank you") → Insert at cursor
```

- **Runtime**: Electron (Tray + BrowserWindow, NOT `menubar` package)
- **Audio**: Web Audio API in renderer (MediaDevices.getUserMedia), NOT SoX
- **STT**: Soniox WebSocket (`wss://stt-rt.soniox.com/transcribe-websocket`, model `stt-rt-v5`) with optional one-way translation
- **Text insertion**: System-level (clipboard paste / AppleScript) — the main engineering challenge
- **Credentials**: local `credentials.json` in Electron user data; Soniox key only

Read [lt-memory/architecture.md](lt-memory/architecture.md) for full details, sibling project comparison, and reference guidance.

## Key Conventions

- Pipeline modules (recorder, Soniox, stopword) are based on voice-vs-extension — reference and adapt, don't blindly copy. Discard VS Code-specific and LLM-correction code.
- UI: DM Sans + JetBrains Mono typography, glass morphism cards, CSS custom properties (see lt-memory/ui-ux.md)
- No terminal context or terminal selector — unlike voice-terminal, this app has no knowledge of what's in the terminal
- Config stored in `config.json`, not hardcoded

## Pitfalls

- Soniox: First WebSocket message = JSON config, then ONLY binary. Sending JSON after config crashes silently.
- Soniox translation terms: `[{source, target}]` array, NOT `{key: value}` map.
- Soniox native translation returns original and translated tokens in one stream; separate them using `translation_status` or text will be duplicated.
- Build: Must use `CSC_IDENTITY_AUTO_DISCOVERY=false` — without it, electron-builder hangs on code signing.
- Resend button was removed — clicking UI buttons steals focus from the target app, defeating the purpose of text insertion. Only non-focus-stealing actions (copy to clipboard) belong in the UI.
- Clipboard contract (text-inserter): the old clipboard is restored ONLY when the AX check confirms the focused element is editable (AXTextField/AXTextArea/AXSearchField/AXComboBox). Otherwise the transcript stays on the clipboard (orange "press ⌘V" bar state) — restoring after a silently-failed paste loses the text forever. AX false-negatives (browsers/terminals) are expected and harmless; Enter-mode is also skipped on unconfirmed targets to avoid triggering default buttons.

Read [lt-memory/pitfalls.md](lt-memory/pitfalls.md) before modifying tricky areas.

## Long-Term Memory

`lt-memory/` uses progressive disclosure — this file stays short with summaries, detail files are read on-demand:

- **[architecture.md](lt-memory/architecture.md)** — Full pipeline, sibling project comparison, what to copy from where, external services
- **[ui-ux.md](lt-memory/ui-ux.md)** — Complete UI spec: menubar popup layout, visual states, design tokens, adaptations from voice-terminal
- **[pitfalls.md](lt-memory/pitfalls.md)** — Known gotchas for Soniox, audio capture, and Electron

## Status

- **Phase**: Complete — app built, installed, and running
- **GitHub**: `hungson175/voice-everywhere` (main branch)
