"""Assemble the folder that gets uploaded to the Hugging Face Space.

Usage:
    .venv/Scripts/python.exe tools/make_space.py                    # free account: Gradio on ZeroGPU
    .venv/Scripts/python.exe tools/make_space.py --target docker    # PRO account: Docker Space
    .venv/Scripts/python.exe tools/make_space.py --out DIR

The folder (build/hf-space by default) holds the git-tracked app files, the Parquet cache (the Space
has no data/ folder and no Tiger Data credentials, so every screen runs offline) and the Space's own
files from deploy/<target>:
- zerogpu: app.py, README and requirements for a Gradio Space. Free Spaces can't build the front end or
  the C++ core, so the front end is built here and uploaded as web/dist, and the NumPy simulation runs.
- docker (deploy/space): a Dockerfile that builds the front end and the C++ core in the container.
Secrets are never copied: .env is not tracked and is skipped by name.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPACE_FILES = ROOT / "deploy" / "space"

# Tracked paths the running app does not need (docs images, notebooks, tests, the Streamlit fallback, local tooling).
SKIP_PREFIXES = (
    ".claude/", ".vscode/", ".streamlit/", "app_pages/", "tests/", "tools/", "deploy/", "tiger/",
    "docs/img/", "web/public/screens/",
)
SKIP_FILES = {"README.md", "requirements.txt", "app.py", "ui.py", "pytest.ini", "discovery.ipynb", "CLAUDE.md", ".env", ".gitignore"}
SKIP_SUFFIXES = (".ipynb", ".png", ".jpg", ".gif", ".mp4")


TARGETS = {"zerogpu": ROOT / "deploy" / "zerogpu", "docker": SPACE_FILES}


def tracked_files(skip: tuple[str, ...] = ()) -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return [f for f in out.splitlines()
            if not f.startswith(SKIP_PREFIXES + skip) and f not in SKIP_FILES and not f.endswith(SKIP_SUFFIXES)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "hf-space")
    ap.add_argument("--target", choices=sorted(TARGETS), default="zerogpu")
    args = ap.parse_args()
    out: Path = args.out.resolve()
    prebuilt = args.target == "zerogpu"
    if out == ROOT or out in ROOT.parents:
        print(f"Refusing to write into {out}; pick a subfolder such as build/hf-space", file=sys.stderr)
        return 1

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    files = tracked_files(("web/", "hpc/") if prebuilt else ())
    for f in files:
        src = ROOT / f
        if src.is_file():
            (out / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, out / f)

    cache = ROOT / "cache"
    if not any(cache.glob("*.parquet")):
        print("cache/ has no Parquet files; run `python load.py` first", file=sys.stderr)
        return 1
    shutil.copytree(cache, out / "cache", ignore=shutil.ignore_patterns("__pycache__"))

    if prebuilt:
        npm = shutil.which("npm") or "npm"
        subprocess.run([npm, "--prefix", str(ROOT / "web"), "run", "build"], check=True)
        shutil.copytree(ROOT / "web" / "dist", out / "web" / "dist")

    for f in TARGETS[args.target].iterdir():
        shutil.copy2(f, out / f.name)

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file()) / 1e6
    print(f"Wrote {out} for {args.target} ({len(files)} tracked files plus the cache, {size:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
