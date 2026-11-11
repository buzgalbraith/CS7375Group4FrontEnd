import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ExplanationType, Stimulus } from '../types';
import { containsToken, matchingLinks, SourceMatch, type WordSelection } from './SourceMatch';

interface Props {
  stimulus: Stimulus;
  /** Which explanation (if any) is currently overlaid on the document. */
  overlay: ExplanationType | null;
  onAlignmentHover?: () => void;
  onViewOriginal?: () => void;
  /** Called when the participant clicks "Show transcription". */
  onShowTranscription?: () => void;
}

export function qeLevel(score: number): 'bad' | 'warn' | 'ok' {
  if (score < 0.4) return 'bad';
  if (score < 0.7) return 'warn';
  return 'ok';
}

export function DocumentPane({ stimulus, overlay, onAlignmentHover, onViewOriginal, onShowTranscription }: Props) {
  const [hovered, setHovered] = useState<WordSelection | null>(null);
  const [focused, setFocused] = useState<WordSelection | null>(null);
  const [pinned, setPinned] = useState<WordSelection | null>(null);
  const lastHovered = useRef<WordSelection | null>(null);
  const matchId = useId();
  // The notice image is shown first; the Korean text is a transcription the participant can reveal.
  // Without an image, the transcription is all there is, so it's always shown.
  const image = stimulus.original?.kind === 'image' ? stimulus.original.src : undefined;
  const [showTranscript, setShowTranscript] = useState(!stimulus.original);
  const { alignment, qe } = stimulus.explanations;
  const links = useMemo(() => alignment ?? [], [alignment]);
  // Overlays only apply once that explanation exists (null = still pending).
  const showAlign = overlay === 'alignment' && alignment !== null;
  const showQE = overlay === 'qe' && qe !== null;
  const selection = showAlign ? pinned ?? hovered ?? focused : null;
  const selectedLinks = matchingLinks(links, selection);
  const clearSelection = useCallback(() => {
    setHovered(null);
    setFocused(null);
    setPinned(null);
    lastHovered.current = null;
  }, []);
  // A match belongs to one notice/version and one explanation; never carry it to another tab.
  useEffect(clearSelection, [stimulus, overlay, clearSelection]);
  // Hover alone doesn't focus a word, so Escape must also work when focus is outside the document.
  useEffect(() => {
    if (!showAlign) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [showAlign, clearSelection]);
  // Word matching works on the transcription, so opening that explanation reveals it.
  useEffect(() => {
    if (showAlign) setShowTranscript(true);
  }, [showAlign]);
  const srcBreaks = useMemo(() => new Set(stimulus.sourceBreaks), [stimulus.sourceBreaks]);
  const tgtBreaks = useMemo(() => new Set(stimulus.targetBreaks), [stimulus.targetBreaks]);

  const aligned = useMemo(() => {
    const s = new Set<number>();
    links.forEach((l) => {
      for (let i = l.tgt[0]; i < l.tgt[1]; i++) s.add(i);
    });
    return s;
  }, [links]);

  const hover = (side: 'src' | 'tgt', index: number) => {
    if (pinned) return;
    const next = { side, index };
    const hit = matchingLinks(links, next);
    const previous = matchingLinks(links, lastHovered.current);
    const changed = hit.length !== previous.length || hit.some((l, k) => l !== previous[k]);
    if (hit.length && changed) onAlignmentHover?.();
    lastHovered.current = next;
    setHovered(next);
  };
  const isHot = (side: 'src' | 'tgt', i: number) =>
    selectedLinks.some((l) => containsToken(i, l[side])) || (selection?.side === side && selection.index === i);
  const renderToken = (side: 'src' | 'tgt', i: number, text: string, className: string, title?: string) => {
    if (!showAlign) return <span className={className} title={title}>{text}</span>;
    const isPinned = pinned?.side === side && pinned.index === i;
    return (
      <button
        type="button"
        className={`${className} word-match-token`}
        aria-label={`Show ${side === 'tgt' ? 'source' : 'translation'} for “${text}”`}
        aria-describedby={isHot(side, i) ? matchId : undefined}
        aria-pressed={isPinned}
        onMouseEnter={() => hover(side, i)}
        onFocus={() => {
          setHovered(null);
          lastHovered.current = null;
          setFocused({ side, index: i });
        }}
        onBlur={() => setFocused(null)}
        onClick={() => {
          if (isPinned) clearSelection();
          else setPinned({ side, index: i });
        }}
      >
        {text}
      </button>
    );
  };

  return (
    <div
      className={`doc-pane ${showAlign ? 'word-matching' : ''}`}
      onMouseLeave={() => { setHovered(null); lastHovered.current = null; }}
    >
      <section className="doc-col">
        <div className="doc-col-head">
          <h3>
            Original document <span className="muted">({stimulus.sourceLang})</span>
          </h3>
          {stimulus.original && onViewOriginal && (
            <button className="small" onClick={onViewOriginal} title="See the original document up close">
              ⤢ {image ? 'Enlarge' : `View original${stimulus.original.kind === 'pdf' ? ' (PDF)' : ''}`}
            </button>
          )}
        </div>
        {image && (
          <button className="doc-image" onClick={onViewOriginal} title="Click to enlarge">
            <img src={image} alt={`The original notice in ${stimulus.sourceLang}`} draggable={false} />
          </button>
        )}
        {stimulus.original && !showAlign && (
          <button
            className="small transcript-toggle"
            aria-expanded={showTranscript}
            onClick={() => {
              if (!showTranscript) onShowTranscription?.();
              setShowTranscript(!showTranscript);
            }}
          >
            {showTranscript ? 'Hide transcription' : 'Show transcription'}
          </button>
        )}
        {(showTranscript || showAlign) && (
          <p className="doc-text source" lang="ko">
            {stimulus.sourceTokens.map((t, i) => (
              <Fragment key={i}>
                {srcBreaks.has(i) && <span className="para-break" />}
                {renderToken('src', i, t, `tok ${showAlign && isHot('src', i) ? 'hot' : ''}`)}{' '}
              </Fragment>
            ))}
          </p>
        )}
      </section>
      <section className="doc-col">
        <h3>
          Machine translation <span className="muted">(English)</span>
        </h3>
        {showAlign && <p className="word-match-hint small">Hover to trace a word to the original. Click or tap to keep it selected; press Escape to clear.</p>}
        <p className="doc-text target" lang="en">
          {stimulus.targetTokens.map((t, i) => {
            const span = showQE ? qe!.spans.find((s) => containsToken(i, s.tgt)) : undefined;
            const cls = ['tok'];
            if (span) cls.push(`qe-${qeLevel(span.score)}`);
            if (showAlign) {
              if (isHot('tgt', i)) cls.push('hot');
              if (!aligned.has(i)) cls.push('unaligned');
            }
            const title = span
              ? `Estimated quality: ${Math.round(span.score * 100)}/100${span.note ? ` — ${span.note}` : ''}`
              : undefined;
            return (
              <Fragment key={i}>
                {tgtBreaks.has(i) && <span className="para-break" />}
                {renderToken('tgt', i, t, cls.join(' '), title)}{' '}
              </Fragment>
            );
          })}
        </p>
        {showAlign && (
          <SourceMatch
            id={matchId}
            stimulus={stimulus}
            selection={selection}
            links={selectedLinks}
            pinned={pinned !== null}
            onClear={clearSelection}
          />
        )}
        {overlay === 'alignment' && alignment === null && (
          <p className="word-match-hint muted small">Source matches are not available for this notice yet.</p>
        )}
      </section>
    </div>
  );
}
