# Translation Explanation Study

Web app for our CS 7375 (Human-Centered Explainable & Responsible AI, Fall 2026) semester project.
It compares **explanation methods for machine translation** from the point of view of people who can't read
the source language.

**Live site:** https://translationstudy.netlify.app

**Team:** Eric Buz Kuan

> ⚠️ **Status: real notices, no explanations yet.** The notices, translations, scenarios and questions are the
> team's study materials. Explanations haven't been generated yet (`explanations.json` is absent), so every
> explanation shows as "not generated yet". Survey items are drafts. See [Before running real participants](#before-running-real-participants).

---

## Contents
- [The study](#the-study)
- [Conditions and counterbalancing](#conditions-and-counterbalancing)
- [Running sessions](#running-sessions)
- [Data](#data)
- [Study data](#study-data)
- [Development and deployment](#development-and-deployment)
- [Repository layout](#repository-layout)
- [Open questions](#open-questions)

---

## The study

Participants imagine traveling in Korea. Each notice they see is a short **Korean** text from a pharmacy
(**high stakes**) or a hotel (**low stakes**), shown with an **English machine translation** and a scenario
("Your situation…"). Each notice exists in two versions: a **correct** translation and a **flawed** one with a
single plausible, consequential error (a flipped "before/after", a dropped list item, a misread number…).
Participants decide whether they'd rely on the translation or get it checked (at a stated cost), look at
several explanations of it, answer a question that only has the right answer if they caught the error, and rank the explanations. Most
participants are US grad students who don't read Korean; the pre-survey asks about Korean proficiency so
readers can be excluded.

Mixing correct and flawed translations is what makes the decisions informative: with only correct
translations, "I'd trust it without any explanation" would always be right and give no signal.

### Session flow

```
Consent → Pre-survey → 4 notices (the first with hints) → Post-survey → Done
```

| Step | What happens |
|---|---|
| **Consent** | Study info, a request not to use outside translation tools, the participant's **email** (required; sets their ID), and an agreement checkbox. No formal consent form: this is a class project without IRB review. |
| **Pre-survey** | Occupation, age range, first language, Korean proficiency, other languages spoken at an advanced level (optional), how they usually check a translation, machine-translation use and trust (adapted from Ki et al.). |
| **Notices** | The 4 notices (2 pharmacy, 2 hotel), each through the four steps below. On the first one, each step and explanation shows a hint on how to read it (there is no separate practice round). |
| **Post-survey** | Mental demand, helpfulness and future trust (Hoffman et al., 2019), each rated overall and then for each explanation by name (stored as e.g. `helpfulness` and `helpfulness_qe`), open-ended questions, and an optional question about a time machine translation misled them. |
| **Done** | Upload status, with a JSON download as a fallback. |

### Each notice: decide → reveal → question → rank

The scenario stays at the top throughout. The original notice is shown as an **image** (click **Enlarge** to
scroll and zoom); the Korean text is hidden behind a **Show transcription** button, and is revealed
automatically when the word-matching explanation is opened, since that explanation works on the text.

1. **First impression.** Korean text + English translation only → *Rely on this translation* / *Get it
   checked* + confidence (1–7). The notice's `check_cost` (e.g. *"calling the clinic, which has a long phone
   queue"*) is shown under *Get it checked*. Stored as `accept` / `reject`. This is the **no-explanation baseline**.
2. **Explanations.** Four explanations appear as tabs named by method (*Round-trip translation*, *Rationale
   generation*, *Quality estimate*, *Word glossary*), in the participant's condition order, so they can refer
   to them by name later. All four must be
   opened, then the participant decides again (rely / get it checked + confidence).
3. **Question.** The scenario's key question (e.g. *"Should you still be taking it on the following
   Wednesday?"*), answered *Yes* / *No* (random order) or *I'm not sure*. One of Yes/No reflects the true
   meaning, the other the flawed translation.
4. **Rank.** The participant ranks the explanations on two dimensions, each with a required written reason
   (at least 15 characters), adapted from Ehsan et al.'s comparative rankings:
   - how **easy to understand** each explanation was
   - how much each **helped them decide** whether to trust the translation

   Each list starts in a random order so the A–D order doesn't anchor rankings.

### What's measured

| Measure | From | Meaning |
|---|---|---|
| **Decision accuracy** | rely/check before vs. after explanations | Did explanations help people check flawed translations and rely on correct ones? |
| **Comprehension** | the key question | Did people end up with the right understanding, or act on the error? This is the most direct behavioral outcome. |
| **Confidence** | 1–7 after each decision | Calibration: confident when right, unsure when wrong? |
| **Preference** | rankings + written reasons | Which explanations people find understandable and useful, and why (the qualitative data). |
| **Process** | tab view times, word-matching hovers, original-image views, transcription opens | How people used each explanation. |

### Explanation types

| Type | What the participant sees |
|---|---|
| **Round-trip translation** | The translation translated into Korean and back into English; wording that differs from the translation is highlighted. |
| **Rationale generation** | An LLM-generated paragraph on how well the translation matches the original. |
| **Quality estimate** | An overall score (0–100) and the translation colored by how likely each part is to be wrong (likely error / uncertain / likely fine). |
| **Word glossary** | Hover a word in either text to highlight the corresponding words; English words with no match get a dashed underline. |

All explanations are **precomputed** (stored in `explanations.json`), so every participant sees identical
stimuli and nothing calls a model at study time.

---

## Conditions and counterbalancing

A condition (`cond` = 0–3) sets three things: the **explanation order**, the **notice order**, and **which notices
get the flawed translation**. Every participant sees all four explanation types on all four notices, so
explanation type is compared within each participant.

**Explanation order (tabs, left to right; stored as labels A → D).** Balanced Latin square: across conditions each type appears in each position
once and follows every other type once. A participant keeps the same order throughout their session.

| `cond` | A | B | C | D |
|---|---|---|---|---|
| **0** | Round-trip translation | Rationale generation | Word glossary | Quality estimate |
| **1** | Rationale generation | Quality estimate | Round-trip translation | Word glossary |
| **2** | Quality estimate | Word glossary | Rationale generation | Round-trip translation |
| **3** | Word glossary | Round-trip translation | Quality estimate | Rationale generation |

**Notices and versions** (✗ flawed translation, ✓ correct). The 1st notice is the one shown with hints.

| `cond` | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|
| **0** | p2_med ✗ | p4_med ✓ | p3_hotel ✗ | p6_hotel ✓ |
| **1** | p4_med ✗ | p3_hotel ✓ | p6_hotel ✗ | p2_med ✓ |
| **2** | p3_hotel ✓ | p6_hotel ✗ | p2_med ✗ | p4_med ✓ |
| **3** | p6_hotel ✓ | p2_med ✓ | p4_med ✗ | p3_hotel ✗ |

Every participant gets **one flawed and one correct notice at each stakes level**, each notice is flawed in
exactly half the conditions, and each notice appears in each position once. `npm run check-data` prints
this table from the live configuration (`app/src/data/studyConfig.ts`).

If `cond` is omitted, it's derived from the participant ID. For a real study, **assign it explicitly** and cycle
0 → 1 → 2 → 3 across participants.

---

## Running sessions

Each participant gets a personal link:

```
https://translationstudy.netlify.app/?pid=P03&cond=2&mode=moderated
```

| Parameter | Values | Purpose |
|---|---|---|
| `pid` | e.g. `P03` | Participant ID. If omitted, it's derived from the email entered on the welcome page (e.g. `P-973DFE46`), so the same person always gets the same ID. |
| `cond` | `0`–`3` | Counterbalancing condition (see above). |
| `mode` | `moderated` · `remote` · `online` (default) | How the session is run; saved with the data. |
| `debug` | `1` | **Researchers only.** Header shows pid, condition, order, mode and upload queue. |
| `stage` | `welcome` `pre` `trials` `post` `done` | **Researchers only.** Jump to a step for design review. |

Keep a session sheet (pid, cond, mode, date, moderator, notes).

### In person (`mode=moderated`)
- Open each participant's link in a **fresh private window** on the study laptop. Never use `debug=1` with participants.
- Record think-aloud audio separately (phone, QuickTime, Zoom) and say the pid aloud at the start.
- Do the post-session interview after the **Done** screen so it doesn't inflate the timing data.
- **Unreliable Wi-Fi is fine.** Responses queue in the browser and upload once it's back online.
  Fully offline: `cd app && npm run build && npm run preview` and use the localhost URL.

### Remote over Zoom (`mode=remote`)
- Send the link in chat and have the participant open it **in their own browser** and share their screen.
  Hover and drag lag badly under remote control.
- Laptop or desktop only. Word glossary relies on hover.
- Record the call, with consent.

### Self-serve (`mode=online` or omitted)
- Send the link. The hints on the first notice are built to work without a researcher.

If a session breaks, restart with a suffixed ID (e.g. `P03b`). Every run has its own `session_id`, so partial
runs stay separable.

---

## Data

Responses go to **Supabase** (Postgres) as an **append-only event log**, uploaded as soon as each step is
finished, so dropouts keep what they completed:

| Event | When | Payload |
|---|---|---|
| `session_start` | after consent | mode, explanation order, document order, user agent |
| `pre_survey` | after pre-survey | answers |
| `trial` | after each notice | notice id, version, stakes, both decisions + confidence, comprehension answer, rankings + justifications, tab view times, word-matching hovers, original-image views, transcription opens |
| `post_survey` | after post-survey | answers |
| `session_complete` | at the end | the full session record |

**Reliability.** Unsent events wait in the browser's local storage and retry automatically (also after a reload
or when the connection comes back). Each event has a client-generated ID, so retries never create duplicates.
The Done screen shows *All responses saved* or offers *Retry now*, and **Download data (JSON)** is always
available.

**Security.** The browser holds Supabase's *publishable* key, which is public by design. The table is
**insert-only** for that key: participants can't read, edit or delete anything. Researchers read data in the
Supabase dashboard.

**Analysis.** In the Supabase **SQL Editor**:

```sql
select * from analysis.sessions;   -- one row per session: pid, condition, mode, trials done, completed?, email
select * from analysis.trials;     -- one row per notice: version, stakes, decisions, comprehension, rankings, mode

-- did explanations improve decisions, and did people end up understanding correctly?
select stakes, version,
       avg(baseline_correct::int)    as decided_right_before,
       avg(revised_correct::int)     as decided_right_after,
       avg(comprehension_right::int) as understood
from analysis.trials
group by stakes, version order by stakes, version;
```

`*_correct` means the participant chose to get a flawed translation checked (`reject`) or relied on a correct
one (`accept`). Each trial payload also has `hints` (true on the session's first notice); `tutorial` is always
false now that there is no practice round.
`comprehension_answer` is `correct`, `flawed` (acted on the error) or `unsure`. Exclude test runs
(e.g. `where pid not like 'TEST%'`) and participants who report reading Korean. The `analysis` schema isn't
reachable through the public API.

Setup details (creating the table, keys, environment variables) are in [`app/README.md`](app/README.md#saving-data-supabase).
The schema is in [`app/supabase/schema.sql`](app/supabase/schema.sql); it's safe to re-run after updates.

---

## Study data

All study content lives in [`app/translation-experiment-data/`](app/translation-experiment-data/), and the
app reads it directly:

| File | Owner | Contents |
|---|---|---|
| `notices.json` | Eric | Korean text, correct + flawed English, error description, scenario, cost of checking, yes/no key question |
| `explanations.json` | Kuan | Explanations per notice **and version**; phrases copied from the texts, not offsets. Optional until generated |
| `images/` | Eric | The notices as images, for "View original" |

The full format is in [`app/translation-experiment-data/README.md`](app/translation-experiment-data/README.md).
After editing, run `cd app && npm run check-data`. It validates every phrase and id and prints explanation
coverage and the condition table. Which notices are used is set in
[`app/src/data/studyConfig.ts`](app/src/data/studyConfig.ts).

**Current explanation coverage:** none. `explanations.json` doesn't exist yet, so all four notices show
"not generated yet" for every explanation.

Survey items are in [`app/src/data/surveys.ts`](app/src/data/surveys.ts).

---

## Development and deployment

```bash
cd app
npm install
npm run dev          # http://localhost:5173  (add ?debug=1)
npm run check-data   # validate translation-experiment-data/
npm run build        # type-check + production build into app/dist
```

Stack: React 19 + TypeScript + Vite, `@dnd-kit` for drag-to-rank, `pdfjs-dist` for PDF originals, Supabase
REST for storage (no SDK). Requires Node 20.19+ / 22.12+. `npm run check-data` validates the study data.

**Deployment.** Netlify builds from this repo on every push to the deployed branch. Settings: **Base
directory** = `app`; build command and publish directory come from [`app/netlify.toml`](app/netlify.toml).
Environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set in Netlify. Vite builds
them into the site, so **redeploy after changing them**. Locally they go in `app/.env.local` (gitignored; see
`app/.env.example`).

Since pushes go live immediately, check changes locally first and avoid deploying during a data-collection
session.

---

## Repository layout

```
├── README.md                    ← this file
├── AGENTS.md                    commands and rules for coding agents
├── project_meterial/            course project description and our planning doc
├── rationale-generation/        script that writes the written explanations with Claude on Bedrock
└── app/
    ├── README.md                developer notes (setup, Supabase, viewer)
    ├── netlify.toml             build settings
    ├── supabase/schema.sql      table, access rules, analysis views
    ├── translation-experiment-data/
    │   ├── notices.json         notices, translations, scenarios, questions
    │   ├── explanations.json    precomputed explanations (not added yet)
    │   └── images/              notice images for "View original"
    ├── scripts/check-data.ts    data validator (npm run check-data)
    └── src/
        ├── App.tsx              session flow and event recording
        ├── types.ts             data formats (Stimulus, TrialResult, SessionRecord)
        ├── data/                studyConfig.ts (which notices, counterbalancing) · study.ts (loader)
        │                        buildStimuli.ts (JSON → stimuli) · surveys.ts (DRAFT)
        ├── lib/                 session.ts (conditions, IDs) · sync.ts (upload queue) · diff.ts
        └── components/          Trial, DocumentPane, ExplanationPanel, ComprehensionQuestion,
                                 RankList, DecisionForm, Survey, OriginalViewer
```

---

## Before running real participants

- [ ] Real explanations for all 4 notices × 2 versions (`explanations.json`)
- [ ] `npm run check-data` passes with no "pending" or "(mock)" in the coverage table
- [ ] Finalize survey items (`app/src/data/surveys.ts`)
- [ ] Re-run `app/supabase/schema.sql` if it changed
- [ ] Pilot with 1–2 people on the live site; check the session length (target about 20 min)
- [ ] Delete pilot and test rows: `delete from public.study_events where pid like 'TEST%';`
- [ ] Prepare participant links and a session sheet with conditions assigned

---

## Open questions

- **Round-trip translation.** The translation is already in English, so English → Korean → English never checks
  the Korean source and can repeat errors. Keep it, replace it with an
  independent second translation, or drop it?
- **Order effects of errors.** Each participant sees 2 flawed translations out of 4. After catching one,
  people may grow more suspicious; the rotation spreads this across notices but doesn't remove it.
- **The question reveals the stakes of the error.** The key question points at exactly the phrase that's
  flawed, which may prompt people to re-check it. That's why it comes after both decisions.
- **Typed reasons in moderated sessions.** Think-aloud participants say their reasons, so the 15-character
  typed minimum duplicates effort. Relaxing it for `mode=moderated` would make moderated and online data less
  comparable.
- **Resuming.** Refreshing mid-study restarts the session (earlier steps stay on the server).
- **Ranking load.** Ranking two dimensions after every document adds time; ranking once per document type or
  once at the end is an alternative.
