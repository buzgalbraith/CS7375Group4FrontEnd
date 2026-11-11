"""Error span annotation (ESA-style) explanations with xCOMET in reference-free (QE) mode.

Reads notices.json, scores every (Korean source, English translation) pair with xCOMET, and writes
  output.json      per notice -> per version -> {score 0-100, spans [{text, occurrence?, score, severity, note}]}
  output_raw.json  everything the model returned, per segment (offsets, severities, confidences, scores)

See METHOD.md for the choices made here.

  python generate.py --dry-run                 # show the segments, no model
  python generate.py --stub                    # run the whole pipeline with a fake model (writes *.stub.json)
  python generate.py --device cuda             # the real run (needs access to the gated model on Hugging Face)
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_NOTICES = HERE.parents[1] / "app" / "translation-experiment-data" / "notices.json"
DEFAULT_MODEL = "Unbabel/XCOMET-XL"
VERSIONS = ("correct", "flawed")

# xCOMET severity -> span score in the app's 0-1 scale (< 0.4 "likely error", < 0.7 "uncertain").
SEVERITY_SCORE = {"critical": 0.1, "major": 0.25, "minor": 0.55}
SEVERITY_NOTE = {
    "critical": "Possible critical error",
    "major": "Possible major error",
    "minor": "Possible minor error",
}

# XLM-R positions; COMET cuts the concatenated [mt, src] input to this many tokens.
MAX_TOKENS = 512
SPECIAL_TOKENS = 4  # <s> mt </s></s> src </s>

# English: split after . ! ? only when the next sentence starts with a capital, so "4 p.m. to" stays whole.
EN_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"“(])")
KO_SENT = re.compile(r"(?<=[.!?])\s+")
PARAGRAPH = re.compile(r"\n\s*\n")


# ---------- segmentation ----------

def split_with_offsets(text, pattern, base=0):
    """Split text on a regex, returning (piece, start) with start offsets relative to base."""
    out, pos = [], 0
    for m in pattern.finditer(text):
        out.append((text[pos:m.start()], base + pos))
        pos = m.end()
    out.append((text[pos:], base + pos))
    return [(p, s) for p, s in out if p.strip()]


def build_segments(korean, english, mode):
    """Pair source and translation segments. Returns a list of dicts with mt offsets into `english`.

    mode: "sentence" (default), "paragraph" or "document". In sentence mode a paragraph whose Korean and
    English sentence counts differ is kept whole (marked fallback) rather than guessing an alignment.
    """
    if mode == "document":
        return [dict(paragraph=0, src=korean, mt=english, mt_start=0, fallback=False)]
    ko_pars = split_with_offsets(korean, PARAGRAPH)
    en_pars = split_with_offsets(english, PARAGRAPH)
    if len(ko_pars) != len(en_pars):
        print(f"  paragraph counts differ ({len(ko_pars)} vs {len(en_pars)}); using whole document",
              file=sys.stderr)
        return [dict(paragraph=0, src=korean, mt=english, mt_start=0, fallback=True)]
    segs = []
    for p, ((ko, _), (en, en_start)) in enumerate(zip(ko_pars, en_pars)):
        if mode == "paragraph":
            segs.append(dict(paragraph=p, src=ko, mt=en, mt_start=en_start, fallback=False))
            continue
        ko_s = split_with_offsets(ko, KO_SENT)
        en_s = split_with_offsets(en, EN_SENT, en_start)
        if len(ko_s) == len(en_s):
            for (k, _), (e, s) in zip(ko_s, en_s):
                segs.append(dict(paragraph=p, src=k, mt=e, mt_start=s, fallback=False))
        else:
            print(f"  paragraph {p}: {len(ko_s)} Korean vs {len(en_s)} English sentences; kept whole",
                  file=sys.stderr)
            segs.append(dict(paragraph=p, src=ko, mt=en, mt_start=en_start, fallback=True))
    for s in segs:
        s["mt_end"] = s["mt_start"] + len(s["mt"])
        assert english[s["mt_start"]:s["mt_end"]] == s["mt"], "segment offsets are wrong"
    return segs


# ---------- model ----------

def pick_device(requested):
    if requested != "auto":
        return requested
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class XComet:
    def __init__(self, model_id, device, batch_size):
        from comet import download_model, load_from_checkpoint
        self.model = load_from_checkpoint(download_model(model_id))
        self.model.eval()
        self.device = device
        self.batch_size = batch_size

    def n_tokens(self, src, mt):
        tok = self.model.encoder.tokenizer
        return len(tok(mt)["input_ids"]) + len(tok(src)["input_ids"])

    def predict(self, segments):
        data = [{"src": s["src"], "mt": s["mt"]} for s in segments]  # no "ref": QE mode
        kw = dict(batch_size=self.batch_size, progress_bar=True)
        if self.device == "cpu":
            kw["gpus"] = 0
        else:
            kw.update(gpus=1, accelerator="gpu" if self.device == "cuda" else self.device)
        out = self.model.predict(data, **kw)
        meta = out.metadata
        return [
            dict(score=float(out.scores[i]),
                 src_score=float(meta.src_scores[i]),
                 mqm_score=float(meta.mqm_scores[i]),
                 error_spans=list(meta.error_spans[i]))
            for i in range(len(data))
        ]


class StubModel:
    """Fake xCOMET for testing the parsing: flags numbers and negations, with a leading space and
    subword-style offsets like the real model can produce."""

    FLAG = re.compile(r"\s?(\b\d+\b|\bnot\b|\bwithout\b|\bonly\b|\bchild\b)")

    def n_tokens(self, src, mt):
        return len(src) + len(mt.split())  # rough; Korean chars count high on purpose

    def predict(self, segments):
        res = []
        for s in segments:
            spans = []
            for i, m in enumerate(self.FLAG.finditer(s["mt"])):
                sev = ("minor", "major", "critical")[i % 3]
                spans.append(dict(text=m.group(0), confidence=0.5 + 0.1 * (i % 4), severity=sev,
                                  start=m.start(), end=m.end()))
            e = sum({"minor": 1, "major": 5, "critical": 10}[x["severity"]] for x in spans)
            mqm = max(0.0, (25 - e) / 25)
            res.append(dict(score=0.78 * 0.9 + 0.22 * mqm, src_score=0.9, mqm_score=mqm, error_spans=spans))
        return res


# ---------- spans ----------

def occurrences(haystack, needle):
    """Start offsets of needle, overlapping, like the app's indexOf loop."""
    hits, i = [], haystack.find(needle)
    while i != -1:
        hits.append(i)
        i = haystack.find(needle, i + 1)
    return hits


def map_span(span, seg, english):
    """Turn a model span (offsets into the segment) into an app span (exact substring of the translation)."""
    start, end = int(span["start"]), int(span["end"])
    piece = seg["mt"][start:end]
    # trim whitespace the tokenizer offsets may include
    start += len(piece) - len(piece.lstrip())
    end -= len(piece) - len(piece.rstrip())
    if end <= start:
        return None
    ds, de = seg["mt_start"] + start, seg["mt_start"] + end
    text = english[ds:de]
    sev = span["severity"]
    out = {"text": text}
    hits = occurrences(english, text)
    if len(hits) > 1:
        out["occurrence"] = hits.index(ds) + 1
    out.update(score=SEVERITY_SCORE[sev], severity=sev, confidence=round(float(span["confidence"]), 4),
               note=SEVERITY_NOTE[sev])
    return out, dict(doc_start=ds, doc_end=de,
                     model_text_matches=str(span.get("text", "")).strip() == text)


def doc_score(seg_results, segments, how):
    if how == "min":
        return min(r["score"] for r in seg_results)
    w = [len(s["mt"]) for s in segments]
    return sum(r["score"] * x for r, x in zip(seg_results, w)) / sum(w)


# ---------- check ----------

def check_output(out, notices):
    """Every span must be an exact substring of its translation, with occurrence set iff it repeats."""
    errors = []
    by_id = {d["id"]: d for d in notices["documents"]}
    for nid, versions in out["notices"].items():
        for v, qe in versions.items():
            text = by_id[nid]["english"][v]
            if not 0 <= qe["score"] <= 100:
                errors.append(f"{nid}/{v}: score {qe['score']} out of range")
            for s in qe["spans"]:
                hits = occurrences(text, s["text"])
                occ = s.get("occurrence")
                if not hits:
                    errors.append(f"{nid}/{v}: not a substring: {s['text']!r}")
                elif len(hits) > 1 and occ is None:
                    errors.append(f"{nid}/{v}: repeats {len(hits)}x, needs occurrence: {s['text']!r}")
                elif occ is not None and not 1 <= occ <= len(hits):
                    errors.append(f"{nid}/{v}: occurrence {occ} out of range: {s['text']!r}")
                if not 0 <= s["score"] <= 1:
                    errors.append(f"{nid}/{v}: span score out of range: {s['text']!r}")
    return errors


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--notices", type=Path, default=DEFAULT_NOTICES)
    ap.add_argument("--output", type=Path, default=None, help="default: output.json next to this script")
    ap.add_argument("--raw-output", type=Path, default=None, help="default: output_raw.json")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="e.g. Unbabel/XCOMET-XL or Unbabel/XCOMET-XXL")
    ap.add_argument("--segment", choices=["sentence", "paragraph", "document"], default="sentence")
    ap.add_argument("--doc-score", choices=["mean", "min"], default="mean",
                    help="combine segment scores: length-weighted mean (default) or the lowest")
    ap.add_argument("--device", choices=["auto", "cuda", "mps", "cpu"], default="auto")
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--limit", type=int, default=None, help="only the first N (notice, version) pairs")
    ap.add_argument("--dry-run", action="store_true", help="print the segments and exit; no model")
    ap.add_argument("--stub", action="store_true", help="fake model, to test the pipeline; writes *.stub.json")
    args = ap.parse_args()

    suffix = ".stub.json" if args.stub else ".json"
    out_path = args.output or HERE / f"output{suffix}"
    raw_path = args.raw_output or HERE / f"output_raw{suffix}"

    notices = json.loads(args.notices.read_text(encoding="utf-8"))
    pairs = [(d, v) for d in notices["documents"] for v in VERSIONS]
    if args.limit is not None:
        pairs = pairs[:args.limit]

    jobs = []  # (doc, version, segments)
    for d, v in pairs:
        segs = build_segments(d["korean"], d["english"][v], args.segment)
        jobs.append((d, v, segs))

    if args.dry_run:
        for d, v, segs in jobs:
            print(f"== {d['id']} / {v}: {len(segs)} segments")
            for i, s in enumerate(segs):
                flag = " (fallback)" if s["fallback"] else ""
                print(f"  [{i}] p{s['paragraph']} mt[{s['mt_start']}:{s['mt_end']}]{flag}")
                print(f"      ko: {s['src']}")
                print(f"      en: {s['mt']}")
        return

    if args.stub:
        model, device = StubModel(), "none"
    else:
        device = pick_device(args.device)
        print(f"loading {args.model} on {device}", file=sys.stderr)
        model = XComet(args.model, device, args.batch_size)

    flat = [s for _, _, segs in jobs for s in segs]
    for s in flat:
        s["n_tokens"] = model.n_tokens(s["src"], s["mt"])
        if not args.stub and s["n_tokens"] > MAX_TOKENS - SPECIAL_TOKENS:
            print(f"  warning: segment has {s['n_tokens']} tokens; COMET will truncate the source",
                  file=sys.stderr)
    results = model.predict(flat)

    meta = dict(
        method="xCOMET error span detection, reference-free (QE) mode; see explanations/esa/METHOD.md",
        model=args.model if not args.stub else "STUB (fake output for testing, not model output)",
        segment=args.segment, doc_score=args.doc_score, severity_score=SEVERITY_SCORE,
        notices=str(args.notices), generated=dt.datetime.now().isoformat(timespec="seconds"),
    )
    if not args.stub:
        import comet
        meta.update(device=device, comet_version=getattr(comet, "__version__", "unknown"))
    out = {"meta": meta, "notices": {}}
    raw = {"meta": meta, "segments": []}

    k = 0
    for d, v, segs in jobs:
        english = d["english"][v]
        seg_results = results[k:k + len(segs)]
        k += len(segs)
        spans = []
        for i, (s, r) in enumerate(zip(segs, seg_results)):
            mapped = []
            for sp in r["error_spans"]:
                m = map_span(sp, s, english)
                if m is None:
                    continue
                spans.append(m[0])
                mapped.append({**m[0], **m[1]})
            raw["segments"].append(dict(
                notice=d["id"], version=v, index=i, **s,
                score=r["score"], src_score=r["src_score"], mqm_score=r["mqm_score"],
                error_spans=[{k2: (float(x) if hasattr(x, "item") else x) for k2, x in sp.items()}
                             for sp in r["error_spans"]],
                mapped_spans=mapped,
            ))
        score = doc_score(seg_results, segs, args.doc_score)
        out["notices"].setdefault(d["id"], {})[v] = dict(
            score=round(100 * score),
            spans=spans,
        )
        raw.setdefault("documents", []).append(dict(
            notice=d["id"], version=v, score_mean=doc_score(seg_results, segs, "mean"),
            score_min=doc_score(seg_results, segs, "min"), n_segments=len(segs),
        ))

    errors = check_output(out, notices)
    raw_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    if errors:
        print("span check FAILED:\n  " + "\n  ".join(errors), file=sys.stderr)
        print(f"raw output kept in {raw_path}", file=sys.stderr)
        sys.exit(1)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    n_spans = sum(len(x["spans"]) for vs in out["notices"].values() for x in vs.values())
    print(f"span check passed ({n_spans} spans). wrote {out_path} and {raw_path}", file=sys.stderr)
    for nid, vs in out["notices"].items():
        for v, x in vs.items():
            print(f"  {nid:9} {v:8} {x['score']:3d}  " + " | ".join(
                f"{s['severity']}: {s['text']}" for s in x["spans"]), file=sys.stderr)


if __name__ == "__main__":
    main()
