"""Test package.  Makes ``src/`` importable so ``python3 -m unittest`` works
from ``ports/python`` without installing the package (no network needed)."""

import sys
from pathlib import Path

_SRC = str(Path(__file__).resolve().parents[1] / "src")
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)
