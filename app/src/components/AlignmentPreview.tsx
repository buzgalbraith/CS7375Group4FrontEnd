import { useState } from 'react';
import { PENDING, phraseToRange, tokenize } from '../data/buildStimuli';
import type { ExplanationType, Stimulus } from '../types';
import { DocumentPane } from './DocumentPane';
import { ExplanationPanel } from './ExplanationPanel';

// Deliberately separate from study.ts: these handwritten UI examples never enter participant sessions.
const korean = '와이파이는 무료입니다. 비밀번호는 프런트에 있습니다.\n\n수건은 프런트에서 받으세요.';
const english = 'Wi-Fi is free. The password is at the front desk.\n\nPlease collect towels at the front desk. Thank you!';
const source = tokenize(korean);
const target = tokenize(english);
const alignment = [
  { ko: '와이파이는', en: 'Wi-Fi' },
  { ko: '무료입니다.', en: 'is free.' },
  { ko: '비밀번호는', en: 'The password' },
  { ko: '프런트에 있습니다.', en: 'is at the front desk.' },
  { ko: '수건은', en: 'towels' },
  { ko: '프런트에서', en: 'at the front desk.', occurrence: 2 },
  { ko: '받으세요.', en: 'Please' },
  { ko: '받으세요.', en: 'collect' },
].map(({ ko, en, occurrence }) => ({
  src: phraseToRange(source, korean, ko),
  tgt: phraseToRange(target, english, en, occurrence),
}));

const example: Stimulus = {
  id: 'interface-demo',
  version: 'correct',
  stakes: 'low',
  setting: 'hotel',
  sourceLang: 'Korean',
  title: 'Guesthouse information · Sample notice',
  scenario: '',
  sourceTokens: source.tokens,
  sourceBreaks: source.breaks,
  targetTokens: target.tokens,
  targetBreaks: target.breaks,
  isFlawed: false,
  keyQuestion: { question: '', choices: [] },
  explanations: { ...PENDING, alignment },
  explanationsMock: true,
};

export default function AlignmentPreview() {
  const [overlay, setOverlay] = useState<ExplanationType | null>('alignment');
  const [coverage, setCoverage] = useState('sample');
  const [hovers, setHovers] = useState(0);
  // Stable inputs let the preview exercise the same interaction lifecycle as a trial.
  const stimulus = coverage === 'sample' ? example : coverage === 'empty' ? empty : pending;

  return (
    <main>
      <header className="alignment-preview-header">
        <p className="small muted">Translation Explanation Study · Interface preview</p>
        <h1>Trace a translation to its source</h1>
        <p className="hint">Demo only: handwritten sample text and mappings, not generated study explanations. No participant responses are recorded here.</p>
        <div className="alignment-preview-controls">
          <label>View
            <select value={overlay ?? 'baseline'} onChange={(e) => setOverlay(e.target.value === 'baseline' ? null : e.target.value as ExplanationType)}>
              <option value="alignment">Word glossary</option>
              <option value="baseline">First impression</option>
              <option value="rationale">Rationale generation</option>
            </select>
          </label>
          <label>Mappings
            <select value={coverage} onChange={(e) => setCoverage(e.target.value)}>
              <option value="sample">Sample matches</option>
              <option value="empty">No matches found</option>
              <option value="pending">Not generated yet</option>
            </select>
          </label>
        </div>
        <p className="small muted">Try “free.”, either “front desk.”, or the unmatched “Thank you!”. Matched phrase hovers: {hovers}</p>
      </header>
      <DocumentPane stimulus={stimulus} overlay={overlay} onAlignmentHover={() => setHovers((n) => n + 1)} />
      {overlay && <div className="card"><ExplanationPanel type={overlay} stimulus={stimulus} /></div>}
    </main>
  );
}

const empty: Stimulus = { ...example, explanations: { ...PENDING, alignment: [] } };
const pending: Stimulus = { ...example, explanations: { ...PENDING } };
