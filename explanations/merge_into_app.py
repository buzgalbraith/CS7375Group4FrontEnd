"""
Copy the generated explanations into the app's data file, app/translation-experiment-data/explanations.json:

    esa/output.json             -> explanations.<id>.<version>.qe        (Quality estimate)
    logprob_heatmap/output.json -> explanations.<id>.<version>.heatmap   (shown as "Confidence estimation")

Only those two fields are replaced; everything else in explanations.json (e.g. the rationales written by
rationale-generation/) is kept. Re-run after regenerating either output. Then run `npm run check-data` in app/.

    python3 merge_into_app.py                  # heatmap uses source-contrast scores (default)
    python3 merge_into_app.py --heatmap-score confidence   # plain p(word | Korean) instead

Standard library only.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ESA = HERE / "esa" / "output.json"
HEATMAP = HERE / "logprob_heatmap" / "output.json"
APP_EXPLANATIONS = HERE.parent / "app" / "translation-experiment-data" / "explanations.json"
VERSIONS = ("correct", "flawed")


def qe_from_esa(entry: dict) -> dict:
    """ESA output is already the app's qe shape; drop the fields the app doesn't use."""
    spans = []
    for s in entry["spans"]:
        span = {"text": s["text"], "score": s["score"]}
        if "occurrence" in s:
            span["occurrence"] = s["occurrence"]
        if s.get("note"):
            span["note"] = s["note"]
        spans.append(span)
    return {"score": entry["score"], "spans": spans}


def heatmap_from_logprob(entry: dict, field: str) -> dict:
    """One item per English word, phrase-based like qe spans (text + occurrence), score in 0-1."""
    words = []
    for w in entry["words"]:
        item = {"text": w["text"], "score": round(float(w[field]), 4)}
        if "occurrence" in w:
            item["occurrence"] = w["occurrence"]
        words.append(item)
    return {"words": words}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--heatmap-score",
        choices=["confidence_contrast", "confidence"],
        default="confidence_contrast",
        help="which word score the heatmap shows (see logprob_heatmap/METHOD.md); default source-contrast",
    )
    args = ap.parse_args()

    esa = json.loads(ESA.read_text(encoding="utf-8"))
    heat = json.loads(HEATMAP.read_text(encoding="utf-8"))
    data = json.loads(APP_EXPLANATIONS.read_text(encoding="utf-8")) if APP_EXPLANATIONS.exists() else {
        "about": "Precomputed explanations per notice id and translation version. See README.md in this folder.",
        "explanations": {},
    }
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    esa_model = esa.get("meta", {}).get("model")
    heat_model = heat.get("model")

    ids = sorted(set(esa["notices"]) | set(heat["notices"]))
    for nid in ids:
        for v in VERSIONS:
            entry = data["explanations"].setdefault(nid, {}).setdefault(v, {})
            gen = entry.setdefault("_generated", {})
            if v in esa["notices"].get(nid, {}):
                entry["qe"] = qe_from_esa(esa["notices"][nid][v])
                gen["qe"] = {"method": "ESA via xCOMET (explanations/esa)", "model": esa_model, "merged": now}
            if v in heat["notices"].get(nid, {}):
                entry["heatmap"] = heatmap_from_logprob(heat["notices"][nid][v], args.heatmap_score)
                gen["heatmap"] = {
                    "method": "log-probability heatmap (explanations/logprob_heatmap)",
                    "model": heat_model,
                    "score": args.heatmap_score,
                    "merged": now,
                }
            print(f"{nid}/{v}: qe={'qe' in entry} heatmap={'heatmap' in entry}")

    APP_EXPLANATIONS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {APP_EXPLANATIONS.relative_to(HERE.parent)}. Now run `npm run check-data` in app/.")


if __name__ == "__main__":
    main()
