import json
import os
import time
from datetime import datetime, timedelta

from api_client import call_api, get_token_summary, token_stats
from checkpoint import checkpoint_summary, load_latest_checkpoint, save_checkpoint
from config import (
    CHECKPOINT_INTERVAL,
    GENERATED_PROMPTS_FILE,
    KNOWN_FAILURE_PROMPTS_FILE,
    MODELS,
    RESULTS_DIR,
    RESULTS_FILE,
)
from cot_runner import run_cot
from csep_runner import run_csep
import telegram_notifier as tg

# Total expected records: 5 models x 322 questions x 4 conditions
TOTAL_RECORDS = len(MODELS) * 322 * 4   # recalculated after load

MODEL_SHORT = {
    "mistralai/ministral-8b-2512":           "Ministral-8B",
    "meta-llama/llama-3.1-8b-instruct":      "Llama-3.1-8B",
    "google/gemma-3-12b-it":                 "Gemma-3-12B",
    "qwen/qwen-2.5-7b-instruct":             "Qwen-2.5-7B",
    "microsoft/phi-4":                       "Phi-4",
}


def _progress_bar(done: int, total: int, width: int = 30) -> str:
    pct = done / total if total else 0
    filled = int(width * pct)
    bar = "#" * filled + "-" * (width - filled)
    return f"[{bar}] {done}/{total} ({pct*100:.1f}%)"


def _eta(done: int, total: int, elapsed_s: float) -> str:
    if done == 0:
        return "ETA: --"
    rate = done / elapsed_s          # records per second
    remaining = (total - done) / rate
    return "ETA: " + str(timedelta(seconds=int(remaining)))


def print_progress(done: int, total: int, elapsed: float,
                   model_id: str, q_idx: int, n_q: int, cond: int) -> None:
    bar  = _progress_bar(done, total)
    eta  = _eta(done, total, elapsed)
    name = MODEL_SHORT.get(model_id, model_id.split("/")[-1][:12])
    try:
        m_idx = next(i for i, m in enumerate(MODELS) if m["id"] == model_id)
    except StopIteration:
        m_idx = 0
    print(f"\n  {bar}  {eta}")
    print(f"  Model {m_idx+1}/5 {name} | Q {q_idx+1}/{n_q} | Cond {cond}/4")
    print(f"  {get_token_summary()}")

_ZERO_SHOT_PROMPT = "Answer the following question:\n\n{question}"

CONDITIONS = [1, 2, 3, 4]
CONDITION_NAMES = {
    1: "zero_shot",
    2: "cot",
    3: "csep_only",
    4: "csep_plus_zeroshot",
}


# ---------------------------------------------------------------------------
# Question loading
# ---------------------------------------------------------------------------

def _load_generated(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = []
    for cat_key, cat_data in data["categories"].items():
        metric = cat_data.get("metric", "")
        desc = cat_data.get("description", "")
        for q in cat_data["questions"]:
            qid = q["id"]
            if cat_key == "10_consistency_under_reframing":
                for framing in ("a", "b"):
                    items.append({
                        "source":      "generated",
                        "category":    cat_key,
                        "question_id": f"{qid}_{framing}",
                        "base_id":     qid,
                        "question":    q[f"framing_{framing}"],
                        "framing":     framing,
                        "expected":    q.get("expected_consistency", ""),
                        "metric":      metric,
                        "description": desc,
                        "extra":       {},
                    })
            else:
                extra = {k: v for k, v in q.items()
                         if k not in ("id", "question", "answer", "expected_answer")}
                items.append({
                    "source":      "generated",
                    "category":    cat_key,
                    "question_id": qid,
                    "base_id":     qid,
                    "question":    q.get("question", ""),
                    "framing":     None,
                    "expected":    q.get("answer", q.get("expected_answer", "")),
                    "metric":      metric,
                    "description": desc,
                    "extra":       extra,
                })
    return items


def _load_known_failures(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = []
    for cat_key, cat_data in data["categories"].items():
        metric = cat_data.get("metric", "")
        desc = cat_data.get("description", "")
        for q in cat_data["questions"]:
            extra = {k: v for k, v in q.items()
                     if k not in ("id", "question", "expected_answer", "source")}
            items.append({
                "source":      "known_failure",
                "category":    cat_key,
                "question_id": q["id"],
                "base_id":     q["id"],
                "question":    q.get("question", ""),
                "framing":     None,
                "expected":    q.get("expected_answer", ""),
                "metric":      metric,
                "description": desc,
                "extra":       extra,
                "lit_source":  q.get("source", ""),
            })
    return items


def load_all_questions() -> list:
    gen = _load_generated(GENERATED_PROMPTS_FILE)
    kf  = _load_known_failures(KNOWN_FAILURE_PROMPTS_FILE)
    return gen + kf


# ---------------------------------------------------------------------------
# Result persistence
# ---------------------------------------------------------------------------

def _append_result(result: dict, results: list) -> None:
    results.append(result)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    tmp = RESULTS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    os.replace(tmp, RESULTS_FILE)

    # Per-model file
    model_id = result.get("model_id", "unknown")
    safe = model_id.replace("/", "__")
    model_file = os.path.join(RESULTS_DIR, f"results_{safe}.json")
    model_records = [r for r in results if r.get("model_id") == model_id]
    tmp_m = model_file + ".tmp"
    with open(tmp_m, "w", encoding="utf-8") as f:
        json.dump(model_records, f, ensure_ascii=False, indent=2)
    os.replace(tmp_m, model_file)


def _load_existing_results() -> list:
    if os.path.exists(RESULTS_FILE):
        try:
            with open(RESULTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"  Warning: could not read existing results ({e}), starting fresh.")
    return []


# ---------------------------------------------------------------------------
# Main experiment loop
# ---------------------------------------------------------------------------

def run_experiment() -> list:
    questions = load_all_questions()
    print(f"Loaded {len(questions)} question items "
          f"({sum(1 for q in questions if q['source'] == 'generated')} generated + "
          f"{sum(1 for q in questions if q['source'] == 'known_failure')} known-failure)")

    # Load or resume results
    results = _load_existing_results()

    # Check for checkpoint (informational only – we use the results file as source of truth)
    summary = checkpoint_summary()
    if summary:
        print(f"\nCheckpoint found: {summary}")
        print("Auto-resuming (skipping already-completed (model, question, condition) tuples).\n")

    # Build a set of completed triples for O(1) lookup
    completed: set = {
        (r["model_id"], r["question_id"], r["condition"])
        for r in results
    }

    # Build zero-shot cache from already-completed results
    zeroshot_cache: dict = {
        (r["model_id"], r["question_id"]): r["response"]
        for r in results
        if r["condition"] == 1 and not r.get("error")
    }

    last_ckpt_time = time.time()
    experiment_start = time.time()
    total_done = len(results)
    total_expected = len(questions) * 4 * len(MODELS)

    def _get_progress_msg() -> str:
        elapsed = time.time() - experiment_start
        bar = _progress_bar(total_done, total_expected)
        eta = _eta(total_done, total_expected, elapsed) if total_done > 0 else "ETA: --"
        return f"*CSEP Eksperiment*\n{bar}\n{eta}\n{get_token_summary()}"

    tg.start_command_listener(_get_progress_msg, get_token_summary)
    tg.send(
        f"*Eksperiment pokrenut*\n"
        f"Pitanja: {len(questions)} | Modeli: {len(MODELS)} | Ukupno zapisa: {total_expected}\n"
        f"Vec uradjeno: {total_done}"
    )

    for model in MODELS:
        model_id   = model["id"]
        model_name = model["name"]
        print(f"\n{'=' * 64}")
        print(f"  MODEL: {model_name}  ({model_id})")
        print(f"{'=' * 64}")
        tg.send(f"*Model: {model_name}*\n{_progress_bar(total_done, total_expected)}", silent=True)

        for q_idx, q in enumerate(questions):
            qid      = q["question_id"]
            question = q["question"]

            # Check for remote stop command
            if tg.should_stop():
                print("\n  [STOP requested via Telegram]")
                tg.send("*STOP* primljen. Eksperiment zaustavljen.")
                return results

            # Progress indicator
            print(f"\n  [{q_idx + 1}/{len(questions)}] {qid}: {question[:55]}...")

            # Cache the zero-shot answer for condition 4
            zs_key = (model_id, qid)
            zeroshot_response: str | None = zeroshot_cache.get(zs_key)

            for cond in CONDITIONS:
                triple = (model_id, qid, cond)
                if triple in completed:
                    # Already done – ensure zero-shot is cached if we skipped cond 1
                    if cond == 1:
                        entry = next(
                            (r for r in results
                             if r["model_id"] == model_id
                             and r["question_id"] == qid
                             and r["condition"] == 1),
                            None,
                        )
                        if entry and not entry.get("error"):
                            zeroshot_response = entry["response"]
                            zeroshot_cache[zs_key] = zeroshot_response
                    continue

                print(f"    Condition {cond} ({CONDITION_NAMES[cond]}):")

                record = {
                    "model_id":      model_id,
                    "model_name":    model_name,
                    "source":        q["source"],
                    "category":      q["category"],
                    "question_id":   qid,
                    "base_id":       q.get("base_id", qid),
                    "question":      question,
                    "framing":       q.get("framing"),
                    "expected":      q.get("expected", ""),
                    "metric":        q.get("metric", ""),
                    "extra":         q.get("extra", {}),
                    "condition":     cond,
                    "condition_name": CONDITION_NAMES[cond],
                    "timestamp":     datetime.now().isoformat(),
                    "response":      None,
                    "intermediate":  {},
                    "error":         None,
                }

                try:
                    if cond == 1:
                        # Zero-shot
                        prompt = _ZERO_SHOT_PROMPT.format(question=question)
                        print(f"      zero-shot ", end="", flush=True)
                        resp = call_api(model_id,
                                        [{"role": "user", "content": prompt}],
                                        call_type="zero_shot")
                        print("ok")
                        record["response"] = resp
                        record["prompt_sent"] = prompt
                        zeroshot_response = resp
                        zeroshot_cache[zs_key] = resp

                    elif cond == 2:
                        cot = run_cot(model_id, question)
                        record["response"] = cot["final_response"]
                        record["intermediate"] = cot

                    elif cond == 3:
                        csep = run_csep(model_id, question, zeroshot_answer=None)
                        record["response"] = csep["final_response"]
                        record["intermediate"] = csep

                    elif cond == 4:
                        if not zeroshot_response:
                            raise RuntimeError(
                                "Zero-shot response unavailable for condition 4. "
                                "Condition 1 must run first."
                            )
                        csep = run_csep(model_id, question, zeroshot_answer=zeroshot_response)
                        record["response"] = csep["final_response"]
                        record["intermediate"] = csep

                except Exception as exc:
                    print(f"\n      ERROR: {exc}")
                    record["error"] = str(exc)
                    record["response"] = f"ERROR: {exc}"
                    tg.send(f"ERROR [{model_name}] {qid} cond{cond}:\n`{str(exc)[:200]}`", silent=True)

                _append_result(record, results)
                completed.add(triple)
                total_done += 1
                elapsed = time.time() - experiment_start
                print_progress(total_done, total_expected, elapsed,
                               model_id, q_idx, len(questions), cond)

                # Checkpoint every 10 minutes
                if time.time() - last_ckpt_time >= CHECKPOINT_INTERVAL:
                    ckpt_path = save_checkpoint({
                        "current_model":       model_id,
                        "current_question_id": qid,
                        "current_condition":   cond,
                        "timestamp":           datetime.now().isoformat(),
                        "results":             results,
                    })
                    print(f"\n  [Checkpoint → {os.path.basename(ckpt_path)}]")
                    last_ckpt_time = time.time()

    # Final checkpoint
    save_checkpoint({
        "current_model":       "COMPLETED",
        "current_question_id": "COMPLETED",
        "current_condition":   "COMPLETED",
        "timestamp":           datetime.now().isoformat(),
        "results":             results,
    })

    print(f"\n{'=' * 64}")
    print(f"  EXPERIMENT COMPLETE — {len(results)} total results")
    print(f"  Results file: {RESULTS_FILE}")
    print(f"{'=' * 64}")
    tg.send(
        f"*EKSPERIMENT ZAVRSEN!*\n"
        f"Ukupno zapisa: {len(results)}\n"
        f"{get_token_summary()}"
    )

    return results
