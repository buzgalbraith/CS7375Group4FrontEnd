/**
 * Validates translation-experiment-data/ (notices.json, explanations.json, images/).
 * Run: npm run check-data        Exit code 1 on errors; prints a coverage table either way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStimulus,
  type RawExplanationsFile,
  type RawNoticesFile,
} from '../src/data/buildStimuli.ts';
import { MAIN_SET, assignVersions } from '../src/data/studyConfig.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'translation-experiment-data');
const errors: string[] = [];
const warnings: string[] = [];

const notices: RawNoticesFile = JSON.parse(readFileSync(join(dir, 'notices.json'), 'utf8'));
const explanations: RawExplanationsFile = existsSync(join(dir, 'explanations.json'))
  ? JSON.parse(readFileSync(join(dir, 'explanations.json'), 'utf8'))
  : { explanations: {} };

const ids = new Set<string>();
for (const n of notices.documents) {
  const at = `notices.json ${n.id}`;
  if (ids.has(n.id)) errors.push(`${at}: duplicate id`);
  ids.add(n.id);
  for (const f of ['korean', 'scenario', 'title_en'] as const) if (!n[f]?.trim()) errors.push(`${at}: missing ${f}`);
  if (!n.english?.correct || !n.english?.flawed) errors.push(`${at}: needs english.correct and english.flawed`);
  else if (n.english.correct === n.english.flawed) errors.push(`${at}: correct and flawed translations are identical`);
  if (!['high', 'low'].includes(n.stakes)) errors.push(`${at}: stakes must be "high" or "low"`);
  if (n.error) {
    if (!n.korean.includes(n.error.korean_span)) errors.push(`${at}: error.korean_span not found in korean`);
    if (!n.english.correct.includes(n.error.correct_span)) errors.push(`${at}: error.correct_span not in english.correct`);
    if (!n.english.flawed.includes(n.error.flawed_span)) errors.push(`${at}: error.flawed_span not in english.flawed`);
  }
  if (n.image && !existsSync(join(dir, n.image))) errors.push(`${at}: image not found: ${n.image}`);
  if (!n.image) warnings.push(`${at}: no image ("View full document" will be hidden)`);
  for (const v of ['correct', 'flawed'] as const) {
    const { problems } = buildStimulus(n, v, explanations.explanations[n.id]?.[v]);
    errors.push(...problems.map((p) => (p.includes('key_question') ? `notices.json ${p}` : `explanations.json ${p}`)));
  }
}

for (const [id, byVersion] of Object.entries(explanations.explanations)) {
  if (!ids.has(id)) errors.push(`explanations.json: unknown notice id "${id}"`);
  for (const v of Object.keys(byVersion)) if (v !== 'correct' && v !== 'flawed') errors.push(`explanations.json ${id}: unknown version "${v}"`);
}

for (const id of MAIN_SET) if (!ids.has(id)) errors.push(`studyConfig.ts: "${id}" is not in notices.json`);

// Coverage table: which explanations exist for the documents participants will see.
const cell = (id: string, v: 'correct' | 'flawed') => {
  const e = explanations.explanations[id]?.[v];
  if (!e) return '— pending —';
  const have = (['heatmap', 'rationale', 'qe', 'alignment'] as const).map((k) => (e[k] ? k[0].toUpperCase() : '·')).join('');
  return `${have}${e._mock ? ' (mock)' : ''}`;
};
console.log('Explanation coverage  (H=heatmap R=rationale Q=quality A=alignment)\n');
console.log('notice      correct          flawed');
for (const id of MAIN_SET) console.log(`${id.padEnd(11)} ${cell(id, 'correct').padEnd(16)} ${cell(id, 'flawed')}`);

// What each condition shows (order rotates by condition; ✗ = flawed translation).
console.log('\nConditions (document order; ✗ flawed, ✓ correct)');
const stakesOf = new Map(notices.documents.map((n) => [n.id, n.stakes]));
if (MAIN_SET.every((id) => stakesOf.has(id))) {
  for (let cond = 0; cond < 4; cond++) {
    const v = assignVersions(MAIN_SET.map((id) => ({ id, stakes: stakesOf.get(id)! })), cond);
    const k = cond % MAIN_SET.length;
    const order = [...MAIN_SET.slice(k), ...MAIN_SET.slice(0, k)];
    console.log(`  cond ${cond}:  ${order.map((id) => `${id}${v[id] === 'flawed' ? '✗' : '✓'}`).join('  ')}`);
  }
}

if (warnings.length) console.log(`\n${warnings.length} warning(s):\n  ${warnings.join('\n  ')}`);
const uniq = [...new Set(errors)];
if (uniq.length) {
  console.error(`\n✗ ${uniq.length} error(s):\n  ${uniq.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n✓ Data OK: ${notices.documents.length} notices`);
