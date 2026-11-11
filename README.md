# Deutsche Untertitel

A personal Chrome extension that shows English translations of German subtitles on
Prime Video. Everything runs on-device with Chrome's built-in AI:

- **Translator API** translates subtitle lines and single words.
- **Prompt API** (Gemini Nano) runs only when you click a word, to show its lemma,
  meaning in context, alternatives and inflected forms.

## Modes

- **Full sentence**: the German line with its English translation below.
- **Single word**: each word has its translation above it. Words on your known lists
  hide their translation until you hover over them.

Click any word in either mode to open the word popup and mark it as known or unknown.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open the extension's settings page and click **Prepare models** once, so Chrome
   downloads the translation and Gemini Nano models.

After changing code, click the reload icon on the extension's card and reload the
Prime Video tab.

## Layout

| Path | What it does |
| --- | --- |
| `manifest.json` | Manifest V3, no build step |
| `src/store.js` | Settings, known-word lists and caches in `chrome.storage.local` |
| `src/ai.js` | Translator and Prompt API wrappers |
| `src/words.js` | Tokenising and known-word matching |
| `src/prime.js` | Prime Video adapter: where the captions live in the page |
| `src/overlay.js` | Caption overlay and word popup |
| `src/main.js` | Wires the adapter, overlay and settings together |
| `lists/` | Built-in word lists |
| `popup/` | Toolbar popup: on/off and mode |
| `options/` | Settings page |
| `test/harness.html` | Fake Prime player for working on the overlay without Prime |

## Word lists

`lists/top2000.json` holds the 2000 most common words in German subtitles, taken from
`de_50k.txt` in [FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(OpenSubtitles 2018, CC BY-SA 4.0), keeping only all-letter words. The other lists are
hand-written.

## Testing without Prime Video

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765/test/harness.html>. The harness stubs `chrome.storage`
and, where Chrome's AI APIs are missing, the Translator and Prompt APIs.
