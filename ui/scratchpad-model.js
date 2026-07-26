function createScratchpadUpdate(text, isWindowFocused) {
  return {
    text: String(text ?? ""),
    mode: isWindowFocused ? "insert-if-editor-focused" : "replace",
  };
}

function clampSelectionOffset(offset, length) {
  const numericOffset = Number.isFinite(offset) ? offset : length;
  return Math.max(0, Math.min(Math.trunc(numericOffset), length));
}

function applyScratchpadUpdate(
  currentValue,
  selectionStart,
  selectionEnd,
  update,
  isEditorFocused
) {
  const value = String(currentValue ?? "");
  const normalizedUpdate = typeof update === "object" && update !== null
    ? update
    : { text: update, mode: "replace" };
  const text = String(normalizedUpdate.text ?? "");
  const shouldInsert =
    normalizedUpdate.mode === "insert-if-editor-focused" && isEditorFocused;

  if (!shouldInsert) {
    return {
      value: text,
      selectionStart: text.length,
      selectionEnd: text.length,
      inserted: false,
    };
  }

  const start = clampSelectionOffset(selectionStart, value.length);
  const end = Math.max(
    start,
    clampSelectionOffset(selectionEnd, value.length)
  );
  const caret = start + text.length;

  return {
    value: value.slice(0, start) + text + value.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
    inserted: true,
  };
}

const scratchpadModel = {
  createScratchpadUpdate,
  applyScratchpadUpdate,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = scratchpadModel;
}

if (typeof window !== "undefined") {
  window.scratchpadModel = scratchpadModel;
}
