import json
import os
import glob

# Derive base path from this file's location — works after any folder rename
EXPERIMENT_FOLDER = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR       = os.path.join(EXPERIMENT_FOLDER, "results")
ANALYSIS_DIR      = os.path.join(EXPERIMENT_FOLDER, "analysis")
GRAPHS_DIR        = os.path.join(ANALYSIS_DIR, "graphs")
LOGS_DIR          = os.path.join(EXPERIMENT_FOLDER, "logs")

API_CONFIG_FILE           = os.path.join(EXPERIMENT_FOLDER, "open_router_api.json")
GENERATED_PROMPTS_FILE    = os.path.join(EXPERIMENT_FOLDER, "final_generated prompts.json")
KNOWN_FAILURE_PROMPTS_FILE= os.path.join(EXPERIMENT_FOLDER, "final_known_failure_prompts.json")

# results.json was split into per-model files; load all of them
RESULTS_FILES = sorted(glob.glob(os.path.join(RESULTS_DIR, "results_*.json")))

MODELS = [
    {"name": "Ministral 8B (Dec-25)",     "id": "mistralai/ministral-8b-2512"},
    {"name": "Llama 3.1 8B Instruct",     "id": "meta-llama/llama-3.1-8b-instruct"},
    {"name": "Gemma 3 12B IT",            "id": "google/gemma-3-12b-it"},
    {"name": "Qwen 2.5 7B Instruct",      "id": "qwen/qwen-2.5-7b-instruct"},
    {"name": "Phi-4 (14B)",               "id": "microsoft/phi-4"},
]

CHECKPOINT_INTERVAL = 600
MAX_CHECKPOINTS     = 5
RETRY_DELAYS        = [5, 15, 45]
API_CALL_DELAY      = 1.2

MAX_TOKENS = {
    "zero_shot":        1024,
    "cot_pass":         2048,
    "cot_synthesis":    1024,
    "csep_class":        512,
    "csep_decomp":      2048,
    "csep_reintegrate": 1536,
    "csep_polish":      1024,
}

TEMPERATURE = {
    "zero_shot":        0.3,
    "cot_pass":         0.7,
    "cot_synthesis":    0.3,
    "csep_class":       0.3,
    "csep_decomp":      0.3,
    "csep_reintegrate": 0.3,
    "csep_polish":      0.3,
}


def load_api_config() -> dict:
    with open(API_CONFIG_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["open_router"]


def load_all_results() -> list:
    """Load all per-model result files and merge into one list."""
    all_results = []
    for path in RESULTS_FILES:
        with open(path, "r", encoding="utf-8") as f:
            all_results.extend(json.load(f))
    return all_results
