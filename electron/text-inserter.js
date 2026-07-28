/**
 * Text inserter — pastes text at cursor position in ANY macOS app.
 *
 * 1. Check via Accessibility whether the focused element is editable
 * 2. Set clipboard to the transcript
 * 3. Confirmed editable: Cmd+V, optionally press Enter, restore clipboard
 * 4. Confirmed non-editable/no focus: open the disposable app scratchpad
 * 5. Unknown Accessibility state after a retry: open the scratchpad and keep
 *    the transcript on the clipboard so manual paste is never required
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

const AX_CHECK_ATTEMPTS = 2;
const AX_RETRY_DELAY_MS = 100;

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
 * @param {object} [deps] - test injection: { osascript, sleep }
 * @returns {Promise<"editable"|"not_editable"|"no_focus"|"unknown">}
 */
async function checkFocusedEditable(deps = {}) {
  const run = deps.osascript || osascript;
  const wait = deps.sleep || sleep;
  let lastFailure = null;

  for (let attempt = 0; attempt < AX_CHECK_ATTEMPTS; attempt += 1) {
    try {
      const editability = parseEditability(await run(AX_EDITABLE_CHECK));
      if (editability !== "unknown") return editability;
      lastFailure = new Error("unexpected Accessibility response");
    } catch (err) {
      lastFailure = err;
    }

    if (attempt < AX_CHECK_ATTEMPTS - 1) {
      await wait(AX_RETRY_DELAY_MS);
    }
  }

  console.error("AX editability check failed:", lastFailure?.message || "unknown error");
  return "unknown";
}

/**
 * Insert text at the current cursor position in the frontmost app.
 * @param {string} text - Text to insert
 * @param {object} [options]
 * @param {boolean} [options.enterMode] - Press Enter after paste to submit
 * @param {object} [deps] - injected services: { osascript, clipboard, sleep, openDraft }
 * @returns {Promise<{
 *   editability: string,
 *   clipboardFallback: boolean,
 *   openedDraft: boolean,
 *   draftApp?: string
 * }>}
 *   clipboardFallback=true is reserved for a last-resort insertion failure.
 */
async function insertText(text, options = {}, deps = {}) {
  const run = deps.osascript || osascript;
  const clip = deps.clipboard || clipboard;
  const wait = deps.sleep || sleep;

  const editability = await checkFocusedEditable(deps);
  const confirmedEditable = editability === "editable";
  const shouldOpenDraft = !confirmedEditable;
  const savedClipboard = clip.readText();

  clip.writeText(text);

  if (shouldOpenDraft) {
    if (typeof deps.openDraft !== "function") {
      throw new Error("Scratchpad opener is not configured");
    }
    const draft = await deps.openDraft(text);
    return {
      editability,
      clipboardFallback: false,
      openedDraft: true,
      draftApp: draft?.draftApp || "Scratchpad",
    };
  }

  await run('tell application "System Events" to keystroke "v" using command down');

  // Extra delay for long text so the app finishes processing input buffer
  await wait(text.length > 200 ? 700 : 200);

  if (options.enterMode) {
    await run('tell application "System Events" to key code 36');
  }

  await wait(100);
  clip.writeText(savedClipboard);
  return {
    editability,
    clipboardFallback: false,
    openedDraft: false,
  };
}

module.exports = { insertText, checkFocusedEditable, parseEditability };
