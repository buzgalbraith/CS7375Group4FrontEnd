import dictionaryFile from '../../translation-experiment-data/dictionary.json';
import { buildDictionaryIndex, dictionaryForSelection, normalizeDictionaryWord, type DictionaryFile, type DictionaryMatch } from '../lib/dictionary';
import type { AlignLink, Stimulus } from '../types';

const dictionary = dictionaryFile as DictionaryFile;
const index = buildDictionaryIndex(dictionary.entries);

function Entry({ match }: { match: DictionaryMatch }) {
  const { entry, text } = match;
  const [first, ...remaining] = entry.senses;
  return (
    <article className="dictionary-entry">
      <strong lang={entry.language}>{entry.headword}</strong>
      {normalizeDictionaryWord(text) !== normalizeDictionaryWord(entry.headword) && (
        <span className="dictionary-form"> · form: <span lang={entry.language}>{text}</span></span>
      )}
      <p><span className="dictionary-pos">{first.partOfSpeech}</span> {first.definition}</p>
      {remaining.length > 0 && (
        <details>
          <summary>{remaining.length} more {remaining.length === 1 ? 'meaning' : 'meanings'}</summary>
          {remaining.map((sense, i) => <p key={i}><span className="dictionary-pos">{sense.partOfSpeech}</span> {sense.definition}</p>)}
        </details>
      )}
      <a className="dictionary-source" href={entry.sourceUrl} target="_blank" rel="noreferrer">Wiktionary entry ↗</a>
    </article>
  );
}

export function DictionaryEntries({ stimulus, side, tokenIndex, links }: {
  stimulus: Stimulus; side: 'src' | 'tgt'; tokenIndex: number; links: AlignLink[];
}) {
  const groups = dictionaryForSelection(index, stimulus, { side, index: tokenIndex }, links);
  return (
    <section className="dictionary" aria-label="Dictionary entries">
      <h5>Dictionary <span className="muted">· meanings in English</span></h5>
      {(['en', 'ko'] as const).map((language) => {
        const group = groups[language];
        const label = language === 'en' ? 'English' : 'Korean';
        const [first, ...remaining] = group.matches;
        return (
          <section key={language} className="dictionary-language" aria-label={`${label} dictionary`}>
            <h6>{label}</h6>
            {first && <Entry match={first} />}
            {remaining.length > 0 && (
              <details className="dictionary-more">
                <summary>{remaining.length} more {label} {remaining.length === 1 ? 'entry' : 'entries'}</summary>
                {remaining.map((match) => <Entry key={match.entry.id} match={match} />)}
              </details>
            )}
            {!group.linked && <p className="dictionary-missing">No linked {label} text.</p>}
            {group.missing.length > 0 && <p className="dictionary-missing">No saved entry for {group.missing.map((word) => `“${word}”`).join(', ')}.</p>}
          </section>
        );
      })}
      <p className="dictionary-credit">{dictionary.attribution} · <a href={dictionary.license.url} target="_blank" rel="noreferrer">{dictionary.license.name}</a></p>
    </section>
  );
}
