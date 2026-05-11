"""
main.py – entry point for the CSEP experiment.

Usage:
    python main.py              -> full run (auto-resumes from checkpoint)
    python main.py --analysis   -> skip experiment, re-run analysis only
"""

import subprocess
import sys

# Force UTF-8 output so special characters don't crash on Windows cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ── Dependency installer ──────────────────────────────────────────────────────

def _ensure(package: str, import_name: str | None = None) -> None:
    name = import_name or package
    try:
        __import__(name)
    except ImportError:
        print(f"  Installing {package}...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", package, "-q"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def install_dependencies() -> None:
    print("Checking / installing dependencies...")
    _ensure("matplotlib")
    _ensure("numpy")
    _ensure("rich")
    print("  All dependencies OK.\n")


# ── Model verification ────────────────────────────────────────────────────────

def verify_and_report_models() -> None:
    from api_client import verify_models, fetch_pricing, _pricing
    from config import MODELS

    print("Verifying models on OpenRouter...")
    ids = [m["id"] for m in MODELS]
    status = verify_models(ids)

    # Fetch pricing while we're at it
    fetch_pricing(ids)

    # Pricing table
    print(f"\n  {'Model':<30} {'Status':<8} {'Prompt/1M':>10} {'Compl/1M':>12} {'Context':>10}")
    print("  " + "-" * 75)

    import urllib.request, json
    from config import load_api_config
    cfg = load_api_config()
    try:
        req = urllib.request.Request(
            cfg["web_address"] + "/api/v1/models",
            headers={"Authorization": f"Bearer {cfg['api_key']}"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            all_models = {m["id"]: m for m in json.loads(r.read())["data"]}
    except Exception:
        all_models = {}

    for m in MODELS:
        mid = m["id"]
        res = status.get(mid)
        ok  = "[OK]" if res is True else "[X] "
        p   = _pricing.get(mid, {})
        pm  = f"${p.get('prompt', 0)*1e6:.4f}" if p else "  n/a"
        cm  = f"${p.get('completion', 0)*1e6:.4f}" if p else "  n/a"
        ctx = f"{all_models.get(mid, {}).get('context_length', 0):,}" if mid in all_models else "?"
        print(f"  {ok} {m['name']:<28} {pm:>10} {cm:>12} {ctx:>10}")
        if res is not True and isinstance(res, list):
            print(f"       ^ NOT FOUND. Alts: {', '.join(res[:3])}")
    print()

    # Rough cost estimate — full experiment (~7M tokens per model, all 4 conditions)
    est_total = 0.0
    for m in MODELS:
        mid = m["id"]
        p = _pricing.get(mid, {})
        est_total += 7_000_000 * 0.6 * p.get("prompt", 0)
        est_total += 7_000_000 * 0.4 * p.get("completion", 0)
    print(f"  Estimated full experiment cost: ~${est_total:.2f} USD")
    print(f"  (based on ~7M tokens per model, all 4 conditions)\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    analysis_only = "--analysis" in sys.argv

    print("=" * 64)
    print("  CSEP EXPERIMENT")
    print("=" * 64)
    print()

    install_dependencies()

    if not analysis_only:
        verify_and_report_models()

        print("Starting experiment (Ctrl+C to stop – progress is checkpointed)...\n")
        from experiment_runner import run_experiment
        results = run_experiment()
        print(f"\n  Total results collected: {len(results)}")
    else:
        print("--analysis flag set: skipping experiment, running analysis only.\n")

    print("\nRunning analysis...")
    from analysis import run_analysis
    report = run_analysis()

    print("\n" + "=" * 64)
    print("  DONE")
    print(f"  Auto-scored:        {report.get('auto_scored', 0)}")
    print(f"  Manual review:      {report.get('manual_review_needed', 0)}")
    print(f"  Errors:             {report.get('errors', 0)}")
    print("=" * 64)


if __name__ == "__main__":
    main()
