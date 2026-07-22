# Voice Everywhere

Global voice input for macOS. Speak anywhere, insert text at your cursor — in any app.

![Voice Everywhere](assets/screenshot.jpg)

## Install

```bash
git clone https://github.com/hungson175/voice-everywhere.git && cd voice-everywhere && bash install.sh
```

## What It Does

1. **Speak** — Click the mic button or press `Ctrl+Option+Cmd+V`
2. **Transcribe** — Real-time speech-to-text via [Soniox](https://soniox.com/) STT
3. **Translate (optional)** — Soniox can translate speech directly to English or Vietnamese
4. **Insert** — Text is automatically pasted at your cursor position in the frontmost app

Works with VS Code, Terminal, browsers, Notes, Slack, and any app that accepts text input.

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js
- [Soniox API key](https://soniox.com/) — for speech-to-text
- macOS Accessibility permission — for text insertion

## Features

- **System-wide text insertion** — Clipboard paste + AppleScript, works in any app
- **Enter Mode** — Optionally sends Enter after pasting (for chat inputs, terminals)
- **Live transcript** — See real-time speech-to-text as you speak
- **Native Soniox translation** — Original speech, always English, or always Vietnamese
- **Global shortcut** — `Ctrl+Option+Cmd+V` to toggle mic from anywhere
- **Audio feedback** — Reminder beep every 60s while listening, confirmation beep on insert
- **Menubar tray icon** — White circle (idle) / red circle (recording)
- **Configurable vocabulary** — Custom terms and phonetic corrections for technical jargon

## Setup

On first launch, enter your Soniox API key. It is stored locally in the app's macOS user-data directory.

## Dev Mode

```bash
npm start
```

## Tech Stack

- **Electron** — Tray + BrowserWindow
- **Soniox** — Real-time WebSocket STT and native translation (`stt-rt-v5`)
- **Web Audio API** — Microphone capture in renderer
- **AppleScript** — System-level text insertion via clipboard paste

## License

MIT
