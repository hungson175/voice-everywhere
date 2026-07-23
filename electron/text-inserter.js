/**
 * Text inserter — pastes text at cursor position in ANY macOS app.
 *
 * 1. Check via Accessibility whether the focused element is editable
 * 2. Set clipboard to the transcript
 * 3. Confirmed editable: Cmd+V, optionally press Enter, restore clipboard
 * 4. Confirmed non-editable/no focus: open a new TextEdit draft and paste
 * 5. Unknown Accessibility state: try Cmd+V and keep the transcript on the
 *    clipboard so it is never lost
 *
 * Requires macOS Accessibility permission.
 */

const { clipboard } = require("electron");
const { execFile } = require("child_process");

// AX roles that reliably accept a Cmd+V text paste. Other roles can still be
// classified as editable when their AXValue attribute is settable.
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

const OPEN_TEXTEDIT_DRAFT = `
tell application "TextEdit"
  activate
  make new document
end tell
delay 0.35
tell application "System Events"
  tell process "TextEdit"
    set frontmost to true
  end tell
  keystroke "v" using command down
end tell`;

/**
 * Classify the raw "ROLE|settable" output of the AX check script.
 * @param {string} axOutput
 * @returns {"editable"|"not_editable"|"no_focus"|"unknown"}
 */
function parseEditability(axOutput) {
  const parts = String(axOutput ?? "").trim().split("|");
  if (parts.length !== 2) return "unknown";

  const [role, settable] = parts;
  if (role === "NO_FOCUS") return "no_focus";
  if (EDITABLE_ROLES.has(role) || settable.toLowerCase() === "true") {
    return "editable";
  }
  return role.startsWith("AX") ? "not_editable" : "unknown";
}

/**
 * Check whether the focused element in the frontmost app is text-editable.
 * @param {object} [deps] - test injection: { osascript }
 * @returns {Promise<"editable"|"not_editable"|"no_focus"|"unknown">}
 */
async function checkFocusedEditable(deps = {}) {
  const run = deps.osascript || osascript;
  try {
    return parseEditability(await run(AX_EDITABLE_CHECK));
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
 * @param {object} [deps] - test injection: { osascript, clipboard, sleep }
 * @returns {Promise<{
 *   editability: string,
 *   clipboardFallback: boolean,
 *   openedDraft: boolean,
 *   draftApp?: string
 * }>}
 *   clipboardFallback=true means the text was left on the clipboard
 *   because Accessibility was uncertain and Enter was NOT pressed.
 */
async function insertText(text, options = {}, deps = {}) {
  const run = deps.osascript || osascript;
  const clip = deps.clipboard || clipboard;
  const wait = deps.sleep || sleep;

  const editability = await checkFocusedEditable(deps);
  const confirmedEditable = editability === "editable";
  const shouldOpenDraft =
    editability === "not_editable" || editability === "no_focus";
  const savedClipboard = clip.readText();

  clip.writeText(text);

  if (shouldOpenDraft) {
    await run(OPEN_TEXTEDIT_DRAFT);
    await wait(text.length > 200 ? 700 : 200);
    return {
      editability,
      clipboardFallback: false,
      openedDraft: true,
      draftApp: "TextEdit",
    };
  }

  // For an unknown AX state, still try the current target and preserve the
  // transcript on the clipboard as a safety net.
  await run('tell application "System Events" to keystroke "v" using command down');

  // Extra delay for long text so the app finishes processing input buffer
  await wait(text.length > 200 ? 700 : 200);

  // Enter mode: only when confirmed editable — on an unknown target Enter
  // could trigger a default button instead of submitting text.
  if (options.enterMode && confirmedEditable) {
    await run('tell application "System Events" to key code 36');
  }

  await wait(100);
  if (confirmedEditable) {
    clip.writeText(savedClipboard);
  }
  return {
    editability,
    clipboardFallback: !confirmedEditable,
    openedDraft: false,
  };
}

module.exports = { insertText, checkFocusedEditable, parseEditability };
