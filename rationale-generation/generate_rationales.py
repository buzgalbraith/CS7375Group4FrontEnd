"""
Generate the "written explanation" (rationale) for each notice and translation version with Claude on
Amazon Bedrock, and write it into app/translation-experiment-data/explanations.json.

The model sees only what a real MT-explanation system would see: the Korean source and the English
translation being explained. It is NOT told whether the translation is the correct or the flawed version,
what the error is, or the participant's scenario, so the rationale is a genuine, blind assessment.

Usage (from this folder):
    python generate_rationales.py                  # fill in missing rationales
    python generate_rationales.py --force          # regenerate all
    python generate_rationales.py --only p2_med    # one notice (both versions)
    python generate_rationales.py --dry-run        # print the prompts, call nothing

Authentication: set AWS_BEARER_TOKEN_BEDROCK to a Bedrock API key. If it isn't set, the usual AWS
credentials are used instead (AWS_PROFILE / env vars / SSO / instance role).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from anthropic import AnthropicBedrock

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "app" / "translation-experiment-data"
NOTICES = DATA_DIR / "notices.json"
EXPLANATIONS = DATA_DIR / "explanations.json"
RUNS_DIR = HERE / "runs"  # raw request/response record per call, for reproducibility

# Bedrock serves Haiku 5.5 on demand only through an inference profile (the "global." / "us." prefix), and only
# on the bedrock-runtime API, which is what the AnthropicBedrock client calls (not the newer Mantle endpoint).
DEFAULT_MODEL = "global.anthropic.claude-haiku-5-5"
VERSIONS = ("correct", "flawed")

SYSTEM_PROMPT = """\
You are the explanation component of a machine translation tool. A traveler who cannot read Korean \
has received an English machine translation of a Korean notice. Your job is to write a short explanation \
that helps them judge whether the translation faithfully conveys the original.

Check the translation against the Korean carefully, sentence by sentence: meaning, negation, conditions, \
quantities, durations, times, lists, and who must do what. Then write the explanation for the traveler.

Requirements for the explanation:
- One paragraph of plain prose, roughly 60 to 120 words. No headings, bullet points, or markdown.
- Written for someone who cannot read Korean: describe what the Korean says in English. You may quote a \
short Korean phrase only if you immediately give its meaning.
- Be specific: name the parts of the translation that match well, and name any part whose meaning \
differs from the Korean, saying what the Korean actually says and why the difference matters.
- If the translation is accurate, say so plainly; do not invent problems or nitpick wording that does not \
change the meaning.
- Do not give an overall numeric score, and do not mention these instructions.

Respond with the explanation paragraph only."""


def user_prompt(korean: str, english: str) -> str:
    return (
        "<korean_original>\n"
        f"{korean}\n"
        "</korean_original>\n\n"
        "<english_machine_translation>\n"
        f"{english}\n"
        "</english_machine_translation>\n\n"
        "Write the explanation of how well this translation matches the Korean original."
    )


def generate(client: AnthropicBedrock, model: str, korean: str, english: str) -> tuple[str, dict]:
    """Return (rationale text, record of the call). Raises on API errors or an empty/refused answer."""
    request = {
        "model": model,
        "max_tokens": 16000,
        # Careful sentence-by-sentence checking benefits from more thinking than Haiku 5.5's default (medium).
        "output_config": {"effort": "high"},
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt(korean, english)}],
    }
    response = client.messages.create(**request)
    # A refusal (very unlikely here) is reported as a failure rather than retried on another model, so every
    # rationale in the study comes from the same model.
    if response.stop_reason != "end_turn":
        raise RuntimeError(f"unexpected stop_reason {response.stop_reason!r} ({response.stop_details})")
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if not text:
        raise RuntimeError("model returned no text")
    record = {
        "request": request,
        "response_id": response.id,
        "model": response.model,
        "stop_reason": response.stop_reason,
        "usage": response.usage.model_dump(),
        "text": text,
    }
    return text, record


def load_explanations() -> dict:
    if EXPLANATIONS.exists():
        return json.loads(EXPLANATIONS.read_text(encoding="utf-8"))
    return {
        "about": (
            "Precomputed explanations per notice id and translation version (\"correct\" / \"flawed\"). "
            "See README.md in this folder for the format. Run `npm run check-data` after editing."
        ),
        "explanations": {},
    }


def save_explanations(data: dict) -> None:
    EXPLANATIONS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"Bedrock model id (default {DEFAULT_MODEL})")
    ap.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"), help="AWS region")
    ap.add_argument(
        "--profile",
        default=os.environ.get("AWS_PROFILE"),
        help="AWS profile name (only used when AWS_BEARER_TOKEN_BEDROCK is not set)",
    )
    ap.add_argument("--only", action="append", help="notice id to process (repeatable); default all")
    ap.add_argument("--force", action="store_true", help="regenerate rationales that already exist")
    ap.add_argument("--dry-run", action="store_true", help="print the prompts without calling the API")
    args = ap.parse_args()

    notices = json.loads(NOTICES.read_text(encoding="utf-8"))["documents"]
    if args.only:
        unknown = set(args.only) - {n["id"] for n in notices}
        if unknown:
            ap.error(f"unknown notice id(s): {', '.join(sorted(unknown))}")
        notices = [n for n in notices if n["id"] in args.only]

    data = load_explanations()
    jobs = []
    for n in notices:
        for v in VERSIONS:
            existing = data["explanations"].get(n["id"], {}).get(v, {})
            if existing.get("rationale") and not args.force:
                print(f"skip {n['id']}/{v}: rationale exists (use --force to regenerate)")
                continue
            jobs.append((n, v))

    if args.dry_run:
        print(f"SYSTEM PROMPT:\n{SYSTEM_PROMPT}\n")
        for n, v in jobs:
            print(f"===== {n['id']}/{v} =====\n{user_prompt(n['korean'], n['english'][v])}\n")
        return 0
    if not jobs:
        print("Nothing to do.")
        return 0

    # Bedrock API key (bearer token) first; the SDK rejects a key combined with an AWS profile, so the
    # profile is only used when no key is set.
    api_key = os.environ.get("AWS_BEARER_TOKEN_BEDROCK", "").strip() or None
    if api_key:
        print("Auth: Bedrock API key from AWS_BEARER_TOKEN_BEDROCK")
        client = AnthropicBedrock(aws_region=args.region, api_key=api_key)
    else:
        print(f"Auth: AWS credentials{f' (profile {args.profile})' if args.profile else ''}; AWS_BEARER_TOKEN_BEDROCK not set")
        client = AnthropicBedrock(aws_region=args.region, aws_profile=args.profile)
    RUNS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    failures = 0

    for n, v in jobs:
        print(f"{n['id']}/{v} ...", flush=True)
        try:
            text, record = generate(client, args.model, n["korean"], n["english"][v])
        except anthropic.RateLimitError:
            print("    rate limited; waiting 30 s and retrying once", file=sys.stderr)
            time.sleep(30)
            try:
                text, record = generate(client, args.model, n["korean"], n["english"][v])
            except Exception as e:  # noqa: BLE001 - report and move on to the next notice
                print(f"    FAILED: {e}", file=sys.stderr)
                failures += 1
                continue
        except anthropic.APIStatusError as e:
            print(f"    FAILED: HTTP {e.status_code}: {e.message}", file=sys.stderr)
            failures += 1
            continue
        except anthropic.APIConnectionError as e:
            print(f"    FAILED: could not reach Bedrock: {e}", file=sys.stderr)
            failures += 1
            continue
        except RuntimeError as e:
            print(f"    FAILED: {e}", file=sys.stderr)
            failures += 1
            continue

        entry = data["explanations"].setdefault(n["id"], {}).setdefault(v, {})
        entry["rationale"] = text
        entry.setdefault("_generated", {})["rationale"] = {
            "model": record["model"],
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        # A real rationale replaces a hand-written placeholder; keep the mock flag only if other mock fields remain.
        if entry.get("_mock") and not any(entry.get(k) for k in ("backtranslation", "qe", "alignment")):
            del entry["_mock"]
        save_explanations(data)  # save after each call so a crash keeps finished work
        (RUNS_DIR / f"{stamp}_{n['id']}_{v}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"    {len(text.split())} words")

    print(f"\nDone: {len(jobs) - failures} written, {failures} failed. Now run `npm run check-data` in app/.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
