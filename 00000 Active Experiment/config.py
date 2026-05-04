import json
import os

EXPERIMENT_FOLDER = r"G:\Meine Ablage\0000 PAPER\00000 MI CSEP Experiment\00000 Active Experiment"
RESULTS_DIR = os.path.join(EXPERIMENT_FOLDER, "results")
ANALYSIS_DIR = os.path.join(EXPERIMENT_FOLDER, "analysis")
GRAPHS_DIR = os.path.join(ANALYSIS_DIR, "graphs")

API_CONFIG_FILE = os.path.join(EXPERIMENT_FOLDER, "open_router_api.json")
GENERATED_PROMPTS_FILE = os.path.join(EXPERIMENT_FOLDER, "final_generated prompts.json")
KNOWN_FAILURE_PROMPTS_FILE = os.path.join(EXPERIMENT_FOLDER, "final_known_failure_prompts.json")
RESULTS_FILE = os.path.join(RESULTS_DIR, "results.json")

MODELS = [
    # mistral-7b-instruct gone; ministral-8b-2512 = 8B, 262K context, same family
    {"name": "Ministral 8B (Dec-25)",     "id": "mistralai/ministral-8b-2512"},
    # unchanged
    {"name": "Llama 3.1 8B Instruct",     "id": "meta-llama/llama-3.1-8b-instruct"},
    # gemma-2-9b-it is gone; gemma-3-12b-it is the closest Google IT model
    {"name": "Gemma 3 12B IT",            "id": "google/gemma-3-12b-it"},
    # unchanged
    {"name": "Qwen 2.5 7B Instruct",      "id": "qwen/qwen-2.5-7b-instruct"},
    # phi-3-mini is gone; phi-4 is the only Phi currently on OpenRouter
    {"name": "Phi-4 (14B)",               "id": "microsoft/phi-4"},
]

CHECKPOINT_INTERVAL = 600   # 10 minutes
MAX_CHECKPOINTS     = 5
RETRY_DELAYS        = [5, 15, 45]
API_CALL_DELAY      = 1.2   # seconds between calls (rate-limit buffer)

# Max tokens per call type
MAX_TOKENS = {
    "zero_shot":        1024,
    "cot_pass":         2048,
    "cot_synthesis":    1024,
    "csep_class":        512,
    "csep_decomp":      2048,
    "csep_reintegrate": 1536,
    "csep_polish":      1024,
}

# Temperature per call type
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
