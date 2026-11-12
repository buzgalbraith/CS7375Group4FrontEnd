# Translation Explanation Study

Web app for our CS 7375 (Human-Centered Explainable & Responsible AI, Fall 2026) semester project.
It compares **explanation methods for machine translation** from the point of view of people who can't read
the source language.

**Live site:** https://translationstudy.netlify.app

**Team:** Eric Buz Kuan

> **Status (2026-11-12): ready to pilot.** All 4 notices × 2 versions have real explanations for Confidence
> estimation, Rationale generation and Quality estimate. The Word glossary works from a bundled Korean–English
> dictionary whose glosses the team curated for these notices. By default the pre- and post-surveys are run as
> live interviews; `?mode=async` shows them on screen (those survey items are still drafts). See
> [Before running real participants](#before-running-real-participants).

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
Participants decide whether they'd rely on the translation or get it checked (the scenario makes checking
inconvenient: no Korean phone number, a long phone queue, rooms selling out), look at several explanations of
it, answer a question that only has the right answer if they caught the error, and rank the explanations. Most
participants are US grad students who don't read Korean; the pre-interview (or pre-survey) screens out
Korean readers.

Mixing correct and flawed translations is what makes the decisions informative: with only correct
translations, "I'd trust it without any explanation" would always be right and give no signal.

### Session flow

```
Consent → Pre-interview → 4 notices (the first with hints) → Post-interview → Done
```

By default the researcher runs the pre- and post-surveys as **live interviews** (in person or over Zoom), recorded
on our side. The site shows an interview screen with an *"The interview is finished"* checkbox in their place
and stores only when each interview started and ended. With `?mode=async` the surveys are shown on screen instead.

| Step | What happens |
|---|---|
| **Consent** | Study info, a request not to use outside translation tools, the participant's **email** (required; sets their ID), and an agreement checkbox. No formal consent form: this is a class project without IRB review. |
| **Pre-interview / survey** | Occupation, age range, first language, Korean proficiency, other languages spoken at an advanced level (optional), how they usually check a translation, machine-translation use and trust (adapted from Ki et al.). In interviews the researcher screens for Korean reading and can end the session as not eligible from the interview screen. |
| **Notices** | The 4 notices (2 pharmacy, 2 hotel), each through the four steps below. On the first one, each step and explanation shows a hint on how to read it (there is no separate practice round). |
| **Post-interview / survey** | Mental demand, helpfulness and future trust (Hoffman et al., 2019), each rated overall and then for each explanation by name (stored as e.g. `helpfulness` and `helpfulness_qe`), open-ended questions, and an optional question about a time machine translation misled them. The interview screen lists the four explanations by name, in the order the participant saw them. |
| **Done** | Upload status, with a JSON download as a fallback. |

### Each notice: decide → reveal → question → rank

The scenario ("Your situation") stays at the top throughout. The original notice is shown as an **image**
(click **Enlarge** to scroll and zoom); the Korean text itself is shown only for a notice without an image.

1. **First impression.** Notice image + English translation only. The participant answers the scenario's key
   question, then decides on one **6-point scale** from *Get it checked* (1–3) to *Rely on the translation*
   (4–6). Stored as `scale`, plus a derived `accept` / `reject` and `confidence` (1–3, how far toward that end).
   This is the **no-explanation baseline**.
2. **Explanations.** Four explanations appear as tabs named by method (*Confidence estimation*, *Rationale
   generation*, *Quality estimate*, *Word glossary*), in the participant's condition order, so they can refer
   to them by name later. All four must be opened, then the participant decides again on the same scale.
3. **Question.** The key question again (e.g. *"Should you still be taking it on the following
   Wednesday?"*), answered *Yes* / *No* (same random order as before) or *I'm not sure*. One of Yes/No reflects
   the true meaning, the other the flawed translation.
4. **Rank.** The participant ranks the explanations on two dimensions, each with a required written reason
   (at least 15 characters), adapted from Ehsan et al.'s comparative rankings:
   - how **easy to understand** each explanation was
   - how much each **helped them decide** whether to trust the translation

   Each list starts in a random order so the A–D order doesn't anchor rankings.

### What's measured

| Measure | From | Meaning |
|---|---|---|
| **Decision accuracy** | rely/check before vs. after explanations | Did explanations help people check flawed translations and rely on correct ones? |
| **Comprehension** | the key question, before and after the explanations | Did people end up with the right understanding, or act on the error? This is the most direct behavioral outcome. |
| **Confidence** | the 6-point decision scale | Calibration: confident when right, unsure when wrong? |
| **Preference** | rankings + written reasons | Which explanations people find understandable and useful, and why (the qualitative data). |
| **Process** | tab view times, Word glossary hovers, original-image views | How people used each explanation. |
| **Time** | per notice and per step (first impression, explanations, question, rank); whole session; each interview | How long each part took. |

### Explanation types

| Type | What the participant sees | How it's made |
|---|---|---|
| **Confidence estimation** | The translation shaded word by word by how unexpected a translation model found it given the Korean (darker red = more unexpected). | Log-probability heatmap, `google/gemma-4-12B-it` ([`explanations/logprob_heatmap/`](explanations/logprob_heatmap/METHOD.md)) |
| **Rationale generation** | An LLM-generated paragraph on how well the translation matches the original. | Claude Haiku 5.5 on Bedrock, blind to which version it's explaining ([`rationale-generation/`](rationale-generation/README.md)) |
| **Quality estimate** | An overall score (0–100) and the translation colored by how likely each part is to be wrong (likely error / uncertain / likely fine). | ESA with `Unbabel/XCOMET-XL` ([`explanations/esa/`](explanations/esa/METHOD.md)) |
| **Word glossary** | Hover a boxed Korean word on the notice image to see its English meaning. English words aren't interactive. | Bundled dictionary (`dictionary.json`): Wiktionary entries, with glosses curated by the team so each word's first meaning fits the notice |

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
| **0** | Confidence estimation | Rationale generation | Word glossary | Quality estimate |
| **1** | Rationale generation | Quality estimate | Confidence estimation | Word glossary |
| **2** | Quality estimate | Word glossary | Rationale generation | Confidence estimation |
| **3** | Word glossary | Confidence estimation | Quality estimate | Rationale generation |

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
| `mode` | `remote` (default) · `moderated` · `async` | How the session is run; saved with the data. `remote` and `moderated` use live interviews, `async` the on-screen surveys (old `online` links count as `async`). |
| `debug` | `1` | **Researchers only.** Header shows pid, condition, order, mode and upload queue. |
| `stage` | `welcome` `pre` `trials` `post` `done` | **Researchers only.** Jump to a step for design review. |

Keep a session sheet (pid, cond, mode, date, moderator, notes).

### In person (`mode=moderated`), interviews
- Open each participant's link in a **fresh private window** on the study laptop. Never use `debug=1` with participants.
- Record think-aloud audio separately (phone, QuickTime, Zoom) and say the pid aloud at the start.
- Run the pre-interview on the first interview screen, then tick *The interview is finished*. The post-interview
  screen comes after the last notice, and each notice's timing stops before it starts.
- **Unreliable Wi-Fi is fine.** Responses queue in the browser and upload once it's back online.
  Fully offline: `cd app && npm run build && npm run preview` and use the localhost URL.

### Remote over Zoom (`mode=remote`, the default), interviews
- Send the link in chat and have the participant open it **in their own browser** and share their screen.
  Hover and drag lag badly under remote control.
- Laptop or desktop only. Word glossary relies on hover.
- Record the call, with consent.

### Self-serve (`mode=async`)
- Send the link. The pre- and post-surveys appear on screen, and the hints on the first notice are built to work
  without a researcher.

If a session breaks, restart with a suffixed ID (e.g. `P03b`). Every run has its own `session_id`, so partial
runs stay separable.

---

## Data

Responses go to **Supabase** (Postgres) as an **append-only event log**, uploaded as soon as each step is
finished, so dropouts keep what they completed:

| Event | When | Payload |
|---|---|---|
| `session_start` | after consent | mode, explanation order, document order, user agent |
| `pre_survey` | after pre-survey / pre-interview | survey answers, or for an interview `format: "interview"`, start/end times, `durationMs` (and `eligible: "no"` if ended as not eligible) |
| `trial` | after each notice | notice id, version, stakes, both decisions (scale, decision, confidence), both comprehension answers, rankings + justifications, tab view times, Word glossary hovers, original-image views, `durationMs` and `stepMs` (time per step) |
| `post_survey` | after post-survey / post-interview | survey answers, or for an interview `format: "interview"`, start/end times, `durationMs` |
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
select * from analysis.sessions;   -- one row per session: pid, condition, mode, trials done, completed?, email,
                                   --   duration_ms, trials_ms, pre_interview_ms, post_interview_ms
select * from analysis.trials;     -- one row per notice: version, stakes, decisions, comprehension, rankings, mode,
                                   --   duration_ms, baseline_ms, reveal_ms, question_ms, rank_ms

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
(e.g. `where pid not like 'TEST%'`) and screened-out sessions (`analysis.sessions.screened_out`). The `analysis` schema isn't
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
| `explanations.json` | Kuan | Explanations per notice **and version**; phrases copied from the texts, not offsets. Written by the generators under `explanations/` and `rationale-generation/` |
| `dictionary.json` | Kuan | Korean and English dictionary entries for the Word glossary (Wiktionary, CC BY-SA 4.0); team-written glosses are marked `"curated": true` |
| `image-boxes.json` | generated | Where each Korean word sits on its notice image (`explanations/image_boxes/`); don't edit |
| `images/` | Eric | The notices as images |

The full format is in [`app/translation-experiment-data/README.md`](app/translation-experiment-data/README.md).
After editing, run `cd app && npm run check-data`. It validates every phrase and id and prints explanation
coverage and the condition table. Which notices are used is set in
[`app/src/data/studyConfig.ts`](app/src/data/studyConfig.ts).

**Current explanation coverage:** Confidence estimation, Rationale generation and Quality estimate exist for all
4 notices × 2 versions. The Word glossary uses the dictionary on every notice; `check-data`'s `A` column (word
alignments) is empty except for three test links on `p3_hotel` correct, which is expected. When a notice's Korean
text changes, hover-check its glosses.

Survey items are in [`app/src/data/surveys.ts`](app/src/data/surveys.ts).

---

## Development and deployment

```bash
cd app
npm install
npm run dev          # http://localhost:5173  (add ?debug=1)
npm run check-data   # validate translation-experiment-data/
npm run test:dictionary   # dictionary lookup tests
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
├── rationale-generation/        writes the Rationale generation explanations with Claude on Bedrock
├── explanations/                generators for the other explanations
│   ├── logprob_heatmap/         Confidence estimation (log-probability heatmap)
│   ├── esa/                     Quality estimate (ESA via xCOMET)
│   ├── image_boxes/             OCR: where each Korean word is on the notice image
│   └── merge_into_app.py        copies their outputs into explanations.json
└── app/
    ├── README.md                developer notes (setup, Supabase, viewer, glossary)
    ├── netlify.toml             build settings
    ├── supabase/schema.sql      table, access rules, analysis views
    ├── translation-experiment-data/
    │   ├── notices.json         notices, translations, scenarios, questions
    │   ├── explanations.json    precomputed explanations
    │   ├── dictionary.json      Word glossary dictionary
    │   ├── image-boxes.json     Korean word positions on the images (generated)
    │   └── images/              the notices as images
    ├── scripts/                 check-data.ts (npm run check-data) · dictionary.test.ts
    └── src/
        ├── App.tsx              session flow and event recording
        ├── types.ts             data formats (Stimulus, TrialResult, SessionRecord)
        ├── data/                studyConfig.ts (which notices, counterbalancing) · study.ts (loader)
        │                        buildStimuli.ts (JSON → stimuli) · surveys.ts (DRAFT, async mode only)
        ├── lib/                 session.ts (conditions, IDs, modes) · sync.ts (upload queue)
        │                        dictionary.ts · glossary.ts (Word glossary lookups)
        └── components/          Trial, DocumentPane, ExplanationPanel, SourceMatch (glossary popover),
                                 ComprehensionQuestion, DecisionForm, RankList, Survey, Interview, OriginalViewer
```

---

## Before running real participants

- [x] Real explanations for all 4 notices × 2 versions (Confidence estimation, Rationale generation, Quality estimate)
- [x] Word glossary covers every Korean word in the 4 notices (curated dictionary glosses)
- [ ] Kuan reviews the curated dictionary glosses, and the team reads every rationale
- [ ] Interview script for the pre- and post-interviews (based on `app/src/data/surveys.ts`); finalize those
      survey items too if `mode=async` will be used
- [ ] Re-run `app/supabase/schema.sql` in Supabase (new timing and interview columns)
- [ ] Pilot with 1–2 people on the live site; check the session length (target about 20 min plus interviews)
- [ ] Delete pilot and test rows: `delete from public.study_events where pid like 'TEST%';`
- [ ] Prepare participant links and a session sheet with conditions assigned

---

## Open questions

- **The Word glossary shows true meanings at the error.** A correct gloss reveals what the Korean says (e.g.
  이 주 = "two weeks" where the flawed translation says "one week"), so it may be the easiest explanation for
  catching errors. That's how a glossary works, but it should be discussed when comparing explanations.
- **Order effects of errors.** Each participant sees 2 flawed translations out of 4. After catching one,
  people may grow more suspicious; the rotation spreads this across notices but doesn't remove it.
- **The question reveals the stakes of the error.** The key question points at exactly the phrase that's
  flawed, which may prompt people to re-check it. That's why it comes after both decisions.
- **Typed reasons in interviewed sessions.** Participants talking through their choices with a researcher
  also type their ranking reasons (15-character minimum), which duplicates effort. Relaxing it for interviewed
  sessions would make them less comparable with `mode=async` data.
- **Resuming.** Refreshing mid-study restarts the session (earlier steps stay on the server).
- **Ranking load.** Ranking two dimensions after every document adds time; ranking once per document type or
  once at the end is an alternative.
