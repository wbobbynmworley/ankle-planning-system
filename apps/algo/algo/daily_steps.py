# Common daily step format for API response
from __future__ import annotations

from typing import List, Any


def daily_steps_from_resampled_path(pts: List[tuple]) -> List[dict]:
    """Build API daily steps from already resampled 3D path (list of (x,y,z))."""
    if not pts:
        return []
    out: List[dict] = []
    cum = 0.0
    prev = pts[0]
    for i, p in enumerate(pts):
        if i == 0:
            delta = 0.0
        else:
            dx = p[0] - prev[0]
            dy = p[1] - prev[1]
            dz = p[2] - prev[2]
            delta = (dx * dx + dy * dy + dz * dz) ** 0.5
            cum += delta
            prev = p
        out.append({
            "dayIndex": i,
            "poseMm": [p[0], p[1], p[2]],
            "deltaMm": round(delta, 6),
            "cumulativeMm": round(cum, 6),
        })
    return out
