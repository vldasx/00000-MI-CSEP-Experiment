"""
telegram_bot/notifier.py — shared Telegram notifier for all experiments.

Usage in experiment code:
    import telegram_bot.notifier as tg
    tg.send("message")
    tg.start_command_listener(get_progress, get_tokens)
    if tg.should_stop(): ...

Commands the user can send to the bot:
    /status   — current progress snapshot
    /stop     — set stop flag (experiment checks between questions)
    /tokens   — current token/cost stats
"""

import json
import os
import threading
import time
import urllib.request
import urllib.error

_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "telegram_config.json")

# Shared stop flag — set to True by /stop command
stop_requested = False
_last_update_id = 0
_lock = threading.Lock()


def _load_cfg() -> dict:
    with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def send(text: str, silent: bool = False) -> bool:
    """Send a Telegram message. Returns True on success."""
    try:
        cfg = _load_cfg()
        url = f"https://api.telegram.org/bot{cfg['token']}/sendMessage"
        payload = {
            "chat_id": cfg["chat_id"],
            "text": text,
            "parse_mode": "Markdown",
            "disable_notification": silent,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()).get("ok", False)
    except Exception as e:
        print(f"  [Telegram] send failed: {e}")
        return False


def _poll_commands(get_progress_fn, get_tokens_fn) -> None:
    """Background thread: poll for commands every 5 s."""
    global stop_requested, _last_update_id
    cfg = _load_cfg()
    base = f"https://api.telegram.org/bot{cfg['token']}"

    while True:
        try:
            url = f"{base}/getUpdates?offset={_last_update_id + 1}&timeout=4"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())

            for upd in data.get("result", []):
                _last_update_id = upd["update_id"]
                text = upd.get("message", {}).get("text", "").strip().lower()

                cmd = text.lstrip("/")
                if cmd == "status":
                    send(get_progress_fn())
                elif cmd == "stop":
                    with _lock:
                        stop_requested = True
                    send("*STOP* flag set. Eksperiment ce stati nakon trenutnog pitanja.")
                elif cmd == "tokens":
                    send(get_tokens_fn())
                elif text.strip():
                    send("Komande: /status /stop /tokens\n(sa ili bez /)")

        except Exception:
            pass  # Silently ignore poll errors

        time.sleep(5)


def start_command_listener(get_progress_fn, get_tokens_fn) -> None:
    """Start background polling thread."""
    t = threading.Thread(
        target=_poll_commands,
        args=(get_progress_fn, get_tokens_fn),
        daemon=True,
    )
    t.start()


def should_stop() -> bool:
    with _lock:
        return stop_requested
