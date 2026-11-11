"""Render output.json as a static HTML heatmap for eyeballing (red = low confidence).

    python preview.py                          # output.json -> preview.html
    python preview.py output.dry-run.json -o preview.dry-run.html
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Shade = MAX_ALPHA * (1 - confidence), so the least likely words get a light red wash, not solid red.
RED = "239, 68, 68"
MAX_ALPHA = 0.35

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log-prob heatmap preview</title>
<style>
body {{ font: 15px/1.7 system-ui, sans-serif; margin: 24px auto; max-width: 1200px; padding: 0 16px; color: #222; background: #fff; }}
h2 {{ margin-top: 40px; font-size: 17px; }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }}
@media (max-width: 800px) {{ .pair {{ grid-template-columns: 1fr; }} }}
.meta {{ color: #666; font-size: 13px; }}
.w {{ border-radius: 3px; padding: 0 1px; cursor: help; }}
.err {{ border-bottom: 2px dotted #000; }}
p {{ margin: 0 0 10px; }}
.legend span {{ display: inline-block; padding: 0 6px; margin-right: 2px; }}
.warn {{ background: #fff3cd; padding: 6px 10px; }}
</style></head><body>
<h1>Log-prob heatmap preview</h1>
{warn}
<p class="meta">Model: {model}. Conditioning: {conditioning}. Each word is shaded by the probability of its weakest
token (red = less likely under the model). Dotted underline = the documented error span. Hover a word for numbers.</p>
<p class="meta">Colour by:
{contrast_radio}<label><input type="radio" name="mode" value="p"> probability</label>
<label><input type="radio" name="mode" value="r"> rank within translation</label></p>
<p class="legend meta">{legend}</p>
{body}
<script>
const words = document.querySelectorAll('.w');
function shade(mode) {{
  for (const w of words) {{
    const c = parseFloat(w.dataset[mode]);
    w.style.background = `rgba({red}, ${{({max_alpha} * (1 - c)).toFixed(3)}})`;
  }}
}}
const radios = document.querySelectorAll('input[name=mode]');
for (const r of radios) r.addEventListener('change', e => shade(e.target.value));
radios[0].checked = true;
shade(radios[0].value);
</script>
</body></html>
"""


def render_version(v: dict) -> str:
    text, words = v["text"], v["words"]
    es = v.get("error_span")
    out, pos = [], 0
    for w in words:
        gap = text[pos : w["start"]]
        out.append("</p><p>" if "\n\n" in gap else html.escape(gap))
        tip = f"p(weakest token) = {w['confidence']:.3f}\nlogprob min {w['logprob']:.2f}, mean {w['mean_logprob']:.2f}"
        tip += f"\nmax entropy {w['max_entropy']:.2f} nats\nrank in translation {w['confidence_rank']:.2f}"
        if "pmi" in w:
            tip += f"\nsource contrast {w['pmi']:.2f} → {w['confidence_contrast']:.3f}"
        if "preferred" in w:
            tip += f"\nmodel preferred: {w['preferred']['piece']!r} ({w['preferred']['logprob']:.2f})"
        err = es and w["start"] < es["end"] and w["end"] > es["start"]
        data_c = f' data-c="{w["confidence_contrast"]:.4f}"' if "pmi" in w else ""
        out.append(
            f'<span class="w{" err" if err else ""}" data-p="{w["confidence"]:.4f}"{data_c} '
            f'data-r="{w["confidence_rank"]:.4f}" title="{html.escape(tip)}">{html.escape(w["text"])}</span>'
        )
        pos = w["end"]
    s = v["summary"]
    meta = f"perplexity {s['perplexity']:.2f} · mean logprob {s['mean_logprob']:.2f} · {s['n_tokens']} tokens"
    if es:
        meta += f" · error span min p {es['min_confidence']:.3f} (weakest: {html.escape(es['weakest_word'])})"
        if "min_confidence_contrast" in es:
            meta += f", contrast {es['min_confidence_contrast']:.3f} ({html.escape(es['weakest_word_contrast'])})"
    return f'<p>{"".join(out)}</p><p class="meta">{meta}</p>'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?", default=str(HERE / "output.json"))
    ap.add_argument("-o", "--out", default=str(HERE / "preview.html"))
    args = ap.parse_args()
    d = json.loads(Path(args.input).read_text(encoding="utf-8"))

    body = []
    for nid, pair in d["notices"].items():
        cols = "".join(f"<div><h3>{version}</h3>{render_version(v)}</div>" for version, v in pair.items())
        body.append(f'<h2>{html.escape(nid)}</h2><div class="pair">{cols}</div>')
    legend = "".join(
        f'<span style="background: rgba({RED}, {MAX_ALPHA * (1 - c):.2f})">{c:.1f}</span>' for c in (0, 0.2, 0.4, 0.6, 0.8, 1)
    )
    warn = '<p class="warn">Dry run: the numbers are fake.</p>' if d.get("_dry_run") else ""
    Path(args.out).write_text(
        PAGE.format(
            model=html.escape(d["model"]),
            conditioning=html.escape(d["settings"]["conditioning"]),
            legend=legend,
            body="\n".join(body),
            warn=warn,
            red=RED,
            max_alpha=MAX_ALPHA,
            contrast_radio=(
                '<label><input type="radio" name="mode" value="c"> source contrast</label>\n'
                if d["settings"].get("contrast") else ""
            ),
        ),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
