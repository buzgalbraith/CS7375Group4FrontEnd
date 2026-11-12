import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ExplanationType, QESpan, Stimulus } from '../types';
import { containsToken, matchingLinks, SourceMatch, type WordSelection } from './SourceMatch';

interface Props {
  stimulus: Stimulus;
  /** Which explanation (if any) is currently overlaid on the document. */
  overlay: ExplanationType | null;
  onAlignmentHover?: () => void;
  onViewOriginal?: () => void;
}

/** Heatmap shading. Starting cut-offs from explanations/logprob_heatmap/METHOD.md; fixed before showing anyone. */
export function heatLevel(score: number): 'strong' | 'weak' | null {
  if (score < 0.1) return 'strong';
  if (score < 0.5) return 'weak';
  return null;
}

/** A heatmap score (the model's probability for the word, 0–1) as a percentage; tiny values read "under 1%". */
export function confidencePercent(score: number): string {
  const pct = Math.round(score * 100);
  return pct < 1 ? 'under 1%' : `${pct}%`;
}

const SEVERITY_TEXT: Record<NonNullable<QESpan['severity']>, string> = {
  critical: 'Possible critical error: this part may badly change the meaning.',
  major: 'Possible major error: this part may change the meaning.',
  minor: 'Possible minor error: probably a small wording problem that doesn’t change the meaning.',
};

/** Plain-language details for a quality-estimate span, one line each (shown on hover and in the list). */
export function qeDetails(span: QESpan): string[] {
  const lines = [span.severity ? SEVERITY_TEXT[span.severity] : span.note ?? `Estimated quality: ${Math.round(span.score * 100)}/100`];
  if (span.confidence !== undefined)
    lines.push(`How sure the AI is that this is an error: ${Math.round(span.confidence * 100)}%`);
  if (span.sentenceScore !== undefined) lines.push(`Quality score for this sentence: ${span.sentenceScore}/100`);
  return lines;
}

export function qeLevel(score: number): 'bad' | 'warn' | 'ok' {
  if (score < 0.4) return 'bad';
  if (score < 0.7) return 'warn';
  return 'ok';
}

export function DocumentPane({ stimulus, overlay, onAlignmentHover, onViewOriginal }: Props) {
  const [hovered, setHovered] = useState<WordSelection | null>(null);
  const [focused, setFocused] = useState<WordSelection | null>(null);
  const [pinned, setPinned] = useState<WordSelection | null>(null);
  const lastHovered = useRef<WordSelection | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchId = useId();
  // The original is shown as the notice image only. The Korean text is shown only when there's no image.
  const image = stimulus.original?.kind === 'image' ? stimulus.original.src : undefined;
  // Word glossary on the image needs to know where each Korean word is in it (image-boxes.json).
  const boxes = image ? stimulus.sourceBoxes : undefined;
  const { alignment, qe, heatmap } = stimulus.explanations;
  const links = useMemo(() => alignment ?? [], [alignment]);
  // Overlays only apply once that explanation exists (null = still pending). The Word glossary always works:
  // Korean words get their meaning from the bundled dictionary even without word-matching data.
  const showAlign = overlay === 'alignment';
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
    const newKoreanWord = side === 'src' && (lastHovered.current?.side !== 'src' || lastHovered.current.index !== index);
    if ((hit.length && changed) || newKoreanWord) onAlignmentHover?.();
    lastHovered.current = next;
    setHovered(next);
  };
  const isHot = (side: 'src' | 'tgt', i: number) =>
    selectedLinks.some((l) => containsToken(i, l[side])) || (selection?.side === side && selection.index === i);
  const renderToken = (
    side: 'src' | 'tgt',
    i: number,
    text: string,
    className: string,
    title?: string,
    // For a word on the image: where to draw it, and no visible text (the image shows the word).
    box?: { style: CSSProperties; key: string },
  ) => {
    if (!showAlign) return <span className={className} title={title}>{text}</span>;
    const isPinned = pinned?.side === side && pinned.index === i;
    return (
      <button
        key={box?.key}
        type="button"
        style={box?.style}
        className={`${className} ${box ? 'image-word' : 'word-match-token'}`}
        aria-label={side === 'src' ? `Show the translation of “${text}”` : `Highlight the Korean for “${text}”`}
        // Only Korean words open a popover (their English translation); English words just highlight.
        aria-haspopup={side === 'src' ? 'dialog' : undefined}
        aria-expanded={side === 'src' ? selection?.side === side && selection.index === i : undefined}
        aria-controls={side === 'src' && selection?.side === side && selection.index === i ? matchId : undefined}
        aria-describedby={side === 'src' && selection?.side === side && selection.index === i ? `${matchId}-content` : undefined}
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
        {box ? null : text}
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
          <div className={`doc-image-frame ${showAlign && boxes ? 'with-boxes' : ''}`}>
            {/* While Word glossary is open the image holds clickable word boxes, so it can't also be a button. */}
            {showAlign && boxes ? (
              <img src={image} alt={`The original notice in ${stimulus.sourceLang}`} draggable={false} />
            ) : (
              <button className="doc-image" onClick={onViewOriginal} title="Click to enlarge">
                <img src={image} alt={`The original notice in ${stimulus.sourceLang}`} draggable={false} />
              </button>
            )}
            {showAlign && boxes && (
              <div className="image-words" lang="ko">
                {boxes.flatMap((wordBoxes, i) =>
                  wordBoxes.map(([x, y, w, h], k) =>
                    renderToken('src', i, stimulus.sourceTokens[i], isHot('src', i) ? 'hot' : '', undefined, {
                      key: `${i}-${k}`,
                      // A little padding so the outline doesn't sit on the strokes.
                      style: {
                        left: `calc(${x * 100}% - 2px)`,
                        top: `calc(${y * 100}% - 2px)`,
                        width: `calc(${w * 100}% + 4px)`,
                        height: `calc(${h * 100}% + 4px)`,
                      },
                    }),
                  ),
                )}
              </div>
            )}
          </div>
        )}
        {(!image || (showAlign && !boxes)) && (
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
        {showAlign && <p className="word-match-hint small">Hover over a Korean word on the image to see its English translation.</p>}
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
              if (alignment !== null && !aligned.has(i)) cls.push('unaligned');
            }
            const title = span
              ? qeDetails(span).join('\n')
              : heatCls === 'strong'
                ? `Very unexpected given the Korean original. AI confidence in this word: ${confidencePercent(heat!.score)}`
                : heatCls === 'weak'
                  ? `Somewhat unexpected given the Korean original. AI confidence in this word: ${confidencePercent(heat!.score)}`
                  : undefined;
            return (
              <Fragment key={i}>
                {tgtBreaks.has(i) && <span className="para-break" />}
                {/* English words are plain text: only Korean words can be hovered or clicked. */}
                <span className={cls.join(' ')} title={title}>{t}</span>{' '}
              </Fragment>
            );
          })}
        </p>
        {showAlign && selection?.side === 'src' && (
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
      </section>
    </div>
  );
}
