// Wrappers around Chrome's built-in Translator API and Prompt API (Gemini Nano).
// The first create() of each may need a user click if the model isn't downloaded yet,
// so callers that hit a NotAllowedError should retry from a click handler.

const TRANSLATOR_OPTIONS = { sourceLanguage: "de", targetLanguage: "en" };

const LOOKUP_SYSTEM_PROMPT = `You are a German-English dictionary for a learner watching a show with German subtitles.
The user gives one German word and the subtitle sentence it appears in. Reply with JSON only.
- lemma: the dictionary form, lowercase except for nouns. Infinitive for verbs, nominative singular for nouns, masculine nominative singular for articles, pronouns and adjectives. For a separable verb whose prefix appears elsewhere in the sentence, include the prefix (e.g. "rufe" in "Ich rufe dich an" -> "anrufen").
- partOfSpeech: the word's part of speech in this sentence.
- meaningInContext: a short English translation of the word as used in this sentence.
- alternatives: 3 to 5 other common English translations of the lemma, most common first.
- forms: the common inflected forms of the lemma, lowercase, at most 12.`;

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
    forms: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
  required: ["lemma", "partOfSpeech", "meaningInContext", "alternatives", "forms"],
  additionalProperties: false,
};

const AI = {
  _translator: null,
  _session: null,

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

  session(monitor) {
    if (!this._session) {
      const opts = {
        initialPrompts: [{ role: "system", content: LOOKUP_SYSTEM_PROMPT }],
        expectedInputs: [{ type: "text", languages: ["en", "de"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        monitor,
      };
      this._session = LanguageModel.create(opts)
        .catch((e) => {
          // German may not be a supported input language hint; English-only still works.
          if (e.name !== "NotSupportedError") throw e;
          return LanguageModel.create({ ...opts, expectedInputs: [{ type: "text", languages: ["en"] }] });
        })
        .catch((e) => {
          this._session = null;
          throw e;
        });
    }
    return this._session;
  },

  promptAvailability() {
    return LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  },

  // Returns { lemma, partOfSpeech, meaningInContext, alternatives, forms }.
  async lookup(word, sentence) {
    const base = await this.session();
    const s = await base.clone();
    try {
      const reply = await s.prompt(`Word: "${word}"\nSentence: "${sentence}"`, {
        responseConstraint: LOOKUP_SCHEMA,
      });
      return JSON.parse(reply);
    } finally {
      s.destroy();
    }
  },
};
