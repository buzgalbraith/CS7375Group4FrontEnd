# ESA: error span annotation with xCOMET

The **quality estimate** explanation: an overall score (0–100) plus the parts of the English that a model
thinks are wrong, each with a severity. It fills the `qe` field of `explanations.json`.

```
explanations/esa/
├── METHOD.md          this file
├── generate.py        notices.json → output.json (+ output_raw.json)
├── preview.py         output.json → preview.html, spans shaded by severity (standard library only)
└── requirements.txt   pinned versions (Python 3.11)
```

---

## What it is

**ESA** (Error Span Annotation; Kocmi et al., 2024) is a human evaluation protocol, used for the WMT24
human evaluation. An annotator sees the source and the translation, marks the spans that are wrong as
*minor* or *major*, and then gives the segment an overall 0–100 score. It sits between Direct Assessment
(one score) and MQM (spans with a full error typology).

We want the automatic version of that output: spans with severities and an overall score, computed without
a reference translation, since participants have none. We use **xCOMET** (Guerreiro et al., 2024), a learned
neural metric that predicts exactly this. It tags each subword of the translation as OK / minor / major /
critical, groups tagged subwords into error spans, and outputs a sentence score that is partly computed from
those spans. Its spans follow MQM severities, which ESA reuses (ESA has no *critical*; see the mapping below).

## Model

| | |
|---|---|
| Model | **`Unbabel/XCOMET-XL`** (3.5B parameters, XLM-R XL encoder), Hugging Face, gated, CC BY-NC-SA 4.0 |
| Larger option | `Unbabel/XCOMET-XXL` (10.7B, XLM-R XXL). Same code: `--model Unbabel/XCOMET-XXL` |
| Library | `unbabel-comet==2.2.7` (latest release, Sep 2025; xCOMET needs ≥ 2.2.0) |
| Mode | **Reference-free (QE)**: input is `{"src": Korean, "mt": English}` with no `ref` |
| Version pin | The checkpoint is whatever the Hugging Face repo serves at run time; `generate.py` records the model id and comet version in `output.json` → `meta`. Record the commit hash from the HF cache after the run. |

**Why xCOMET.** It is the open neural metric that outputs both things the explanation shows (spans with
severity and an overall score) in one model, it supports source-only input by design ("unified" input:
the same model scores src-only, ref-only and src+ref), and its paper reports source-only span detection
close to reference-based (character-level F1 0.255 vs 0.280 for XXL; Guerreiro et al., 2024, Table 3). It
dates from 2023, which matches "one of the neural versions, slightly older". Its stress tests (Section 7)
cover the kind of errors in our flawed versions: added text, negation, and number errors.

**Runner-up.** For the model: `XCOMET-XXL`, which is slightly better in the paper but 3× larger; worth
running if the cluster allows (see open questions). For a different method: **GEMBA-ESA / GEMBA-MQM**
(Kocmi & Federmann, 2023), which prompt an LLM (GPT-4) to produce ESA/MQM-style spans. Those are
prompted LLMs, not a trained metric, they change with the API model behind them, and the written
explanation condition is already LLM-generated, so they would blur the contrast between explanation types.

**Considered and not used.**
- *CometKiwi* (Rei et al., 2022; 2023): reference-free, but the released checkpoints give a sentence score
  only, no spans.
- *MetricX-24* (Juraska et al., 2024): strong, has a QE variant, but scores only.
- *xCOMET-lite* (Larionov et al., 2024): a distilled xCOMET; smaller but no better, and we have a GPU.

## Running it

```bash
cd explanations/esa
python3.11 -m venv .venv && source .venv/bin/activate
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu121   # match the cluster CUDA
pip install -r requirements.txt
huggingface-cli login            # once; the account must have accepted the XCOMET-XL terms on its HF page

python generate.py --dry-run     # print the segments that will be scored; no model
python generate.py --stub        # whole pipeline with a fake model → output.stub.json (for testing only)
python generate.py --device cuda # the real run → output.json, output_raw.json
```

Options: `--notices PATH` (default `app/translation-experiment-data/notices.json`), `--model`,
`--segment sentence|paragraph|document`, `--doc-score mean|min`, `--device auto|cuda|mps|cpu`,
`--batch-size`, `--limit N` (first N notice/version pairs), `--output`, `--raw-output`.
The 8 pairs are 62 short segments, so the run takes minutes; most of the time is loading the model.
XL needs about 14 GB of GPU memory in fp32, XXL about 45 GB.

## Segmentation

Each notice is two paragraphs of 3–6 sentences (460–550 characters of English). xCOMET was trained and
evaluated on sentence-level WMT segments. Its input is `<s> mt </s></s> src </s>` cut to 512 XLM-R tokens;
when it's too long COMET **silently truncates the end**, which is the Korean source.

- **Default: sentence by sentence.** Paragraphs split on blank lines; sentences on `. ! ?` (English only
  when the next sentence starts with a capital, so `4 p.m. to` stays whole). In all 8 pairs the Korean and
  English sentence counts match paragraph by paragraph, so sentences are paired in order. If a paragraph's
  counts ever differ, it's scored whole (`fallback: true` in the raw file) rather than guessing an alignment.
- `--segment paragraph` or `--segment document` are there to compare; a whole notice should be well under
  the limit (an estimate; not tokenized yet). `generate.py` counts tokens with the model's tokenizer and warns above 508.
- **Mapping spans back.** xCOMET returns character offsets into the segment. The script trims whitespace,
  adds the segment's offset in the full translation, takes `english[start:end]` as the span `text`, and adds
  `occurrence` (1-based, counted like the app, overlapping) when that text appears more than once.
  Spans can start or end inside a word; the app highlights every word the phrase touches.
- Since the correct and flawed versions differ in one sentence, the other sentences get identical inputs and
  identical outputs. The difference between versions is all in the changed sentence.

## Scores

**Span score (0–1, the app's scale: < 0.4 likely error, < 0.7 uncertain, else likely fine)** is set by severity:

| xCOMET severity | span `score` | shown as | `note` |
|---|---|---|---|
| critical | 0.10 | likely error | Possible critical error |
| major | 0.25 | likely error | Possible major error |
| minor | 0.55 | uncertain | Possible minor error |

ESA itself has only minor and major; critical and major both land in "likely error". The model's confidence
(mean probability of the predicted tag over the span's subwords) is kept as `confidence` in each span but
doesn't change the color, so the display depends only on the severity the model chose. xCOMET gives no error
category or reason, so the note is only the severity.

**Overall score (0–100).** Per segment, xCOMET in QE mode returns
`0.78 · regression score + 0.22 · MQM score from spans`, where the MQM score is
`(25 − (minor + 5·major + 10·critical)) / 25`, floored at 0. The notice score is the **length-weighted mean**
of its segment scores (weights = English characters), × 100, rounded. `--doc-score min` uses the worst
segment instead. Both are in `output_raw.json` → `documents`.

## Output

`output.json`:

```jsonc
{
  "meta": { "model": "Unbabel/XCOMET-XL", "segment": "sentence", "doc_score": "mean", … },
  "notices": {
    "p2_med": {
      "flawed": {
        "score": 84,
        "spans": [
          { "text": "for one week", "score": 0.25, "severity": "major", "confidence": 0.71,
            "note": "Possible major error" }   // "occurrence": n when the text repeats
        ]
      },
      "correct": { … }
    }
  }
}
```

`notices.<id>.<version>` is the `qe` object of `explanations.json` (`severity` and `confidence` are extra
fields; drop them in the merge if the app shouldn't see them). Every span not listed is "likely fine".
(The example values above are made up.)

`output_raw.json` keeps everything: per segment the Korean and English text, offsets in the full translation,
token count, final / regression / MQM scores, the model's `error_spans` exactly as returned
(`text, start, end, severity, confidence`), and the mapped spans; per document the mean and min scores.

**Check.** Before writing, `generate.py` verifies each span `text` is a substring of its translation, that
`occurrence` is present exactly when needed and in range, and that scores are in range. On failure it writes
only the raw file and exits 1. `npm run check-data` in `app/` repeats the substring check after the merge.

## Assumptions and limitations

- **Korean.** Korean is one of XLM-R's 100 pretraining languages (listed on the model card), but the
  supervision (WMT DA 2017–20, MLQE-PE, WMT MQM 2020–22 for en-de, zh-en, en-ru, plus IndicMT and DEMETR)
  has no Korean pair as far as we can tell. Ko→en is zero-shot transfer; the model card warns that uncovered
  pairs are less reliable.
- **Omissions can't be marked.** Spans are tags on translation tokens, so a dropped phrase has nothing to tag.
  Human ESA lets annotators mark a missing-content position; xCOMET can at best lower the score or tag a
  neighbouring word.
- **Severity of merged spans.** Adjacent tagged subwords become one span with the severity of the first
  subword (COMET 2.2.7 `decode`), not the most severe one as the paper describes.
- **Scores are not calibrated to ESA's 0–100.** Good translations tend to score high and the scale is
  model-specific, and our notice score is our own aggregation.
- **Sentence scoring loses context.** Each sentence is scored without its neighbours. None of the four
  errors needs cross-sentence context, but some false positives might (e.g. "it").
- **Gated, non-commercial.** The weights need a Hugging Face account that accepted Unbabel's terms; the
  licence (CC BY-NC-SA 4.0) allows research use.
- **Not run yet.** The pipeline was tested only with the stub model (`--stub`); the real output format of
  `predict()` was read from the COMET 2.2.7 source, not observed.

## What we expect to see

| Notice | Error in flawed version | Expectation |
|---|---|---|
| p2_med | 이 주 ("two weeks") → "for one week" | **Uncertain.** A number error, which xCOMET's stress tests catch well, but 이 is also "this" (이 주 = "this week"), so "one week" may look plausible to the model. |
| p4_med | "or cold medicines" dropped | **Probably missed** as a span (omission). Maybe a lower score for that sentence, or a span on "sleeping pills with it". |
| p3_hotel | "cannot check in without ID" → "can check in without ID" | **Likely caught**: a negation flip, the kind of error the paper's stress tests target. Expect a major/critical span on "can check in" or "If you have booked in advance". |
| p6_hotel | "only two guests" → "two guests, or three if one is a child" | **Likely caught**: added content with no counterpart in the source. Expect a span on "or three if one is a child". |

**Correct versions.** Expect a few minor (maybe major) false positives on loose but acceptable renderings,
e.g. "capsule" for 알 (a pill), "contact your doctor" for 병원에 연락 ("contact the hospital/clinic"), "lounge"
for 거실 ("living room"), "first-floor restaurant". These appear identically in both versions, so they
can make a flawed version look no worse than its correct one on the overall score. The mean overall score
will likely differ between versions by only a few points; the spans carry the signal. Whether that is enough
for participants is part of what the study measures.

## References

- Guerreiro, N. M., Rei, R., van Stigt, D., Coheur, L., Colombo, P., & Martins, A. F. T. (2024). xCOMET:
  Transparent machine translation evaluation through fine-grained error detection. *Transactions of the
  Association for Computational Linguistics, 12*, 979–995. https://doi.org/10.1162/tacl_a_00683
  (arXiv:2310.10482)
- Kocmi, T., Zouhar, V., Avramidis, E., Grundkiewicz, R., Karpinska, M., Popović, M., Sachan, M., &
  Shmatova, M. (2024). Error span annotation: A balanced approach for human evaluation of machine
  translation. In *Proceedings of the Ninth Conference on Machine Translation (WMT)*, 1440–1453.
  https://aclanthology.org/2024.wmt-1.131 (arXiv:2406.11580)
- Zouhar, V., Kocmi, T., & Sachan, M. (2025). AI-assisted human evaluation of machine translation.
  *NAACL 2025*. arXiv:2406.12419 (ESA^AI: ESA with spans pre-filled by automatic QE)
- Kocmi, T., & Federmann, C. (2023). GEMBA-MQM: Detecting translation quality error spans with GPT-4.
  In *Proceedings of the Eighth Conference on Machine Translation (WMT)*.
- Rei, R., et al. (2022). CometKiwi: IST-Unbabel 2022 submission for the quality estimation shared task.
  *WMT 2022*. Rei, R., et al. (2023). Scaling up CometKiwi: Unbabel-IST 2023 submission for the quality
  estimation shared task. *WMT 2023*.
- Juraska, J., et al. (2024). MetricX-24: The Google submission to the WMT 2024 metrics shared task. *WMT 2024*.
- Larionov, D., et al. (2024). xCOMET-lite: Bridging the gap between efficiency and quality in learned MT
  evaluation metrics. *Findings of EMNLP 2024*.
- Model card: https://huggingface.co/Unbabel/XCOMET-XL · Code: https://github.com/Unbabel/COMET
