"""Check that SAM deps (torch, segment_anything) are importable in this Python.
Exit 0 if OK, 1 otherwise. Used by start-algo.bat to avoid 503 when wrong env is used.
"""
import sys
try:
    import torch
    from segment_anything import SamPredictor  # noqa: F401
    print("OK: torch and segment_anything found in this Python.")
    sys.exit(0)
except ImportError as e:
    print("This Python does not have SAM dependencies:", e, file=sys.stderr)
    print("Use the SAME Python where you ran: pip install -r requirements.txt", file=sys.stderr)
    print("Example: open Anaconda Prompt, cd to apps\\algo, then run:", file=sys.stderr)
    print("  python -m uvicorn algo.main:app --host 0.0.0.0 --port 8000", file=sys.stderr)
    sys.exit(1)
