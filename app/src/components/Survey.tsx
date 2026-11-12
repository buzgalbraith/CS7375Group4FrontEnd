import { useState } from 'react';
import type { SurveyAnswers } from '../types';

export type Question =
  | { id: string; type: 'text'; label: string; optional?: boolean; long?: boolean }
  | { id: string; type: 'choice'; label: string; options: string[]; optional?: boolean }
  | { id: string; type: 'multi'; label: string; options: string[]; optional?: boolean }
  | { id: string; type: 'likert'; label: string; low: string; high: string; points?: number; optional?: boolean }
  /** Several items rated on one shared scale, shown as a grid. Each row's answer is stored under the row's id. */
  | {
      id: string;
      type: 'matrix';
      label: string;
      rows: { id: string; label: string }[];
      low: string;
      high: string;
      points?: number;
      optional?: boolean;
    };

interface Props {
  title: string;
  intro?: string;
  questions: Question[];
  submitLabel?: string;
  onSubmit: (a: SurveyAnswers) => void;
}

const OTHER = 'Other';

export function Survey({ title, intro, questions, submitLabel = 'Continue', onSubmit }: Props) {
  const [a, setA] = useState<SurveyAnswers>({});
  const set = (id: string, v: SurveyAnswers[string]) => setA((prev) => ({ ...prev, [id]: v }));
  /** Picking "Other" opens a text box; its text is stored as `<question id>_other`. Unpicking it clears the text. */
  const pickedOther = (v: SurveyAnswers[string]) => (Array.isArray(v) ? v.includes(OTHER) : v === OTHER);
  const setChoice = (id: string, v: SurveyAnswers[string]) =>
    setA((prev) => {
      const next = { ...prev, [id]: v };
      if (!pickedOther(v)) delete next[`${id}_other`];
      return next;
    });
  const otherBox = (q: Question) =>
    (q.type === 'choice' || q.type === 'multi') && pickedOther(a[q.id]) && (
      <input
        type="text"
        className="other-text"
        aria-label="Please describe"
        placeholder="Please describe"
        autoFocus
        value={(a[`${q.id}_other`] as string) ?? ''}
        onChange={(e) => set(`${q.id}_other`, e.target.value)}
      />
    );

  const answered = (q: Question) => {
    if (q.optional) return true;
    if (q.type === 'matrix') return q.rows.every((r) => a[r.id] !== undefined);
    const v = a[q.id];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && String(v).trim() !== '';
  };
  const complete = questions.every(answered);

  return (
    <div className="card survey">
      <h2>{title}</h2>
      {intro && <p>{intro}</p>}
      {questions.map((q) => (
        <fieldset key={q.id}>
          <legend>
            {q.label} {q.optional && <span className="muted">(optional)</span>}
          </legend>
          {q.type === 'text' &&
            (q.long ? (
              <textarea rows={3} value={(a[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />
            ) : (
              <input type="text" value={(a[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />
            ))}
          {q.type === 'choice' && (
            <div className="options">
              {q.options.map((o) => (
                <label key={o}>
                  <input type="radio" name={q.id} checked={a[q.id] === o} onChange={() => setChoice(q.id, o)} /> {o}
                </label>
              ))}
            </div>
          )}
          {q.type === 'multi' && (
            <div className="options">
              {q.options.map((o) => {
                const cur = (a[q.id] as string[]) ?? [];
                return (
                  <label key={o}>
                    <input
                      type="checkbox"
                      checked={cur.includes(o)}
                      onChange={(e) => setChoice(q.id, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))}
                    />{' '}
                    {o}
                  </label>
                );
              })}
            </div>
          )}
          {otherBox(q)}
          {q.type === 'matrix' && <Matrix q={q} answers={a} set={set} />}
          {q.type === 'likert' && (
            <div className="likert">
              {Array.from({ length: q.points ?? 7 }, (_, i) => i + 1).map((n, i, arr) => (
                <label key={n} className={a[q.id] === n ? 'selected' : ''}>
                  <input type="radio" name={q.id} checked={a[q.id] === n} onChange={() => set(q.id, n)} />
                  {n}
                  {i === 0 ? ` ${q.low}` : i === arr.length - 1 ? ` ${q.high}` : ''}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      <button className="primary" disabled={!complete} onClick={() => onSubmit(a)}>
        {submitLabel}
      </button>
    </div>
  );
}

function Matrix({
  q,
  answers,
  set,
}: {
  q: Extract<Question, { type: 'matrix' }>;
  answers: SurveyAnswers;
  set: (id: string, v: number) => void;
}) {
  const points = Array.from({ length: q.points ?? 7 }, (_, i) => i + 1);
  return (
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {points.map((n, i) => (
              <th key={n} scope="col">
                {n}
                {i === 0 && <span className="matrix-anchor">{q.low}</span>}
                {i === points.length - 1 && <span className="matrix-anchor">{q.high}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.rows.map((r) => (
            <tr key={r.id} className={answers[r.id] === undefined ? '' : 'done'}>
              <th scope="row">{r.label}</th>
              {points.map((n) => (
                <td key={n}>
                  <input
                    type="radio"
                    name={r.id}
                    aria-label={`${r.label}: ${n}`}
                    checked={answers[r.id] === n}
                    onChange={() => set(r.id, n)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
