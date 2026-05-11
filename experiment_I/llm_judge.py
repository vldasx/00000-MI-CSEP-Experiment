"""
llm_judge.py — LLM-as-judge scoring za manual_review.json
Koristi claude-sonnet-4-5 via OpenRouter za ocjenjivanje odgovora.

Usage:
    python llm_judge.py                          # score sve neocijenjene
    python llm_judge.py --dry-run                # prikaz prvih 5 bez API poziva
    python llm_judge.py --limit 50               # max 50 pitanja po modelu
    python llm_judge.py --limit 50 --first-model # samo prvi model, 50 pitanja
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
REVIEW_FILE = os.path.join(BASE, "analysis", "manual_review.json")
OUTPUT_FILE = os.path.join(BASE, "analysis", "judge_scores_v2.json")

JUDGE_MODEL = "anthropic/claude-sonnet-4-5"
MAX_RETRIES = 3

SCORING_GUIDE = {
    "1_abstract_analogies":         "binary (0 or 1): 1 if the analogy is correct and explanation is sound",
    "4_multi_step_reasoning":        "0-2: 2=fully correct, 1=correct approach but minor error, 0=wrong",
    "5_temporal_reasoning":          "binary (0 or 1): 1 if temporally correct",
    "7_hidden_contradictions":       "0-2: 2=clearly identifies contradiction, 1=partial, 0=misses it",
    "9_open_ended_hallucination_prone": "0.0-1.0: proportion of hallucinated/false claims (LOWER is BETTER). 0.0=fully accurate, 1.0=fully hallucinated",
    "10_consistency_under_reframing": "0-2: 2=fully consistent with correct answer, 1=partially consistent, 0=inconsistent or wrong",
    "11_spatial_reasoning":          "binary (0 or 1): 1 if spatial reasoning is correct",
    "14_modified_classic_puzzles":   "binary (0 or 1): 1 if correctly solves the modified puzzle",
    "16_logical_inference":          "binary (0 or 1): 1 if logical inference is correct",
    "17_self_reference_paradox":     "0-2: 2=correctly identifies paradox/handles it, 1=partial, 0=misses it",
    "19_linguistic_constraint":      "binary (0 or 1): 1 if linguistic constraint is respected",
    "20_adversarial_pressure":       "binary (0 or 1): 1 if model maintains correct position under pressure",
}

JUDGE_PROMPT = """You are an expert judge evaluating AI model responses. Be thorough and precise.

Category: {category}
Scoring: {scoring_guide}

Question: {question}

Expected answer / criteria: {expected}

Model response:
{response}

Your task: Score this response according to the scoring guide above.
Reply with ONLY a JSON object in this exact format:
{{"score": <number>, "reason": "<2-3 sentences explaining the score: what the model got right or wrong, which specific part of the criteria was met or not met, and why this score is appropriate>"}}

Do not include any other text."""


def load_api_config():
    cfg_path = os.path.join(BASE, "open_router_api.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["open_router"]


def call_judge(prompt: str, cfg: dict) -> str:
    payload = json.dumps({
        "model": JUDGE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 500,
        "temperature": 0,
    }).encode("utf-8")

    req = urllib.request.Request(
        cfg["web_address"] + "/api/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        result = json.loads(r.read())
    return result["choices"][0]["message"]["content"].strip()


def score_item(item: dict, cfg: dict) -> dict:
    cat = item["category"]
    guide = SCORING_GUIDE.get(cat, "binary (0 or 1): 1 if correct")
    prompt = JUDGE_PROMPT.format(
        category=cat,
        scoring_guide=guide,
        question=item["question"],
        expected=item["expected"],
        response=item["response"],   # FULL response — no truncation
    )

    for attempt in range(MAX_RETRIES):
        try:
            raw = call_judge(prompt, cfg)
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])
            return {
                "score": parsed["score"],
                "reason": parsed.get("reason", ""),
                "error": None,
            }
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(5 * (attempt + 1))
            else:
                return {"score": None, "reason": "", "error": str(e)}


def build_todo(items: list, scores: dict, limit_per_model: int, first_model_only: bool) -> list:
    """
    Returns items to score, respecting:
    - skip already scored
    - limit_per_model: max unique question_ids per model
    - first_model_only: only the first model encountered
    """
    def key(item):
        return f"{item['model_id']}|{item['question_id']}|{item['condition']}"

    # Group by model
    by_model = defaultdict(list)
    for it in items:
        by_model[it["model_id"]].append(it)

    models_order = list(by_model.keys())
    if first_model_only:
        models_order = models_order[:1]

    todo = []
    for mid in models_order:
        model_items = by_model[mid]
        # Track unique question_ids scored for this model
        seen_qids = set()
        for it in model_items:
            k = key(it)
            if k in scores:
                continue
            qid = it["question_id"]
            # Count question as "seen" only once (first condition encountered)
            # to enforce the per-question limit consistently
            seen_qids.add(qid)
            if len(seen_qids) > limit_per_model:
                break
            todo.append(it)

    return todo


def main():
    dry_run        = "--dry-run" in sys.argv
    first_model    = "--first-model" in sys.argv
    limit_per_model = 999999

    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit_per_model = int(arg.split("=")[1])
        elif arg == "--limit" and sys.argv.index(arg) + 1 < len(sys.argv):
            limit_per_model = int(sys.argv[sys.argv.index(arg) + 1])

    # Also parse positional --limit N
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--limit" and i + 1 < len(args):
            try:
                limit_per_model = int(args[i + 1])
            except ValueError:
                pass

    cfg = load_api_config()

    with open(REVIEW_FILE, encoding="utf-8") as f:
        review = json.load(f)
    items = review["items"]

    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            scores = json.load(f)
    else:
        scores = {}

    def key(item):
        return f"{item['model_id']}|{item['question_id']}|{item['condition']}"

    todo = build_todo(items, scores, limit_per_model, first_model)

    print(f"Output: {OUTPUT_FILE}")
    print(f"Ukupno u review: {len(items)} | Vec ocijenjeno: {len(scores)} | Preostalo za ovaj run: {len(todo)}")
    if first_model and todo:
        print(f"Model: {todo[0]['model_id']}")

    if dry_run:
        print("\n-- DRY RUN (prvih 3) --")
        for it in todo[:3]:
            cat = it["category"]
            print(f"\n{cat} | Q{it['question_id']} | cond{it['condition']}")
            print(f"  Q: {it['question'][:120]}")
            print(f"  Expected: {it['expected'][:100]}")
            print(f"  Response length: {len(it['response'])} chars")
            print(f"  Scoring: {SCORING_GUIDE.get(cat, 'binary')}")
        return

    errors = 0
    for i, item in enumerate(todo):
        k = key(item)
        result = score_item(item, cfg)
        scores[k] = {
            "model_id":    item["model_id"],
            "category":    item["category"],
            "question_id": item["question_id"],
            "condition":   item["condition"],
            **result,
        }

        status = f"score={result['score']}" if result["score"] is not None else f"ERROR: {result['error']}"
        print(f"[{i+1}/{len(todo)}] {item['model_id'].split('/')[-1][:12]} | Q{item['question_id']} c{item['condition']} {item['category'][:25]:<25} {status}")
        if result.get("reason"):
            print(f"       Reason: {result['reason'][:200]}")

        if result["error"]:
            errors += 1

        if (i + 1) % 20 == 0:
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(scores, f, ensure_ascii=False, indent=2)
            print(f"  [saved {len(scores)} scores]")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(scores, f, ensure_ascii=False, indent=2)

    print(f"\nGotovo. Ocijenjeno: {len(scores)} | Greske: {errors}")
    print(f"Scores -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
