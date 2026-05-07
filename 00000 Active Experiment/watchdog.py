"""
watchdog.py — prati experiment log i ubija eksperiment ako detektuje API greske.
Cita PID iz experiment.pid fajla koji kreira start_experiment.ps1.
"""

import time
import subprocess
import sys
import os

BASE = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE, "experiment_new_run.log")
PID_FILE = os.path.join(BASE, "experiment.pid")
CHECK_INTERVAL = 10
ERROR_THRESHOLD = 5


def read_pid():
    try:
        with open(PID_FILE) as f:
            return int(f.read().strip())
    except Exception:
        return None


def pid_alive(pid):
    result = subprocess.run(
        ["powershell", "-Command", f"Get-Process -Id {pid} -ErrorAction SilentlyContinue"],
        capture_output=True, text=True
    )
    return bool(result.stdout.strip())


def kill_pid(pid):
    subprocess.run(
        ["powershell", "-Command", f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"],
        capture_output=True
    )


def tail_new_lines(f, pos):
    f.seek(0, 2)
    new_pos = f.tell()
    if new_pos <= pos:
        return [], new_pos
    f.seek(pos)
    lines = f.read(new_pos - pos).splitlines()
    return lines, new_pos


def main():
    print(f"[watchdog] PID file: {PID_FILE}")
    print(f"[watchdog] Log: {LOG_FILE}")
    print(f"[watchdog] Threshold: {ERROR_THRESHOLD} uzastopnih gresaka")

    # Cekaj PID file
    for _ in range(30):
        if os.path.exists(PID_FILE):
            break
        print("[watchdog] Cekam experiment.pid...")
        time.sleep(2)
    else:
        print("[watchdog] PID file nije pronadjen. Izlazim.")
        sys.exit(1)

    pid = read_pid()
    print(f"[watchdog] Pratim PID {pid}")

    # Cekaj log
    for _ in range(30):
        if os.path.exists(LOG_FILE):
            break
        time.sleep(2)

    consecutive_errors = 0

    with open(LOG_FILE, encoding="utf-8", errors="replace") as f:
        f.seek(0, 2)
        pos = f.tell()
        print(f"[watchdog] Pracenje pocelo.")

        while True:
            time.sleep(CHECK_INTERVAL)

            if not pid_alive(pid):
                print(f"[watchdog] Eksperiment (PID {pid}) vise ne postoji. Izlazim.")
                sys.exit(0)

            new_lines, pos = tail_new_lines(f, pos)
            for line in new_lines:
                if "ERROR: API failed" in line or "ERROR:" in line:
                    consecutive_errors += 1
                    print(f"[watchdog] Neuspjesni poziv #{consecutive_errors}: {line.strip()}")
                    if consecutive_errors >= ERROR_THRESHOLD:
                        print(f"[watchdog] THRESHOLD {ERROR_THRESHOLD} dostignut — zaustavljam PID {pid}...")
                        kill_pid(pid)
                        if os.path.exists(PID_FILE):
                            os.remove(PID_FILE)
                        print("[watchdog] Gotovo. Izlazim.")
                        sys.exit(0)
                elif "ok" in line.lower() and "condition" not in line.lower():
                    if consecutive_errors > 0:
                        print(f"[watchdog] Reset greske (bio {consecutive_errors})")
                    consecutive_errors = 0


if __name__ == "__main__":
    main()
