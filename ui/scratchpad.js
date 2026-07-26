const editor = document.getElementById("scratchpad");
const characterCount = document.getElementById("character-count");

function updateCharacterCount() {
  const count = editor.value.length;
  characterCount.textContent = `${count.toLocaleString()} ${count === 1 ? "character" : "characters"}`;
}

function setText(text) {
  editor.value = String(text ?? "");
  updateCharacterCount();

  requestAnimationFrame(() => {
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
    editor.scrollTop = editor.scrollHeight;
  });
}

editor.addEventListener("input", updateCharacterCount);
window.scratchpad.onText(setText);
