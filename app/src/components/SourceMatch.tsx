import type { AlignLink, Stimulus, TokenRange } from '../types';

export interface WordSelection {
  side: 'src' | 'tgt';
  index: number;
}

export const containsToken = (i: number, [start, end]: TokenRange) => i >= start && i < end;

export function matchingLinks(links: AlignLink[], selection: WordSelection | null) {
  if (!selection) return [];
  return links.filter((link) => containsToken(selection.index, link[selection.side]));
}

function paragraphLocation(breaks: number[], [start, end]: TokenRange) {
  const first = 1 + breaks.filter((i) => i <= start).length;
  const last = 1 + breaks.filter((i) => i < end).length;
  return first === last ? `Paragraph ${first}` : `Paragraphs ${first}–${last}`;
}

interface Props {
  id: string;
  stimulus: Stimulus;
  selection: WordSelection | null;
  links: AlignLink[];
  pinned: boolean;
  onClear: () => void;
}

/** Keep the source readable beside the translation, including on touch screens. */
export function SourceMatch({ id, stimulus, selection, links, pinned, onClear }: Props) {
  const tokens = selection?.side === 'src' ? stimulus.sourceTokens : stimulus.targetTokens;
  // Preserve individual pairs: merging overlapping links can imply correspondences that aren't in the data.
  const uniqueLinks = links.filter((link, i) =>
    links.findIndex((other) => other.src[0] === link.src[0] && other.src[1] === link.src[1]
      && other.tgt[0] === link.tgt[0] && other.tgt[1] === link.tgt[1]) === i,
  );

  return (
    <aside className={`source-match ${selection ? 'has-selection' : ''}`} aria-label="Source match">
      <div className="source-match-head">
        <h4>Where this text comes from</h4>
        {pinned && <button type="button" className="small" onClick={onClear}>Clear selection</button>}
      </div>
      <div id={id} role="status" aria-live="polite" aria-atomic="true">
        {!selection ? (
          <p className="muted">Hover or focus on a word to see its source. Click or tap to keep a match visible.</p>
        ) : uniqueLinks.length === 0 ? (
          <>
            <p className="source-match-empty">No {selection.side === 'tgt' ? 'source' : 'translation'} match available for “{tokens[selection.index]}”.</p>
            <p className="muted small">The supplied word mappings do not link this word to the other text. This alone does not mean the translation is wrong.</p>
          </>
        ) : (
          <>
            <p className="source-match-document">{stimulus.title}</p>
            <ol className="source-match-list">
              {uniqueLinks.map((link) => (
                <li key={`${link.src.join('-')}:${link.tgt.join('-')}`}>
                  <div className="source-match-label">{stimulus.sourceLang} original · {paragraphLocation(stimulus.sourceBreaks, link.src)}</div>
                  <blockquote lang="ko">{stimulus.sourceTokens.slice(...link.src).join(' ')}</blockquote>
                  <div className="source-match-label">Linked English text</div>
                  <p className="source-match-translation">{stimulus.targetTokens.slice(...link.tgt).join(' ')}</p>
                </li>
              ))}
            </ol>
            <p className="muted small">A word match shows a correspondence, not whether the translation is correct.</p>
          </>
        )}
      </div>
    </aside>
  );
}
