"""Stage only the public dashboard, modules, styles and draw data for Pages."""

import argparse
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    ".nojekyll",
    "index.html",
    "data/draws.json",
    "assets/lotto-picks.js",
    "assets/lotto-calendar.js",
    "assets/lotto-strategies.js",
    "assets/lotto-scoring.js",
    "assets/live-summary.js",
    "assets/live-ui.js",
    "assets/manual-generation.js",
    "assets/manual-ui.js",
    "assets/research-math.js",
    "assets/research-patterns.js",
    "assets/research-simulation.js",
    "assets/research-backtest.js",
    "assets/research-worker.js",
    "assets/research-ui.js",
    "assets/research.css",
)


def build(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    def generated(path):
        return path.parent == destination / 'data' / 'live' and (path.name == 'index.json' or
                 (path.suffix == '.json' and path.stem.isascii() and path.stem.isdecimal()))

    unexpected = [path for path in destination.rglob("*") if path.is_symlink() or
                  (path.is_file() and path.relative_to(destination).as_posix() not in FILES and not generated(path))]
    if unexpected:
        raise ValueError("Pages artifact directory contains unexpected files")
    for name in FILES:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    live = destination / 'data' / 'live'
    if live.exists():
        for path in live.glob('*.json'):
            if generated(path):
                path.unlink()
    subprocess.run(['node', str(ROOT / 'scripts' / 'build-live-index.mjs'), str(live.resolve())], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    build(parser.parse_args().destination)
