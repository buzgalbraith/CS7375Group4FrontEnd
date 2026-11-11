import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ComprehensionRecord,
  DecisionRecord,
  ExplanationType,
  OriginalViewRecord,
  RankingRecord,
  Stimulus,
  TrialResult,
  TrialStep,
} from '../types';
import { ComprehensionQuestion } from './ComprehensionQuestion';
import { OriginalViewer } from './OriginalViewer';
import { EXPLANATION_NAMES, LABELS, shuffle } from '../lib/session';
import { DocumentPane } from './DocumentPane';
import { ExplanationPanel } from './ExplanationPanel';
import { DecisionForm } from './DecisionForm';
import { RankList } from './RankList';

export const RANK_DIMENSIONS = [
  {
    id: 'understandability',
    question: 'Rank the explanations by how easy they were to understand.',
    why: 'What made your top choice easier to understand than your bottom choice?',
  },
  {
    id: 'decision_support',
    question: 'Rank the explanations by how much they helped you decide whether to trust the translation.',
    why: 'What did your top choice tell you that helped you decide? What was missing from your bottom choice?',
  },
] as const;

const MIN_JUSTIFICATION = 15;

interface Props {
  stimulus: Stimulus;
  order: ExplanationType[];
  /** Show "how to read this" hints (the session's first notice). */
  hints?: boolean;
  progress: string;
  onComplete: (r: TrialResult) => void;
}

type Step = TrialStep;

const STEP_LABELS: Record<Step, string> = {
  baseline: 'First impression',
  reveal: 'Explanations',
  question: 'Question',
  rank: 'Rank',
};

export function Trial({ stimulus, order, hints, progress, onComplete }: Props) {
  const labels = order.map((_, i) => LABELS[i]);
  const [step, setStep] = useState<Step>('baseline');
  const [baseline, setBaseline] = useState<DecisionRecord | null>(null);
  const [revised, setRevised] = useState<DecisionRecord | null>(null);
  const [comprehension, setComprehension] = useState<ComprehensionRecord | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [viewed, setViewed] = useState<Set<number>>(new Set());
  // Each ranking list starts in an independent random order so the A–D display order doesn't anchor rankings.
  const [initialRankings] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(RANK_DIMENSIONS.map((d) => [d.id, shuffle(labels)])),
  );
  const [rankings, setRankings] = useState<Record<string, string[]>>(initialRankings);
  const [justifications, setJustifications] = useState<Record<string, string>>({});
  const [hovers, setHovers] = useState(0);
  const transcriptionOpens = useRef<TrialStep[]>([]);

  const [startedAt] = useState(() => Date.now());
  const tabMs = useRef<Record<string, number>>(Object.fromEntries(order.map((t) => [t, 0])));
  const tabOpenedAt = useRef<number | null>(null);

  const closeTabTimer = () => {
    if (active !== null && tabOpenedAt.current !== null) {
      tabMs.current[order[active]] += Date.now() - tabOpenedAt.current;
    }
    tabOpenedAt.current = null;
  };

  const openTab = (i: number) => {
    closeTabTimer();
    setActive(i);
    setViewed((v) => new Set(v).add(i));
    tabOpenedAt.current = Date.now();
  };

  const [viewerOpen, setViewerOpen] = useState(false);
  const views = useRef<OriginalViewRecord[]>([]);
  const viewerSession = useRef<{ openedAt: number; maxZoom: number } | null>(null);
  const openViewer = () => {
    viewerSession.current = { openedAt: Date.now(), maxZoom: 1 };
    setViewerOpen(true);
  };
  const closeViewer = useCallback(() => {
    const v = viewerSession.current;
    if (v) views.current.push({ step, ms: Date.now() - v.openedAt, maxZoom: v.maxZoom });
    viewerSession.current = null;
    setViewerOpen(false);
  }, [step]);
  const onViewerZoom = useCallback((z: number) => {
    if (viewerSession.current) viewerSession.current.maxZoom = Math.max(viewerSession.current.maxZoom, z);
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const allViewed = viewed.size === order.length;
  const rankDone = RANK_DIMENSIONS.every((d) => (justifications[d.id] ?? '').trim().length >= MIN_JUSTIFICATION);

  const finish = () => {
    closeTabTimer();
    const rankRecords: Record<string, RankingRecord> = {};
    for (const d of RANK_DIMENSIONS) {
      const ord = rankings[d.id];
      rankRecords[d.id] = {
        order: ord,
        types: ord.map((l) => order[labels.indexOf(l)]),
        initialOrder: initialRankings[d.id],
        changed: ord.some((l, i) => l !== initialRankings[d.id][i]),
        justification: justifications[d.id].trim(),
      };
    }
    onComplete({
      stimulusId: stimulus.id,
      version: stimulus.version,
      stakes: stimulus.stakes,
      isFlawed: stimulus.isFlawed,
      tutorial: false,
      hints: !!hints,
      explanationOrder: order,
      baseline: baseline!,
      revised: revised!,
      comprehension: comprehension!,
      rankings: rankRecords,
      tabViewMs: { ...tabMs.current } as TrialResult['tabViewMs'],
      alignmentHovers: hovers,
      originalViews: [...views.current],
      transcriptionOpens: [...transcriptionOpens.current],
      startedAt,
      completedAt: Date.now(),
    });
  };

  const overlay = step !== 'baseline' && active !== null ? order[active] : null;

  return (
    <div className="trial">
      <div className="trial-header">
        <span className="muted">{progress}</span>
        <h2>{stimulus.title}</h2>
        <ol className="steps">
          {(Object.keys(STEP_LABELS) as Step[]).map((s, i) => (
            <li key={s} className={s === step ? 'current' : ''}>
              {i + 1}. {STEP_LABELS[s]}
            </li>
          ))}
        </ol>
      </div>

      <div className="scenario">
        <strong>Your situation</strong>
        <p>{stimulus.scenario}</p>
        <p className="muted small">You can't read Korean, so you're relying on the machine translation.</p>
      </div>

      {hints && step === 'baseline' && (
        <p className="hint">
          💡 Read your situation above, then decide using only the notice and its translation. Use
          “Enlarge” to see the notice up close (zoom with the +/− buttons or Ctrl + scroll), and “Show transcription”
          to see the Korean as text.
        </p>
      )}
      {hints && step === 'question' && (
        <p className="hint">💡 Answer based on everything you've seen: the translation and the explanations.</p>
      )}

      <DocumentPane
        stimulus={stimulus}
        overlay={overlay}
        onAlignmentHover={() => setHovers((h) => h + 1)}
        onViewOriginal={openViewer}
        onShowTranscription={() => transcriptionOpens.current.push(step)}
      />

      {viewerOpen && stimulus.original && (
        <OriginalViewer doc={stimulus.original} title={stimulus.title} onClose={closeViewer} onZoom={onViewerZoom} />
      )}

      {step !== 'baseline' && (
        <div className="card">
          <div className="tabs" role="tablist">
            {labels.map((l, i) => (
              <button
                key={l}
                role="tab"
                aria-selected={active === i}
                className={`tab ${active === i ? 'active' : ''} ${viewed.has(i) ? 'seen' : ''}`}
                onClick={() => openTab(i)}
              >
                {EXPLANATION_NAMES[order[i]]} {viewed.has(i) && <span className="check">✓</span>}
              </button>
            ))}
          </div>
          {active === null ? (
            <p className="muted">Open each explanation using the tabs above.</p>
          ) : (
            <ExplanationPanel type={order[active]} stimulus={stimulus} tutorial={hints} />
          )}
        </div>
      )}

      {step === 'baseline' && (
        <DecisionForm
          key="baseline"
          prompt="Based only on the translation, would you rely on it, or get it checked?"
          checkCost={stimulus.checkCost}
          onSubmit={(r) => {
            setBaseline(r);
            setStep('reveal');
          }}
        />
      )}

      {step === 'reveal' && (
        <DecisionForm
          key="revised"
          prompt="Now that you have seen the explanations, would you rely on this translation, or get it checked?"
          checkCost={stimulus.checkCost}
          disabled={!allViewed}
          disabledReason={`Please open every explanation first (${viewed.size}/${order.length} viewed).`}
          onSubmit={(r) => {
            setRevised(r);
            setStep('question');
          }}
        />
      )}

      {step === 'question' && (
        <ComprehensionQuestion
          question={stimulus.keyQuestion}
          onSubmit={(r) => {
            setComprehension(r);
            setStep('rank');
          }}
        />
      )}

      {step === 'rank' && (
        <div className="card">
          <p className="muted small">
            Drag the items, or use the arrows, to order them from best (top) to worst (bottom). You can reopen the
            explanations above.
          </p>
          <div className="rank-grid">
            {RANK_DIMENSIONS.map((d, k) => {
              const len = (justifications[d.id] ?? '').trim().length;
              const ok = len >= MIN_JUSTIFICATION;
              return (
                <div key={d.id} className="rank-dim">
                  <p className="q">
                    {k + 1}. {d.question}
                  </p>
                  <RankList
                    items={rankings[d.id]}
                    names={Object.fromEntries(labels.map((l, i) => [l, EXPLANATION_NAMES[order[i]]]))}
                    onChange={(items) => setRankings((r) => ({ ...r, [d.id]: items }))} />
                  <label className="small">
                    {d.why}
                    <textarea
                      rows={3}
                      value={justifications[d.id] ?? ''}
                      onChange={(e) => setJustifications((j) => ({ ...j, [d.id]: e.target.value }))}
                    />
                  </label>
                  <p className={`small char-count ${ok ? 'ok' : ''}`}>
                    {ok ? '✓ Thanks' : `${len}/${MIN_JUSTIFICATION} characters minimum`}
                  </p>
                </div>
              );
            })}
          </div>
          {!rankDone && (
            <p className="muted small">
              To continue, write at least {MIN_JUSTIFICATION} characters explaining ranking{' '}
              {RANK_DIMENSIONS.map((d, k) => ((justifications[d.id] ?? '').trim().length < MIN_JUSTIFICATION ? k + 1 : null))
                .filter((n) => n !== null)
                .join(' and ')}
              .
            </p>
          )}
          <button className="primary" disabled={!rankDone} onClick={finish}>
            Next document
          </button>
        </div>
      )}
    </div>
  );
}
