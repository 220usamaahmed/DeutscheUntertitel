const $ = (id) => document.getElementById(id);

(async () => {
  await Store.load();
  const s = Store.settings;

  // Display
  $("pauseOnPopup").checked = s.pauseOnPopup;
  $("pauseOnPopup").addEventListener("change", (e) => Store.saveSettings({ pauseOnPopup: e.target.checked }));
  const showScale = () => ($("fontScale-value").textContent = `${Math.round(Store.settings.fontScale * 100)}%`);
  $("fontScale").value = s.fontScale;
  $("fontScale").addEventListener("change", (e) => {
    Store.saveSettings({ fontScale: Number(e.target.value) }).then(showScale);
  });
  showScale();

  // Lists
  for (const box of document.querySelectorAll("[data-list]")) {
    box.checked = s.lists[box.dataset.list];
    box.addEventListener("change", () =>
      Store.saveSettings({ lists: { ...Store.settings.lists, [box.dataset.list]: box.checked } }),
    );
  }
  $("topN").value = String(s.topN);
  $("topN").addEventListener("change", (e) => Store.saveSettings({ topN: Number(e.target.value) }));

  // Known words and exceptions
  renderWords();
  Store.watch((keys) => {
    if (keys.includes("known") || keys.includes("exceptions")) renderWords();
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

function renderWords() {
  fillTable($("known"), Store.known, "No known words yet. Mark words in the word popup.");
  fillTable($("exceptions"), Store.exceptions, "No exceptions.");
}

function fillTable(table, entries, emptyText) {
  table.replaceChildren();
  const keys = Object.keys(entries).sort((a, b) => a.localeCompare(b, "de"));
  if (!keys.length) {
    const td = table.insertRow().insertCell();
    td.className = "muted";
    td.textContent = emptyText;
    return;
  }
  for (const lemma of keys) {
    const row = table.insertRow();
    const word = row.insertCell();
    word.append(lemma);
    const forms = entries[lemma].filter((f) => f !== lemma);
    if (forms.length) {
      const span = document.createElement("div");
      span.className = "forms";
      span.textContent = forms.join(", ");
      word.append(span);
    }
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      delete entries[lemma];
      Store.saveWords();
    });
    row.insertCell().append(remove);
  }
}

async function showModelStatus() {
  $("translator-status").textContent = AI.hasTranslator()
    ? await AI.translatorAvailability()
    : "not supported in this Chrome";
  $("prompt-status").textContent = AI.hasPrompt()
    ? await AI.promptAvailability()
    : "not supported in this Chrome";
}

// Creating each API once from a click starts the model downloads.
async function prepareModels() {
  const progress = (id) => (m) =>
    m.addEventListener("downloadprogress", (e) => {
      $(id).textContent = `downloading ${Math.round(e.loaded * 100)}%`;
    });
  $("prepare").disabled = true;
  const jobs = [];
  if (AI.hasTranslator()) jobs.push(AI.translator(progress("translator-status")));
  if (AI.hasPrompt()) jobs.push(AI.session(progress("prompt-status")));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.warn(r.reason);
  await showModelStatus();
  $("prepare").disabled = false;
}
