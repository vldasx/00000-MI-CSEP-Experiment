"""
analysis.py – post-experiment analysis, auto-scoring, graphs, and JSON reports.

Auto-scoreable categories (unambiguous):
  12, 13, 15  → binary math/count answer check
  2, 8, 18    → refusal / hedge / hallucinate (3-level)
  6           → false-premise rejection (binary)
  3           → math with distractors (binary)

Manual-review categories:
  1, 4, 5, 7, 9, 10, 11, 14, 16, 17, 19, 20
"""

import json
import os
import re
from collections import defaultdict
from datetime import datetime

from config import ANALYSIS_DIR, GRAPHS_DIR, MODELS, load_all_results

CONDITION_NAMES = {1: "Zero-shot", 2: "COT", 3: "CSEP", 4: "CSEP+ZS"}
MODEL_SHORT = {
    "mistralai/mistral-7b-instruct":         "Mistral-7B",
    "meta-llama/llama-3.1-8b-instruct":      "Llama-3.1-8B",
    "google/gemma-2-9b-it":                  "Gemma-2-9B",
    "qwen/qwen-2.5-7b-instruct":             "Qwen-2.5-7B",
    "microsoft/phi-3-mini-128k-instruct":    "Phi-3-Mini",
}

# ── Scorer type per category ──────────────────────────────────────────────────

SCORER = {
    # Auto – math / count
    "3_math_with_distractors":           "math",
    "12_counting_and_basic_arithmetic":  "math",
    "13_aiw_relational_puzzles":         "math",
    "15_distractor_injection":           "math",
    # Auto – refusal
    "2_fabricated_entities":             "refusal",
    "8_confidence_calibration":          "refusal",
    "18_hallucination_fabrication":      "refusal",
    # Auto – false-premise rejection
    "6_false_premise":                   "false_premise",
    # Manual
    "1_abstract_analogies":              "manual",
    "4_multi_step_reasoning":            "manual",
    "5_temporal_reasoning":              "manual",
    "7_hidden_contradictions":           "manual",
    "9_open_ended_hallucination_prone":  "manual",
    "10_consistency_under_reframing":    "manual",
    "11_spatial_reasoning":              "manual",
    "14_modified_classic_puzzles":       "manual",
    "16_logical_inference":              "manual",
    "17_self_reference_paradox":         "manual",
    "19_linguistic_constraint":          "manual",
    "20_adversarial_pressure":           "manual",
}


# ── Individual scorers ────────────────────────────────────────────────────────

_REFUSAL_STRONG = [
    "does not exist", "do not exist", "doesn't exist", "don't exist",
    "not a real", "no such", "cannot be found", "no record of",
    "i cannot find", "i don't have information", "not in my knowledge",
    "made-up", "fabricated", "fictional", "not real",
    "false premise", "incorrect premise", "the premise is false",
    "incorrect assumption", "that is incorrect",
    "impossible to determine", "cannot be determined", "no way to know",
    "cannot answer", "unable to answer",
    "i don't know", "i cannot know", "i have no way",
    "this is a paradox", "paradoxical", "self-referential",
    "cannot be verified", "no verifiable",
    "i must clarify", "i need to correct",
]
_REFUSAL_HEDGE = [
    "i'm not sure", "i'm uncertain", "it's unclear",
    "may not be", "might not be", "possibly", "perhaps",
    "i believe, but", "i think, but", "i'm not certain",
    "i cannot confirm", "limited information",
]


def score_refusal(response: str) -> int:
    """0 = fabricates/answers, 1 = hedges, 2 = clearly refuses."""
    rl = response.lower()
    for phrase in _REFUSAL_STRONG:
        if phrase in rl:
            return 2
    for phrase in _REFUSAL_HEDGE:
        if phrase in rl:
            return 1
    if len(response.strip()) < 60 and any(w in rl for w in ("cannot", "can't", "unable", "no ")):
        return 2
    return 0


def score_false_premise(response: str) -> int:
    """1 = correctly rejects the false premise, 0 = accepts it."""
    rl = response.lower()
    rejection = [
        "false", "incorrect", "not true", "myth", "misconception",
        "actually", "in fact", "premise is wrong", "not accurate",
        "this is not", "that is not", "it is not the case",
        "does not", "did not", "is not", "never",
    ]
    for phrase in rejection:
        if phrase in rl:
            return 1
    return 0


def score_math(response: str, expected: str) -> int | None:
    """
    Extract the primary number from the expected answer and look for it in the response.
    Returns 1 (correct), 0 (wrong), or None (cannot determine).
    """
    if not expected:
        return None

    # Pull numbers from the first clause of the expected answer
    exp_clause = re.split(r"[.(]", expected)[0]
    exp_nums = re.findall(r"-?\d+(?:[.,]\d+)?", exp_clause)
    if not exp_nums:
        return None

    # Normalise: remove thousands separators, use '.' for decimal
    def normalise(s):
        return s.replace(",", "")

    targets = {normalise(n) for n in exp_nums}

    rl = response.lower()

    # Look for explicit answer statements
    answer_re = re.compile(
        r"(?:answer is|result is|total is|=|therefore|so)\s*[:\s]*(-?\d[\d,\.]*)",
        re.IGNORECASE,
    )
    for m in answer_re.finditer(response):
        if normalise(m.group(1)) in targets:
            return 1

    # Check last 300 characters of response for any matching number
    tail = response[-300:]
    for num_str in re.findall(r"-?\d[\d,\.]*", tail):
        if normalise(num_str) in targets:
            return 1

    # If the expected number appears anywhere and we found no conflicting number, score 1
    for t in targets:
        if t in response.replace(",", ""):
            return 1

    return 0


# ── Auto-score dispatcher ────────────────────────────────────────────────────

def auto_score(result: dict) -> dict:
    cat = result.get("category", "")
    scorer_type = SCORER.get(cat, "manual")

    info = {
        "auto_score":         None,
        "scorer_type":        scorer_type,
        "needs_manual_review": scorer_type == "manual",
    }

    if result.get("error"):
        info["auto_score"] = -1
        info["needs_manual_review"] = False
        return info

    response = result.get("response", "") or ""
    expected = result.get("expected", "") or ""

    if scorer_type == "math":
        s = score_math(response, expected)
        info["auto_score"] = s
        if s is None:
            info["needs_manual_review"] = True

    elif scorer_type == "refusal":
        info["auto_score"] = score_refusal(response)

    elif scorer_type == "false_premise":
        info["auto_score"] = score_false_premise(response)

    return info


# ── Statistics ────────────────────────────────────────────────────────────────

def _mean(lst):
    valid = [x for x in lst if x is not None and x >= 0]
    return round(sum(valid) / len(valid), 4) if valid else None


def compute_statistics(scored: list) -> dict:
    by_mc   = defaultdict(lambda: defaultdict(list))   # model → cond → scores
    by_cc   = defaultdict(lambda: defaultdict(list))   # category → cond → scores
    by_cond = defaultdict(list)

    for r in scored:
        s = r.get("auto_score")
        if s is None or s < 0:
            continue
        m    = r["model_id"]
        cond = r["condition"]
        cat  = r["category"]
        by_mc[m][cond].append(s)
        by_cc[cat][cond].append(s)
        by_cond[cond].append(s)

    return {
        "by_model_and_condition": {
            m: {str(c): {"mean": _mean(sc), "n": len(sc)}
                for c, sc in conds.items()}
            for m, conds in by_mc.items()
        },
        "by_category_and_condition": {
            cat: {str(c): {"mean": _mean(sc), "n": len(sc)}
                  for c, sc in conds.items()}
            for cat, conds in by_cc.items()
        },
        "overall_by_condition": {
            str(c): {"mean": _mean(sc), "n": len(sc)}
            for c, sc in by_cond.items()
        },
    }


# ── Graphs ────────────────────────────────────────────────────────────────────

def _generate_graphs(stats: dict) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        print("  matplotlib / numpy not available – skipping graphs.")
        return

    os.makedirs(GRAPHS_DIR, exist_ok=True)
    colors = ["#2196F3", "#4CAF50", "#FF9800", "#E91E63"]

    # Graph 1 – Overall by condition
    try:
        fig, ax = plt.subplots(figsize=(9, 5))
        obc = stats["overall_by_condition"]
        conds = sorted(obc, key=int)
        means = [obc[c]["mean"] or 0 for c in conds]
        labels = [CONDITION_NAMES.get(int(c), c) for c in conds]
        bars = ax.bar(labels, means, color=colors[: len(conds)], alpha=0.85)
        ax.set_title("Overall Mean Score by Condition (auto-scored items)")
        ax.set_ylabel("Mean Score")
        ax.set_ylim(0, max(means) * 1.25 + 0.01)
        for bar, v in zip(bars, means):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.005,
                    f"{v:.3f}", ha="center", fontsize=9)
        plt.tight_layout()
        plt.savefig(os.path.join(GRAPHS_DIR, "1_overall_by_condition.png"), dpi=150)
        plt.close()
    except Exception as e:
        print(f"  Graph 1 failed: {e}")

    # Graph 2 – Grouped bars: model × condition
    try:
        bmc = stats["by_model_and_condition"]
        model_ids = [m["id"] for m in MODELS if m["id"] in bmc]
        if model_ids:
            fig, ax = plt.subplots(figsize=(14, 6))
            x = np.arange(len(model_ids))
            w = 0.2
            for i, cond in enumerate([1, 2, 3, 4]):
                vals = [bmc[mid].get(str(cond), {}).get("mean") or 0 for mid in model_ids]
                ax.bar(x + i * w, vals, w, label=CONDITION_NAMES[cond],
                       color=colors[i], alpha=0.85)
            ax.set_title("Mean Score by Model and Condition")
            ax.set_ylabel("Mean Score")
            ax.set_xticks(x + w * 1.5)
            ax.set_xticklabels(
                [MODEL_SHORT.get(m, m.split("/")[-1][:14]) for m in model_ids],
                rotation=20, ha="right",
            )
            ax.legend()
            plt.tight_layout()
            plt.savefig(os.path.join(GRAPHS_DIR, "2_by_model_and_condition.png"), dpi=150)
            plt.close()
    except Exception as e:
        print(f"  Graph 2 failed: {e}")

    # Graph 3 – Heatmap: category × condition
    try:
        bcc = stats["by_category_and_condition"]
        cats = sorted(bcc)
        if cats:
            matrix = []
            for cat in cats:
                row = [bcc[cat].get(str(c), {}).get("mean") for c in [1, 2, 3, 4]]
                matrix.append(row)

            mat = np.array(
                [[v if v is not None else np.nan for v in row] for row in matrix],
                dtype=float,
            )
            fig, ax = plt.subplots(figsize=(11, max(5, len(cats) * 0.45)))
            masked = np.ma.masked_invalid(mat)
            im = ax.imshow(masked, cmap="RdYlGn", vmin=0, vmax=2, aspect="auto")
            ax.set_xticks(range(4))
            ax.set_xticklabels([CONDITION_NAMES[c] for c in [1, 2, 3, 4]])
            ax.set_yticks(range(len(cats)))
            ax.set_yticklabels([c[:35] for c in cats], fontsize=8)
            ax.set_title("Mean Score Heatmap – Category × Condition")
            plt.colorbar(im, ax=ax, label="Mean Score")
            plt.tight_layout()
            plt.savefig(os.path.join(GRAPHS_DIR, "3_category_heatmap.png"), dpi=150)
            plt.close()
    except Exception as e:
        print(f"  Graph 3 failed: {e}")

    # Graph 4 – CSEP improvement over zero-shot, per model
    try:
        bmc = stats["by_model_and_condition"]
        model_ids = [m["id"] for m in MODELS if m["id"] in bmc]
        if model_ids:
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            for ax_i, (compare_cond, title) in enumerate([
                (3, "CSEP (C3) vs Zero-shot (C1)"),
                (4, "CSEP+ZS (C4) vs Zero-shot (C1)"),
            ]):
                diffs, labels = [], []
                for mid in model_ids:
                    base = bmc[mid].get("1", {}).get("mean")
                    imp  = bmc[mid].get(str(compare_cond), {}).get("mean")
                    if base is not None and imp is not None:
                        diffs.append(round(imp - base, 4))
                        labels.append(MODEL_SHORT.get(mid, mid.split("/")[-1][:12]))
                if diffs:
                    bar_colors = ["#4CAF50" if v >= 0 else "#F44336" for v in diffs]
                    axes[ax_i].bar(labels, diffs, color=bar_colors, alpha=0.85)
                    axes[ax_i].axhline(0, color="black", linewidth=0.8, linestyle="--")
                    axes[ax_i].set_title(title)
                    axes[ax_i].set_ylabel("Δ Mean Score")
                    axes[ax_i].tick_params(axis="x", rotation=20)
                    for xi, v in enumerate(diffs):
                        axes[ax_i].text(xi, v + (0.003 if v >= 0 else -0.01),
                                        f"{v:+.3f}", ha="center", fontsize=8)
            plt.suptitle("CSEP Improvement over Zero-shot Baseline")
            plt.tight_layout()
            plt.savefig(os.path.join(GRAPHS_DIR, "4_csep_improvement.png"), dpi=150)
            plt.close()
    except Exception as e:
        print(f"  Graph 4 failed: {e}")

    # Graph 5 – Per-model score distribution (box-like bar with range)
    try:
        bmc = stats["by_model_and_condition"]
        model_ids = [m["id"] for m in MODELS if m["id"] in bmc]
        if model_ids:
            fig, ax = plt.subplots(figsize=(12, 5))
            for i, mid in enumerate(model_ids):
                cond_means = [
                    bmc[mid].get(str(c), {}).get("mean")
                    for c in [1, 2, 3, 4]
                ]
                valid = [v for v in cond_means if v is not None]
                if valid:
                    avg = sum(valid) / len(valid)
                    ax.bar(i, avg, color=colors[i % 4], alpha=0.8,
                           label=MODEL_SHORT.get(mid, mid.split("/")[-1]))
                    ax.errorbar(i, avg,
                                yerr=[[avg - min(valid)], [max(valid) - avg]],
                                fmt="none", color="black", capsize=5)
            ax.set_title("Per-model Overall Mean Score (range = min–max across conditions)")
            ax.set_ylabel("Mean Score")
            ax.set_xticks(range(len(model_ids)))
            ax.set_xticklabels(
                [MODEL_SHORT.get(m, m.split("/")[-1][:14]) for m in model_ids],
                rotation=15,
            )
            ax.legend()
            plt.tight_layout()
            plt.savefig(os.path.join(GRAPHS_DIR, "5_per_model_range.png"), dpi=150)
            plt.close()
    except Exception as e:
        print(f"  Graph 5 failed: {e}")

    print(f"  Graphs saved → {GRAPHS_DIR}")


# ── Main entry point ──────────────────────────────────────────────────────────

def run_analysis() -> dict:
    print("\nLoading results...")
    results = load_all_results()
    print(f"  {len(results)} records loaded.")

    os.makedirs(ANALYSIS_DIR, exist_ok=True)
    os.makedirs(GRAPHS_DIR, exist_ok=True)

    # Score every record
    scored = []
    manual_items = []

    for r in results:
        si = auto_score(r)
        scored.append({**r, **si})

        if si["needs_manual_review"] and not r.get("error"):
            manual_items.append({
                "model_id":    r["model_id"],
                "category":    r["category"],
                "question_id": r["question_id"],
                "question":    r["question"],
                "expected":    r.get("expected", ""),
                "condition":   r["condition"],
                "response":    r.get("response", ""),
                "scorer_type": si["scorer_type"],
            })

    stats = compute_statistics(scored)

    auto_count = sum(1 for s in scored if s["auto_score"] is not None and s["auto_score"] >= 0)
    error_count = sum(1 for s in scored if s.get("error"))

    report = {
        "timestamp":            datetime.now().isoformat(),
        "total_results":        len(results),
        "auto_scored":          auto_count,
        "errors":               error_count,
        "manual_review_needed": len(manual_items),
        "statistics":           stats,
        "per_result_summary": [
            {
                "model_id":    r["model_id"],
                "category":    r["category"],
                "question_id": r["question_id"],
                "condition":   r["condition"],
                "auto_score":  r["auto_score"],
                "scorer_type": r["scorer_type"],
                "error":       r.get("error"),
            }
            for r in scored
        ],
    }

    report_path = os.path.join(ANALYSIS_DIR, "analysis_report.json")
    tmp = report_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    os.replace(tmp, report_path)
    print(f"  Analysis report → {report_path}")

    manual_path = os.path.join(ANALYSIS_DIR, "manual_review.json")
    tmp2 = manual_path + ".tmp"
    with open(tmp2, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp":   datetime.now().isoformat(),
            "description": (
                "Items requiring manual scoring. For each item, add a 'score' field "
                "(integer) and optionally 'notes'. Categories: "
                "1=analogies(binary), 4=multistep(0-2), 5=temporal(binary), "
                "7=contradiction(0-2), 9=hallucination(ratio 0-1, lower=better), "
                "10=consistency(0-2), 11=spatial(binary), 14=modified-classic(binary), "
                "16=logic(binary), 17=self-ref(0-2), 19=constraints(binary), "
                "20=adversarial(binary)."
            ),
            "total":  len(manual_items),
            "items":  manual_items,
            "findings": {},
        }, f, ensure_ascii=False, indent=2)
    os.replace(tmp2, manual_path)
    print(f"  Manual review file → {manual_path}")

    print("\nGenerating graphs...")
    _generate_graphs(stats)

    print(f"\n{'─' * 50}")
    print(f"  Total results:         {len(results)}")
    print(f"  Auto-scored:           {auto_count}")
    print(f"  Errors (skipped):      {error_count}")
    print(f"  Need manual review:    {len(manual_items)}")
    print(f"{'─' * 50}")

    # Print quick stats table
    print("\nOverall mean score by condition (auto-scored):")
    for cond in [1, 2, 3, 4]:
        info = stats["overall_by_condition"].get(str(cond), {})
        mean_str = f"{info['mean']:.4f}" if info.get("mean") is not None else "n/a"
        print(f"  Condition {cond} ({CONDITION_NAMES[cond]:12s}): {mean_str}  (n={info.get('n', 0)})")

    return report
