// Localization core. Each language is its own module (src/i18n/fr.js, src/i18n/en.js), so the
// page downloads only the language it shows: context.js awaits the active dictionary before the
// first render, which keeps t() synchronous, and setLang() loads the other one on a switch.
// Keys are exactly parallel (test/i18n-save.test.js); a key missing anyway renders ⟦key⟧.
const LOADERS = { fr: () => import('./i18n/fr.js'), en: () => import('./i18n/en.js') };
const dictionaries = {};

export const normalizeLanguage = (value) => (value === 'en' ? 'en' : 'fr');

// French typography, applied once so authors type ordinary spaces: a narrow no-break space
// (U+202F) before ! ? : ; » and after «, and a no-break space before %, so a lone "!" or "%"
// never wraps onto its own line.
function frenchTypography(dictionary) {
  return Object.fromEntries(
    Object.entries(dictionary).map(([key, value]) => [
      key,
      value
        .replace(/[ \u00a0\u202f]+([!?:;»])/g, '\u202f$1')
        .replace(/([\p{L}\p{N})}.…])([!?;»])/gu, '$1\u202f$2')
        .replace(/([\p{L}}]):/gu, '$1\u202f:')
        .replace(/«[ \u00a0\u202f]*/g, '«\u202f')
        .replace(/([\p{N}}])[ \u202f]?%/gu, '$1\u00a0%'),
    ])
  );
}

// The finished dictionary of a language (French typography applied), loaded once. A failed load
// stays failed for the page, like any failed module import.
export function loadDictionary(language) {
  const lang = normalizeLanguage(language);
  dictionaries[lang] ??= LOADERS[lang]().then(({ default: dictionary }) =>
    lang === 'fr' ? frenchTypography(dictionary) : dictionary
  );
  return dictionaries[lang];
}

// A numeric `count` var selects `<key>.<plural category>` when that form exists
// (e.g. 'mastery.total.one'); the bare key holds the plural ("other") form.
const PLURAL_RULES = { fr: new Intl.PluralRules('fr'), en: new Intl.PluralRules('en') };
// French elides "de" before a vowel-initial name: "Fiche d’Orakyn", "l’animation d’Énigme des marées".
const ELIDABLE = /^[aeiouâàäéèêëîïôöûùüœæ]/iu;

export async function createI18n(initial = 'fr') {
  let lang = normalizeLanguage(initial),
    dictionary = await loadDictionary(lang),
    requested = lang;
  return {
    get lang() {
      return lang;
    },
    // Loads the language first, then switches. Resolves false when a later call superseded it.
    async setLang(value) {
      const next = normalizeLanguage(value);
      requested = next;
      const loaded = await loadDictionary(next);
      if (requested !== next) return false;
      lang = next;
      dictionary = loaded;
      document.documentElement.lang = lang;
      return true;
    },
    t(key, vars = {}) {
      const form = typeof vars.count === 'number' ? PLURAL_RULES[lang].select(vars.count) : null;
      const value = (form && dictionary[`${key}.${form}`]) ?? dictionary[key] ?? `⟦${key}⟧`;
      return value.replace(/(?<![\p{L}’'])([dD])e \{(\w+)\}|\{(\w+)\}/gu, (_, d, elidedName, name) => {
        const text = String(vars[elidedName ?? name] ?? `{${elidedName ?? name}}`);
        if (!d) return text;
        return lang === 'fr' && ELIDABLE.test(text) ? `${d}’${text}` : `${d}e ${text}`;
      });
    },
  };
}
