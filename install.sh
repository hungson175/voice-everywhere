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

NEW_APP="dist/mac-arm64/Voice Everywhere.app"
INSTALLED_APP="/Applications/Voice Everywhere.app"

# Permission-preserving update: macOS TCC (Accessibility/Mic) keys off the
# main executable's identity. If the Electron version is unchanged, swap only
# the app resources (app.asar + config.json + .env) inside the existing
# bundle — permissions survive. A full bundle replace (or Electron upgrade)
# changes the executable identity and forces re-granting permissions.
#
# NOTE: we compare via a version receipt, NOT the binary bytes — ad-hoc
# re-signing modifies the installed binary, so byte-compare always mismatches
# after the first in-place update and would wrongly trigger full replaces.
ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version" 2>/dev/null || echo unknown)"
RECEIPT="$INSTALLED_APP/Contents/Resources/.install-receipt"
INSTALLED_VERSION="$(grep -E '^electron=' "$RECEIPT" 2>/dev/null | cut -d= -f2 || echo none)"
if [ -f "$INSTALLED_APP/Contents/MacOS/Voice Everywhere" ] && \
   [ "$ELECTRON_VERSION" != "unknown" ] && \
   [ "$INSTALLED_VERSION" = "$ELECTRON_VERSION" ]; then
  echo "Same Electron $ELECTRON_VERSION — updating in place (permissions preserved)..."
  cp "$NEW_APP/Contents/Resources/app.asar" \
     "$INSTALLED_APP/Contents/Resources/app.asar"
  cp config.json "$INSTALLED_APP/Contents/Resources/config.json"
  if [ -f ".env" ]; then
    cp .env "$INSTALLED_APP/Contents/Resources/.env"
    chmod 600 "$INSTALLED_APP/Contents/Resources/.env"
  fi
else
  echo "New Electron binary (or fresh install) — full replace."
  echo "NOTE: macOS will ask for Accessibility/Mic permissions again (one time)."
  rm -rf "$INSTALLED_APP" 2>/dev/null
  cp -R "$NEW_APP" /Applications/
  if [ -f "$INSTALLED_APP/Contents/Resources/.env" ]; then
    chmod 600 "$INSTALLED_APP/Contents/Resources/.env"
  fi
fi

# Version receipt for the next run's in-place/full decision
echo "electron=$ELECTRON_VERSION" > "$INSTALLED_APP/Contents/Resources/.install-receipt"

# Ad-hoc sign the full app bundle (required on macOS 15+ / Sequoia and later)
# Without this, macOS kills the app with SIGKILL (Code Signature Invalid)
echo "Signing app bundle..."
codesign --force --deep --sign - /Applications/Voice\ Everywhere.app

echo ""
echo "Voice Everywhere installed to /Applications!"
echo ""
echo "If this was a full replace (new Electron binary), re-grant Accessibility"
echo "permission once: System Settings → Privacy & Security → Accessibility"
echo "Remove and re-add 'Voice Everywhere', then relaunch."
echo ""
echo "Opening..."
open /Applications/Voice\ Everywhere.app
