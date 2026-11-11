"""Render output.json as a static HTML page for eyeballing the xCOMET error spans.

    python preview.py                          # output.json -> preview.html
    python preview.py output.stub.json -o preview.stub.html
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_NOTICES = HERE.parents[1] / "app" / "translation-experiment-data" / "notices.json"

# Light washes, not solid colour, so the text stays readable. Same red as the log-prob heatmap preview.
SEVERITY_BG = {
    "critical": "rgba(239, 68, 68, 0.40)",
    "major": "rgba(239, 68, 68, 0.28)",
    "minor": "rgba(245, 158, 11, 0.25)",
}

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ESA span preview</title>
<style>
body {{ font: 15px/1.7 system-ui, sans-serif; margin: 24px auto; max-width: 1200px; padding: 0 16px; color: #222; background: #fff; }}
h2 {{ margin-top: 40px; font-size: 17px; }}
h3 {{ margin-bottom: 4px; }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }}
@media (max-width: 800px) {{ .pair {{ grid-template-columns: 1fr; }} }}
.meta {{ color: #666; font-size: 13px; }}
.s {{ border-radius: 3px; padding: 0 1px; cursor: help; }}
.err {{ border-bottom: 2px dotted #000; }}
p {{ margin: 0 0 10px; }}
.legend span {{ display: inline-block; padding: 0 6px; margin-right: 4px; border-radius: 3px; }}
.score {{ font-variant-numeric: tabular-nums; }}
.warn {{ background: #fff3cd; padding: 6px 10px; }}
</style></head><body>
<h1>ESA span preview</h1>
{warn}
<p class="meta">Model: {model}. Error spans predicted by xCOMET in reference-free mode, shaded by severity.
Dotted underline = the documented error. Hover a span for its numbers.</p>
<p class="legend meta">{legend}</p>
{body}
</body></html>
"""


def phrase_hits(text: str, phrase: str) -> list[int]:
    """Same rule as phraseToRange in app/src/data/buildStimuli.ts (overlapping indexOf hits)."""
    hits, i = [], text.find(phrase)
    while i != -1:
        hits.append(i)
        i = text.find(phrase, i + 1)
    return hits


def render_version(text: str, v: dict, error_phrase: str | None) -> str:
    # Character ranges for the predicted spans and the documented error.
    marks = []
    for s in v["spans"]:
        start = phrase_hits(text, s["text"])[s.get("occurrence", 1) - 1]
        marks.append((start, start + len(s["text"]), s))
    err = None
    if error_phrase and (hits := phrase_hits(text, error_phrase)):
        err = (hits[0], hits[0] + len(error_phrase))

    # Split the text at every boundary, so overlapping spans and the error underline both render.
    cuts = sorted({0, len(text), *(b for m in marks for b in m[:2]), *(err or ())})
    out = []
    for a, b in zip(cuts, cuts[1:]):
        chunk = html.escape(text[a:b]).replace("\n\n", "</p><p>")
        here = [m[2] for m in marks if m[0] <= a and b <= m[1]]
        in_err = err and err[0] <= a and b <= err[1]
        if not here and not in_err:
            out.append(chunk)
            continue
        cls, style, tip = [], "", ""
        if in_err:
            cls.append("err")
        if here:
            s = max(here, key=lambda s: ("minor", "major", "critical").index(s["severity"]))
            cls.append("s")
            style = f' style="background: {SEVERITY_BG[s["severity"]]}"'
            tip = f'{s["severity"]} · span score {s["score"]:.2f} · model confidence {s.get("confidence", float("nan")):.2f}'
            if s.get("note"):
                tip += f'\n{s["note"]}'
            tip = f' title="{html.escape(tip)}"'
        out.append(f'<span class="{" ".join(cls)}"{style}{tip}>{chunk}</span>')
    n = len(v["spans"])
    meta = f'score <span class="score">{v["score"]:.1f}</span> / 100 · {n} span{"" if n == 1 else "s"}'
    return f'<p>{"".join(out)}</p><p class="meta">{meta}</p>'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?", default=str(HERE / "output.json"))
    ap.add_argument("-o", "--out", default=str(HERE / "preview.html"))
    ap.add_argument("--notices", default=str(DEFAULT_NOTICES), help="notices.json (texts and documented errors)")
    args = ap.parse_args()
    d = json.loads(Path(args.input).read_text(encoding="utf-8"))
    docs = {x["id"]: x for x in json.loads(Path(args.notices).read_text(encoding="utf-8"))["documents"]}

    body = []
    for nid, pair in d["notices"].items():
        doc = docs[nid]
        cols = "".join(
            f"<div><h3>{version}</h3>"
            f"{render_version(doc['english'][version], v, doc.get('error', {}).get(f'{version}_span'))}</div>"
            for version, v in pair.items()
        )
        err = doc.get("error", {}).get("type", "")
        body.append(
            f'<h2>{html.escape(nid)}</h2><p class="meta">documented error: {html.escape(err)}</p>'
            f'<div class="pair">{cols}</div>'
        )
    legend = "".join(f'<span style="background: {bg}">{sev}</span>' for sev, bg in SEVERITY_BG.items())
    meta = d.get("meta", {})
    model = meta.get("model") or d.get("model") or "unknown"
    warn = '<p class="warn">Stub run: the spans are fake.</p>' if meta.get("stub") or d.get("_stub") else ""
    Path(args.out).write_text(
        PAGE.format(model=html.escape(str(model)), legend=legend, body="\n".join(body), warn=warn),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
