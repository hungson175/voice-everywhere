const editor = document.getElementById("scratchpad");
const characterCount = document.getElementById("character-count");

function updateCharacterCount() {
  const count = editor.value.length;
  characterCount.textContent = `${count.toLocaleString()} ${count === 1 ? "character" : "characters"}`;
}

function setText(update) {
  const isEditorFocused =
    document.hasFocus() && document.activeElement === editor;
  const result = window.scratchpadModel.applyScratchpadUpdate(
    editor.value,
    editor.selectionStart,
    editor.selectionEnd,
    update,
    isEditorFocused
  );

  editor.value = result.value;
  updateCharacterCount();

  requestAnimationFrame(() => {
    editor.focus();
    editor.setSelectionRange(result.selectionStart, result.selectionEnd);
    if (!result.inserted) {
      editor.scrollTop = editor.scrollHeight;
    }
  });
}

editor.addEventListener("input", updateCharacterCount);
window.scratchpad.onText(setText);
