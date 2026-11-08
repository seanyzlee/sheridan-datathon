"""Screenshot a running page (the web app or Streamlit) with the installed Edge/Chrome over DevTools.

    python tools/screenshot.py "http://127.0.0.1:8000/?account=20396&inc=55&eim=6" docs/img/web-customer.png
    python tools/screenshot.py "http://127.0.0.1:8501/?account=20396&twist=EI 55% for 6 months" docs/img/customer.png
    add --dark or --light to pick the theme, --width 390 for a phone

Streamlit renders over a websocket after the page loads, so a plain `--headless --screenshot` captures
a blank page. This waits until the app has stopped running, then captures the full page.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request

from tornado.ioloop import IOLoop
from tornado.websocket import websocket_connect

BROWSERS = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe", "msedge", "google-chrome", "chromium"]


def _browser() -> str:
    for b in BROWSERS:
        if os.path.exists(b) or shutil.which(b):
            return b
    raise SystemExit("No Edge or Chrome found")


async def _capture(ws_url: str, url: str, width: int, wait: float, out: str, dark: bool | None = None) -> None:
    ws = await websocket_connect(ws_url, max_message_size=200 * 1024 * 1024)
    n = 0

    async def cmd(method, **params):
        nonlocal n
        n += 1
        await ws.write_message(json.dumps({"id": n, "method": method, "params": params}))
        while True:
            msg = json.loads(await ws.read_message())
            if msg.get("id") == n:
                return msg.get("result", {})

    await cmd("Emulation.setDeviceMetricsOverride", width=width, height=1000, deviceScaleFactor=1, mobile=False)
    await cmd("Page.enable")
    if dark is not None:
        await cmd("Emulation.setEmulatedMedia",
                  features=[{"name": "prefers-color-scheme", "value": "dark" if dark else "light"}])
    await cmd("Page.navigate", url=url)
    # Wait until Streamlit has finished running (no "running" status widget) and the page settles.
    deadline = time.time() + wait
    # Streamlit: wait for the status widget to stop running. The web app: wait for no loading notes.
    js = ("(() => { const s = document.querySelector('[data-testid=\"stStatusWidget\"]');"
          " const m = document.querySelector('[data-testid=\"stMain\"]') || document.documentElement;"
          " const loading = document.querySelectorAll('.loading, .chart-body.stale').length;"
          " return JSON.stringify({running: !!(s && s.innerText.includes('Running')) || loading > 0,"
          " h: m.scrollHeight, n: document.querySelectorAll('[data-testid=\"stElementContainer\"], svg, table').length}); })()")
    stable, last = 0, None
    while time.time() < deadline:
        await IOLoop.current().run_in_executor(None, time.sleep, 1.0)
        r = await cmd("Runtime.evaluate", expression=js, returnByValue=True)
        state = json.loads(r.get("result", {}).get("value", "{}") or "{}")
        if state.get("n", 0) > 5 and not state.get("running") and state.get("h") == (last or {}).get("h"):
            stable += 1
            if stable >= 3:
                break
        else:
            stable = 0
        last = state
    await IOLoop.current().run_in_executor(None, time.sleep, 2.0)   # let charts finish drawing
    h = (last or {}).get("h", 2000) + 120
    await cmd("Emulation.setDeviceMetricsOverride", width=width, height=int(h), deviceScaleFactor=1, mobile=False)
    await IOLoop.current().run_in_executor(None, time.sleep, 2.0)
    shot = await cmd("Page.captureScreenshot", format="png", captureBeyondViewport=True)
    with open(out, "wb") as f:
        f.write(base64.b64decode(shot["data"]))
    ws.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=1500)
    ap.add_argument("--wait", type=float, default=60)
    ap.add_argument("--dark", action="store_true", help="emulate prefers-color-scheme: dark")
    ap.add_argument("--light", action="store_true", help="emulate prefers-color-scheme: light")
    ap.add_argument("--port", type=int, default=9333, help="DevTools port; give parallel runs different ports")
    a = ap.parse_args()
    port = a.port
    profile = tempfile.mkdtemp(prefix="shot-")
    proc = subprocess.Popen([_browser(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                             f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=1).read())
                page = next(t for t in tabs if t.get("type") == "page")
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise SystemExit("Browser did not start")
        IOLoop.current().run_sync(lambda: _capture(page["webSocketDebuggerUrl"], a.url, a.width, a.wait, a.out, True if a.dark else False if a.light else None))
        print(f"wrote {a.out} ({os.path.getsize(a.out):,} bytes)")
    finally:
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
