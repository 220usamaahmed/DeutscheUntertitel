(async () => {
  await Store.load();
  const enabled = document.getElementById("enabled");
  enabled.checked = Store.settings.enabled;
  enabled.addEventListener("change", () => Store.saveSettings({ enabled: enabled.checked }));

  for (const radio of document.querySelectorAll("input[name=mode]")) {
    radio.checked = radio.value === Store.settings.mode;
    radio.addEventListener("change", () => Store.saveSettings({ mode: radio.value }));
  }

  document.getElementById("words").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("words/words.html") });
    window.close();
  });

  document.getElementById("settings").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
