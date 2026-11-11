# Log-probability heatmap

The English translation is shaded word by word by how likely a translation model finds it, given the Korean
source: the less likely, the redder. Nothing is generated. We force the existing translation (correct or
flawed) through the model and read off its probabilities ("forced decoding" or teacher forcing).

```
explanations/logprob_heatmap/
├── METHOD.md          this file
├── generate.py        scores all 8 (notice, version) pairs → output.json
├── preview.py         output.json → preview.html, a static heatmap for eyeballing
└── requirements.txt   pinned versions (torch, transformers)
```

**Status:** run on 2026-11-11 (Apple M4 Pro, `--device mps`, bfloat16): `output.json` and `preview.html`.
The source-contrast variant (below) was added the same day, after the first run showed wording-choice noise but
before it was run, without looking at which words are the planted errors.

## Running

On a GPU machine, in a virtualenv:

```bash
pip install -r requirements.txt
python generate.py                         # all 8 pairs → output.json (default model, cuda, bfloat16)
python generate.py --limit 1               # first notice only
python generate.py --conditioning paragraph
python generate.py --no-contrast              # skip the source-free pass
python generate.py --model google/gemma-4-E4B-it --device mps
python preview.py                          # output.json → preview.html
```

`python generate.py --dry-run` needs no model or packages: it uses a stub tokenizer and fake numbers and
writes `output.dry-run.json`, to test the offset and aggregation code. Every run checks that each token and
word is an exact substring at its offsets, that the tokens cover every non-whitespace character, and that each
word's `occurrence` resolves to its position under the app's phrase rule. It stops on the first failure.

## Model

**`google/gemma-4-12B-it`** (Gemma 4 "12B Unified", dense, 11.95B parameters, Apache 2.0).

- It's the Gemma 4 size closest to "~8B" with full dense capacity. The smaller E4B is 8B parameters
  including embeddings but 4.5B effective, and Korean→English quality matters here: if the model can't
  translate the notice, its probabilities say little about errors.
- Gemma 4 is current (2026), instruction-tuned, multilingual (pre-trained on 140+ languages), and Apache
  2.0, so the weights shouldn't need a gated access request (unlike Gemma 2/3).
- bfloat16 weights are about 24 GB: fine on one 40–80 GB GPU. `--model google/gemma-4-E4B-it` is the
  fallback for a smaller GPU or a Mac (`--device mps`).

The model card loads it with `AutoModelForMultimodalLM`; the script tries that, then `AutoModelForCausalLM`.

## Prompt

The chat template with one user turn and the translation as the model's reply:

```
user:  Translate the following Korean notice into English. Reply with the translation only.

       <Korean notice>
model: <English translation>          ← only these tokens are scored
```

- No system prompt and thinking off (`enable_thinking=False`). With thinking off, the Gemma 4 template ends
  the generation prompt with an empty thought channel (`<|channel>thought\n<channel|>`), so the scored reply
  follows exactly what the model sees before answering directly. The script warns if the rendered prompt
  doesn't end that way, and stores the last rendered prompt in `output.json` (`settings.rendered_prompt_example`).
- The prompt (up to the reply) and the translation are tokenized separately and concatenated, as in
  generation. The end-of-turn token isn't scored.

**Whole document by default.** Each notice has two paragraphs in Korean and two in each English version,
and they align one to one (checked for all 4 notices). Conditioning on the whole notice gives the model the
context a human translator has (e.g. "the full period" refers back to "two weeks"). `--conditioning paragraph`
scores each English paragraph against its Korean paragraph only. It's a useful robustness check: if the
flagged words change a lot between the two, the signal is fragile.

## What's stored

`output.json` → `notices.<id>.<version>`:

| Field | Contents |
|---|---|
| `model`, `text` | model id; the English text that was scored (= `english.<version>`) |
| `summary` | `n_tokens`, `mean_logprob`, `perplexity`, `mean_entropy` for the whole translation |
| `tokens[]` | `text` (= `text[start:end]`, may include a leading space), `piece`, `id`, `start`, `end`, `logprob`, `entropy`, `rank` of the actual token, `top_alternatives` (top 5: `piece`, `logprob`) |
| `words[]` | `text`, `occurrence` (only if the phrase repeats), `start`, `end`, `logprob`, `mean_logprob`, `sum_logprob`, `max_entropy`, `confidence`, `confidence_rank`, `tokens` (indices), `preferred` (only if the weakest token wasn't the model's first choice) |
| `error_span` | the documented `correct_span` / `flawed_span`: min and mean word confidence, weakest word and its rank in the document |
| `changed_words` | same, for the words that differ between the two versions (by a word diff); `null` if this version has none (an omission) |
| contrast fields | per token `logprob_nosrc`, `pmi`; per word `pmi`, `confidence_contrast`; in `error_span` / `changed_words`, `min_confidence_contrast` and `weakest_word_contrast`. Absent with `--no-contrast`. |

Logs are natural logs; entropy is in nats. Offsets are character offsets into `english.<version>` in
notices.json.

## From tokens to words

**Words are whitespace-delimited** (`\S+`), the same units the app highlights (`tokenize` in
`app/src/data/buildStimuli.ts`). A word's `text` is copied exactly, punctuation included ("week."), and
`occurrence` follows the app's rule (every `indexOf` hit counts, so "it" also matches inside "with"). These
can go straight into a phrase-based format like `qe.spans`.

**A word's score is the minimum log-probability of its tokens** (the weakest link). One unlikely subword
is enough to make the word suspicious; the mean dilutes it with predictable continuation pieces ("amox|ic|illin":
once the first piece is chosen, the rest are near-certain), and the sum penalizes long words. Mean and sum are
stored too. Punctuation at the edges of a word is ignored when picking its tokens, so "week." is scored by
"week", not by the period.

**Confidence = exp(min logprob)**, the probability of the word's weakest token, in 0–1. We keep the absolute
probability rather than a rank within the document as the default, because a rank always paints the same
share of words red, so a correct translation would look as alarming as a flawed one. The rank
(`confidence_rank`, 0 = least confident word in that translation) is stored as an alternative. `preview.py`
can switch between the two.

**Colour and bins** are a frontend decision, to make after seeing real numbers. Starting points:

- continuous: red with opacity `1 − confidence`
- three bins like the quality estimate: < 0.1 red, 0.1–0.5 light red, ≥ 0.5 none. Instruction-tuned
  models put most tokens near p = 1, so useful cut-offs are probably lower than the QE thresholds (0.4 / 0.7).

The `preferred` alternative ("the model expected *two* here") could be shown on hover.

## Source-contrast variant

The first run showed the main pitfall below in practice: 11–18% of the words in every translation, correct or
flawed, had p < 0.1, mostly where the model would have phrased it differently ("capsule" vs "tablet", "right
away" vs "immediately"). Those words are unlikely whether or not the model has seen the Korean. A real
mistranslation is different: it's fluent English, so it's plausible without the source, and unlikely only
because the source says something else.

So each translation is scored a second time with the same chat format but no source:

```
user:  Write a notice in English. Reply with the notice only.        (paragraph mode: "Write one paragraph …")
model: <English translation>          ← same tokens, scored again
```

and for each token

```
pmi = log p(token | Korean, previous English) − log p(token | no source, previous English)
```

the pointwise mutual information between the token and the source: how much the Korean raises (> 0) or
lowers (< 0) the token's probability. This is the token-level form of conditional cross-mutual information,
used to measure how much an MT model relies on its source or context (Fernandes et al., 2021) and to detect
hallucinations from a model's own internals (Xu et al., 2023).

A word's **`confidence_contrast` = exp(min(0, min pmi over its tokens))**, i.e. min(1, p_with / p_without) for
its weakest token by this measure. It's 1 wherever the source makes the word at least as likely as plain English
does, and red only where the source makes it less likely. Edge punctuation is ignored as for `confidence`.

Decided before running it and not tuned afterwards: the source-free prompts, the min over tokens, and the cap
at 0. The plain `confidence` stays in the output as the first variant; both are reported. With 4 notices,
anything adjusted after seeing which words are flagged would look better and mean nothing.

What it can't fix: where the model itself misreads the source (p2_med, 이 주 read as "this week"), the source
really does make the correct word unlikely, so contrast keeps it red. Omissions still have no tokens.

## Pitfalls

Low probability doesn't mean wrong. Known reasons for low probability that have nothing to do with errors:

- **Wording choice.** We score someone else's translation. Where the model would have phrased it
  differently ("capsule" vs "tablet", "Even if" vs "Although"), the word gets low probability even though it's
  right. This is the main source of red in a correct translation.
- **Paragraph and sentence starts** have many plausible continuations (high entropy).
- **Names and numbers.** Transliterated names (Haesol, Solbaram, Noeulbit) and numbers can be uncertain even
  when right. The Korean writes numbers in Hangul on purpose (이 주 is "two weeks" or "this week").
- **Omissions leave nothing to colour.** In p4_med's flawed version the dropped "or cold medicines" has no
  tokens; at best the next word ("with") is unlikely because the model expected "or" or a comma. The stored
  `preferred` alternative is the only trace.
- **Calibration.** Probabilities from instruction-tuned models are poorly calibrated (overconfident), so
  0.3 doesn't mean "30% chance of an error". Treat them as a ranking signal.
- **Model-specific.** Another model, prompt, or paragraph vs document conditioning will move the numbers; the
  heatmap explains this model's surprise, not the translation's correctness.

## What we expect to see

For each notice, compare the error region's confidence in the flawed version with the same region in the
correct version (`error_span` and `changed_words`, printed as a table at the end of each run):

| Notice | Error | Expected |
|---|---|---|
| p2_med | "two weeks" → "one week" | "one" lower than "two". Less sure for "two" than usual: 이 주 is ambiguous. |
| p4_med | "or cold medicines" dropped | Weak: only "with" after "pills" can drop. |
| p3_hotel | "Even if … cannot" → "If … can" | "can" lower than "cannot", since the source has a negative. |
| p6_hotel | "only two guests" → "two guests, or three if one is a child" | The added clause clearly low: there's nothing in the source to predict it. |

If the flawed spans aren't among the least confident words of their translation, the heatmap won't help
participants catch the error, which is itself a result worth reporting. Prior work found exactly that for code
(below).

## Background

- Using an MT model's own probabilities as a quality signal is "glass-box" (unsupervised) quality estimation.
  Fomicheva et al. (2020) showed that sequence-level log-probability, entropy and their variance under dropout
  correlate with human judgments, competitively with supervised QE for some language pairs. We use the
  simplest of their features (token log-probability, entropy) at the word level, without dropout.
- The Eval4NLP 2021 shared task on explainable QE (Fomicheva et al., 2021) scored word-level error highlights
  against human error annotations; it's the closest evaluation of "which words are wrong" from a model's
  internals.
- Guerreiro et al. (2023) found sequence log-probability is a strong detector of hallucinated (added) content
  in NMT, which matches the expectation for p6_hotel.
- Vasconcelos et al. (2025) highlighted low-probability tokens in AI code completions and found no benefit over
  no highlights. Highlighting what a model predicted people would edit helped more. Their participants wanted
  to know why a token was flagged; the `preferred` alternative is one answer.
- In MT for medical instructions, Mehandru et al. (2023) found a quality-estimate display helped physicians
  rely on translations appropriately, while backtranslation helped them find critical errors; Zouhar et al.
  (2021) found backtranslation feedback raised users' confidence without improving the translations.
- Kim et al. (2024) found that LLMs expressing uncertainty ("I'm not sure") lowered over-reliance, which
  supports showing uncertainty at all, if it's informative.

## References

- Fernandes, P., Yin, K., Neubig, G., & Martins, A. F. T. (2021). Measuring and Increasing Context Usage in
  Context-Aware Machine Translation. *Proceedings of ACL-IJCNLP 2021*, 6467–6478.
  https://aclanthology.org/2021.acl-long.505/
- Xu, W., Agrawal, S., Briakou, E., Martindale, M. J., & Carpuat, M. (2023). Understanding and Detecting
  Hallucinations in Neural Machine Translation via Model Introspection. *Transactions of the ACL*, 11, 546–564.
  https://aclanthology.org/2023.tacl-1.32/

- Fomicheva, M., Sun, S., Yankovskaya, L., Blain, F., Guzmán, F., Fishel, M., Aletras, N., Chaudhary, V., &
  Specia, L. (2020). Unsupervised Quality Estimation for Neural Machine Translation. *Transactions of the ACL*,
  8, 539–555. https://doi.org/10.1162/tacl_a_00330
- Fomicheva, M., Lertvittayakumjorn, P., Zhao, W., Eger, S., & Gao, Y. (2021). The Eval4NLP Shared Task on
  Explainable Quality Estimation: Overview and Results. *Proc. 2nd Workshop on Evaluation and Comparison of
  NLP Systems (Eval4NLP)*. https://aclanthology.org/2021.eval4nlp-1.17/
- Guerreiro, N. M., Voita, E., & Martins, A. F. T. (2023). Looking for a Needle in a Haystack: A Comprehensive
  Study of Hallucinations in Neural Machine Translation. *Proc. EACL 2023*.
  https://aclanthology.org/2023.eacl-main.75/
- Vasconcelos, H., Bansal, G., Fourney, A., Liao, Q. V., & Vaughan, J. W. (2025). Generation Probabilities Are
  Not Enough: Uncertainty Highlighting in AI Code Completions. *ACM Transactions on Computer-Human
  Interaction*, 32(1). https://doi.org/10.1145/3702320
- Mehandru, N., Agrawal, S., Xiao, Y., Gao, G., Khoong, E., Carpuat, M., & Salehi, N. (2023). Physician
  Detection of Clinical Harm in Machine Translation: Quality Estimation Aids in Reliance and Backtranslation
  Identifies Critical Errors. *Proc. EMNLP 2023*. https://aclanthology.org/2023.emnlp-main.712/
- Zouhar, V., Novák, M., Žilinec, M., Bojar, O., Obregón, M., Hill, R. L., Blain, F., Fomicheva, M., Specia, L.,
  & Yankovskaya, L. (2021).
  Backtranslation Feedback Improves User Confidence in MT, Not Quality. *Proc. NAACL 2021*.
  https://aclanthology.org/2021.naacl-main.14/
- Kim, S. S. Y., Liao, Q. V., Vorvoreanu, M., Ballard, S., & Vaughan, J. W. (2024). "I'm Not Sure, But…":
  Examining the Impact of Large Language Models' Uncertainty Expression on User Reliance and Trust.
  *Proc. FAccT 2024*. https://doi.org/10.1145/3630106.3658941
- Google (2026). Gemma 4 model card. https://ai.google.dev/gemma/docs/core/model_card_4
