export type ExplanationType = 'heatmap' | 'rationale' | 'qe' | 'alignment';

/** Half-open token range [start, end). */
export type TokenRange = [number, number];

export interface QESpan {
  tgt: TokenRange;
  /** 0 = very likely an error, 1 = very likely fine. */
  score: number;
  note?: string;
}

/** One English word in the Confidence estimation heatmap. */
export interface HeatWord {
  tgt: TokenRange;
  /** 0–1: how expected the word is given the Korean (lower = less expected). */
  score: number;
}

export interface AlignLink {
  src: TokenRange;
  tgt: TokenRange;
}

/** The original document as participants would encounter it.
 *  `src` is a URL: an imported asset URL, a path under public/, or an absolute URL. */
export interface OriginalDocument {
  kind: 'pdf' | 'html' | 'image';
  src: string;
}

/** Each notice has a correct and a deliberately flawed English translation. */
export type TranslationVersion = 'correct' | 'flawed';

/** `null` = not produced yet (shown as "pending"). */
export interface StimulusExplanations {
  heatmap: { words: HeatWord[] } | null;
  rationale: string | null;
  qe: { score: number; spans: QESpan[] } | null;
  alignment: AlignLink[] | null;
}

export interface KeyQuestion {
  question: string;
  /** Yes / No, derived from key_question.answer; `key` says which reading each reflects (never shown). */
  choices: { label: string; key: TranslationVersion }[];
}

/** One notice in one translation version, ready to render. */
export interface Stimulus {
  /** Notice id from notices.json (e.g. "p2_med"). */
  id: string;
  version: TranslationVersion;
  stakes: 'low' | 'high';
  setting: string;
  sourceLang: string;
  title: string;
  /** The situation the participant imagines being in. */
  scenario: string;
  /** What getting the translation checked would cost in this situation (in notices.json; not currently shown). */
  checkCost?: string;
  sourceTokens: string[];
  /** Token indices that start a new paragraph. */
  sourceBreaks: number[];
  targetTokens: string[];
  targetBreaks: number[];
  /** Optional full original for context; the tokens above remain the source of truth for the text. */
  original?: OriginalDocument;
  /** Ground truth for analysis only; never shown to participants. */
  isFlawed: boolean;
  flawNote?: string;
  keyQuestion: KeyQuestion;
  explanations: StimulusExplanations;
  /** True if the explanations are placeholder mock content. */
  explanationsMock: boolean;
}

/** Shown to participants as "Rely on this translation" (accept) vs. "Get it checked" (reject). */
export type Decision = 'accept' | 'reject';

export interface DecisionRecord {
  decision: Decision;
  /** How far toward that end of the scale: 1 (next to the middle) to 3 (the end). */
  confidence: number;
  /** The raw answer on the 6-point scale: 1–3 = get it checked, 4–6 = rely on the translation. */
  scale: number;
  at: number;
}

export interface RankingRecord {
  /** Labels (A, B, ...) best → worst. */
  order: string[];
  /** Same order, as explanation types. */
  types: ExplanationType[];
  /** Randomized order the list started in (labels). */
  initialOrder: string[];
  /** False if the participant submitted the starting order unchanged. */
  changed: boolean;
  justification: string;
}

export type TrialStep = 'baseline' | 'reveal' | 'question' | 'rank';

export interface OriginalViewRecord {
  step: TrialStep;
  ms: number;
  maxZoom: number;
}

export interface ComprehensionRecord {
  question: string;
  /** Label chosen, or "unsure". */
  choice: string;
  /** Which reading the chosen option reflects: the true meaning, the flawed translation's, or unsure. */
  answerKey: TranslationVersion | 'unsure';
  /** answerKey === 'correct'. */
  isRight: boolean;
  /** Labels in the (shuffled) order shown. */
  optionOrder: string[];
  at: number;
}

export interface TrialResult {
  stimulusId: string;
  version: TranslationVersion;
  stakes: 'low' | 'high';
  isFlawed: boolean;
  /** Always false now (there is no separate practice round); kept so the analysis views still work. */
  tutorial: boolean;
  /** True on the session's first notice, which shows "how to read this" hints. */
  hints: boolean;
  explanationOrder: ExplanationType[];
  baseline: DecisionRecord;
  revised: DecisionRecord;
  /** The key question asked on the first-impression step, before any explanations. */
  baselineComprehension: ComprehensionRecord;
  /** The same question after the explanations. */
  comprehension: ComprehensionRecord;
  rankings: Record<string, RankingRecord>;
  tabViewMs: Record<ExplanationType, number>;
  alignmentHovers: number;
  /** Each time the participant opened the original-document viewer. */
  originalViews: OriginalViewRecord[];
  /** Step at which the participant clicked "Show transcription" each time (not counting the automatic
   *  reveal when the word-matching explanation is opened). */
  transcriptionOpens: TrialStep[];
  startedAt: number;
  completedAt: number;
}

export type SurveyAnswers = Record<string, string | number | string[]>;

/** How the session was run: researcher present in person, over video call, or self-serve link. */
export type SessionMode = 'moderated' | 'remote' | 'online';

export interface SessionRecord {
  sessionId: string;
  pid: string;
  /** Given on the welcome page; the pid is derived from it unless the link sets ?pid=. */
  email?: string;
  condition: number;
  mode: SessionMode;
  startedAt: number;
  userAgent: string;
  consent?: number;
  pre?: SurveyAnswers;
  trials: TrialResult[];
  post?: SurveyAnswers;
  completedAt?: number;
}
