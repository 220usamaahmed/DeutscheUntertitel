# Deutsche Untertitel

A personal Chrome extension that shows English translations of German subtitles on
Prime Video and YouTube. Everything runs on-device with Chrome's built-in AI:

- **Translator API** translates subtitle lines and single words.
- **Prompt API** (Gemini Nano) runs only when you click a word, to show its lemma,
  meaning in context, alternatives and inflected forms.

## Modes

- **Full sentence**: the German line with its English translation below.
- **Single word**: each word has its translation above it. Common words (the top N,
  articles, prepositions, pronouns) and your Known words hide their translation until
  you hover over them.

Click any word in either mode to open the word popup and put it on your **Known** or
**Learning** list (click the highlighted button to take it off again). Both save the
dictionary form and its inflected forms. Learning words always show their translation
and are amber in the captions, in both modes, even if they're common words.
Captions hold still while the popup is open.

On YouTube, turn on German captions (auto-generated ones work). Those roll in a word
at a time, so in full-sentence mode the English for the sentence still being spoken
changes as it grows. Captions in other languages are left as YouTube shows them.

## Words from videos

Words that aren't common, Known or Learning are recorded per video, in either mode,
with how often they came up, the sentence they first appeared in, and whether you
clicked them. Words in `[…]` or `(…)` are skipped.

Open **Words** from the toolbar popup. The **Videos** tab lists each video's words with
**Known** and **Learning** buttons; handled words move to the bottom, where they can be
switched or removed. **Mark the rest as known** handles everything still new.
**Delete** removes a video's record; words already on a list stay there. The
**Learning** and **Known** tabs list your words with their meaning and forms, with
search, sorting, and buttons to move or remove them. Recording can be turned off on
the settings page.

On Prime Video the title and episode only appear while the player's controls show.
Until you first move the mouse, words go to a group named after the page title; they
move to the episode's group once its title shows.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open the extension's settings page and click **Prepare models** once, so Chrome
   downloads the translation and Gemini Nano models.

After changing code, click the reload icon on the extension's card and reload the
video tab. The page's `<html data-dtu="ready 0.4.1">` shows which version is running.

## Layout

| Path | What it does |
| --- | --- |
| `manifest.json` | Manifest V3, no build step |
| `src/store.js` | Settings, known-word lists and caches in `chrome.storage.local` |
| `src/ai.js` | Translator and Prompt API wrappers |
| `src/words.js` | Tokenising and known-word matching |
| `src/recorder.js` | Records the words shown, per video |
| `src/prime.js` | Prime Video adapter: where the captions live in the page |
| `src/youtube.js` | YouTube adapter, including rolling auto-generated captions |
| `src/overlay.js` | Caption overlay and word popup |
| `src/main.js` | Wires the adapter, overlay and settings together |
| `lists/` | Built-in word lists |
| `popup/` | Toolbar popup: on/off and mode |
| `words/` | Words page: recorded words by video |
| `options/` | Settings page |
| `test/harness.html` | Fake Prime player for working on the overlay without Prime |
| `test/words-harness.html` | Words page with fake records and stubbed extension APIs |

The harnesses add a cache-busting query to each script, but a plain `http.server` lets
the browser cache them anyway; serve with `Cache-Control: no-store` if edits don't show.

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
