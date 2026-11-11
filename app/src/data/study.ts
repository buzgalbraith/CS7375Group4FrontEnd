/**
 * Loads the study data from translation-experiment-data/ and decides, per condition, which notices a
 * participant sees, in what order, and in which translation version (correct / flawed).
 */
import type { Stimulus, TranslationVersion } from '../types';
import noticesFile from '../../translation-experiment-data/notices.json';
import { buildStimulus, type RawExplanationsFile, type RawImageBoxesFile, type RawNoticesFile } from './buildStimuli';
import { MAIN_SET, assignVersions } from './studyConfig';
import { rotate } from '../lib/session';

const notices = (noticesFile as RawNoticesFile).documents;
// explanations.json is optional: while it's missing, every explanation shows as "not generated yet".
const explanationsFile = Object.values(
  import.meta.glob('../../translation-experiment-data/explanations.json', { eager: true, import: 'default' }),
)[0] as RawExplanationsFile | undefined;
const explanations = explanationsFile?.explanations ?? {};
// image-boxes.json is optional too: without it, Word glossary works on the Korean text instead of the image.
const imageBoxesFile = Object.values(
  import.meta.glob('../../translation-experiment-data/image-boxes.json', { eager: true, import: 'default' }),
)[0] as RawImageBoxesFile | undefined;

// Images are bundled by Vite; map "images/p2_med.png" → served URL.
const imageUrls = import.meta.glob('../../translation-experiment-data/images/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const imageUrl = (path?: string) =>
  path ? imageUrls[`../../translation-experiment-data/${path.replace(/^\.?\//, '')}`] : undefined;

const byId = new Map(notices.map((n) => [n.id, n]));

function make(id: string, version: TranslationVersion): Stimulus {
  const notice = byId.get(id);
  if (!notice) throw new Error(`studyConfig: unknown notice id "${id}"`);
  const { stimulus, problems } = buildStimulus(
    notice,
    version,
    explanations[id]?.[version],
    imageUrl(notice.image),
    imageBoxesFile?.notices[id],
  );
  // Bad phrases are skipped rather than crashing the study; `npm run check-data` reports them as errors.
  problems.forEach((p) => console.error(`[data] ${p}`));
  return stimulus;
}

/** The main documents for a condition: order rotated, versions assigned. */
export function stimuliForCondition(condition: number): Stimulus[] {
  const versions = assignVersions(MAIN_SET.map((id) => ({ id, stakes: byId.get(id)!.stakes })), condition);
  return rotate(MAIN_SET, condition).map((id) => make(id, versions[id]));
}
