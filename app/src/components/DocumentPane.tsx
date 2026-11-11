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

/** Heatmap shading. Starting cut-offs from explanations/logprob_heatmap/METHOD.md; fixed before showing anyone. */
export function heatLevel(score: number): 'strong' | 'weak' | null {
  if (score < 0.1) return 'strong';
  if (score < 0.5) return 'weak';
  return null;
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchId = useId();
  // The notice image is shown first; the Korean text is a transcription the participant can reveal.
  // Without an image, the transcription is all there is, so it's always shown.
  const image = stimulus.original?.kind === 'image' ? stimulus.original.src : undefined;
  const [showTranscript, setShowTranscript] = useState(!stimulus.original);
  const { alignment, qe, heatmap } = stimulus.explanations;
  const links = useMemo(() => alignment ?? [], [alignment]);
  // Overlays only apply once that explanation exists (null = still pending).
  const showAlign = overlay === 'alignment' && alignment !== null;
  const showQE = overlay === 'qe' && qe !== null;
  const showHeat = overlay === 'heatmap' && heatmap !== null;
  const selection = showAlign ? pinned ?? hovered ?? focused : null;
  const selectedLinks = useMemo(() => matchingLinks(links, selection), [links, selection]);
  const cancelHoverClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const scheduleHoverClose = () => {
    cancelHoverClose();
    // Allow the pointer to cross the small gap between the word and its glossary.
    closeTimer.current = setTimeout(() => {
      setHovered(null);
      lastHovered.current = null;
    }, 180);
  };
  const clearSelection = useCallback(() => {
    cancelHoverClose();
    setHovered(null);
    setFocused(null);
    setPinned(null);
    lastHovered.current = null;
  }, [cancelHoverClose]);
  useEffect(() => cancelHoverClose, [cancelHoverClose]);
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
  const anchor = selection?.anchor;
  useEffect(() => {
    if (!anchor) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !document.getElementById(matchId)?.contains(target)) clearSelection();
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [anchor, matchId, clearSelection]);
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

  const hover = (side: 'src' | 'tgt', index: number, anchor: HTMLButtonElement) => {
    cancelHoverClose();
    if (pinned) return;
    const next = { side, index, anchor };
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
        aria-haspopup="dialog"
        aria-expanded={selection?.side === side && selection.index === i}
        aria-controls={selection?.side === side && selection.index === i ? matchId : undefined}
        aria-describedby={selection?.side === side && selection.index === i ? `${matchId}-content` : undefined}
        aria-pressed={isPinned}
        onMouseEnter={(event) => hover(side, i, event.currentTarget)}
        onMouseLeave={scheduleHoverClose}
        onFocus={(event) => {
          cancelHoverClose();
          setHovered(null);
          lastHovered.current = null;
          setFocused({ side, index: i, anchor: event.currentTarget });
        }}
        onBlur={() => setFocused(null)}
        onClick={(event) => {
          if (isPinned) clearSelection();
          else setPinned({ side, index: i, anchor: event.currentTarget });
        }}
      >
        {text}
      </button>
    );
  };

  return (
    <div className={`doc-pane ${showAlign ? 'word-matching' : ''}`}>
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
        {showAlign && <p className="word-match-hint small">Hover or focus on a word to open its glossary. Click or tap to pin it; press Escape to close.</p>}
        <p className="doc-text target" lang="en">
          {stimulus.targetTokens.map((t, i) => {
            const span = showQE ? qe!.spans.find((s) => containsToken(i, s.tgt)) : undefined;
            const cls = ['tok'];
            if (span) cls.push(`qe-${qeLevel(span.score)}`);
            const heat = showHeat ? heatmap!.words.find((w) => containsToken(i, w.tgt)) : undefined;
            const heatCls = heat ? heatLevel(heat.score) : null;
            if (heatCls) cls.push(`heat-${heatCls}`);
            if (showAlign) {
              if (isHot('tgt', i)) cls.push('hot');
              if (!aligned.has(i)) cls.push('unaligned');
            }
            const title = span
              ? `Estimated quality: ${Math.round(span.score * 100)}/100${span.note ? ` — ${span.note}` : ''}`
              : heatCls === 'strong'
                ? 'Very unexpected given the Korean original'
                : heatCls === 'weak'
                  ? 'Somewhat unexpected given the Korean original'
                  : undefined;
            return (
              <Fragment key={i}>
                {tgtBreaks.has(i) && <span className="para-break" />}
                {renderToken('tgt', i, t, cls.join(' '), title)}{' '}
              </Fragment>
            );
          })}
        </p>
        {showAlign && selection && (
          <SourceMatch
            id={matchId}
            stimulus={stimulus}
            selection={selection}
            links={selectedLinks}
            pinned={pinned !== null}
            onClear={clearSelection}
            onMouseEnter={cancelHoverClose}
            onMouseLeave={scheduleHoverClose}
            onFocus={() => { cancelHoverClose(); setPinned(selection); }}
          />
        )}
        {overlay === 'alignment' && alignment === null && (
          <p className="word-match-hint muted small">Source matches are not available for this notice yet.</p>
        )}
      </section>
    </div>
  );
}
