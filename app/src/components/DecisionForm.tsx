import { useState, type ReactNode } from 'react';
import type { DecisionRecord } from '../types';

interface Props {
  prompt: string;
  disabled?: boolean;
  disabledReason?: string;
  onSubmit: (r: DecisionRecord) => void;
  /** Extra questions shown above the scale, submitted with the same Continue button. */
  children?: ReactNode;
  /** False while those extra questions are unanswered. */
  ready?: boolean;
}

/** Even number of points, so there is no neutral middle: 1–3 = get it checked, 4–6 = rely on the translation. */
export const DECISION_POINTS = 6;

/** One scale combines the decision and its confidence. */
export function toDecision(scale: number): DecisionRecord {
  const half = DECISION_POINTS / 2;
  const rely = scale > half;
  return {
    decision: rely ? 'accept' : 'reject',
    // How far toward that end: 1 = next to the middle, 3 = the end of the scale.
    confidence: rely ? scale - half : half + 1 - scale,
    scale,
    at: Date.now(),
  };
}

export function DecisionForm({ prompt, disabled, disabledReason, onSubmit, children, ready = true }: Props) {
  const [scale, setScale] = useState<number | null>(null);
  const points = Array.from({ length: DECISION_POINTS }, (_, i) => i + 1);

  return (
    <div className="card decision">
      {children}
      <p className="q">{prompt}</p>
      <div className="decision-scale" role="radiogroup" aria-label={prompt}>
        {points.map((n) => (
          <label key={n} className={`decision-point ${scale === n ? 'selected' : ''} ${n > DECISION_POINTS / 2 ? 'rely' : 'check'}`}>
            <input
              type="radio"
              name="decision-scale"
              checked={scale === n}
              onChange={() => setScale(n)}
              disabled={disabled}
              aria-label={`${n} of ${DECISION_POINTS}${n === 1 ? ', get it checked' : n === DECISION_POINTS ? ', rely on the translation' : ''}`}
            />
          </label>
        ))}
      </div>
      <div className="decision-anchors">
        <div>
          <strong>Get it checked</strong>
        </div>
        <div className="right">
          <strong>Rely on the translation</strong>
        </div>
      </div>
      {disabled && disabledReason && <p className="muted small">{disabledReason}</p>}
      <button
        className="primary"
        disabled={disabled || scale === null || !ready}
        onClick={() => onSubmit(toDecision(scale!))}
      >
        Continue
      </button>
    </div>
  );
}
