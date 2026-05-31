const saveBtn = document.getElementById("save-btn");
const geminiInput = document.getElementById("gemini-key");
const sonioxInput = document.getElementById("soniox-key");
const errorEl = document.getElementById("setup-error");

saveBtn.addEventListener("click", async () => {
  const geminiKey = geminiInput.value.trim();
  const sonioxKey = sonioxInput.value.trim();

  if (!geminiKey || !sonioxKey) {
    errorEl.textContent = "Both API keys are required.";
    errorEl.style.display = "block";
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  errorEl.style.display = "none";

  try {
    await window.voiceEverywhere.saveCredentials(geminiKey, sonioxKey);
  } catch (err) {
    errorEl.textContent = "Failed to save: " + err.message;
    errorEl.style.display = "block";
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & Start";
  }
});
