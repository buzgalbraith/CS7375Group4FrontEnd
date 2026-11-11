# Rationale generation

Generates the **written explanation** ("rationale") for every notice × translation version with Claude on
Amazon Bedrock, and writes it into
[`app/translation-experiment-data/explanations.json`](../app/translation-experiment-data/explanations.json)
(`explanations.<id>.<version>.rationale`). Other explanation fields in that file are left untouched.

The model sees only the Korean source and the English translation it is explaining. It is **not** told
whether that translation is the correct or the flawed version, what the planted error is, or the
participant's scenario, so each rationale is a blind assessment, as a real MT tool would produce. Some
rationales may therefore miss an error or flag a non-issue; that's a realistic property of the explanation,
not a bug. Read them before using them in the study.

## Setup

```bash
cd rationale-generation
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

**Authentication.** Put a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`:

```bash
export AWS_BEARER_TOKEN_BEDROCK=...   # Bedrock console → API keys; never commit it
```

If that variable isn't set, the script falls back to normal AWS credentials (`AWS_PROFILE`,
`AWS_ACCESS_KEY_ID`/…, SSO via `aws sso login`, or an instance role); `--profile` applies only then. Either
way, the account needs Bedrock access to Claude Haiku 5.5 through the global inference profile (`global.anthropic.claude-haiku-5-5`) in the chosen region
(`--region`, else `AWS_REGION`, else `us-east-1`).

## Run

```bash
python generate_rationales.py --dry-run              # print the exact prompts; no API calls
python generate_rationales.py                        # generate missing rationales (8 calls for 4 notices)
python generate_rationales.py --force                # regenerate everything
python generate_rationales.py --only p2_med --force  # one notice, both versions
python generate_rationales.py --region us-west-2 --profile research
```

Then check the result from `app/`:

```bash
cd ../app && npm run check-data   # coverage table should show R for every notice/version
```

## Output

- `explanations.json`: each generated entry gets `rationale` plus
  `_generated.rationale = {model, at}` recording which model wrote it and when.
- `runs/<timestamp>_<id>_<version>.json`: the full request (system prompt, user prompt, settings), the
  response id, model, token usage and text for every call, so the stimuli can be reported and reproduced.

## Settings

- Model: `global.anthropic.claude-haiku-5-5` (`--model` to change, e.g. `us.anthropic.claude-haiku-5-5`), adaptive
  thinking (the model's default) at effort `high`.
- Calls go through Bedrock's standard runtime API (`InvokeModel`, via the SDK's `AnthropicBedrock` client).
  Haiku 5.5 can only be invoked on demand through an inference profile, so the bare
  `anthropic.claude-haiku-5-5` ID returns an error; use the `global.` or `us.` form.
- If the model declines a request (`stop_reason: "refusal"`, very unlikely here), that item is reported as
  failed rather than retried on a different model, so all rationales come from one model.
- The prompt asks for one plain-prose paragraph of about 60–120 words, written for someone who can't read
  Korean. Edit `SYSTEM_PROMPT` in `generate_rationales.py` to change it, then rerun with `--force`.
