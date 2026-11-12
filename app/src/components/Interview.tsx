import { useState } from 'react';
import type { SurveyAnswers } from '../types';

interface Props {
  phase: 'pre' | 'post';
  pid: string;
  /** Post-interview: the explanations by name, in the order this participant saw them, for reference. */
  explanationNames?: string[];
  onDone: (answers: SurveyAnswers) => void;
  /** Pre-interview only: the researcher found the participant isn't eligible (e.g. they read Korean). */
  onIneligible?: (answers: SurveyAnswers) => void;
}

/**
 * Stands in for the pre- or post-survey when a researcher interviews the participant live (in person or over
 * Zoom); the answers are recorded on the researchers' side. Only when it started and finished is stored here.
 */
export function Interview({ phase, pid, explanationNames, onDone, onIneligible }: Props) {
  const [startedAt] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);
  const record = (extra: SurveyAnswers = {}): SurveyAnswers => {
    const completedAt = Date.now();
    return { format: 'interview', startedAt, completedAt, durationMs: completedAt - startedAt, ...extra };
  };

  return (
    <div className="card interview">
      <h1>{phase === 'pre' ? 'Before we begin' : 'Final interview'}</h1>
      <p>
        {phase === 'pre'
          ? 'The researcher will now ask you a few questions about yourself and how you use translations.'
          : 'The researcher will now ask you some questions about the documents and explanations you saw.'}{' '}
        Please wait here until the interview is finished.
      </p>
      {explanationNames && (
        <>
          <p className="muted small">The four explanations you saw, in order:</p>
          <ol className="interview-names">
            {explanationNames.map((n) => <li key={n}>{n}</li>)}
          </ol>
        </>
      )}
      <p className="muted small">Participant ID: {pid}</p>
      <label className="consent">
        <input type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} /> The interview is
        finished
      </label>
      <button className="primary" disabled={!finished} onClick={() => onDone(record())}>
        {phase === 'pre' ? 'Start the study' : 'Finish'}
      </button>
      {onIneligible && (
        <p className="small interview-ineligible">
          <button type="button" className="link" onClick={() => onIneligible(record({ eligible: 'no' }))}>
            Researcher: end the session, participant isn't eligible
          </button>
        </p>
      )}
    </div>
  );
}
