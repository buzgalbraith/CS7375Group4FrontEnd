"""Log-probability heatmap: score the fixed English translations with forced decoding.

For each notice and version (correct / flawed), the Korean source goes in the user turn of a chat
prompt and the existing English translation is forced as the model's reply. We record, for every
English token, log p(token | source, previous tokens), the entropy of the model's next-token
distribution, its rank and the top-k alternatives, then aggregate tokens to whitespace-delimited
words (the units the app highlights). See METHOD.md.

    python generate.py                       # all 8 pairs, writes output.json
    python generate.py --dry-run             # no model: stub tokenizer + fake numbers, writes output.dry-run.json
    python generate.py --limit 1 --device mps
"""

from __future__ import annotations

import argparse
import datetime as dt
import difflib
import hashlib
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_NOTICES = HERE.parent.parent / "app" / "translation-experiment-data" / "notices.json"
DEFAULT_MODEL = "google/gemma-4-12B-it"
VERSIONS = ("correct", "flawed")

PROMPT_DOCUMENT = (
    "Translate the following Korean notice into English. Reply with the translation only.\n\n{korean}"
)
PROMPT_PARAGRAPH = (
    "Translate the following paragraph of a Korean notice into English. "
    "Reply with the translation only.\n\n{korean}"
)
# Source-free prompts for the contrast pass: the same chat format and register, without the Korean.
# log p(token | source) - log p(token | these) is how much the source itself raises or lowers a token.
PROMPT_NOSRC_DOCUMENT = "Write a notice in English. Reply with the notice only."
PROMPT_NOSRC_PARAGRAPH = "Write one paragraph of a notice in English. Reply with the paragraph only."

# Characters stripped from the edges of a word before choosing the tokens that score it, so that
# "week." is scored by "week", not by the period. The word itself keeps its punctuation, because
# the app highlights whole whitespace-delimited words.
EDGE_PUNCT = "\"'“”‘’()[]{}.,;:!?…-–—·"


# ---------- Scorers ----------


class ModelScorer:
    """Forced decoding with a Hugging Face chat model."""

    def __init__(self, model_id: str, device: str, dtype: str, top_k: int):
        import torch
        import transformers
        from transformers import AutoTokenizer

        self.torch = torch
        self.top_k = top_k
        self.model_id = model_id
        self.transformers_version = transformers.__version__
        self.torch_version = torch.__version__
        self.device = device
        torch_dtype = {
            "auto": torch.float32 if device == "cpu" else torch.bfloat16,
            "bfloat16": torch.bfloat16,
            "float16": torch.float16,
            "float32": torch.float32,
        }[dtype]
        self.dtype = str(torch_dtype).replace("torch.", "")

        self.tok = AutoTokenizer.from_pretrained(model_id)
        self.template_owner = self.tok
        if not getattr(self.tok, "chat_template", None):
            # Some multimodal repos keep the chat template on the processor only.
            from transformers import AutoProcessor

            self.template_owner = AutoProcessor.from_pretrained(model_id)
        self.last_prefix_text = None
        model = None
        errors = []
        # The Gemma 4 model card loads with AutoModelForMultimodalLM; fall back to the text-only class.
        for cls_name in ("AutoModelForMultimodalLM", "AutoModelForCausalLM"):
            cls = getattr(transformers, cls_name, None)
            if cls is None:
                continue
            try:
                model = cls.from_pretrained(model_id, dtype=torch_dtype)
                break
            except (ValueError, KeyError, TypeError) as e:
                errors.append(f"{cls_name}: {e}")
        if model is None:
            raise RuntimeError("could not load model:\n" + "\n".join(errors))
        self.model = model.to(device).eval()

    def prefix_ids(self, prompt: str) -> list[int]:
        messages = [{"role": "user", "content": prompt}]
        # enable_thinking=False makes the Gemma 4 template end the generation prompt with an empty
        # thought channel, which is what the model sees right before answering without thinking.
        text = self.template_owner.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        if "gemma-4" in self.model_id.lower() and not text.rstrip().endswith("<channel|>"):
            print("  warning: prompt does not end with the empty thought channel; check the template", file=sys.stderr)
        ids = self.tok(text, add_special_tokens=False)["input_ids"]
        bos = self.tok.bos_token_id
        if bos is not None and (not ids or ids[0] != bos):
            ids = [bos] + ids
        self.last_prefix_text = text
        return ids

    def score(self, prompt: str, target: str) -> list[dict]:
        torch = self.torch
        prefix = self.prefix_ids(prompt)
        enc = self.tok(target, add_special_tokens=False, return_offsets_mapping=True)
        ids, offsets = enc["input_ids"], enc["offset_mapping"]
        decoded = self.tok.decode(ids)
        if decoded != target:
            print(f"  warning: tokenizer round trip differs from the text:\n    {decoded!r}", file=sys.stderr)

        input_ids = torch.tensor([prefix + ids], device=self.device)
        with torch.no_grad():
            logits = self.model(input_ids=input_ids).logits[0]
        # The logits at position i predict token i + 1.
        pred = logits[len(prefix) - 1 : len(prefix) + len(ids) - 1].float()
        logp = torch.log_softmax(pred, dim=-1)
        entropy = -(logp.exp() * logp).sum(-1)
        target_ids = torch.tensor(ids, device=logp.device)
        token_lp = logp.gather(1, target_ids[:, None])[:, 0]
        rank = (logp > token_lp[:, None]).sum(-1) + 1
        top_lp, top_ids = logp.topk(self.top_k, dim=-1)

        out = []
        for i, tid in enumerate(ids):
            start, end = offsets[i]
            out.append(
                {
                    "id": tid,
                    "piece": self.tok.decode([tid]),
                    "start": int(start),
                    "end": int(end),
                    "logprob": float(token_lp[i]),
                    "entropy": float(entropy[i]),
                    "rank": int(rank[i]),
                    "top_alternatives": [
                        {"id": int(a), "piece": self.tok.decode([int(a)]), "logprob": float(lp)}
                        for a, lp in zip(top_ids[i].tolist(), top_lp[i].tolist())
                    ],
                }
            )
        return out


class StubScorer:
    """No model: a SentencePiece-like regex tokenizer and deterministic fake numbers. For testing the
    offset, aggregation and output code only; the numbers mean nothing."""

    model_id = "stub (dry run, fake numbers)"
    transformers_version = None
    torch_version = None
    dtype = None
    device = None

    def __init__(self, top_k: int):
        self.top_k = top_k

    def score(self, prompt: str, target: str) -> list[dict]:
        out = []
        # Leading spaces are attached to the following token, as in SentencePiece offsets.
        for m in re.finditer(r"\s*(?:[A-Za-z]{1,4}|\d|[^\sA-Za-z\d])", target):
            piece = m.group(0)
            h = int(hashlib.md5((prompt[-40:] + piece + str(m.start())).encode()).hexdigest(), 16)
            lp = -((h % 1000) / 1000) ** 3 * 6
            alts = [{"id": -1, "piece": piece, "logprob": lp}]
            for k in range(1, self.top_k):
                alts.append({"id": -1 - k, "piece": f" alt{k}", "logprob": lp - k})
            alts.sort(key=lambda a: -a["logprob"])
            out.append(
                {
                    "id": -1,
                    "piece": piece,
                    "start": m.start(),
                    "end": m.end(),
                    "logprob": lp,
                    "entropy": ((h >> 10) % 1000) / 250,
                    "rank": 1,
                    "top_alternatives": alts,
                }
            )
        return out


# ---------- Segments, words, checks ----------


def paragraphs(text: str) -> list[tuple[int, int]]:
    """(start, end) of each paragraph; paragraphs are separated by a blank line."""
    spans, pos = [], 0
    for m in re.finditer(r"\n\s*\n", text):
        spans.append((pos, m.start()))
        pos = m.end()
    spans.append((pos, len(text)))
    return spans


def phrase_hits(text: str, phrase: str) -> list[int]:
    """Same rule as phraseToRange in app/src/data/buildStimuli.ts (overlapping indexOf hits)."""
    hits, i = [], text.find(phrase)
    while i != -1:
        hits.append(i)
        i = text.find(phrase, i + 1)
    return hits


def make_words(text: str, tokens: list[dict]) -> list[dict]:
    words = []
    for m in re.finditer(r"\S+", text):
        ws, we = m.start(), m.end()
        core = m.group(0).strip(EDGE_PUNCT)
        if core:
            cs = ws + m.group(0).index(core)
            ce = cs + len(core)
        else:  # a word that is only punctuation, e.g. "·"
            cs, ce = ws, we
        idx = [i for i, t in enumerate(tokens) if t["start"] < ce and t["end"] > cs]
        if not idx:
            raise AssertionError(f"no token covers word {m.group(0)!r} at {ws}")
        lps = [tokens[i]["logprob"] for i in idx]
        weakest = min(idx, key=lambda i: tokens[i]["logprob"])
        contrast = "pmi" in tokens[idx[0]]
        word = {"text": m.group(0)}
        hits = phrase_hits(text, word["text"])
        if len(hits) > 1:
            word["occurrence"] = hits.index(ws) + 1
        word.update(
            {
                "start": ws,
                "end": we,
                "logprob": min(lps),
                "mean_logprob": sum(lps) / len(lps),
                "sum_logprob": sum(lps),
                "max_entropy": max(tokens[i]["entropy"] for i in idx),
                "confidence": math.exp(min(lps)),
                "tokens": idx,
            }
        )
        if contrast:
            # Weakest link again, but by source contrast: red only where the Korean makes a token
            # less likely than plain English does. Positive contrast (source supports it) is capped at 1.
            pmi = min(tokens[i]["pmi"] for i in idx)
            word["pmi"] = pmi
            word["confidence_contrast"] = math.exp(min(0.0, pmi))
        top = tokens[weakest]["top_alternatives"][0]
        if tokens[weakest]["rank"] > 1:
            word["preferred"] = {"token": weakest, "piece": top["piece"], "logprob": top["logprob"]}
        words.append(word)

    # Rank-normalized confidence within this translation: 0 = least confident word, 1 = most.
    order = sorted(range(len(words)), key=lambda i: words[i]["logprob"])
    n = len(words)
    for r, i in enumerate(order):
        words[i]["confidence_rank"] = r / (n - 1) if n > 1 else 1.0
    return words


def check(text: str, tokens: list[dict], words: list[dict]) -> None:
    """Every token and word points at exact text, tokens are in order, and every non-whitespace
    character is covered by a token."""
    prev_end = 0
    covered = [False] * len(text)
    for i, t in enumerate(tokens):
        s, e = t["start"], t["end"]
        assert 0 <= s <= e <= len(text), f"token {i} offsets out of range: {s}-{e}"
        assert t["text"] == text[s:e], f"token {i} text mismatch"
        # Byte-fallback pieces of one character can share a span, so allow s < prev_end only then.
        assert s >= prev_end or (i > 0 and (s, e) == (tokens[i - 1]["start"], tokens[i - 1]["end"])), (
            f"token {i} overlaps the previous one: {s}-{e}"
        )
        assert text[prev_end:s].strip() == "", f"text before token {i} is not covered: {text[prev_end:s]!r}"
        for k in range(s, e):
            covered[k] = True
        prev_end = max(prev_end, e)
    assert text[prev_end:].strip() == "", f"text after the last token is not covered: {text[prev_end:]!r}"
    missing = [k for k, c in enumerate(covered) if not c and not text[k].isspace()]
    assert not missing, f"characters not covered by any token at {missing[:10]}"

    for w in words:
        s, e = w["start"], w["end"]
        assert text[s:e] == w["text"], f"word text mismatch at {s}"
        hits = phrase_hits(text, w["text"])
        assert hits[w.get("occurrence", 1) - 1] == s, f"occurrence of {w['text']!r} does not resolve to {s}"
        assert len(hits) == 1 or "occurrence" in w, f"{w['text']!r} repeats but has no occurrence"
    assert [w["text"] for w in words] == text.split(), "words do not match the whitespace split"


def span_summary(text: str, words: list[dict], phrase: str) -> dict | None:
    hits = phrase_hits(text, phrase)
    if not hits:
        return None
    s, e = hits[0], hits[0] + len(phrase)
    inside = [w for w in words if w["start"] < e and w["end"] > s]
    return summarize(phrase, s, e, inside, words)


def summarize(label: str, s: int, e: int, inside: list[dict], words: list[dict]) -> dict:
    weakest = min(inside, key=lambda w: w["logprob"])
    out = {
        "text": label,
        "start": s,
        "end": e,
        "min_confidence": weakest["confidence"],
        "mean_confidence": sum(w["confidence"] for w in inside) / len(inside),
        "weakest_word": weakest["text"],
        "weakest_word_rank_in_doc": sorted(w["logprob"] for w in words).index(weakest["logprob"]) + 1,
        "n_words_in_doc": len(words),
    }
    if "pmi" in inside[0]:
        w = min(inside, key=lambda w: w["pmi"])
        out["min_confidence_contrast"] = w["confidence_contrast"]
        out["weakest_word_contrast"] = w["text"]
    return out


def changed_words(a: str, b: str) -> tuple[list[int], list[int]]:
    """Indices of whitespace words that differ between the two versions (difflib on words)."""
    wa, wb = a.split(), b.split()
    ia, ib = [], []
    for tag, a0, a1, b0, b1 in difflib.SequenceMatcher(a=wa, b=wb, autojunk=False).get_opcodes():
        if tag != "equal":
            ia += range(a0, a1)
            ib += range(b0, b1)
    return ia, ib


# ---------- Main ----------


def score_version(
    scorer, korean: str, english: str, conditioning: str, contrast: bool
) -> tuple[list[dict], list[dict]]:
    if conditioning == "document":
        segments = [(korean, 0, len(english), PROMPT_DOCUMENT, PROMPT_NOSRC_DOCUMENT)]
    else:
        ko, en = paragraphs(korean), paragraphs(english)
        if len(ko) != len(en):
            raise ValueError(f"{len(ko)} Korean vs {len(en)} English paragraphs; use --conditioning document")
        segments = [
            (korean[ks:ke], es, ee, PROMPT_PARAGRAPH, PROMPT_NOSRC_PARAGRAPH) for (ks, ke), (es, ee) in zip(ko, en)
        ]

    tokens = []
    for src, es, ee, template, nosrc in segments:
        seg = scorer.score(template.format(korean=src), english[es:ee])
        if contrast:
            base = scorer.score(nosrc, english[es:ee])
            assert [(t["start"], t["end"]) for t in base] == [(t["start"], t["end"]) for t in seg], (
                "source-free pass tokenized the text differently"
            )
            for t, b in zip(seg, base):
                t["logprob_nosrc"] = b["logprob"]
                t["pmi"] = t["logprob"] - b["logprob"]
        for t in seg:
            t["start"] += es
            t["end"] += es
            tokens.append(t)
    for t in tokens:
        t["text"] = english[t["start"] : t["end"]]
    # Put the exact substring first in each record for readability.
    tokens = [{"text": t.pop("text"), **t} for t in tokens]
    words = make_words(english, tokens)
    check(english, tokens, words)
    return tokens, words


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("notices", nargs="?", default=str(DEFAULT_NOTICES), help="path to notices.json")
    ap.add_argument("--out", help="output path (default output.json, or output.dry-run.json with --dry-run)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"Hugging Face model id (default {DEFAULT_MODEL})")
    ap.add_argument("--device", default="cuda", choices=["cuda", "mps", "cpu"])
    ap.add_argument("--dtype", default="auto", choices=["auto", "bfloat16", "float16", "float32"],
                    help="auto = bfloat16 on cuda/mps, float32 on cpu")
    ap.add_argument("--conditioning", default="document", choices=["document", "paragraph"],
                    help="condition on the whole Korean notice, or on the aligned Korean paragraph")
    ap.add_argument("--no-contrast", action="store_true",
                    help="skip the source-free pass (no logprob_nosrc / pmi / confidence_contrast)")
    ap.add_argument("--top-k", type=int, default=5, help="alternatives stored per token")
    ap.add_argument("--limit", type=int, help="only the first N notices")
    ap.add_argument("--dry-run", action="store_true", help="no model; stub tokenizer and fake numbers")
    args = ap.parse_args()

    data = json.loads(Path(args.notices).read_text(encoding="utf-8"))
    docs = data["documents"][: args.limit]
    out_path = Path(args.out) if args.out else HERE / ("output.dry-run.json" if args.dry_run else "output.json")

    scorer = StubScorer(args.top_k) if args.dry_run else ModelScorer(args.model, args.device, args.dtype, args.top_k)

    result = {
        "about": "Forced-decoding log probabilities of the existing English translations given the Korean "
        "source. Made by explanations/logprob_heatmap/generate.py; see METHOD.md. Offsets are character "
        "offsets into english.<version> in notices.json; text is always text[start:end].",
        "model": scorer.model_id,
        "settings": {
            "conditioning": args.conditioning,
            "prompt": PROMPT_DOCUMENT if args.conditioning == "document" else PROMPT_PARAGRAPH,
            "top_k": args.top_k,
            "dtype": scorer.dtype,
            "device": scorer.device,
            "transformers": scorer.transformers_version,
            "torch": scorer.torch_version,
            "word_logprob": "min over the word's tokens (punctuation at the word's edges ignored)",
            "confidence": "exp(word logprob), i.e. the probability of the word's weakest token",
            "contrast": None if args.no_contrast else {
                "prompt_nosrc": PROMPT_NOSRC_DOCUMENT if args.conditioning == "document" else PROMPT_NOSRC_PARAGRAPH,
                "pmi": "token logprob given the source minus logprob given the source-free prompt",
                "confidence_contrast": "exp(min(0, min pmi over the word's tokens)); 1 = the source does not "
                "make the word less likely",
            },
            "logs": "natural log; entropy in nats",
        },
        "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "notices": {},
    }
    if args.dry_run:
        result["_dry_run"] = True

    for doc in docs:
        result["notices"][doc["id"]] = {}
        for version in VERSIONS:
            english = doc["english"][version]
            print(f"{doc['id']} {version}", file=sys.stderr)
            tokens, words = score_version(scorer, doc["korean"], english, args.conditioning, not args.no_contrast)
            lps = [t["logprob"] for t in tokens]
            entry = {
                "model": scorer.model_id,
                "text": english,
                "summary": {
                    "n_tokens": len(tokens),
                    "mean_logprob": sum(lps) / len(lps),
                    "perplexity": math.exp(-sum(lps) / len(lps)),
                    "mean_entropy": sum(t["entropy"] for t in tokens) / len(tokens),
                },
                "error_span": span_summary(english, words, doc["error"][f"{version}_span"]),
                "tokens": tokens,
                "words": words,
            }
            result["notices"][doc["id"]][version] = entry

        # Words that differ between the two versions, summarized in each.
        pair = result["notices"][doc["id"]]
        ia, ib = changed_words(doc["english"]["correct"], doc["english"]["flawed"])
        for version, idx in (("correct", ia), ("flawed", ib)):
            words = pair[version]["words"]
            if idx:
                inside = [words[i] for i in idx]
                s, e = inside[0]["start"], inside[-1]["end"]
                pair[version]["changed_words"] = summarize(
                    pair[version]["text"][s:e], s, e, inside, words
                )
            else:
                pair[version]["changed_words"] = None  # e.g. an omission: nothing left to score

    if getattr(scorer, "last_prefix_text", None):
        # The last rendered prompt (everything before the scored reply), for checking the template.
        result["settings"]["rendered_prompt_example"] = scorer.last_prefix_text
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out_path}", file=sys.stderr)

    nan = float("nan")
    print("\nnotice     version  error-span min conf  changed-words min conf  (contrast)  perplexity", file=sys.stderr)
    for nid, pair in result["notices"].items():
        for version, v in pair.items():
            es, cw = v["error_span"], v["changed_words"]
            cc = cw.get("min_confidence_contrast", nan) if cw else nan
            print(
                f"{nid:10} {version:8} {es['min_confidence'] if es else nan:>19.3f}"
                f"  {cw['min_confidence'] if cw else nan:>22.3f}  {cc:>10.3f}  {v['summary']['perplexity']:>10.2f}",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
