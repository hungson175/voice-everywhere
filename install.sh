#!/bin/bash
set -e

echo "Installing Voice Everywhere..."

# Clone if not already in the repo
if [ ! -f "package.json" ] || ! grep -q '"voice-everywhere"' package.json 2>/dev/null; then
  git clone https://github.com/hungson175/voice-everywhere.git
  cd voice-everywhere
fi

npm install --no-fund --no-audit
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir

# Kill any running instance before replacing the binary
echo "Stopping running instance..."
pkill -x "Voice Everywhere" 2>/dev/null || true
sleep 1

rm -rf /Applications/Voice\ Everywhere.app 2>/dev/null
cp -R dist/mac-arm64/Voice\ Everywhere.app /Applications/

# Ad-hoc sign the full app bundle (required on macOS 15+ / Sequoia and later)
# Without this, macOS kills the app with SIGKILL (Code Signature Invalid)
echo "Signing app bundle..."
codesign --force --deep --sign - /Applications/Voice\ Everywhere.app

echo ""
echo "Voice Everywhere installed to /Applications!"
echo ""
echo "IMPORTANT: If this is a reinstall, you may need to re-grant Accessibility"
echo "permission: System Settings → Privacy & Security → Accessibility"
echo "Remove and re-add 'Voice Everywhere', then relaunch."
echo ""
echo "Opening..."
open /Applications/Voice\ Everywhere.app
