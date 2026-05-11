import json
import time
import urllib.request
import urllib.error

from config import load_api_config, RETRY_DELAYS, API_CALL_DELAY, MAX_TOKENS, TEMPERATURE

# ── Global token / cost counters (updated after every successful API call) ────
token_stats = {
    "prompt_tokens":     0,
    "completion_tokens": 0,
    "total_tokens":      0,
    "api_calls":         0,
    "estimated_cost_usd": 0.0,
}

# Pricing in USD per single token (fetched once at startup via fetch_pricing())
_pricing: dict = {}   # model_id -> {"prompt": float, "completion": float}


def fetch_pricing(model_ids: list) -> None:
    """Populate _pricing from the OpenRouter /api/v1/models endpoint."""
    cfg = load_api_config()
    headers = _build_headers()
    try:
        req = urllib.request.Request(
            f"{cfg['web_address']}/api/v1/models", headers=headers
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
        for m in data.get("data", []):
            if m["id"] in model_ids:
                p = m.get("pricing", {})
                _pricing[m["id"]] = {
                    "prompt":     float(p.get("prompt", 0)),
                    "completion": float(p.get("completion", 0)),
                }
    except Exception as e:
        print(f"  Warning: could not fetch pricing ({e})")


def reset_token_stats() -> None:
    for k in token_stats:
        token_stats[k] = 0


def get_token_summary() -> str:
    t = token_stats
    return (
        f"API calls: {t['api_calls']} | "
        f"Tokens in: {t['prompt_tokens']:,} | "
        f"Tokens out: {t['completion_tokens']:,} | "
        f"Total: {t['total_tokens']:,} | "
        f"Est. cost: ${t['estimated_cost_usd']:.4f}"
    )


def _build_headers() -> dict:
    cfg = load_api_config()
    return {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://csep-experiment.local",
        "X-Title": "CSEP Experiment",
    }


def _update_stats(model_id: str, usage: dict) -> None:
    pt = usage.get("prompt_tokens", 0)
    ct = usage.get("completion_tokens", 0)
    token_stats["prompt_tokens"]     += pt
    token_stats["completion_tokens"] += ct
    token_stats["total_tokens"]      += pt + ct
    token_stats["api_calls"]         += 1

    p = _pricing.get(model_id, {})
    token_stats["estimated_cost_usd"] += (
        pt * p.get("prompt", 0) + ct * p.get("completion", 0)
    )


def call_api(
    model_id: str,
    messages: list,
    call_type: str = "zero_shot",
) -> str:
    """
    Call the OpenRouter chat-completions endpoint with exponential-backoff retry.
    Updates global token_stats on success.
    Returns the assistant message content as a string.
    """
    cfg = load_api_config()
    url = f"{cfg['web_address']}/api/v1/chat/completions"

    payload = {
        "model": model_id,
        "messages": messages,
        "max_tokens": MAX_TOKENS.get(call_type, 1024),
        "temperature": TEMPERATURE.get(call_type, 0.3),
    }

    headers = _build_headers()
    delays = RETRY_DELAYS + [None]

    for attempt, delay in enumerate(delays):
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")

            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            time.sleep(API_CALL_DELAY)

            # OpenRouter sometimes returns HTTP 200 with an error body
            if "error" in result and "choices" not in result:
                err = result["error"]
                code = err.get("code", 0)
                msg  = err.get("message", str(err))[:200]
                print(f"\n    OpenRouter error (HTTP 200): {code} {msg}")
                if delay is None:
                    raise RuntimeError(f"API error after retries: {code} {msg}")
                wait = delay * 2 if code == 429 else delay
                print(f"    Retry in {wait}s...")
                time.sleep(wait)
                continue

            content = result["choices"][0]["message"]["content"]
            if not content or not content.strip():
                raise ValueError("Empty response from model")

            # Strip null bytes and other control chars Windows can't write to files
            content = "".join(ch for ch in content if ch >= " " or ch in "\n\r\t")

            # Record token usage
            usage = result.get("usage", {})
            _update_stats(model_id, usage)

            return content

        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8")[:300]
            except Exception:
                pass
            print(f"\n    HTTP {e.code}: {body}")

            if delay is None:
                raise RuntimeError(f"API failed after {len(RETRY_DELAYS)} retries: HTTP {e.code}") from e

            wait = delay * 2 if e.code == 429 else delay
            print(f"    Retry in {wait}s...")
            time.sleep(wait)

        except (urllib.error.URLError, TimeoutError, ConnectionResetError, OSError) as e:
            print(f"\n    Connection error: {e}")
            if delay is None:
                raise RuntimeError(f"API failed after {len(RETRY_DELAYS)} retries: {e}") from e
            print(f"    Retry in {delay}s...")
            time.sleep(delay)

        except ValueError as e:
            print(f"\n    {e}")
            if delay is None:
                raise RuntimeError(f"API returned empty response after {len(RETRY_DELAYS)} retries") from e
            print(f"    Retry in {delay}s...")
            time.sleep(delay)

    raise RuntimeError("Unreachable")


def verify_models(model_ids: list) -> dict:
    """
    Query /api/v1/models and check which of the requested model IDs are available.
    Returns dict: model_id -> True | list[str] (alternatives) | False.
    """
    cfg = load_api_config()
    url = f"{cfg['web_address']}/api/v1/models"
    headers = _build_headers()

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        available = {m["id"] for m in data.get("data", [])}
    except Exception as e:
        print(f"  Warning: could not fetch model list ({e}). Assuming all available.")
        return {mid: True for mid in model_ids}

    result = {}
    for mid in model_ids:
        if mid in available:
            result[mid] = True
        else:
            base_tokens = set(mid.split("/")[-1].lower().split("-"))
            alternatives = sorted(
                available,
                key=lambda m: -len(set(m.lower().split("/")[-1].split("-")) & base_tokens),
            )
            top = [a for a in alternatives if set(a.lower().split("/")[-1].split("-")) & base_tokens][:5]
            result[mid] = top if top else False

    return result
