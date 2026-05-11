"""
telegram_bot/claude_bot.py — Telegram bot koji prosljedjuje poruke Claude-u i vraca odgovore.

Pokretanje (iz root foldera projekta):
    python telegram_bot/claude_bot.py

Komande u Telegram-u:
    /reset   — ocisti kontekst razgovora (nova sesija)
    /model   — ispisi trenutni model
    /help    — lista komandi
    sve ostalo — salji kao prompt Claude-u

Zaustavljanje: Ctrl+C
"""

import json
import os
import sys
import time
import textwrap
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Konfiguracija ─────────────────────────────────────────────────────────────

BOT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT    = os.path.dirname(BOT_DIR)

TG_CFG  = os.path.join(BOT_DIR, "telegram_config.json")
API_CFG = os.path.join(ROOT, "experiment_I", "open_router_api.json")

MODEL        = "anthropic/claude-sonnet-4-5"
MAX_TOKENS   = 2048
POLL_TIMEOUT = 20          # long-poll sekundi
MAX_MSG_LEN  = 4000        # Telegram limit ~4096 znakova

SYSTEM_PROMPT = (
    "You are Claude, an AI assistant. The user is messaging you through a "
    "Telegram bot connected to their CSEP (Conceptual Space Expansion Prompting) "
    "research project. Be concise and helpful. Respond in the same language the "
    "user writes in (English or Bosnian/Serbian/Croatian)."
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_tg() -> dict:
    with open(TG_CFG, "r", encoding="utf-8") as f:
        return json.load(f)


def load_api_key() -> str:
    with open(API_CFG, "r", encoding="utf-8") as f:
        return json.load(f)["open_router"]["api_key"]


def tg_request(method: str, payload: dict, token: str) -> dict:
    url  = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(url, data=data,
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def send_message(text: str, chat_id: int, token: str) -> None:
    """Salje poruku; dijeli na vise dijelova ako je predugacka."""
    chunks = textwrap.wrap(text, MAX_MSG_LEN, break_long_words=False,
                           replace_whitespace=False)
    if not chunks:
        chunks = [text]
    for chunk in chunks:
        try:
            tg_request("sendMessage", {
                "chat_id":    chat_id,
                "text":       chunk,
                "parse_mode": "Markdown",
            }, token)
        except Exception:
            # Fallback bez Markdown ako parsiranje pukne
            try:
                tg_request("sendMessage", {
                    "chat_id": chat_id,
                    "text":    chunk,
                }, token)
            except Exception as e:
                print(f"  [TG] send failed: {e}")


def send_typing(chat_id: int, token: str) -> None:
    try:
        tg_request("sendChatAction",
                   {"chat_id": chat_id, "action": "typing"}, token)
    except Exception:
        pass


def call_claude(messages: list, api_key: str) -> str:
    url     = "https://openrouter.ai/api/v1/chat/completions"
    payload = {
        "model":      MODEL,
        "max_tokens": MAX_TOKENS,
        "messages":   messages,
        "system":     SYSTEM_PROMPT,
    }
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(url, data=data, headers={
        "Content-Type":  "application/json",
        "Authorization": f"Bearer {api_key}",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read())
    return resp["choices"][0]["message"]["content"].strip()


# ── Polling loop ──────────────────────────────────────────────────────────────

def main() -> None:
    tg_cfg  = load_tg()
    token   = tg_cfg["token"]
    chat_id = int(tg_cfg["chat_id"])
    api_key = load_api_key()

    history: list[dict] = []
    last_update_id = 0

    print(f"[bot] Pokrenut. Model: {MODEL}")
    print(f"[bot] Slusa na chat_id={chat_id}")
    print(f"[bot] Ctrl+C za zaustavljanje.\n")

    send_message(
        f"Bot pokrenut ✓\nModel: `{MODEL}`\n\n"
        "Samo pisi — prosljedjujem poruke Claude-u.\n"
        "/reset — nova sesija  |  /help — komande",
        chat_id, token
    )

    while True:
        try:
            url = (f"https://api.telegram.org/bot{token}/getUpdates"
                   f"?offset={last_update_id + 1}&timeout={POLL_TIMEOUT}")
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=POLL_TIMEOUT + 5) as r:
                data = json.loads(r.read())

            for upd in data.get("result", []):
                last_update_id = upd["update_id"]
                msg  = upd.get("message", {})
                text = msg.get("text", "").strip()
                uid  = msg.get("chat", {}).get("id")

                if uid != chat_id:
                    continue
                if not text:
                    continue

                # ── Komande ──────────────────────────────────────────────────
                if text.startswith("/reset"):
                    history.clear()
                    send_message("Kontekst obrisan. Nova sesija.", chat_id, token)
                    print("[bot] Kontekst resetovan.")
                    continue

                if text.startswith("/model"):
                    send_message(f"Trenutni model: `{MODEL}`", chat_id, token)
                    continue

                if text.startswith("/help"):
                    send_message(
                        "*Komande:*\n"
                        "/reset — obrisi kontekst razgovora\n"
                        "/model — ispisi model\n"
                        "/help  — ova poruka\n\n"
                        "Sve ostalo se salje Claude-u direktno.",
                        chat_id, token
                    )
                    continue

                # ── Prompt → Claude ──────────────────────────────────────────
                print(f"[user] {text[:80]}{'...' if len(text) > 80 else ''}")
                send_typing(chat_id, token)

                history.append({"role": "user", "content": text})

                try:
                    reply = call_claude(history, api_key)
                    history.append({"role": "assistant", "content": reply})
                    send_message(reply, chat_id, token)
                    print(f"[claude] {reply[:80]}{'...' if len(reply) > 80 else ''}\n")
                except Exception as e:
                    err = f"Greska pri pozivu API-ja: {e}"
                    send_message(err, chat_id, token)
                    print(f"  [ERROR] {e}")
                    if history and history[-1]["role"] == "user":
                        history.pop()

        except KeyboardInterrupt:
            print("\n[bot] Zaustavljam...")
            send_message("Bot ugasen.", chat_id, token)
            break
        except urllib.error.URLError as e:
            print(f"  [poll error] {e} — ponovni pokusaj za 5s")
            time.sleep(5)
        except Exception as e:
            print(f"  [unexpected] {e}")
            time.sleep(2)


if __name__ == "__main__":
    main()
