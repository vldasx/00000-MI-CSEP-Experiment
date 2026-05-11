import glob
import json
import os
from datetime import datetime

from config import MAX_CHECKPOINTS, RESULTS_DIR


def save_checkpoint(state: dict) -> str:
    """Write a full checkpoint JSON and prune old ones, keeping the latest MAX_CHECKPOINTS."""
    os.makedirs(RESULTS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(RESULTS_DIR, f"checkpoint_{ts}.json")

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

    # Prune oldest checkpoints
    pattern = os.path.join(RESULTS_DIR, "checkpoint_*.json")
    existing = sorted(glob.glob(pattern))
    while len(existing) > MAX_CHECKPOINTS:
        try:
            os.remove(existing.pop(0))
        except OSError:
            pass

    return path


def load_latest_checkpoint() -> dict | None:
    """Return the most recent checkpoint dict, or None if none exist."""
    pattern = os.path.join(RESULTS_DIR, "checkpoint_*.json")
    found = sorted(glob.glob(pattern))
    if not found:
        return None
    try:
        with open(found[-1], "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  Warning: could not read checkpoint {found[-1]}: {e}")
        return None


def checkpoint_summary() -> str | None:
    """Return a human-readable summary of the latest checkpoint, or None."""
    pattern = os.path.join(RESULTS_DIR, "checkpoint_*.json")
    found = sorted(glob.glob(pattern))
    if not found:
        return None
    try:
        with open(found[-1], "r", encoding="utf-8") as f:
            s = json.load(f)
        n = len(s.get("results", []))
        return (
            f"{os.path.basename(found[-1])}  |  "
            f"model={s.get('current_model', '?')}  "
            f"q={s.get('current_question_id', '?')}  "
            f"cond={s.get('current_condition', '?')}  "
            f"results={n}"
        )
    except Exception:
        return found[-1]
