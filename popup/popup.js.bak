const $ = (id) => document.getElementById(id);

(async () => {
  await Store.load();
  const s = Store.settings;

  // Views: main and settings share the popup.
  const show = (name) => {
    $("view-main").hidden = name !== "main";
    $("view-settings").hidden = name !== "settings";
  };
  $("open-settings").addEventListener("click", () => show("settings"));
  $("back").addEventListener("click", () => show("main"));

  // On/off
  const showEnabled = () => ($("enabled-hint").textContent = $("enabled").checked ? "Captions are translated" : "Turned off");
  $("enabled").checked = s.enabled;
  showEnabled();
  $("enabled").addEventListener("change", (e) => {
    Store.saveSettings({ enabled: e.target.checked });
    showEnabled();
  });

  // Mode
  for (const radio of document.querySelectorAll("input[name=mode]")) {
    radio.checked = radio.value === s.mode;
    radio.addEventListener("change", () => Store.saveSettings({ mode: radio.value }));
  }

  $("words").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("words/words.html") });
    window.close();
  });

  // Display
  $("pauseOnPopup").checked = s.pauseOnPopup;
  $("pauseOnPopup").addEventListener("change", (e) => Store.saveSettings({ pauseOnPopup: e.target.checked }));
  const scale = $("fontScale");
  const showScale = () => {
    $("fontScale-value").textContent = `${Math.round(scale.value * 100)}%`;
    scale.style.setProperty("--fill", `${((scale.value - scale.min) / (scale.max - scale.min)) * 100}%`);
  };
  scale.value = s.fontScale;
  showScale();
  scale.addEventListener("input", showScale);
  scale.addEventListener("change", () => Store.saveSettings({ fontScale: Number(scale.value) }));

  // Lists
  for (const box of document.querySelectorAll("[data-list]")) {
    box.checked = s.lists[box.dataset.list];
    box.addEventListener("change", () =>
      Store.saveSettings({ lists: { ...Store.settings.lists, [box.dataset.list]: box.checked } }),
    );
  }
  $("topN").value = String(s.topN);
  $("topN").addEventListener("change", (e) => Store.saveSettings({ topN: Number(e.target.value) }));

  // Words from videos
  $("recordWords").checked = s.recordWords;
  $("recordWords").addEventListener("change", (e) => Store.saveSettings({ recordWords: e.target.checked }));
  const del = $("delete-videos");
  let delTimer = null;
  const resetDelete = () => {
    del.classList.remove("confirm");
    del.textContent = "Delete all records";
  };
  del.addEventListener("click", async () => {
    // Two clicks: the first asks.
    if (!del.classList.contains("confirm")) {
      const n = Object.keys(await Store.loadVideos()).length;
      if (!n) return ($("delete-videos-done").textContent = "There are none.");
      del.classList.add("confirm");
      del.textContent = `Delete ${n} video${n === 1 ? "" : "s"}?`;
      delTimer = setTimeout(resetDelete, 4000);
      return;
    }
    clearTimeout(delTimer);
    await Store.deleteAllVideos();
    resetDelete();
    $("delete-videos-done").textContent = "Deleted.";
  });

  // Cache
  $("clear").addEventListener("click", async () => {
    await Store.clearCaches();
    $("clear-done").textContent = "Cleared.";
  });

  // Models
  $("prepare").addEventListener("click", prepareModels);
  showModelStatus();
})();

function setStatus(id, text) {
  const el = $(id);
  el.textContent = text;
  el.className = "badge" + (text === "available" ? " known" : /download/.test(text) ? " learning" : "");
}

async function showModelStatus() {
  const t = AI.hasTranslator() ? await AI.translatorAvailability() : "unsupported";
  const p = AI.hasPrompt() ? await AI.promptAvailability() : "unsupported";
  setStatus("translator-status", t);
  setStatus("prompt-status", p);
  // Only worth offering while a download is still needed.
  const needed = [t, p].some((s) => s === "downloadable" || s === "downloading");
  $("prepare").hidden = !needed;
  $("models-hint").textContent = needed
    ? "Both run on this Mac, downloaded once."
    : t === "available" && p === "available"
      ? "Both models are ready."
      : "Models this Chrome can't run are marked unsupported.";
}

// Creating each API once from a click starts the model downloads.
async function prepareModels() {
  const progress = (id) => (m) =>
    m.addEventListener("downloadprogress", (e) => setStatus(id, `downloading ${Math.round(e.loaded * 100)}%`));
  $("prepare").disabled = true;
  const jobs = [];
  if (AI.hasTranslator()) jobs.push(AI.translator(progress("translator-status")));
  if (AI.hasPrompt()) jobs.push(AI.session("lookup", progress("prompt-status")));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.warn(r.reason);
  await showModelStatus();
  $("prepare").disabled = false;
}
