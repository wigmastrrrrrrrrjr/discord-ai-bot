#!/usr/bin/env python3
"""
agentrelay — bind theAIagent to your real terminal.

Usage:
    agentrelay bind <one-time-code>   # from `/agent relay` in Discord
    agentrelay refresh                # rotate to a fresh 2h token
    agentrelay run                    # start the polling bridge (interactive)

The bridge polls the bot worker for pending shell commands every second,
executes them locally with your shell, and posts the output back. The token
lives two hours; when the window lapses the agent is halted until you
refresh, then it continues where it left off.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BOT_URL", "https://discord-ai-bot.csomeone301.workers.dev").rstrip("/")
STATE_FILE = os.path.expanduser(os.environ.get("AGENTRELAY_STATE", "~/.config") + "/agentrelay.json")

HALTED_NOTICE = (
    "\n[agentrelay] The agent's relay window expired — it has been halted.\n"
    "             Run `agentrelay refresh` to start a new 2-hour window;\n"
    "             the agent then picks up exactly where it left off.\n"
)


def post(action: str, payload: dict) -> dict:
    body = json.dumps({"action": action, **payload}).encode()
    request = urllib.request.Request(
        f"{BASE}/api/agent/relay",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body_text = error.read().decode("utf-8", "replace")
        try:
            return json.loads(body_text)
        except Exception:
            return {"error": f"HTTP {error.code}"}


def load_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as handle:
        json.dump(state, handle)


def print_ttl(seconds: float) -> None:
    hours, remainder = divmod(int(seconds), 3600)
    minutes = remainder // 60
    print(f"[agentrelay] window: {hours}h{minutes:02d}m remaining")


def run_loop(token: str) -> None:
    print("[agentrelay] bridge running — commands from the agent execute here.")
    print("[agentrelay] press Ctrl+C to stop.")
    while True:
        data = post("poll", {"token": token})
        if "error" in data:
            if "expired" in str(data["error"]) or "invalid" in str(data["error"]):
                sys.stdout.write(HALTED_NOTICE)
                while True:
                    answer = input("[agentrelay] type `refresh` to continue or `exit`: ").strip().lower()
                    if answer == "refresh":
                        token = refresh(token)
                        sys.stdout.write("[agentrelay] window restarted. The agent continues.\n")
                        break
                    if answer in ("exit", "quit"):
                        return
                continue
            time.sleep(3)
            continue

        ttl = data.get("ttlMs")
        if isinstance(ttl, (int, float)) and 0 < ttl < 120_000:
            # Inside the last two minutes: refresh transparently so the
            # agent keeps working inside an always-live window.
            token = refresh(token)

        command, command_id = data.get("command"), data.get("commandId")
        if not command or not command_id:
            time.sleep(1)
            continue

        print(f"[agentrelay] $ {command}")
        try:
            result = subprocess.run(
                ["/bin/bash", "-c", command],
                capture_output=True,
                text=True,
                timeout=55,
            )
            output = (result.stdout or "") + (result.stderr or "")
            status = result.returncode
        except subprocess.TimeoutExpired as error:
            output = f"timed out after 55s; partial: {error.stdout} {error.stderr}"
            status = 124
        post("result", {"token": token, "commandId": command_id,
                        "output": f"[exit {status}] {output}"})
        time.sleep(0.2)


def refresh(old_token: str | None) -> str:
    if not old_token:
        print("No bound session to refresh. Use `agentrelay bind <code>` first.")
        sys.exit(1)
    data = post("refresh", {"token": old_token})
    if "error" in data or "token" not in data:
        print(f"Refresh failed: {data.get('error', 'unknown response')}")
        print("Bind again with `agentrelay bind <code>` (new code from `/agent relay`).")
        sys.exit(1)
    state = load_state()
    state["token"] = data["token"]
    state["expiresAt"] = data["expiresAt"]
    save_state(state)
    print_ttl(data.get("ttlMs", 0) / 1000)
    return data["token"]


def main() -> None:
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return

    state = load_state()
    command = argv[0]

    if command == "bind":
        if len(argv) < 2:
            print("Usage: agentrelay bind <code>")
            sys.exit(1)
        data = post("bind", {"code": argv[1]})
        if "error" in data or "token" not in data:
            print(f"Bind failed: {data.get('error', 'unknown response')}")
            sys.exit(1)
        state["token"] = data["token"]
        state["expiresAt"] = data["expiresAt"]
        save_state(state)
        print(f"Bound. token saved to {STATE_FILE}")
        print_ttl(data["ttlMs"] / 1000)
        run_loop(data["token"])

    elif command == "refresh":
        refresh(state.get("token"))

    elif command == "run":
        token = state.get("token", "")
        if not token:
            print("No bound session. Use: agentrelay bind <code>")
            sys.exit(1)
        ttl_left = state.get("expiresAt", 0) / 1000 - time.time()
        if ttl_left <= 0:
            print(HALTED_NOTICE)
            token = refresh(token)
        else:
            print_ttl(ttl_left)
        run_loop(token)

    else:
        print(__doc__)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[agentrelay] stopped.")
