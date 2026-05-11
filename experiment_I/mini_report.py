import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

with open("analysis/judge_scores_v2.json", encoding="utf-8") as f:
    scores = json.load(f)

ministral = {k: v for k, v in scores.items() if "ministral" in v["model_id"]}
print(f"Ministral-8B scored items: {len(ministral)}")

cat_cond = defaultdict(lambda: defaultdict(list))
for k, v in ministral.items():
    if v["score"] is None:
        continue
    s = float(v["score"])
    cat = v["category"]
    cond = v["condition"]
    if cat in ["4_multi_step_reasoning", "7_hidden_contradictions",
               "10_consistency_under_reframing", "17_self_reference_paradox"]:
        s = s / 2.0
    elif cat == "9_open_ended_hallucination_prone":
        s = 1.0 - s
    cat_cond[cat][cond].append(s)

print()
print(f"{'Category':<28} | {'ZS':>5} | {'CoT':>5} | {'CSEP':>5} | {'CSEP+ZS':>7} | n")
print("-" * 70)
for cat in sorted(cat_cond.keys()):
    row = []
    n = 0
    for cond in [1, 2, 3, 4]:
        vals = cat_cond[cat][cond]
        if vals:
            row.append(f"{sum(vals)/len(vals):.3f}")
            n = len(vals)
        else:
            row.append("  -  ")
    print(f"{cat[:28]:<28} | {row[0]:>5} | {row[1]:>5} | {row[2]:>5} | {row[3]:>7} | {n}")

print()
all_by_cond = defaultdict(list)
for k, v in ministral.items():
    if v["score"] is None:
        continue
    s = float(v["score"])
    cat = v["category"]
    cond = v["condition"]
    if cat in ["4_multi_step_reasoning", "7_hidden_contradictions",
               "10_consistency_under_reframing", "17_self_reference_paradox"]:
        s = s / 2.0
    elif cat == "9_open_ended_hallucination_prone":
        s = 1.0 - s
    all_by_cond[cond].append(s)

print("Overall Ministral-8B:")
for cond, name in [(1, "ZS"), (2, "CoT"), (3, "CSEP"), (4, "CSEP+ZS")]:
    vals = all_by_cond[cond]
    if vals:
        print(f"  {name:<8}: {sum(vals)/len(vals):.3f}  (n={len(vals)})")

print()
print("=== SAMPLE REASONS (first 6 items) ===")
shown = 0
for k, v in ministral.items():
    if shown >= 6:
        break
    if not v.get("reason"):
        continue
    cat = v["category"]
    qid = v["question_id"]
    cond = v["condition"]
    score = v["score"]
    reason = v["reason"]
    print(f"  [{cat[:22]} | Q{qid} | cond{cond} | score={score}]")
    print(f"  {reason}")
    print()
    shown += 1
