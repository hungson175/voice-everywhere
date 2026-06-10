/**
 * Text inserter — pastes text at cursor position in ANY macOS app.
 *
 * 1. Check via Accessibility whether the focused element is editable
 * 2. Save current clipboard
 * 3. Set clipboard to text
 * 4. Cmd+V via System Events
 * 5. (Enter Mode) Press Enter to submit
 * 6. Restore clipboard — ONLY if the target was confirmed editable.
 *    Otherwise the corrected text stays on the clipboard so it's never
 *    lost (the paste was likely a silent no-op).
 *
 * Requires macOS Accessibility permission.
 */

const { clipboard } = require("electron");
const { execFile } = require("child_process");

// AX roles that reliably accept a Cmd+V text paste. Browsers, terminals and
// Electron apps sometimes misreport (false negative) — that's fine: we still
// paste, we just also keep the text on the clipboard as a safety net.
const EDITABLE_ROLES = new Set([
  "AXTextField",
  "AXTextArea",
  "AXSearchField",
  "AXComboBox",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

const AX_EDITABLE_CHECK = `
tell application "System Events"
  set frontProc to first application process whose frontmost is true
  try
    set focusedElem to value of attribute "AXFocusedUIElement" of frontProc
    set elemRole to value of attribute "AXRole" of focusedElem
    set canSet to "false"
    try
      set canSet to (settable of attribute "AXValue" of focusedElem) as string
    end try
    return elemRole & "|" & canSet
  on error
    return "NO_FOCUS|false"
  end try
end tell`;

/**
 * Check whether the focused element in the frontmost app is text-editable.
 * @returns {Promise<"editable"|"not_editable"|"unknown">}
 */
async function checkFocusedEditable() {
  try {
    const result = await osascript(AX_EDITABLE_CHECK);
    const [role] = result.split("|");
    if (role === "NO_FOCUS") return "unknown";
    return EDITABLE_ROLES.has(role) ? "editable" : "not_editable";
  } catch (err) {
    console.error("AX editability check failed:", err.message);
    return "unknown";
  }
}

/**
 * Insert text at the current cursor position in the frontmost app.
 * @param {string} text - Text to insert
 * @param {object} [options]
 * @param {boolean} [options.enterMode] - Press Enter after paste to submit
 * @returns {Promise<{editability: string, clipboardFallback: boolean}>}
 *   clipboardFallback=true means the text was left on the clipboard
 *   (target not confirmed editable) and Enter was NOT pressed.
 */
async function insertText(text, options = {}) {
  const editability = await checkFocusedEditable();
  const confirmedEditable = editability === "editable";
  const savedClipboard = clipboard.readText();

  clipboard.writeText(text);
  // Paste even when not confirmed editable — AX false-negatives (browsers,
  // terminals) still paste fine, and on a truly non-editable target it's a no-op.
  await osascript('tell application "System Events" to keystroke "v" using command down');

  // Extra delay for long text so the app finishes processing input buffer
  await sleep(text.length > 200 ? 700 : 200);

  // Enter mode: only when confirmed editable — on an unknown target Enter
  // could trigger a default button instead of submitting text.
  if (options.enterMode && confirmedEditable) {
    await osascript('tell application "System Events" to key code 36');
  }

  await sleep(100);
  if (confirmedEditable) {
    clipboard.writeText(savedClipboard);
  }
  return { editability, clipboardFallback: !confirmedEditable };
}

module.exports = { insertText, checkFocusedEditable };
