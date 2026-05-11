# telegram_notifier.py — thin shim, sva logika je u telegram_bot/notifier.py
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from telegram_bot.notifier import (  # noqa: F401
    send,
    start_command_listener,
    should_stop,
    stop_requested,
)
