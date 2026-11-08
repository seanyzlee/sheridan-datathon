"""Automated quality audit of the running web app: axe-core accessibility checks and console errors,
for every page, at desktop and phone width, in light and dark mode.

    python tools/audit.py                     # all pages, writes docs/audit.json, prints a summary
    python tools/audit.py --base http://127.0.0.1:8001 --pages / /bank

The app must already be running (uvicorn api:app). Uses the installed Edge/Chrome over DevTools and
injects web/node_modules/axe-core/axe.min.js into each page. Exit code 1 if any serious or critical
accessibility violation or any console error is found.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from tornado.ioloop import IOLoop
from tornado.websocket import websocket_connect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from screenshot import _browser  # noqa: E402

AXE = (ROOT / "web" / "node_modules" / "axe-core" / "axe.min.js").read_text(encoding="utf-8")
PAGES = ["/?account=20396", "/?account=20396&inc=55&eim=6", "/?account=26773", "/bank?inc=55&eim=6",
         "/finding", "/?account=20396&inc=55&eim=6&view=advanced", "/bank?inc=55&eim=6&view=advanced",
         "/time-machine?view=advanced", "/method?view=advanced"]


async def _audit_one(ws_url: str, url: str, width: int, dark: bool) -> dict:
    ws = await websocket_connect(ws_url, max_message_size=64 * 1024 * 1024)
    n = 0
    errors: list[str] = []

    async def cmd(method, **params):
        nonlocal n
        n += 1
        my = n
        await ws.write_message(json.dumps({"id": my, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.read_message())
            if msg.get("method") == "Runtime.exceptionThrown":
                errors.append(msg["params"]["exceptionDetails"].get("text", "exception")
                              + " " + str(msg["params"]["exceptionDetails"].get("exception", {}).get("description", ""))[:200])
            if msg.get("method") == "Runtime.consoleAPICalled" and msg["params"].get("type") == "error":
                errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"].get("args", []))[:300])
            if msg.get("id") == my:
                return msg.get("result", {})

    await cmd("Runtime.enable")
    await cmd("Emulation.setDeviceMetricsOverride", width=width, height=900, deviceScaleFactor=1, mobile=width < 600)
    await cmd("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "dark" if dark else "light"}])
    await cmd("Page.enable")
    await cmd("Page.navigate", url=url)
    # wait for loading notes to clear and the page height to settle
    stable, last_h = 0, -1
    for _ in range(40):
        await IOLoop.current().run_in_executor(None, time.sleep, 0.5)
        r = await cmd("Runtime.evaluate", returnByValue=True, expression=(
            "JSON.stringify({h: document.documentElement.scrollHeight, l: document.querySelectorAll('.loading').length})"))
        st = json.loads(r.get("result", {}).get("value", "{}") or "{}")
        stable = stable + 1 if st.get("l", 1) == 0 and st.get("h") == last_h else 0
        last_h = st.get("h", -1)
        if stable >= 3:
            break
    await cmd("Runtime.evaluate", expression=AXE)
    res = await cmd("Runtime.evaluate", awaitPromise=True, returnByValue=True, expression=(
        "axe.run(document, {resultTypes: ['violations']}).then(r => JSON.stringify(r.violations.map(v => "
        "({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, "
        "targets: v.nodes.slice(0, 3).map(n => n.target.join(' '))}))))"))
    violations = json.loads(res.get("result", {}).get("value", "[]") or "[]")
    ws.close()
    return {"url": url, "width": width, "dark": dark, "violations": violations, "console_errors": errors}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--pages", nargs="*", default=PAGES)
    ap.add_argument("--out", default=str(ROOT / "docs" / "audit.json"))
    ap.add_argument("--port", type=int, default=9341)
    a = ap.parse_args()

    profile = tempfile.mkdtemp(prefix="audit-")
    proc = subprocess.Popen([_browser(), "--headless=new", "--disable-gpu", f"--remote-debugging-port={a.port}",
                             f"--user-data-dir={profile}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = []
    try:
        for _ in range(50):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{a.port}/json", timeout=1).read())
                page = next(t for t in tabs if t.get("type") == "page")
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise SystemExit("Browser did not start")
        for path in a.pages:
            for width, dark in [(1440, False), (390, False), (1440, True)]:
                r = IOLoop.current().run_sync(lambda: _audit_one(page["webSocketDebuggerUrl"], a.base + path, width, dark))
                results.append(r)
    finally:
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)

    Path(a.out).write_text(json.dumps(results, indent=2), encoding="utf-8")
    bad = 0
    for r in results:
        serious = [v for v in r["violations"] if v["impact"] in ("serious", "critical")]
        bad += len(serious) + len(r["console_errors"])
        tag = f"{r['url'].replace(a.base, '')} @{r['width']}{' dark' if r['dark'] else ''}"
        print(f"{tag}: {len(r['violations'])} violations ({len(serious)} serious/critical), {len(r['console_errors'])} console errors")
        for v in r["violations"]:
            print(f"    [{v['impact']}] {v['id']}: {v['help']} ({v['nodes']} nodes) e.g. {v['targets'][:1]}")
        for e in r["console_errors"][:3]:
            print(f"    console: {e}")
    print(f"\nTOTAL serious/critical violations + console errors: {bad}  (details in {a.out})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
