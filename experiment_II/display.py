"""
display.py — Rich live display for the CSEP experiment.

Shows:
  • Two progress bars (overall + current model)
  • Animated spinner while API call is in flight
  • Scrolling log of recent completions
  • Token / cost / ETA stats
"""

import itertools
import logging
import os
import time
from collections import deque
from datetime import datetime, timedelta

from rich.columns import Columns
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.progress import BarColumn, MofNCompleteColumn, Progress, SpinnerColumn, TextColumn, TimeRemainingColumn
from rich.table import Table
from rich.text import Text

# ── File logger ──────────────────────────────────────────────────────────────

def setup_file_logger(log_path: str) -> logging.Logger:
    logger = logging.getLogger("csep")
    logger.setLevel(logging.DEBUG)
    if not logger.handlers:
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))
        logger.addHandler(fh)
    return logger


# ── Spinner frames (growing/shrinking circle) ────────────────────────────────

_CIRCLE_FRAMES = [
    "·", "○", "◎", "●", "◎", "○", "·",
]
_DOT_TRAIL = "⠁⠂⠄⡀⢀⠠⠐⠈"

def _spinner_frame(tick: int) -> str:
    frames = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]
    return frames[tick % len(frames)]


# ── Main display class ───────────────────────────────────────────────────────

class ExperimentDisplay:
    MAX_LOG = 12

    def __init__(
        self,
        total_records: int,
        models: list,
        log_path: str,
    ):
        self.total_records = total_records
        self.models = models
        self.model_names = {m["id"]: m["name"] for m in models}
        self.n_models = len(models)

        self.logger = setup_file_logger(log_path)
        self.console = Console()

        # State
        self.overall_done = 0
        self.model_done = 0
        self.model_total = 0
        self.current_model_id = ""
        self.current_model_idx = 0
        self.current_question = ""
        self.current_qid = ""
        self.status = "Starting..."
        self.calling_api = False

        self.tokens_in = 0
        self.tokens_out = 0
        self.cost = 0.0
        self.api_calls = 0
        self.start_time = time.time()

        self.log_entries: deque = deque(maxlen=self.MAX_LOG)
        self._tick = 0
        self._live: Live | None = None

        # Progress bars (managed internally)
        self._progress_overall = Progress(
            TextColumn("[bold cyan]Overall[/bold cyan]"),
            BarColumn(bar_width=40, style="cyan", complete_style="bold cyan"),
            MofNCompleteColumn(),
            TextColumn("[cyan]{task.percentage:>5.1f}%[/cyan]"),
            TimeRemainingColumn(),
            expand=False,
        )
        self._task_overall = self._progress_overall.add_task(
            "overall", total=total_records
        )

        self._progress_model = Progress(
            TextColumn("[bold green]Model  [/bold green]"),
            BarColumn(bar_width=40, style="green", complete_style="bold green"),
            MofNCompleteColumn(),
            TextColumn("[green]{task.percentage:>5.1f}%[/green]"),
            expand=False,
        )
        self._task_model = self._progress_model.add_task("model", total=1)

    # ── Internal rendering ────────────────────────────────────────────────────

    def _make_layout(self) -> Layout:
        layout = Layout()
        layout.split_column(
            Layout(name="header", size=3),
            Layout(name="bars",   size=4),
            Layout(name="status", size=3),
            Layout(name="log",    minimum_size=6),
            Layout(name="footer", size=3),
        )
        return layout

    def _render_header(self) -> Panel:
        elapsed = timedelta(seconds=int(time.time() - self.start_time))
        title = Text("  CSEP  ZERO-SHOT  PRETEST  ", style="bold white on dark_blue")
        sub   = Text(f"  elapsed {elapsed}  ", style="dim")
        return Panel(Columns([title, sub]), style="dark_blue")

    def _render_bars(self) -> Panel:
        return Panel(
            Columns([self._progress_overall, self._progress_model], equal=False),
            title="Progress",
            border_style="cyan",
            padding=(0, 1),
        )

    def _render_status(self) -> Panel:
        spinner = _spinner_frame(self._tick) if self.calling_api else "·"
        model_label = self.model_names.get(self.current_model_id, self.current_model_id)
        idx_label   = f"[dim]{self.current_model_idx}/{self.n_models}[/dim]"

        line1 = Text.assemble(
            (f" {spinner} ", "bold yellow"),
            ("Model: ", "dim"),
            (model_label, "bold yellow"),
            (" ", ""),
            (idx_label, ""),
        )
        line2 = Text.assemble(
            ("   Q: ", "dim"),
            (self.current_qid, "bold"),
            ("  ", ""),
            (self.current_question[:80], "italic"),
        )
        line3 = Text.assemble(
            ("   ", ""),
            (self.status, "cyan"),
        )
        body = Text("\n").join([line1, line2, line3])
        return Panel(body, title="Current", border_style="yellow", padding=(0, 1))

    def _render_log(self) -> Panel:
        table = Table.grid(padding=(0, 2))
        table.add_column(width=6,  style="dim")
        table.add_column(width=40)
        table.add_column(style="dim")

        for entry in list(self.log_entries):
            status_style = "green" if entry["ok"] else "red"
            mark = "✓" if entry["ok"] else "✗"
            table.add_row(
                f"[{status_style}]{mark}[/{status_style}] {entry['qid']}",
                entry["question"][:45],
                entry["model"],
            )

        return Panel(table, title="Recent completions", border_style="dim", padding=(0, 1))

    def _render_footer(self) -> Panel:
        rate = self.overall_done / max(time.time() - self.start_time, 1)
        remaining = (self.total_records - self.overall_done) / max(rate, 0.001)
        eta_str = str(timedelta(seconds=int(remaining)))

        text = Text.assemble(
            (" API calls: ", "dim"), (str(self.api_calls), "bold"),
            ("   in: ", "dim"),  (f"{self.tokens_in:,}", "bold cyan"),
            ("   out: ", "dim"), (f"{self.tokens_out:,}", "bold cyan"),
            ("   cost: ", "dim"), (f"${self.cost:.4f}", "bold green"),
            ("   ETA: ", "dim"), (eta_str, "bold white"),
        )
        return Panel(text, border_style="dim", padding=(0, 1))

    def _refresh(self) -> None:
        if self._live is None:
            return
        layout = self._make_layout()
        layout["header"].update(self._render_header())
        layout["bars"].update(self._render_bars())
        layout["status"].update(self._render_status())
        layout["log"].update(self._render_log())
        layout["footer"].update(self._render_footer())
        self._live.update(layout)
        self._tick += 1

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        self._live = Live(
            renderable="",
            console=self.console,
            refresh_per_second=4,
            screen=False,
        )
        self._live.start()
        self.logger.info("Experiment display started")

    def stop(self) -> None:
        if self._live:
            self._live.stop()
            self._live = None
        self.logger.info("Experiment display stopped")

    def set_model(self, model_id: str, model_idx: int, model_total: int) -> None:
        self.current_model_id = model_id
        self.current_model_idx = model_idx
        self.model_done = 0
        self.model_total = model_total
        self._progress_model.reset(self._task_model, total=model_total)
        name = self.model_names.get(model_id, model_id)
        self.logger.info(f"Model {model_idx}/{self.n_models}: {name} ({model_id})")
        self._refresh()

    def set_question(self, qid: str, question: str) -> None:
        self.current_qid = qid
        self.current_question = question
        self.status = "Waiting for API..."
        self.calling_api = True
        self.logger.debug(f"  Q {qid}: {question[:80]}")
        self._refresh()

    def complete(self, qid: str, question: str, model_id: str, ok: bool, error: str = "") -> None:
        self.calling_api = False
        self.overall_done += 1
        self.model_done += 1
        self._progress_overall.advance(self._task_overall)
        self._progress_model.advance(self._task_model)

        model_short = self.model_names.get(model_id, model_id.split("/")[-1][:14])
        self.log_entries.append({
            "qid":      qid,
            "question": question,
            "model":    model_short,
            "ok":       ok,
        })
        status = "ok" if ok else f"ERROR: {error[:60]}"
        self.status = f"Done — {status}"
        if ok:
            self.logger.info(f"  ✓ Q {qid} [{model_short}]")
        else:
            self.logger.warning(f"  ✗ Q {qid} [{model_short}] ERROR: {error[:120]}")
        self._refresh()

    def update_stats(self, tokens_in: int, tokens_out: int, cost: float, api_calls: int) -> None:
        self.tokens_in  = tokens_in
        self.tokens_out = tokens_out
        self.cost       = cost
        self.api_calls  = api_calls
        self._refresh()

    def log_info(self, msg: str) -> None:
        self.logger.info(msg)

    def log_warning(self, msg: str) -> None:
        self.logger.warning(msg)
