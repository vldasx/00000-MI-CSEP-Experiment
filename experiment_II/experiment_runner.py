import json
import os
import time
from datetime import datetime, timedelta

from api_client import call_api, get_token_summary, token_stats
from checkpoint import checkpoint_summary, load_latest_checkpoint, save_checkpoint
from config import (
    CHECKPOINT_INTERVAL,
    EXPERIMENT_FOLDER,
    GENERATED_PROMPTS_FILE,
    KNOWN_FAILURE_PROMPTS_FILE,
    LOGS_DIR,
    MODELS,
    RESULTS_DIR,
    RESULTS_FILE,
)
from cot_runner import run_cot
from csep_runner import run_csep
from display import ExperimentDisplay
import telegram_notifier as tg

MODEL_SHORT = {
    "meta-llama/llama-3.3-70b-instruct":           "Llama-3.3-70B",
    "qwen/qwen-2.5-72b-instruct":                  "Qwen-2.5-72B",
    "nvidia/llama-3.1-nemotron-70b-instruct":      "Nemotron-70B",
    "deepseek/deepseek-r1-distill-llama-70b":      "R1-Distill-70B",
    "cohere/command-r-plus-08-2024":               "CommandR+-104B",
}

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
    results   = _load_existing_results()

    completed: set = {
        (r["model_id"], r["question_id"], r["condition"])
        for r in results
    }
    zeroshot_cache: dict = {
        (r["model_id"], r["question_id"]): r["response"]
        for r in results
        if r["condition"] == 1 and not r.get("error")
    }

    total_expected = len(questions) * len(CONDITIONS) * len(MODELS)
    os.makedirs(LOGS_DIR, exist_ok=True)
    log_path = os.path.join(LOGS_DIR, "experiment.log")

    disp = ExperimentDisplay(
        total_records=total_expected,
        models=MODELS,
        log_path=log_path,
    )
    # Sync already-done count into display progress bar
    disp.overall_done = len(results)
    disp._progress_overall.advance(disp._task_overall, len(results))

    disp.start()
    disp.log_info(
        f"Loaded {len(questions)} questions | "
        f"Models: {len(MODELS)} | Total expected: {total_expected} | "
        f"Already done: {len(results)}"
    )

    summary = checkpoint_summary()
    if summary:
        disp.log_info(f"Checkpoint: {summary}")

    last_ckpt_time   = time.time()
    experiment_start = time.time()

    def _progress_msg() -> str:
        elapsed = time.time() - experiment_start
        done    = disp.overall_done
        total   = total_expected
        pct     = done / total * 100 if total else 0
        return (
            f"*CSEP Eksperiment*\n"
            f"[{'#' * int(pct//3)}{'-' * (33 - int(pct//3))}] {pct:.1f}%\n"
            f"{get_token_summary()}"
        )

    tg.start_command_listener(_progress_msg, get_token_summary)
    tg.send(
        f"*Eksperiment pokrenut*\n"
        f"Pitanja: {len(questions)} | Modeli: {len(MODELS)} | "
        f"Ukupno: {total_expected} | Vec uradjeno: {len(results)}"
    )

    try:
        for m_idx, model in enumerate(MODELS):
            model_id   = model["id"]
            model_name = model["name"]

            # Count how many this model still needs
            model_remaining = sum(
                1 for q in questions for c in CONDITIONS
                if (model_id, q["question_id"], c) not in completed
            )
            model_done_already = len(questions) * len(CONDITIONS) - model_remaining

            disp.set_model(model_id, m_idx + 1, len(questions) * len(CONDITIONS))
            # Advance model bar to already-done position
            disp._progress_model.advance(disp._task_model, model_done_already)
            disp.model_done = model_done_already

            tg.send(
                f"*Model: {model_name}*\n"
                f"Remaining: {model_remaining}/{len(questions) * len(CONDITIONS)}",
                silent=True,
            )

            for q_idx, q in enumerate(questions):
                qid      = q["question_id"]
                question = q["question"]

                if tg.should_stop():
                    disp.log_info("STOP requested via Telegram")
                    tg.send("*STOP* primljen. Eksperiment zaustavljen.")
                    return results

                zs_key = (model_id, qid)
                zeroshot_response: str | None = zeroshot_cache.get(zs_key)

                for cond in CONDITIONS:
                    triple = (model_id, qid, cond)
                    if triple in completed:
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

                    disp.set_question(qid, question)

                    record = {
                        "model_id":       model_id,
                        "model_name":     model_name,
                        "source":         q["source"],
                        "category":       q["category"],
                        "question_id":    qid,
                        "base_id":        q.get("base_id", qid),
                        "question":       question,
                        "framing":        q.get("framing"),
                        "expected":       q.get("expected", ""),
                        "metric":         q.get("metric", ""),
                        "extra":          q.get("extra", {}),
                        "condition":      cond,
                        "condition_name": CONDITION_NAMES[cond],
                        "timestamp":      datetime.now().isoformat(),
                        "response":       None,
                        "intermediate":   {},
                        "error":          None,
                    }

                    try:
                        if cond == 1:
                            prompt = _ZERO_SHOT_PROMPT.format(question=question)
                            resp = call_api(model_id,
                                            [{"role": "user", "content": prompt}],
                                            call_type="zero_shot")
                            record["response"]    = resp
                            record["prompt_sent"] = prompt
                            zeroshot_response     = resp
                            zeroshot_cache[zs_key] = resp

                        elif cond == 2:
                            cot = run_cot(model_id, question)
                            record["response"]     = cot["final_response"]
                            record["intermediate"] = cot

                        elif cond == 3:
                            csep = run_csep(model_id, question, zeroshot_answer=None)
                            record["response"]     = csep["final_response"]
                            record["intermediate"] = csep

                        elif cond == 4:
                            if not zeroshot_response:
                                raise RuntimeError(
                                    "Zero-shot response unavailable for condition 4."
                                )
                            csep = run_csep(model_id, question,
                                            zeroshot_answer=zeroshot_response)
                            record["response"]     = csep["final_response"]
                            record["intermediate"] = csep

                        disp.complete(qid, question, model_id, ok=True)

                    except Exception as exc:
                        record["error"]    = str(exc)
                        record["response"] = f"ERROR: {exc}"
                        tg.send(
                            f"ERROR [{model_name}] {qid} cond{cond}:\n"
                            f"`{str(exc)[:200]}`",
                            silent=True,
                        )
                        disp.complete(qid, question, model_id, ok=False, error=str(exc))

                    _append_result(record, results)
                    completed.add(triple)

                    disp.update_stats(
                        tokens_in  = token_stats["prompt_tokens"],
                        tokens_out = token_stats["completion_tokens"],
                        cost       = token_stats["estimated_cost_usd"],
                        api_calls  = token_stats["api_calls"],
                    )

                    # Checkpoint every 10 minutes
                    if time.time() - last_ckpt_time >= CHECKPOINT_INTERVAL:
                        ckpt_path = save_checkpoint({
                            "current_model":       model_id,
                            "current_question_id": qid,
                            "current_condition":   cond,
                            "timestamp":           datetime.now().isoformat(),
                            "results":             results,
                        })
                        disp.log_info(f"Checkpoint → {os.path.basename(ckpt_path)}")
                        last_ckpt_time = time.time()

    finally:
        disp.stop()

    # Final checkpoint
    save_checkpoint({
        "current_model":       "COMPLETED",
        "current_question_id": "COMPLETED",
        "current_condition":   "COMPLETED",
        "timestamp":           datetime.now().isoformat(),
        "results":             results,
    })

    disp.log_info(f"EXPERIMENT COMPLETE — {len(results)} total results")
    tg.send(
        f"*EKSPERIMENT ZAVRSEN!*\n"
        f"Ukupno zapisa: {len(results)}\n"
        f"{get_token_summary()}"
    )

    return results
