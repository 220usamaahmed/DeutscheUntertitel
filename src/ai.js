// Wrappers around Chrome's built-in Translator API and Prompt API (Gemini Nano).
// The first create() of each may need a user click if the model isn't downloaded yet,
// so callers that hit a NotAllowedError should retry from a click handler.

const TRANSLATOR_OPTIONS = { sourceLanguage: "de", targetLanguage: "en" };

// Word lookups and inflected forms are two calls: Gemini Nano's time grows with the
// length of its reply, so the popup shows the meaning (~2 s) before the forms arrive.

const LOOKUP_PROMPTS = [
  {
    role: "system",
    content: `You are a German-English dictionary for a learner watching a show with German subtitles.
The user gives one German word and the subtitle sentence it appears in. Reply with JSON only.
- lemma: the dictionary form. Infinitive for verbs, nominative singular for nouns. For a separable verb whose prefix appears later in the sentence, the lemma includes the prefix.
- partOfSpeech: the word's part of speech in this sentence.
- meaningInContext: a short English translation of the word as used in this sentence.
- alternatives: 3 to 5 other common English translations of the lemma, most common first.`,
  },
  { role: "user", content: 'Word: "machst"\nSentence: "Wann machst du das Fenster zu?"' },
  {
    role: "assistant",
    content: '{"lemma":"zumachen","partOfSpeech":"verb","meaningInContext":"close","alternatives":["to close","to shut","to fasten"]}',
  },
];

const LOOKUP_SCHEMA = {
  type: "object",
  properties: {
    lemma: { type: "string" },
    partOfSpeech: {
      type: "string",
      enum: [
        "noun", "verb", "adjective", "adverb", "pronoun", "article", "preposition",
        "conjunction", "particle", "numeral", "interjection", "other",
      ],
    },
    meaningInContext: { type: "string" },
    alternatives: { type: "array", items: { type: "string" }, maxItems: 5 },
  },
  required: ["lemma", "partOfSpeech", "meaningInContext", "alternatives"],
  additionalProperties: false,
};

const FORMS_PROMPTS = [
  {
    role: "system",
    content: `You list the inflected forms of a German word, exactly as they are spelled in German text.
Verbs: present tense (ich, du, er, wir, ihr), simple past, past participle. Nouns: singular and plural, with case endings, without articles. Adjectives: the declined endings.
Reply with JSON only: an array of single words, no articles, no phrases.`,
  },
  { role: "user", content: "machen (verb)" },
  {
    role: "assistant",
    content: '["mache","machst","macht","machen","machte","machtest","machten","gemacht"]',
  },
];

const FORMS_SCHEMA = { type: "array", items: { type: "string" }, maxItems: 12 };

const AI = {
  _translator: null,
  _sessions: {},

  hasTranslator: () => "Translator" in self,
  hasPrompt: () => "LanguageModel" in self,

  translator(monitor) {
    if (!this._translator) {
      this._translator = Translator.create({ ...TRANSLATOR_OPTIONS, monitor }).catch((e) => {
        this._translator = null;
        throw e;
      });
    }
    return this._translator;
  },

  async translate(text) {
    return (await this.translator()).translate(text);
  },

  translatorAvailability() {
    return Translator.availability(TRANSLATOR_OPTIONS);
  },

  // One base session per prompt set; each call runs on a clone so calls don't
  // see each other's history.
  session(name = "lookup", monitor) {
    if (!this._sessions[name]) {
      const prompts = name === "forms" ? FORMS_PROMPTS : LOOKUP_PROMPTS;
      this._sessions[name] = LanguageModel.create({ initialPrompts: prompts, monitor }).catch(
        (e) => {
          delete this._sessions[name];
          throw e;
        },
      );
    }
    return this._sessions[name];
  },

  promptAvailability() {
    return LanguageModel.availability();
  },

  async _ask(name, text, schema) {
    const s = await (await this.session(name)).clone();
    try {
      return JSON.parse(await s.prompt(text, { responseConstraint: schema }));
    } finally {
      s.destroy();
    }
  },

  // { lemma, partOfSpeech, meaningInContext, alternatives }
  lookup(word, sentence) {
    return this._ask("lookup", `Word: "${word}"\nSentence: "${sentence}"`, LOOKUP_SCHEMA);
  },

  // Lowercase single-word forms. The model sometimes returns phrases or repeats.
  // For verbs ("rufe an") the first word is what appears in subtitles; for anything
  // else ("die Tür") it's the last.
  async forms(lemma, partOfSpeech) {
    const raw = await this._ask("forms", `${lemma} (${partOfSpeech})`, FORMS_SCHEMA);
    const words = raw.map((f) => {
      const parts = f.trim().toLowerCase().split(/\s+/);
      return partOfSpeech === "verb" ? parts[0] : parts.at(-1);
    });
    return [...new Set(words.filter((w) => /^\p{L}+$/u.test(w)))];
  },
};
