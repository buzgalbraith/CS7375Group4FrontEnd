/** The Word glossary's dictionary: a Korean word's English meaning. */
import dictionaryFile from '../../translation-experiment-data/dictionary.json';
import type { Stimulus } from '../types';
import { buildDictionaryIndex, lookupDictionaryWord, type DictionaryFile } from './dictionary';

const index = buildDictionaryIndex((dictionaryFile as DictionaryFile).entries);

/** English meaning of a Korean word (its first sense), or null if the dictionary has no entry. */
export function koreanGloss(stimulus: Stimulus, i: number): string | null {
  const [hit] = lookupDictionaryWord(index, 'ko', stimulus.sourceTokens, i, stimulus.sourceBreaks);
  return hit ? hit.entry.senses[0].definition : null;
}

