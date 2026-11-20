"""Smoke test the wardbyte worker protocol directly over JSON-lines stdio.

Usage: python test/test_worker.py
Optional env overrides:
  WARDBYTE_PYTHON   interpreter for the worker (default: sys.executable)
  WARDBYTE_POLLOUT  path used for fs_stat/fs_list (default: the worker dir)
"""
import json
import os
import pathlib
import subprocess
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = os.environ.get("WARDBYTE_PYTHON", sys.executable)
WORKER = str(ROOT / "worker" / "wardbyte_worker.py")
POLLOUT = os.environ.get("WARDBYTE_POLLOUT", str(ROOT / "worker"))

p = subprocess.Popen(
    [PY, "-u", WORKER],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, encoding="utf-8", cwd=str(ROOT / "worker"),
)

responses = {}
outcome = {"ok": True}

def reader():
    for line in p.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            print("BADLINE:", line[:200])
            outcome["ok"] = False
            continue
        if obj.get("ready"):
            print("READY OK")
            continue
        if obj.get("fatal"):
            print("FATAL:", obj["fatal"])
            return
        responses[obj["id"]] = obj

t = threading.Thread(target=reader, daemon=True)
t.start()

def send(rid, name, arguments):
    p.stdin.write(json.dumps({"id": rid, "name": name, "arguments": arguments}) + "\n")
    p.stdin.flush()
    for _ in range(600):
        if rid in responses:
            return responses[rid]
        threading.Event().wait(0.1)
    return {"timeout": True}

r1 = send(1, "fs_stat", {"path": POLLOUT})
print("fs_stat:", json.dumps(r1, ensure_ascii=False)[:400])
if not r1.get("ok"):
    outcome["ok"] = False

r2 = send(2, "assemble_code", {"code": "mov eax, 1", "architecture": "x86-64"})
print("assemble_code:", json.dumps(r2, ensure_ascii=False)[:300])
if not r2.get("ok"):
    outcome["ok"] = False

r3 = send(3, "fs_list", {"path": POLLOUT})
print("fs_list:", json.dumps(r3, ensure_ascii=False)[:300])

r4 = send(4, "notes_list", {})
print("notes_list:", json.dumps(r4, ensure_ascii=False)[:300])
if not r4.get("ok"):
    outcome["ok"] = False

r5 = send(5, "no_such_tool", {})
print("unknown:", json.dumps(r5, ensure_ascii=False)[:200])
if not (r5.get("ok") and r5.get("result", {}).get("success") is False):
    outcome["ok"] = False

p.stdin.close()
p.wait(timeout=20)
print("exit:", p.returncode)
print("outcome_ok:", outcome["ok"])
sys.exit(0 if outcome["ok"] and p.returncode == 0 else 1)
