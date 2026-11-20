"""wardbyte_worker.py - stdio JSON-lines bridge for the dsh-wardbyte native DSH plugin.

Protocol (one JSON object per line):
  request  -> {"id": <n>, "name": "<tool>", "arguments": {...}}
  response <- {"id": <n>, "ok": true,  "result": {...}}
          or {"id": <n>, "ok": false, "error": "..."}
  startup  <- {"ok": true,  "ready": true}
          or {"ok": false, "fatal": "..."}

Wardbyte's own dispatch always returns a structured JSON dict
({"success": bool, "data"/"error": ...}), so tool failures stay ok:true.
Only protocol-level failures produce ok:false. Everything logged by
wardbyte goes to stderr (safe to mix with stdout JSON lines).
"""
import json
import sys


def main() -> None:
    try:
        from wardbyte.server import WardbyteServer
    except ImportError as exc:
        sys.stdout.write(json.dumps({
            "ok": False,
            "fatal": f"The wardbyte Python package is not installed for this interpreter "
                     f"({sys.executable or sys.exec_prefix}); install it with: pip install "
                     f"https://github.com/JV-1054/wardbyte-dsh/releases/download/wardbyte-core-v1.2.1/"
                     f"wardbyte-1.2.1-py3-none-any.whl (original error: {exc})",
        }) + "\n")
        sys.stdout.flush()
        return

    try:
        server = WardbyteServer()
    except Exception as exc:
        sys.stdout.write(json.dumps({"ok": False, "fatal": str(exc)}) + "\n")
        sys.stdout.flush()
        return

    sys.stdout.write(json.dumps({"ok": True, "ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            name = req["name"]
            arguments = req.get("arguments") or {}
            if not isinstance(arguments, dict):
                raise ValueError("arguments must be an object")
            result = server._dispatch(name, arguments)
            resp = {"id": rid, "ok": True, "result": result}
        except KeyError as exc:
            resp = {"id": rid, "ok": False, "error": f"missing field: {exc}"}
        except Exception as exc:
            resp = {"id": rid, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(resp, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
