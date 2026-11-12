import type { ExplanationType, SessionMode, SessionRecord } from '../types';
import { uuid } from './sync';

export const EXPLANATION_TYPES: ExplanationType[] = ['heatmap', 'rationale', 'qe', 'alignment'];

/** Balanced (Williams) Latin square for 4 conditions: each type appears in each position once
 *  and each type follows every other type once. */
const LATIN_SQUARE = [
  [0, 1, 3, 2],
  [1, 2, 0, 3],
  [2, 3, 1, 0],
  [3, 0, 2, 1],
];
export const NUM_CONDITIONS = LATIN_SQUARE.length;

export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Names participants see on the tabs, in the rankings and in the exit survey, so they can refer to each one.
 *  Kept descriptive rather than evaluative ("Quality estimate", not "Error detector"). */
export const EXPLANATION_NAMES: Record<ExplanationType, string> = {
  heatmap: 'Confidence estimation',
  rationale: 'Rationale generation',
  qe: 'Quality estimate',
  alignment: 'Word glossary',
};

export function explanationOrder(condition: number): ExplanationType[] {
  return LATIN_SQUARE[condition % NUM_CONDITIONS].map((i) => EXPLANATION_TYPES[i]);
}

/** Rotate trial order by condition so each document appears in each position across participants. */
export function rotate<T>(items: T[], by: number): T[] {
  const k = ((by % items.length) + items.length) % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export const params = new URLSearchParams(window.location.search);

const MODES: SessionMode[] = ['moderated', 'remote', 'async'];

/** `?mode=moderated|remote|async`. Missing or unknown means a researcher-run session over Zoom (`remote`);
 *  the old `online` (self-serve) means `async`. */
export function parseMode(value: string | null): SessionMode {
  const m = value?.toLowerCase();
  if (m === 'online') return 'async';
  return MODES.includes(m as SessionMode) ? (m as SessionMode) : 'remote';
}

/** Researcher-run sessions replace the pre- and post-surveys with live interviews. */
export const usesInterviews = (mode: SessionMode) => mode !== 'async';

const conditionFor = (pid: string) => {
  const condParam = params.get('cond');
  return condParam !== null ? Number(condParam) % NUM_CONDITIONS : hash(pid) % NUM_CONDITIONS;
};

/** Provisional identity until the participant gives their email on the welcome page (see `withEmail`). */
export function initSession(): SessionRecord {
  const pid = params.get('pid') || `P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return { sessionId: uuid(), pid, condition: conditionFor(pid), mode: parseMode(params.get('mode')), startedAt: Date.now(), userAgent: navigator.userAgent, trials: [] };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** Stable participant ID from an email: the same person always gets the same pid (e.g. "P-3F9A12C4"),
 *  so repeat or restarted sessions line up. Separate runs still have separate session ids. */
export async function pidFromEmail(email: string): Promise<string> {
  // crypto.subtle only exists on https:// or localhost; fall back to a simpler hash elsewhere.
  if (!globalThis.crypto?.subtle) return `P-${hash(normalizeEmail(email)).toString(16).padStart(8, '0').toUpperCase()}`;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeEmail(email))));
  return `P-${[...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Attach the participant's email. A researcher-assigned `?pid=` still wins; otherwise the pid (and, unless
 *  `?cond=` is set, the condition) is derived from the email. */
export async function withEmail(session: SessionRecord, email: string): Promise<SessionRecord> {
  const pid = params.get('pid') || (await pidFromEmail(email));
  return { ...session, email: normalizeEmail(email), pid, condition: conditionFor(pid) };
}

const STORAGE_KEY = 'mt-study-session';

export function saveLocal(session: SessionRecord) {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${session.sessionId}`, JSON.stringify(session));
  } catch {
    /* storage unavailable: data still lives in memory and can be downloaded */
  }
}

export function downloadJSON(session: SessionRecord) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${session.pid}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
