import json, sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
base = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(base, "analysis", "analysis_report.json"), encoding="utf-8") as f:
    rpt = json.load(f)

print("timestamp:", rpt["timestamp"])
print("total_results:", rpt["total_results"])
print("auto_scored:", rpt["auto_scored"])
print("errors:", rpt["errors"])
print("manual_review_needed:", rpt["manual_review_needed"])
print()

stats = rpt["statistics"]
print("=== OVERALL BY CONDITION ===")
for c, v in sorted(stats["overall_by_condition"].items()):
    print(f"  cond {c}: mean={v['mean']:.4f}  n={v['n']}")

print()
print("=== BY MODEL AND CONDITION ===")
for mid, conds in stats["by_model_and_condition"].items():
    row = "  ".join(f"c{c}={v['mean']:.4f}" for c, v in sorted(conds.items()))
    print(f"  {mid.split('/')[-1][:25]}: {row}")

print()
print("=== BY CATEGORY AND CONDITION ===")
for cat, conds in sorted(stats["by_category_and_condition"].items()):
    row = "  ".join(f"c{c}={v['mean']:.3f}" for c, v in sorted(conds.items()))
    print(f"  {cat}: {row}")
