import { useEffect, useMemo, useState } from 'react';
import type { SessionRecord, TrialResult } from './types';
import { stimuliForCondition } from './data/study';
import { ELIGIBLE_KOREAN, preSurvey, postSurveyFor } from './data/surveys';
import { EXPLANATION_NAMES, downloadJSON, explanationOrder, initSession, isEmail, params, saveLocal, withEmail } from './lib/session';
import { flush, recordEvent, useSyncStatus, type EventKind } from './lib/sync';
import { Trial } from './components/Trial';
import { Survey } from './components/Survey';

type Stage = 'welcome' | 'pre' | 'trials' | 'post' | 'done' | 'ineligible';
const STAGES: Stage[] = ['welcome', 'pre', 'trials', 'post', 'done', 'ineligible'];

export default function App() {
  const [session, setSession] = useState<SessionRecord>(initSession);
  const initial = params.get('stage') as Stage | null;
  const [stage, setStage] = useState<Stage>(initial && STAGES.includes(initial) ? initial : 'welcome');
  const [trialIdx, setTrialIdx] = useState(0);
  const [consent, setConsent] = useState(false);
  const [email, setEmail] = useState('');
  const [starting, setStarting] = useState(false);
  const sync = useSyncStatus();

  const order = useMemo(() => explanationOrder(session.condition), [session.condition]);
  const trials = useMemo(() => stimuliForCondition(session.condition), [session.condition]);

  useEffect(() => saveLocal(session), [session]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [stage, trialIdx]);
  // Each step is uploaded as soon as it's finished, so partial sessions (dropouts) are kept.
  const record = (kind: EventKind, payload: unknown) => recordEvent(session, kind, payload);

  const addTrial = (r: TrialResult) => {
    record('trial', r);
    setSession((s) => ({ ...s, trials: [...s.trials, r] }));
  };

  return (
    <main>
      <header className="app-header">
        <span>Translation Explanation Study</span>
        {params.has('debug') && (
          <span className="muted small">
            pid {session.pid} · condition {session.condition} · mode {session.mode} · docs{' '}
            {trials.map((t) => `${t.id}${t.version === 'flawed' ? '✗' : '✓'}`).join(' ')} · order {order.join(' → ')} · upload{' '}
            {sync.configured ? `${sync.pending} pending${sync.lastError ? ' (error)' : ''}` : 'off'}
          </span>
        )}
      </header>

      {stage === 'welcome' && (
        <div className="card">
          <h1>Welcome</h1>
          <p>
            In this study you will imagine you're traveling in Korea. You'll see short notices from hotels and
            pharmacies written in <strong>Korean</strong>, each with an English translation produced by a machine
            translation system. Some translations may contain errors.
          </p>
          <p>
            For each notice you'll decide whether you would rely on the translation or get it checked, look at
            several different explanations of it, answer a question about your situation, and rank the explanations. The study takes
            about 20 minutes.
          </p>
          <p>
            <strong>Please don't use any external translation tools</strong> (such as Google Translate, Papago or
            ChatGPT) at any point during the study. We want to know how you judge the translations using only what
            the study shows you.
          </p>
          <label className="email-field">
            Your email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
            <span className="muted small">
              Used to link your responses together and, if needed, to contact you about this study.
            </span>
          </label>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I have read the
            information above and agree to take part.
          </label>
          <button
            className="primary"
            disabled={!consent || !isEmail(email) || starting}
            onClick={async () => {
              setStarting(true);
              const consentAt = Date.now();
              // The email decides the pid (and condition), so build the session record before logging the start.
              const started = { ...(await withEmail(session, email)), consent: consentAt };
              recordEvent(started, 'session_start', {
                mode: started.mode,
                email: started.email,
                startedAt: started.startedAt,
                consent: consentAt,
                userAgent: started.userAgent,
                explanationOrder: explanationOrder(started.condition),
                trialOrder: stimuliForCondition(started.condition).map((t) => `${t.id}:${t.version}`),
              });
              setSession(started);
              setStage('pre');
            }}
          >
            Start
          </button>
        </div>
      )}

      {stage === 'pre' && (
        <Survey
          title="About you"
          questions={preSurvey}
          onSubmit={(pre) => {
            record('pre_survey', pre);
            setSession((s) => ({ ...s, pre }));
            // Screening: the study is for people who can't read Korean. The pre-survey answers are kept (above);
            // nothing else is recorded, and analysis.sessions marks the session as screened out.
            setStage(pre.korean_proficiency === ELIGIBLE_KOREAN ? 'trials' : 'ineligible');
          }}
        />
      )}

      {stage === 'trials' && (
        <Trial
          key={trials[trialIdx].id}
          stimulus={trials[trialIdx]}
          order={order}
          hints={trialIdx === 0}
          progress={`Document ${trialIdx + 1} of ${trials.length}`}
          onComplete={(r) => {
            addTrial(r);
            if (trialIdx + 1 < trials.length) setTrialIdx(trialIdx + 1);
            else setStage('post');
          }}
        />
      )}

      {stage === 'post' && (
        <Survey
          title="Final questions"
          intro={`The four explanations you saw were: ${order.map((t) => EXPLANATION_NAMES[t]).join(', ')}.`}
          questions={postSurveyFor(order)}
          submitLabel="Submit"
          onSubmit={(post) => {
            const completedAt = Date.now();
            const durationMs = completedAt - (session.consent ?? session.startedAt);
            const final = { ...session, post, completedAt, durationMs };
            record('post_survey', post);
            record('session_complete', final);
            setSession(final);
            setStage('done');
          }}
        />
      )}

      {stage === 'ineligible' && (
        <div className="card">
          <h1>Thank you</h1>
          <p>
            This study is for people who can't read any Korean, so we won't ask you to continue. Thank you for your
            time and interest.
          </p>
          <p className="muted small">You can close this tab.</p>
        </div>
      )}

      {stage === 'done' && (
        <div className="card">
          <h1>Thank you!</h1>
          <p>Your responses have been recorded. Participant ID: {session.pid}</p>
          {!sync.configured ? (
            <p className="muted small">No server configured. Please download the data file below.</p>
          ) : sync.pending === 0 ? (
            <p className="small sync-ok">✓ All responses saved. You can close this tab.</p>
          ) : (
            <>
              <p className="small">
                Saving your responses… ({sync.pending} remaining). Please keep this tab open.
                {sync.lastError && (
                  <span className="muted"> Retrying automatically; if this persists, download the file below.</span>
                )}
              </p>
              <button onClick={() => void flush()} disabled={sync.sending}>
                {sync.sending ? 'Saving…' : 'Retry now'}
              </button>{' '}
            </>
          )}
          <button onClick={() => downloadJSON(session)}>Download data (JSON)</button>
        </div>
      )}
    </main>
  );
}
