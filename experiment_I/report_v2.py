import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

with open("analysis/judge_scores_v2.json", encoding="utf-8") as f:
    scores = json.load(f)

MODEL_SHORT = {
    "mistralai/ministral-8b-2512":      "Ministral-8B",
    "meta-llama/llama-3.1-8b-instruct": "Llama-3.1-8B",
    "google/gemma-3-12b-it":            "Gemma-3-12B",
    "qwen/qwen-2.5-7b-instruct":        "Qwen-2.5-7B",
    "microsoft/phi-4":                  "Phi-4",
}
MODEL_IDS = list(MODEL_SHORT.keys())
COND_NAMES = {1: "ZS", 2: "CoT", 3: "CSEP", 4: "CSEP+ZS"}

def normalize(s, cat):
    s = float(s)
    if cat in ["4_multi_step_reasoning", "7_hidden_contradictions",
               "10_consistency_under_reframing", "17_self_reference_paradox"]:
        return s / 2.0
    elif cat == "9_open_ended_hallucination_prone":
        return 1.0 - s
    return s

# Overall by condition
overall = defaultdict(list)
model_cond = defaultdict(lambda: defaultdict(list))
cat_cond = defaultdict(lambda: defaultdict(list))
errors = 0

for k, v in scores.items():
    if v["score"] is None:
        errors += 1
        continue
    s = normalize(v["score"], v["category"])
    cond = v["condition"]
    mid = v["model_id"]
    cat = v["category"]
    overall[cond].append(s)
    model_cond[mid][cond].append(s)
    cat_cond[cat][cond].append(s)

print(f"Total scored: {len(scores)} | Errors/null: {errors}")
print()

print("=== OVERALL BY CONDITION ===")
for c in [1,2,3,4]:
    vals = overall[c]
    print(f"  {COND_NAMES[c]:<8}: {sum(vals)/len(vals):.4f}  (n={len(vals)})")

print()
print("=== BY MODEL AND CONDITION ===")
print(f"  {'Model':<15} {'ZS':>6} {'CoT':>6} {'CSEP':>6} {'CSEP+ZS':>8}")
print("  " + "-"*45)
for mid in MODEL_IDS:
    row = []
    for c in [1,2,3,4]:
        vals = model_cond[mid][c]
        row.append(f"{sum(vals)/len(vals):.4f}" if vals else "  -   ")
    print(f"  {MODEL_SHORT[mid]:<15} {row[0]:>6} {row[1]:>6} {row[2]:>6} {row[3]:>8}")

print()
print("=== BY CATEGORY AND CONDITION ===")
print(f"  {'Category':<35} {'ZS':>6} {'CoT':>6} {'CSEP':>6} {'CSEP+ZS':>8} {'n':>4}")
print("  " + "-"*68)
for cat in sorted(cat_cond.keys(), key=lambda x: int(x.split("_")[0])):
    row = []
    n = 0
    for c in [1,2,3,4]:
        vals = cat_cond[cat][c]
        row.append(f"{sum(vals)/len(vals):.3f}" if vals else "  - ")
        if vals: n = len(vals)
    print(f"  {cat:<35} {row[0]:>6} {row[1]:>6} {row[2]:>6} {row[3]:>8} {n:>4}")

print()
print("=== CSEP DELTA vs ZS (judge-scored only) ===")
print(f"  {'Category':<35} {'CSEP-ZS':>8} {'CSEP+ZS-ZS':>11}")
print("  " + "-"*58)
for cat in sorted(cat_cond.keys(), key=lambda x: int(x.split("_")[0])):
    zs   = sum(cat_cond[cat][1])/len(cat_cond[cat][1]) if cat_cond[cat][1] else None
    csep = sum(cat_cond[cat][3])/len(cat_cond[cat][3]) if cat_cond[cat][3] else None
    czs  = sum(cat_cond[cat][4])/len(cat_cond[cat][4]) if cat_cond[cat][4] else None
    if zs and csep and czs:
        d1 = csep - zs
        d2 = czs - zs
        flag1 = "▲" if d1 > 0.02 else ("▼" if d1 < -0.02 else "~")
        flag2 = "▲" if d2 > 0.02 else ("▼" if d2 < -0.02 else "~")
        print(f"  {cat:<35} {flag1}{d1:+.3f}   {flag2}{d2:+.3f}")
