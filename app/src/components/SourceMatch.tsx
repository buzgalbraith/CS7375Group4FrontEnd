import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AlignLink, Stimulus, TokenRange } from '../types';

export interface WordSelection {
  side: 'src' | 'tgt';
  index: number;
  anchor: HTMLButtonElement;
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
  selection: WordSelection;
  links: AlignLink[];
  pinned: boolean;
  onClear: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
}

interface Position {
  left: number;
  top: number;
  arrow: number;
  maxHeight: number;
  placement: 'above' | 'below';
  visible: boolean;
}

/** A glossary attached to the selected word; a portal keeps it clear of document clipping. */
export function SourceMatch({ id, stimulus, selection, links, pinned, onClear, onMouseEnter, onMouseLeave, onFocus }: Props) {
  const bubble = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const tokens = selection.side === 'src' ? stimulus.sourceTokens : stimulus.targetTokens;

  useLayoutEffect(() => {
    const popup = bubble.current;
    const body = content.current;
    const anchor = selection.anchor;
    if (!popup || !body) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? document.documentElement.clientWidth;
      const height = viewport?.height ?? window.innerHeight;
      const margin = 12;
      const gap = 10;
      popup.style.width = `${Math.min(340, width - margin * 2)}px`;
      const popupWidth = popup.getBoundingClientRect().width;
      const naturalHeight = body.scrollHeight + 2;
      const below = Math.max(0, y + height - margin - rect.bottom - gap);
      const above = Math.max(0, rect.top - y - margin - gap);
      const placement = below >= naturalHeight || below >= above ? 'below' : 'above';
      const maxHeight = Math.min(height - margin * 2, placement === 'below' ? below : above);
      const center = rect.left + rect.width / 2;
      const left = Math.max(x + margin, Math.min(center - popupWidth / 2, x + width - popupWidth - margin));
      const next: Position = {
        left,
        top: placement === 'below' ? rect.bottom + gap : rect.top - gap - Math.min(naturalHeight, maxHeight),
        arrow: Math.max(18, Math.min(center - left, popupWidth - 18)),
        maxHeight,
        placement,
        visible: anchor.isConnected && rect.bottom > y && rect.top < y + height && rect.right > x && rect.left < x + width,
      };
      setPosition((current) => current && Object.keys(next).every((key) =>
        current[key as keyof Position] === next[key as keyof Position]) ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(body);
    const pane = anchor.closest('.doc-pane');
    if (pane) observer.observe(pane);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [selection.anchor, links, pinned]);
  // Preserve individual pairs: merging overlapping links can imply correspondences that aren't in the data.
  const uniqueLinks = links.filter((link, i) =>
    links.findIndex((other) => other.src[0] === link.src[0] && other.src[1] === link.src[1]
      && other.tgt[0] === link.tgt[0] && other.tgt[1] === link.tgt[1]) === i,
  );

  return createPortal(
    <div
      ref={bubble}
      id={id}
      className={`glossary-popover ${position?.placement ?? 'below'}`}
      role="dialog"
      aria-modal="false"
      aria-label={`Glossary for “${tokens[selection.index]}”`}
      style={{ left: position?.left, top: position?.top, visibility: position?.visible ? 'visible' : 'hidden' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
    >
      <span className="glossary-arrow" style={{ left: position?.arrow }} aria-hidden="true" />
      <div ref={content} className="source-match" style={{ maxHeight: position?.maxHeight }}>
        <div className="source-match-head">
          <div>
            <span className="source-match-label">Glossary{pinned ? ' · Pinned' : ''}</span>
            <h4 lang={selection.side === 'src' ? 'ko' : 'en'}>{tokens[selection.index]}</h4>
          </div>
          <button type="button" className="glossary-close" aria-label="Close glossary" onClick={onClear}>×</button>
        </div>
        <div id={`${id}-content`} role="status" aria-live="polite" aria-atomic="true">
          {uniqueLinks.length === 0 ? (
            <>
              <p className="source-match-empty">No {selection.side === 'tgt' ? 'source' : 'translation'} match available for “{tokens[selection.index]}”.</p>
              <p className="muted small">The supplied word mappings do not link this word to the other text. This alone does not mean the translation is wrong.</p>
            </>
          ) : (
            <>
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
              <p className="source-match-document">{stimulus.title}</p>
              <p className="muted small">A word match shows a correspondence, not whether the translation is correct.</p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
