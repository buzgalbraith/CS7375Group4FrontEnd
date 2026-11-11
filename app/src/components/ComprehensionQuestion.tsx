import { useState } from 'react';
import type { ComprehensionRecord, KeyQuestion } from '../types';

const UNSURE = "I'm not sure";

type Option = KeyQuestion['choices'][number];

function toRecord(question: KeyQuestion, options: Option[], choice: string): ComprehensionRecord {
  const picked = options.find((o) => o.label === choice);
  const answerKey = picked ? picked.key : 'unsure';
  return {
    question: question.question,
    choice,
    answerKey,
    isRight: answerKey === 'correct',
    optionOrder: options.map((o) => o.label),
    at: Date.now(),
  };
}

/**
 * The scenario's key question. `options` come pre-shuffled from the trial so the order is the same both times
 * it's asked; "I'm not sure" is always last.
 * - With `onSubmit`: a standalone card with its own Continue button.
 * - With `onChange` instead: embedded in another form (no card, no button); reports the answer as it changes.
 */
export function ComprehensionQuestion({
  question,
  options,
  name,
  onSubmit,
  onChange,
}: {
  question: KeyQuestion;
  options: Option[];
  name: string;
  onSubmit?: (r: ComprehensionRecord) => void;
  onChange?: (r: ComprehensionRecord) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);

  const body = (
    <>
      <p className="q">{question.question}</p>
      <div className="options mc-options">
        {[...options.map((o) => o.label), UNSURE].map((label) => (
          <label key={label} className={`mc-option ${choice === label ? 'selected' : ''}`}>
            <input
              type="radio"
              name={name}
              checked={choice === label}
              onChange={() => {
                setChoice(label);
                onChange?.(toRecord(question, options, label));
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </>
  );

  if (!onSubmit) return <div className="embedded-question">{body}</div>;
  return (
    <div className="card decision">
      {body}
      <button className="primary" disabled={!choice} onClick={() => onSubmit(toRecord(question, options, choice!))}>
        Continue
      </button>
    </div>
  );
}
