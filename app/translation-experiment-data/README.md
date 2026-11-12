# Study data

Everything participants see comes from this folder. The app reads these files directly at build time,
so editing them (and pushing) is all it takes to change the study.

```
translation-experiment-data/
├── notices.json        Korean notices, correct + flawed English, scenario, comprehension question  (Eric)
├── dictionary.json     Offline English definitions of English and Korean headwords, plus explicit forms
├── explanations.json   precomputed explanations per notice and translation version (optional while  (Kuan)
│                       not yet generated: everything shows as "pending")
├── image-boxes.json    where each Korean word sits in its image, for the Word glossary (generated; don't edit)
└── images/             the notices as participants would see them ("View original")
```

**After any edit, run `npm run check-data` from `app/`.** It reports missing or mistyped phrases,
unknown ids, missing images, and prints which explanations exist and what each condition shows.
The site still loads with bad data (bad items are skipped), so this check is the safety net.

Which notices are used (and in what order) is set in [`../src/data/studyConfig.ts`](../src/data/studyConfig.ts).

---

## notices.json

```jsonc
{
  "about": "…",
  "documents": [
    {
      "id": "p2_med",                       // unique; referenced by explanations.json and studyConfig.ts
      "stakes": "high",                     // "high" | "low"; versions are balanced within each level
      "setting": "pharmacy",
      "title_ko": "해솔약국 · 복약 안내",
      "title_en": "Haesol Pharmacy · Medication Guide",   // shown as the page heading
      "image": "images/p2_med.png",         // relative to this folder; optional
      "korean": "…\n\n…",                   // paragraphs separated by a blank line
      "english": {
        "correct": "…",                     // faithful translation
        "flawed": "…"                       // same text with one plausible, consequential error
      },
      "error": {                            // documents the flaw; checked to exist in the texts
        "type": "lexical ambiguity (Hangul number)",
        "korean_span": "이 주 동안",         // must appear in "korean"
        "correct_span": "…",                // must appear in english.correct
        "flawed_span": "…"                  // must appear in english.flawed
      },
      "scenario": "…",                      // shown to the participant as "Your situation"
      "check_cost": "Getting it checked means …",  // optional; not currently shown to participants
      "key_question": {
        "question": "…",                    // a yes/no question, asked after the explanations
        "answer": "Yes. …",                 // must start with "Yes" or "No": the correct answer
        "answer_if_trusting_flawed": "No. …" // must start with the opposite word
      }
    }
  ]
}
```

**Key question.** Participants answer *Yes*, *No* (shown in random order) or *I'm not sure*. The app reads
the first word of `answer` to know which of Yes/No reflects the true meaning of the Korean, and the first word
of `answer_if_trusting_flawed` for the flawed reading; they must be opposites. The rest of both strings is
researcher notes and isn't shown.

**Decision.** Before and after the explanations, participants answer *"How confident are you?"* on a 6-point
scale from *Get it checked* to *Rely on the translation*; stored as `scale` (1–6) with a derived `accept` /
`reject`. `check_cost` is kept in the data but isn't currently shown.

---

## image-boxes.json

Generated, not hand-written: `python3 explanations/image_boxes/build_boxes.py` (macOS; Apple Vision OCR)
reads each notice image, matches the recognized characters to the notice's `korean` text, and stores one box
per Korean word (whitespace token, in order) per image line it spans: `[x, y, width, height]` as fractions of
the image, origin top-left. **Re-run it after changing a notice's Korean text or image.** If the words no longer
line up, `npm run check-data` reports it and the app falls back to showing the Korean text in the Word glossary.

## explanations.json

One set of explanations per notice **and translation version**, because the explanations describe the
translation the participant actually sees.

```jsonc
{
  "about": "…",
  "explanations": {
    "p2_med": {
      "flawed": {
        "_mock": true,                      // optional; marks hand-written placeholder content
        "heatmap": {                        // "Confidence estimation" heatmap: one item per English word
          "words": [
            { "text": "week.", "score": 0.03 }  // 0–1, lower = less expected; < 0.1 very, < 0.5 somewhat
          ]                                     // unexpected (shaded); "occurrence" if the text repeats
        },
        "rationale": "…",                   // plain text
        "qe": {
          "score": 80,                      // overall estimated quality, 0–100
          "spans": [                        // parts of the English to highlight
            { "text": "for one week.", "score": 0.55, "note": "Duration may not match the source" }
            // score 0–1: < 0.4 shown as "likely error", < 0.7 "uncertain", else "likely fine"
          ]
        },
        "alignment": [                      // Korean phrase ↔ English phrase it corresponds to
          { "ko": "이 주 동안", "en": "for one week" }
        ]
      },
      "correct": { … }
    }
  }
}
```

**Phrases, not offsets.** `qe.spans[].text`, `heatmap.words[].text`, `alignment[].ko` and `alignment[].en` are exact substrings
copied from `korean` / `english.<version>` in notices.json. The app highlights every word the phrase
touches. If a phrase occurs more than once, add a 1-based occurrence number: `"occurrence"` for qe spans,
`"ko_occurrence"` / `"en_occurrence"` for alignment. An alignment link's English side must be one
contiguous phrase; split non-contiguous correspondences into several links with the same `ko`.

**Coverage.** Any missing notice, version or field shows to participants as "This explanation hasn't been
generated for this document yet." English words not covered by any alignment link get a dashed underline
("no match found in the original"), so aim to cover every content word.

If a pipeline produces token or character offsets, converting them to phrases is a one-liner:
`text[start:end]`.

## dictionary.json

Dictionary entries appear only in the Word matching glossary. The snapshot contains definitions in
English for both `en` and `ko` headwords, along with explicit surface forms (for example, `towels` →
`towel`, `무료입니다` → `무료`). These mappings identify dictionary headwords; they do **not** create
translation alignments or decide whether a translation is correct. Missing entries remain explicit.
Dictionary lookup stays available in Word matching even when alignment data is pending; counterpart
definitions require supplied links and are never inferred from dictionary meanings.

Each entry has an `id`, `language`, `headword`, `forms`, `senses` (each with `partOfSpeech` and
`definition`), and `sourceUrl`. Punctuation is ignored at token edges; multiword entries prefer the
longest exact match without crossing paragraphs or linked spans. No generic Korean suffix stripping
or live dictionary lookups are used. Add exact forms to the entry when adding new notice text.

Definitions are extracted from [English Wiktionary](https://en.wiktionary.org/), attributed to
**Wiktionary contributors**, and licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Each entry links to its original headword/language page (and that page's contributor history).
The snapshot removes HTML and examples and keeps up to eight senses within 160 words per headword;
the common no-cost sense of “free”, request adverb “please”, and state sense of “be” are listed first. Inflection aliases
are locally curated. This license applies to the dictionary content; it does not relicense app code.
Keep the attribution, license, retrieval date, and source links with any redistributed dictionary content.

Run `npm run check-data` after editing definitions or forms, and `npm run test:dictionary` after changing
lookup behavior. Definitions are bundled at build time so every participant using a build sees the
same text and the glossary continues to work offline.
