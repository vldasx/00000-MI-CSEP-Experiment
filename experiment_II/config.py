import json
import os

EXPERIMENT_FOLDER = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR  = os.path.join(EXPERIMENT_FOLDER, "results")
ANALYSIS_DIR = os.path.join(EXPERIMENT_FOLDER, "analysis")
GRAPHS_DIR   = os.path.join(ANALYSIS_DIR, "graphs")
LOGS_DIR     = os.path.join(EXPERIMENT_FOLDER, "logs")

API_CONFIG_FILE = os.path.join(EXPERIMENT_FOLDER, "open_router_api.json")
GENERATED_PROMPTS_FILE = os.path.join(EXPERIMENT_FOLDER, "final_generated prompts.json")
KNOWN_FAILURE_PROMPTS_FILE = os.path.join(EXPERIMENT_FOLDER, "final_known_failure_prompts.json")
RESULTS_FILE = os.path.join(RESULTS_DIR, "full_experiment.json")

MODELS = [
    {"name": "Llama 3.3 70B",    "id": "meta-llama/llama-3.3-70b-instruct"},
    {"name": "Qwen 2.5 72B",     "id": "qwen/qwen-2.5-72b-instruct"},
    {"name": "Nemotron 70B",     "id": "nvidia/llama-3.1-nemotron-70b-instruct"},
    {"name": "R1 Distill 70B",   "id": "deepseek/deepseek-r1-distill-llama-70b"},
    {"name": "Command R+ 104B",  "id": "cohere/command-r-plus-08-2024"},
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
