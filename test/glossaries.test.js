const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseDictionary,
  parseDictionaries,
  normalizeFormality,
  GLOSSARY_LIMITS,
  getCacheKey,
  serializeGlossary,
  serializeLanguage,
  validateLanguageCode
} = require("../server");

test("treats null formality as absent and rejects unknown values", () => {
  assert.equal(normalizeFormality(undefined), "default");
  assert.equal(normalizeFormality(null), "default");
  assert.equal(normalizeFormality("prefer_more"), "prefer_more");
  assert.throws(() => normalizeFormality("formal-ish"), /Invalid formality/);
});

test("normalizes glossary language codes and entries", () => {
  const dictionary = parseDictionary({
    source_lang: "en",
    target_lang: "fr",
    entries: [{ source: " Saving Throw ", target: " Jet de sauvegarde " }]
  });

  assert.equal(dictionary.sourceLangCode, "EN");
  assert.equal(dictionary.targetLangCode, "FR");
  assert.equal(dictionary.entries.toTsv(), "Saving Throw\tJet de sauvegarde");
});

test("serializes supported languages for the module", () => {
  assert.deepEqual(serializeLanguage({
    code: "EN-US",
    name: "English (American)",
    supportsFormality: false
  }), {
    language: "EN-US",
    name: "English (American)",
    supports_formality: false
  });
});

test("accepts the shorthand single-dictionary request", () => {
  const dictionaries = parseDictionaries({
    source_lang: "EN",
    target_lang: "FR",
    entries: [{ source: "Armor Class", target: "Classe d’armure" }]
  });

  assert.equal(dictionaries.length, 1);
});

test("rejects duplicate and empty source terms", () => {
  assert.throws(() => parseDictionary({
    source_lang: "EN",
    target_lang: "FR",
    entries: [
      { source: "Spell Slot", target: "Emplacement de sort" },
      { source: "Spell Slot", target: "Case de sort" }
    ]
  }), /Duplicate glossary source term/);

  assert.throws(() => parseDictionary({
    source_lang: "EN",
    target_lang: "FR",
    entries: [{ source: " ", target: "Vide" }]
  }), /must not be empty/);

  assert.throws(() => parseDictionary({
    source_lang: "EN",
    target_lang: "FR",
    entries: [
      { source: "Spell", target: "Sort" },
      { source: "spell", target: "Magie" }
    ]
  }), /Duplicate glossary source term/);
});

test("validates language codes", () => {
  assert.equal(validateLanguageCode("en-us", "source_lang"), "EN-US");
  assert.equal(validateLanguageCode("es-419", "target_lang"), "ES-419");
  assert.equal(validateLanguageCode("zh-Hans", "source_lang"), "ZH-HANS");
  assert.throws(() => validateLanguageCode("english", "source_lang"), /Invalid source_lang/);
});

test("keeps semantically distinct HTML whitespace out of the same cache entry", () => {
  assert.notEqual(
    getCacheKey("<pre>one  two</pre>", "FR"),
    getCacheKey("<pre>one two</pre>", "FR")
  );
  assert.equal(
    getCacheKey("<p>Hello</p>", "FR"),
    getCacheKey("<p>Hello</p>", "FR")
  );
});

test("enforces dedicated glossary limits", () => {
  assert.throws(() => parseDictionary({
    source_lang: "EN",
    target_lang: "FR",
    entries: [{ source: "x".repeat(GLOSSARY_LIMITS.maxTermLength + 1), target: "Test" }]
  }), /must not exceed/);
  assert.throws(() => parseDictionaries({
    dictionaries: Array.from({ length: GLOSSARY_LIMITS.maxDictionaries + 1 }, () => ({
      source_lang: "EN",
      target_lang: "FR",
      entries: [{ source: "One", target: "Un" }]
    }))
  }), /cannot contain more/);
});

test("serializes the DeepL SDK glossary shape as the proxy contract", () => {
  const creationTime = new Date("2026-07-18T20:00:00.000Z");
  assert.deepEqual(serializeGlossary({
    glossaryId: "glossary-1",
    name: "D&D 5e — EN to FR",
    creationTime,
    dictionaries: [{ sourceLangCode: "en", targetLangCode: "fr", entryCount: 3 }]
  }), {
    glossary_id: "glossary-1",
    name: "D&D 5e — EN to FR",
    creation_time: creationTime,
    dictionaries: [{ source_lang: "en", target_lang: "fr", entry_count: 3 }]
  });
});
