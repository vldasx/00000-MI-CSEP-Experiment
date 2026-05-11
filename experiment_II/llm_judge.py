"""
llm_judge.py — LLM-as-judge scoring za manual_review.json (Experiment II)
Preskace Command R+ (previse gresaka). Koristi judge_scores_v2.json.

Usage:
    python llm_judge.py           # score sve neocijenjene
    python llm_judge.py --dry-run # prikaz prvih 3 bez API poziva
"""
import json, os, sys, time, urllib.request
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
REVIEW_FILE  = os.path.join(BASE, "analysis", "manual_review.json")
OUTPUT_FILE  = os.path.join(BASE, "analysis", "judge_scores_v2.json")
API_CFG_FILE = os.path.join(BASE, "open_router_api.json")

JUDGE_MODEL = "anthropic/claude-sonnet-4-5"
MAX_RETRIES = 3
EXCLUDE_MODELS = {"cohere/command-r-plus-08-2024"}

SCORING_GUIDE = {
    "1_abstract_analogies":          "binary (0 or 1): 1 if the analogy is correct and explanation is sound",
    "4_multi_step_reasoning":        "0-2: 2=fully correct, 1=correct approach but minor error, 0=wrong",
    "5_temporal_reasoning":          "binary (0 or 1): 1 if temporally correct",
    "7_hidden_contradictions":       "0-2: 2=clearly identifies contradiction, 1=partial, 0=misses it",
    "9_open_ended_hallucination_prone": "0.0-1.0: proportion of hallucinated/false claims (LOWER is BETTER). 0.0=fully accurate, 1.0=fully hallucinated",
    "10_consistency_under_reframing": "0-2: 2=fully consistent with correct answer, 1=partially consistent, 0=inconsistent or wrong",
    "11_spatial_reasoning":          "binary (0 or 1): 1 if spatial reasoning is correct",
    "12_counting_and_basic_arithmetic": "binary (0 or 1): 1 if count or arithmetic result is correct",
    "14_modified_classic_puzzles":   "binary (0 or 1): 1 if correctly solves the modified puzzle",
    "15_distractor_injection":       "binary (0 or 1): 1 if model answers correctly despite distractors",
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


def load_cfg():
    with open(API_CFG_FILE, encoding="utf-8") as f:
        return json.load(f)["open_router"]


def call_judge(prompt, cfg):
    payload = json.dumps({
        "model": JUDGE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 500,
        "temperature": 0,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["web_address"] + "/api/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        result = json.loads(r.read())
    return result["choices"][0]["message"]["content"].strip()


def score_item(item, cfg):
    cat = item["category"]
    guide = SCORING_GUIDE.get(cat, "binary (0 or 1): 1 if correct")
    prompt = JUDGE_PROMPT.format(
        category=cat, scoring_guide=guide,
        question=item["question"], expected=item["expected"],
        response=item["response"],
    )
    for attempt in range(MAX_RETRIES):
        try:
            raw = call_judge(prompt, cfg)
            parsed = json.loads(raw[raw.find("{"):raw.rfind("}")+1])
            return {"score": parsed["score"], "reason": parsed.get("reason", ""), "error": None}
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(5 * (attempt + 1))
            else:
                return {"score": None, "reason": "", "error": str(e)}


def main():
    dry_run = "--dry-run" in sys.argv
    cfg = load_cfg()

    with open(REVIEW_FILE, encoding="utf-8") as f:
        items = json.load(f)["items"]

    # Exclude Command R+
    items = [i for i in items if i["model_id"] not in EXCLUDE_MODELS]
    print(f"Items after excluding Command R+: {len(items)}")

    scores = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            scores = json.load(f)

    def key(i): return f"{i['model_id']}|{i['question_id']}|{i['condition']}"
    todo = [i for i in items if key(i) not in scores]
    print(f"Already scored: {len(scores)} | To score: {len(todo)}")

    if dry_run:
        print("\n-- DRY RUN (first 3) --")
        for it in todo[:3]:
            print(f"\n{it['category']} | Q{it['question_id']} | cond{it['condition']}")
            print(f"  Model: {it['model_id'].split('/')[-1]}")
            print(f"  Response length: {len(it['response'])} chars")
            print(f"  Scoring: {SCORING_GUIDE.get(it['category'], 'binary')}")
        return

    errors = 0
    for i, item in enumerate(todo):
        k = key(item)
        result = score_item(item, cfg)
        scores[k] = {
            "model_id": item["model_id"], "category": item["category"],
            "question_id": item["question_id"], "condition": item["condition"],
            **result,
        }
        status = f"score={result['score']}" if result["score"] is not None else f"ERROR: {result['error']}"
        print(f"[{i+1}/{len(todo)}] {item['model_id'].split('/')[-1][:15]} | Q{item['question_id']} c{item['condition']} {item['category'][:22]:<22} {status}")
        if result.get("reason"):
            print(f"       {result['reason'][:180]}")
        if result["error"]:
            errors += 1
        if (i + 1) % 20 == 0:
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(scores, f, ensure_ascii=False, indent=2)
            print(f"  [saved {len(scores)}]")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(scores, f, ensure_ascii=False, indent=2)
    print(f"\nDone. Scored: {len(scores)} | Errors: {errors}")
    print(f"Output: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
