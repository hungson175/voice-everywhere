const saveBtn = document.getElementById("save-btn");
const sonioxInput = document.getElementById("soniox-key");
const errorEl = document.getElementById("setup-error");

saveBtn.addEventListener("click", async () => {
  const sonioxKey = sonioxInput.value.trim();

  if (!sonioxKey) {
    errorEl.textContent = "A Soniox API key is required.";
    errorEl.style.display = "block";
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  errorEl.style.display = "none";

  try {
    await window.voiceEverywhere.saveCredentials(sonioxKey);
  } catch (err) {
    errorEl.textContent = "Failed to save: " + err.message;
    errorEl.style.display = "block";
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & Start";
  }
});
