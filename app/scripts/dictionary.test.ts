import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDictionaryIndex, dictionaryForSelection, lookupDictionaryWord, validateDictionary, type DictionaryFile } from '../src/lib/dictionary.ts';

const dictionary: DictionaryFile = JSON.parse(readFileSync(new URL('../translation-experiment-data/dictionary.json', import.meta.url), 'utf8'));
const index = buildDictionaryIndex(dictionary.entries);

test('dictionary snapshot has valid definitions, attribution, and unambiguous forms', () => {
  assert.deepEqual(validateDictionary(dictionary), []);
  for (const language of ['en', 'ko']) assert.ok(dictionary.entries.some((entry) => entry.language === language));
});

test('punctuation and explicit inflections resolve to dictionary headwords in both languages', () => {
  assert.equal(lookupDictionaryWord(index, 'en', ['“TOWELS,”'], 0)[0].entry.headword, 'towel');
  assert.equal(lookupDictionaryWord(index, 'ko', ['무료입니다.'], 0)[0].entry.headword, '무료');
  assert.equal(lookupDictionaryWord(index, 'ko', ['받으세요.'], 0)[0].entry.headword, '받다');
  assert.deepEqual(lookupDictionaryWord(index, 'ko', ['무료라면'], 0), [], 'unlisted Korean endings must not be guessed');
  assert.deepEqual(lookupDictionaryWord(index, 'en', ['passwordish'], 0), [], 'substrings must not become dictionary matches');
});

test('multiword entries prefer the whole phrase and retain the hovered occurrence', () => {
  const tokens = ['front', 'desk.', 'front', 'desk.'];
  const hit = lookupDictionaryWord(index, 'en', tokens, 3)[0];
  assert.equal(hit.entry.headword, 'front desk');
  assert.deepEqual(hit.range, [2, 4]);
  assert.equal(lookupDictionaryWord(index, 'en', tokens, 2)[0].entry.headword, 'front desk');
});

test('dictionary phrases cannot join separate paragraphs or exceed alignment bounds', () => {
  assert.ok(lookupDictionaryWord(index, 'en', ['front', 'desk'], 1, [1]).every((hit) => hit.entry.headword !== 'front desk'));
  assert.ok(lookupDictionaryWord(index, 'en', ['front', 'desk'], 1, [], [1, 2]).every((hit) => hit.entry.headword !== 'front desk'));
});

test('the selected word and its linked text get separate dictionary entries', () => {
  const text = { sourceTokens: ['무료입니다.'], targetTokens: ['is', 'free.'], sourceBreaks: [], targetBreaks: [] };
  const groups = dictionaryForSelection(index, text, { side: 'tgt', index: 1 }, [{ src: [0, 1], tgt: [0, 2] }]);
  assert.equal(groups.en.matches[0].entry.headword, 'free');
  assert.equal(groups.ko.matches[0].entry.headword, '무료');
  assert.ok(groups.en.matches[0].entry.senses.some((sense) => /payment|charge|cost/i.test(sense.definition)));
  assert.deepEqual(groups.ko.missing, []);
});

test('a dictionary definition never creates an alignment for an unmatched word', () => {
  const groups = dictionaryForSelection(index, {
    sourceTokens: ['무료입니다.'], targetTokens: ['Thank', 'you!'], sourceBreaks: [], targetBreaks: [],
  }, { side: 'tgt', index: 0 }, []);
  assert.equal(groups.en.matches[0].entry.headword, 'thank you');
  assert.equal(groups.ko.linked, false);
  assert.deepEqual(groups.ko.matches, []);
});

test('duplicate source links do not repeat dictionary entries', () => {
  const groups = dictionaryForSelection(index, {
    sourceTokens: ['프런트에서'], targetTokens: ['front', 'desk'], sourceBreaks: [], targetBreaks: [],
  }, { side: 'src', index: 0 }, [{ src: [0, 1], tgt: [0, 2] }, { src: [0, 1], tgt: [0, 2] }]);
  assert.equal(groups.en.matches.length, 1);
  assert.equal(groups.en.matches[0].entry.headword, 'front desk');
});

test('validation catches conflicting aliases and unrelated attribution links', () => {
  const copy = structuredClone(dictionary);
  const duplicate = structuredClone(copy.entries.find((entry) => entry.id === 'en:free')!);
  duplicate.id = 'en:other';
  duplicate.headword = 'other';
  duplicate.forms = ['free'];
  copy.entries.push(duplicate);
  assert.ok(validateDictionary(copy).some((error) => error.includes('ambiguous form')));
  assert.ok(validateDictionary(copy).some((error) => error.includes('source URL')));
});
