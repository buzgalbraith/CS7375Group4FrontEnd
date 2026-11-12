import type { AlignLink, Stimulus, TokenRange } from '../types';

export type DictionaryLanguage = 'en' | 'ko';
export interface DictionaryEntry {
  id: string;
  language: DictionaryLanguage;
  headword: string;
  /** Explicit surface forms; Korean endings are never guessed at runtime. */
  forms: string[];
  senses: { partOfSpeech: string; definition: string }[];
  sourceUrl: string;
}
export interface DictionaryFile {
  about: string;
  retrievedOn: string;
  attribution: string;
  license: { name: string; url: string };
  entries: DictionaryEntry[];
}
interface IndexedForm { entry: DictionaryEntry; words: string[] }
export interface DictionaryIndex { forms: Map<string, IndexedForm[]>; maxWords: number }
export interface DictionaryMatch { entry: DictionaryEntry; text: string; range: TokenRange }
export interface DictionaryGroup { matches: DictionaryMatch[]; missing: string[]; linked: boolean }

export const normalizeDictionaryWord = (word: string) => word.normalize('NFKC').toLowerCase()
  .replace(/[‐‑‒–—]/g, '-').replace(/[’‘]/g, "'")
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

export function buildDictionaryIndex(entries: DictionaryEntry[]): DictionaryIndex {
  const forms = new Map<string, IndexedForm[]>();
  let maxWords = 1;
  for (const entry of entries) {
    const uniqueForms = new Set([entry.headword, ...entry.forms].map((form) =>
      form.split(/\s+/).map(normalizeDictionaryWord).join(' ')));
    for (const form of uniqueForms) {
      const words = form.split(' ');
      const key = `${entry.language}:${words[0]}`;
      forms.set(key, [...(forms.get(key) ?? []), { entry, words }]);
      maxWords = Math.max(maxWords, words.length);
    }
  }
  return { forms, maxWords };
}

/** Prefer a complete phrase (e.g. front desk), without crossing a paragraph or linked span. */
export function lookupDictionaryWord(
  index: DictionaryIndex, language: DictionaryLanguage, tokens: string[], at: number,
  breaks: number[] = [], bounds: TokenRange = [0, tokens.length],
): DictionaryMatch[] {
  const hits: DictionaryMatch[] = [];
  let longest = 0;
  for (let start = Math.max(bounds[0], at - index.maxWords + 1); start <= at; start++) {
    const candidates = index.forms.get(`${language}:${normalizeDictionaryWord(tokens[start] ?? '')}`) ?? [];
    for (const { entry, words } of candidates) {
      const end = start + words.length;
      if (end <= at || end > bounds[1] || words.length < longest) continue;
      if (breaks.some((b) => b > start && b < end)) continue;
      if (!words.every((word, i) => word === normalizeDictionaryWord(tokens[start + i]))) continue;
      if (words.length > longest) { hits.length = 0; longest = words.length; }
      if (!hits.some((hit) => hit.entry.id === entry.id))
        hits.push({ entry, text: tokens.slice(start, end).join(' '), range: [start, end] });
    }
  }
  return hits;
}

type DictionaryText = Pick<Stimulus, 'sourceTokens' | 'targetTokens' | 'sourceBreaks' | 'targetBreaks'>;

export function dictionaryForSelection(
  index: DictionaryIndex, text: DictionaryText, selection: { side: 'src' | 'tgt'; index: number }, links: AlignLink[],
): Record<DictionaryLanguage, DictionaryGroup> {
  const groups: Record<DictionaryLanguage, DictionaryGroup> = {
    en: { matches: [], missing: [], linked: false }, ko: { matches: [], missing: [], linked: false },
  };
  for (const language of ['en', 'ko'] as const) {
    const side = language === 'en' ? 'tgt' : 'src';
    const tokens = side === 'src' ? text.sourceTokens : text.targetTokens;
    const breaks = side === 'src' ? text.sourceBreaks : text.targetBreaks;
    const group = groups[language];
    const addAt = (at: number, bounds?: TokenRange) => {
      const hits = lookupDictionaryWord(index, language, tokens, at, breaks, bounds);
      for (const hit of hits) if (!group.matches.some((match) => match.entry.id === hit.entry.id)) group.matches.push(hit);
      if (!hits.length && !group.missing.includes(tokens[at])) group.missing.push(tokens[at]);
      return hits.length ? Math.max(...hits.map((hit) => hit.range[1])) : at + 1;
    };
    if (selection.side === side) {
      group.linked = true;
      addAt(selection.index);
    } else {
      group.linked = links.length > 0;
      for (const link of links) {
        for (let at = link[side][0]; at < link[side][1];) at = addAt(at, link[side]);
      }
    }
  }
  return groups;
}

export function validateDictionary(file: DictionaryFile): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const forms = new Map<string, string>();
  if (file.license?.name !== 'CC BY-SA 4.0' || file.license?.url !== 'https://creativecommons.org/licenses/by-sa/4.0/')
    errors.push('dictionary.json: missing or unexpected license');
  if (!file.attribution?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(file.retrievedOn))
    errors.push('dictionary.json: missing attribution or retrieval date');
  for (const entry of file.entries) {
    const where = `dictionary.json ${entry.id}`;
    if (ids.has(entry.id)) errors.push(`${where}: duplicate id`);
    ids.add(entry.id);
    if (!['en', 'ko'].includes(entry.language) || !entry.headword.trim()) errors.push(`${where}: invalid language or headword`);
    if (!entry.senses.length || entry.senses.some((sense) => !sense.partOfSpeech.trim() || !sense.definition.trim() || /<\/?[a-z][^>]*>/i.test(sense.definition)))
      errors.push(`${where}: expected plain-text definitions with parts of speech`);
    const expectedUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(entry.headword.replaceAll(' ', '_'))}#${entry.language === 'ko' ? 'Korean' : 'English'}`;
    if (entry.sourceUrl !== expectedUrl) errors.push(`${where}: source URL must point to this headword and language`);
    for (const form of [entry.headword, ...entry.forms]) {
      const normalized = form.split(/\s+/).map(normalizeDictionaryWord).join(' ');
      const key = `${entry.language}:${normalized}`;
      if (!normalized.trim()) errors.push(`${where}: empty form`);
      if (forms.has(key) && forms.get(key) !== entry.id) errors.push(`${where}: ambiguous form "${form}"`);
      forms.set(key, entry.id);
    }
  }
  return errors;
}
