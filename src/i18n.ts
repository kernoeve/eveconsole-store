// The words the site shows buyers, in the store's language.
//
// EVE Console says which language the store speaks (StoreInfo.language, the app's own codes:
// en, de, es, fr, ja, ko, ru, zh-Hans), and every page, message and number is worded and
// formatted in it. An app from before the field sends none, and the site speaks English as it
// always did. English is the catalogue every translation is checked against (test/i18n.test.ts):
// a key a translation lacks falls back to English here, and fails the tests there.
//
// A message is a string with {name} placeholders, or plural forms chosen by the argument n. The
// CLDR categories (zero, one, two, few, many, other) each keep every placeholder the English has;
// an exact form ("=1") matches that number only and may leave {n} out, so "per day" can stand
// for one day where Russian's "one" also has to cover 21. Numbers passed as arguments come out
// in the language's own format; an identifier (a contract id, an HTTP status) is passed as a
// string, so it is not grouped like an amount.

import { en } from "./messages/en";
import { de } from "./messages/de";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { ja } from "./messages/ja";
import { ko } from "./messages/ko";
import { ru } from "./messages/ru";
import { zhHans } from "./messages/zh-Hans";

export const LANGUAGES = ["en", "de", "es", "fr", "ja", "ko", "ru", "zh-Hans"] as const;
export type Lang = (typeof LANGUAGES)[number];

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type Plural = { other: string } & { [C in Exclude<PluralCategory, "other">]?: string } & { [exact: `=${number}`]: string };
export type Message = string | Plural;

export type Key = keyof typeof en;
export type Translation = { [K in Key]?: Message };
export type Args = Record<string, string | number>;

/** Something to tell the buyer, not yet worded: what code that does not know the language returns. */
export interface Said { key: Key; args?: Args }
export const said = (key: Key, args?: Args): Said => (args ? { key, args } : { key });

export const catalogues: Record<Lang, Translation> = { en, de, es, fr, ja, ko, ru, "zh-Hans": zhHans };

/** The language to speak: the store's, or English for a code this site does not know or none at all. */
export function langOf(code: string | null | undefined): Lang {
  const wanted = (code ?? "").toLowerCase();
  return LANGUAGES.find((l) => l.toLowerCase() === wanted) ?? "en";
}

const numberFormats = new Map<Lang, Intl.NumberFormat>();
const pluralRules = new Map<Lang, Intl.PluralRules>();

/** A whole number as the language writes it: 1,100,000 in English, 1.100.000 in German. */
export function formatNumber(lang: Lang, n: number): string {
  let f = numberFormats.get(lang);
  if (!f) numberFormats.set(lang, (f = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 })));
  return f.format(n);
}

function pick(lang: Lang, message: Plural, n: number): string {
  const exact = message[`=${n}`];
  if (exact !== undefined) return exact;
  let rules = pluralRules.get(lang);
  if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(lang)));
  return message[rules.select(n) as PluralCategory] ?? message.other;
}

/** The message in the language, its placeholders filled; numbers in the language's format. */
export function t(lang: Lang, key: Key, args?: Args): string {
  const message = catalogues[lang][key] ?? en[key];
  const text = typeof message === "string" ? message : pick(lang, message, Number(args?.n ?? 0));
  if (!args) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = args[name];
    return v === undefined ? whole : typeof v === "number" ? formatNumber(lang, v) : v;
  });
}

/** Words what code without the language said. */
export const tell = (lang: Lang, s: Said): string => t(lang, s.key, s.args);

/** An amount of ISK, as the language writes one. */
export const formatIsk = (lang: Lang, n: number): string => t(lang, "iskAmount", { amount: n });

/** A plain message's own text with its placeholders left in: for a script in the page that fills them itself. */
export function template(lang: Lang, key: Key): string {
  const message = catalogues[lang][key] ?? en[key];
  return typeof message === "string" ? message : message.other;
}
