# Translation Explanation Study — Front End

Developer notes. For the study design see the [root README](../README.md); for the data format see
[`translation-experiment-data/README.md`](translation-experiment-data/README.md).

## Run
```bash
npm install
npm run dev          # http://localhost:5173
npm run check-data   # validate translation-experiment-data/ (run after every data edit)
npm run build        # type-check + production build
```

URL parameters:
- `?pid=P01`: participant ID (random if omitted)
- `?cond=0..3`: counterbalancing condition (Latin-square explanation order + trial rotation; hashed from pid if omitted)
- `?mode=moderated|remote|online`: how the session is run (in person / video call / self-serve). Saved with the
  session and shown as a `mode` column in the analysis views. Defaults to `online`.
- `?stage=welcome|pre|tutorial|trials|post|done`: jump to a stage (for design review)
- `?debug=1`: show pid, condition, and explanation order in the header

## Flow
Consent → pre-survey → 4 notices (the first with hints) → post-survey → done (upload + JSON download).
Each notice: **baseline decision** (rely on it or get it checked; translation only) → **reveal** explanations as tabs named by method (all must be opened)
→ **revised decision** → **comprehension question** (yes / no / not sure) → **rank** on two dimensions with required
justifications. The scenario is shown throughout.

## Where things live
- `translation-experiment-data/`: **all study content** (notices.json, explanations.json, images/)
- `src/data/studyConfig.ts`: main set, version counterbalancing (pure; used by check-data too)
- `src/data/buildStimuli.ts`: JSON → `Stimulus` (tokenizing, resolving phrases to token ranges)
- `src/data/study.ts`: Vite loader (imports the JSON and images) and per-condition stimulus list
- `src/data/surveys.ts`: draft survey items
- `src/types.ts`: data formats (`Stimulus`, `TrialResult`, `SessionRecord`)
- `src/components/`: `Trial` (step flow), `DocumentPane` (texts + QE / alignment overlays), `ExplanationPanel`,
  `ComprehensionQuestion`, `RankList`, `DecisionForm`, `Survey`, `OriginalViewer`
- `src/lib/session.ts`: conditions, IDs, local save, JSON download · `src/lib/sync.ts`: Supabase upload queue
- `scripts/check-data.ts`: data validator

## Saving data (Supabase)
Every step is uploaded as soon as it's finished (`session_start`, `pre_survey`, each `trial`,
`post_survey`, `session_complete`), so partial sessions from dropouts are kept. Unsent events wait in a
localStorage queue and retry with backoff, also after a reload or when the connection comes back. The final
screen shows "All responses saved" or offers **Retry now**, and **Download data (JSON)** is always available
as a fallback. Without configuration, uploading is off and only the download works.

Setup (once):
1. Create a Supabase project. In **SQL Editor**, run `supabase/schema.sql`. It's safe to re-run.
2. Copy `.env.example` to `.env.local` and fill in the **Project URL** and the **publishable** key
   (`sb_publishable_…`, Project Settings → API Keys). Supabase's snippets call it
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; for Vite the name must be `VITE_SUPABASE_PUBLISHABLE_KEY`.
   Never use the secret (`sb_secret_…`) or `service_role` key in the front end.
3. Set the same two variables on your host (Vercel/Netlify), because Vite bakes them in at build time.
4. Restart `npm run dev`. With `?debug=1` the header shows the upload queue.

Security model: the anon key is public, so the table is **insert-only** for it (row-level security plus
grants). Participants can't read, edit or delete any rows. Researchers read data in the dashboard or via the
analysis views, which are in a private `analysis` schema that the REST API doesn't expose:
```sql
select * from analysis.sessions;  -- one row per session: progress, completed?
select * from analysis.trials;    -- one row per trial: decisions, correctness, rankings, justifications
```

## Original documents ("View original")
Each notice's `image` in notices.json is bundled by Vite and opened in a modal viewer that scrolls and zooms
(+/− buttons, Ctrl/Cmd +/−, or Ctrl + scroll / pinch). At 100% the whole image fits the viewer. The viewer also
supports PDFs (drawn with pdf.js) and saved HTML pages (same-origin iframe) via `original.kind`, though the
current data only uses images. The viewer is display-only: the Korean text comes from notices.json, so no OCR is
needed. Each open is logged per trial as `originalViews: [{ step, ms, maxZoom }]`.

## Word-matching interface preview

Run `npm run dev` and open `http://localhost:5173/?preview=alignment` to try the source tracing interface.
This development-only page uses clearly labeled handwritten examples and does not start a participant
session or upload responses. The controls also show the baseline, missing-mapping, and empty-mapping states.

In the study, the glossary is available **only in the Word glossary explanation**. The Korean words on the
notice image become boxes (positions from `translation-experiment-data/image-boxes.json`). Hovering or
keyboard-focusing a box opens a small popover with that word's **English meaning**: the first sense of its entry
in `translation-experiment-data/dictionary.json` (`koreanGloss` in `src/lib/glossary.ts`). Phrase entries (such as
`이 주` = "two weeks") take precedence over single words. Click, tap, Enter or Space pins the popover; its close
button, Escape or clicking outside dismisses it. English words are plain text and aren't interactive.

If a notice has `alignment` links in `explanations.json`, a Korean word with no dictionary entry falls back to the
English it's linked to, and its linked English words are highlighted; English words with no link get a dashed
underline. Only `p3_hotel` correct has (three test) links. Without links, a word with no entry shows
"No translation available".

Definitions come from English Wiktionary (Wiktionary contributors, CC BY-SA 4.0), bundled so they work offline.
Because only the first sense is shown, the team **curated** the Korean entries for the study notices: the right
sense was moved first where Wiktionary had it, and senses or whole entries the team wrote are marked
`"curated": true` (they have no Wiktionary `sourceUrl`). Every Korean word in the four notices has an entry.
`npm run check-data` validates the file; `npm run test:dictionary` checks lookup behavior. After changing a
notice's Korean text, hover-check its words. The fuller `DictionaryEntries` component (all senses, both
languages) is kept in `src/components/` but isn't shown in the study.
