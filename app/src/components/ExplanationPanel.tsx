import type { ExplanationType, Stimulus } from '../types';
import { EXPLANATION_NAMES } from '../lib/session';
import { heatLevel, qeLevel } from './DocumentPane';

/** Shown only in the tutorial, to teach how to read each format. Trials show no hints. */
const TUTORIAL_HINTS: Record<ExplanationType, string> = {
  heatmap:
    'A translation model read the Korean and the English translation, and the English words it found unexpected are shaded red. Darker red means more unexpected. Hover over shaded words to see details.',
  rationale: 'This is a written explanation, produced by an AI model, of how well the translation matches the original.',
  qe: 'Parts of the translation are colored by how likely they are to contain an error. Hover over colored text to see details.',
  alignment:
    'Hover or focus on words in either text to open an attached glossary with the linked Korean phrase and its paragraph. Click or tap to pin it. A dashed underline means no source match is available in the supplied word mappings.',
};

interface Props {
  type: ExplanationType;
  stimulus: Stimulus;
  tutorial?: boolean;
}

export function ExplanationPanel({ type, stimulus, tutorial }: Props) {
  const ex = stimulus.explanations;

  if (ex[type] === null)
    return (
      <div className="explanation">
        <p className="pending">⏳ This explanation hasn't been generated for this document yet.</p>
      </div>
    );

  return (
    <div className="explanation">
      {tutorial && <p className="hint">💡 {TUTORIAL_HINTS[type]}</p>}

      {type === 'heatmap' && (
        <div>
          <h4>{EXPLANATION_NAMES.heatmap}</h4>
          <p>
            Words in the translation above are shaded by how unexpected a translation model found them, given the
            Korean original.
          </p>
          <p className="legend">
            <span className="tok heat-strong">very unexpected</span>{' '}
            <span className="tok heat-weak">somewhat unexpected</span> · unshaded = expected
          </p>
          <p className="muted small">
            {ex.heatmap!.words.filter((w) => heatLevel(w.score)).length} of {stimulus.targetTokens.length} words
            shaded.
          </p>
        </div>
      )}

      {type === 'rationale' && (
        <div>
          <h4>{EXPLANATION_NAMES.rationale}</h4>
          <p className="rationale">{ex.rationale}</p>
        </div>
      )}

      {type === 'qe' && (
        <div>
          <h4>{EXPLANATION_NAMES.qe}</h4>
          <div className="qe-score">
            <div className="qe-bar">
              <div className="qe-fill" style={{ width: `${ex.qe!.score}%` }} />
            </div>
            <strong>{ex.qe!.score}/100</strong>
          </div>
          <p className="legend">
            Highlights in the translation above: <span className="tok qe-bad">likely error</span>{' '}
            <span className="tok qe-warn">uncertain</span> <span className="tok qe-ok">likely fine</span>
          </p>
          {ex.qe!.spans.some((s) => qeLevel(s.score) !== 'ok') && (
            <ul className="qe-list">
              {ex.qe!.spans
                .filter((s) => qeLevel(s.score) !== 'ok')
                .map((s, i) => (
                  <li key={i}>
                    <span className={`tok qe-${qeLevel(s.score)}`}>
                      “{stimulus.targetTokens.slice(s.tgt[0], s.tgt[1]).join(' ')}”
                    </span>{' '}
                    {s.note && <span className="muted">{s.note}</span>}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {type === 'alignment' && (
        <div>
          <h4>{EXPLANATION_NAMES.alignment}</h4>
          <p>
            Hover or focus on a word above to highlight its matches and open its glossary beside the word.
            Click or tap to pin it. Close the glossary, press Escape, or click outside to dismiss it.
          </p>
          <p className="legend">
            <span className="tok hot">highlighted</span> = matching words ·{' '}
            <span className="tok unaligned">dashed</span> = no source match available
          </p>
        </div>
      )}
    </div>
  );
}
