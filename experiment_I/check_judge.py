import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

with open("analysis/judge_scores_v2.json", encoding="utf-8") as f:
    scores = json.load(f)

with open("analysis/manual_review.json", encoding="utf-8") as f:
    review = json.load(f)

lookup = {}
for item in review["items"]:
    k = f"{item['model_id']}|{item['question_id']}|{item['condition']}"
    lookup[k] = item

ministral = {k: v for k, v in scores.items() if "ministral" in v["model_id"]}

# Print ALL items with full question, expected, response, score, reason
for k, v in sorted(ministral.items(), key=lambda x: (x[1]["category"], x[1]["question_id"], x[1]["condition"])):
    if v["score"] is None:
        continue
    item = lookup.get(k, {})
    print("=" * 80)
    print(f"Category : {v['category']}")
    print(f"Q ID     : {v['question_id']}  |  Condition: {v['condition']}  |  Score: {v['score']}")
    print(f"Question : {item.get('question', 'N/A')}")
    print(f"Expected : {item.get('expected', 'N/A')}")
    print(f"Response : {item.get('response', 'N/A')[:600]}")
    if len(item.get("response", "")) > 600:
        print(f"           ... [{len(item.get('response',''))} chars total]")
    print(f"Reason   : {v['reason']}")
    print()
