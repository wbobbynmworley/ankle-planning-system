# 3D STL A* planner with collision (simplified from CT3D: translation-only, single moving mesh)
from __future__ import annotations

import math
import heapq
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

from .collision import PoseTR, CollisionChecker, Obstacle, _make_obstacle, _quat_norm

try:
    import vtk
    import pyvista as pv
except ImportError:
    vtk = None  # type: ignore
    pv = None  # type: ignore

ASTAR_TIMEOUT_SEC = 30.0
ASTAR_MAX_NODES = 400000
VOXEL_MM = 1.0


def _apply_transform_to_vtk_polydata(poly, transform):
    if vtk is None:
        raise RuntimeError("vtk not installed")
    filt = vtk.vtkTransformPolyDataFilter()
    filt.SetTransform(transform)
    filt.SetInputData(poly)
    filt.Update()
    out = vtk.vtkPolyData()
    out.ShallowCopy(filt.GetOutput())
    return out


def _vtk_transform_from_pose(pose: PoseTR):
    if vtk is None:
        raise RuntimeError("vtk not installed")
    R = _quat_to_rotmat(pose.q)
    M = vtk.vtkMatrix4x4()
    for i in range(3):
        for j in range(3):
            M.SetElement(i, j, float(R[i, j]))
    M.SetElement(0, 3, float(pose.t[0]))
    M.SetElement(1, 3, float(pose.t[1]))
    M.SetElement(2, 3, float(pose.t[2]))
    M.SetElement(3, 3, 1.0)
    tr = vtk.vtkTransform()
    tr.SetMatrix(M)
    return tr


def _quat_to_rotmat(q: np.ndarray) -> np.ndarray:
    q = _quat_norm(q)
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=float,
    )


def _build_voxel_grid(origin: np.ndarray, bounds: Tuple, voxel: float):
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    min_idx = np.floor((np.array([xmin, ymin, zmin]) - origin) / voxel).astype(int)
    max_idx = np.ceil((np.array([xmax, ymax, zmax]) - origin) / voxel).astype(int)
    return origin, min_idx, max_idx, voxel


def _idx_to_pos(idx: Tuple[int, int, int], origin: np.ndarray, voxel: float) -> np.ndarray:
    return (origin + np.array(idx, dtype=float) * voxel).astype(float)


def _pos_to_idx(pos: np.ndarray, origin: np.ndarray, voxel: float) -> Tuple[int, int, int]:
    rel = (pos - origin) / voxel
    return (int(round(rel[0])), int(round(rel[1])), int(round(rel[2])))


def _idx_in_bounds(idx: Tuple[int, int, int], min_idx: np.ndarray, max_idx: np.ndarray) -> bool:
    return (
        min_idx[0] <= idx[0] <= max_idx[0]
        and min_idx[1] <= idx[1] <= max_idx[1]
        and min_idx[2] <= idx[2] <= max_idx[2]
    )


@dataclass
class Plan3DResult:
    ok: bool
    path: List[PoseTR]
    total_len_mm: float = 0.0
    message: str = ""


def plan_3d_astar(
    start: PoseTR,
    goal: PoseTR,
    moving_poly,
    obstacle_polys: List[Tuple],
    voxel_mm: float = VOXEL_MM,
    margin_mm: float = 10.0,
) -> Plan3DResult:
    """Plan collision-free path from start to goal. obstacle_polys: list of (poly, pose)."""
    if vtk is None or pv is None:
        return Plan3DResult(False, [], message="vtk/pyvista not installed")
    obstacles = [_make_obstacle(p, pose) for p, pose in obstacle_polys]
    checker = CollisionChecker(moving_poly, obstacles, max_step_mm=0.5)
    if not checker.is_pose_collision_free(start):
        return Plan3DResult(False, [], message="Start in collision")
    if not checker.is_pose_collision_free(goal):
        return Plan3DResult(False, [], message="Goal in collision")

    mins = np.minimum(start.t, goal.t)
    maxs = np.maximum(start.t, goal.t)
    for obs in obstacles:
        b = obs.bounds_world
        mins = np.minimum(mins, np.array([b[0], b[2], b[4]]))
        maxs = np.maximum(maxs, np.array([b[1], b[3], b[5]]))
    mins -= margin_mm
    maxs += margin_mm
    bounds = (mins[0], maxs[0], mins[1], maxs[1], mins[2], maxs[2])
    origin = start.t.copy()
    min_idx, max_idx, voxel = _build_voxel_grid(origin, bounds, voxel_mm)[1:4]
    goal_idx = _pos_to_idx(goal.t, origin, voxel_mm)
    if not _idx_in_bounds(goal_idx, min_idx, max_idx):
        return Plan3DResult(False, [], message="Goal out of bounds")

    start_state = (0, 0, 0)
    goal_state = tuple(goal_idx)
    offsets = [
        (dx, dy, dz)
        for dx in (-1, 0, 1)
        for dy in (-1, 0, 1)
        for dz in (-1, 0, 1)
        if (dx, dy, dz) != (0, 0, 0)
    ]
    cost_per_step = voxel_mm * math.sqrt(3)

    def state_to_pose(st: Tuple[int, int, int]) -> PoseTR:
        t = _idx_to_pos(st, origin, voxel_mm)
        return PoseTR(t=t, q=start.q.copy())

    open_heap = []
    g_score = {start_state: 0.0}
    came_from = {start_state: None}
    h0 = float(np.linalg.norm(goal.t - start.t))
    heapq.heappush(open_heap, (h0, 0.0, start_state))
    closed = set()
    start_time = time.time()
    expanded = 0

    while open_heap:
        if time.time() - start_time > ASTAR_TIMEOUT_SEC:
            return Plan3DResult(False, [], message="Timeout")
        f, g, state = heapq.heappop(open_heap)
        if state in closed:
            continue
        if g > g_score.get(state, float("inf")) + 1e-9:
            continue
        closed.add(state)
        expanded += 1
        if expanded > ASTAR_MAX_NODES:
            return Plan3DResult(False, [], message="Max nodes")
        if state == goal_state:
            path_states = []
            cur = state
            while cur is not None:
                path_states.append(cur)
                cur = came_from[cur]
            path_states.reverse()
            path = [state_to_pose(s) for s in path_states]
            path[0] = PoseTR(t=start.t.copy(), q=start.q.copy())
            path[-1] = PoseTR(t=goal.t.copy(), q=goal.q.copy())
            total = sum(
                float(np.linalg.norm(path[i].t - path[i - 1].t))
                for i in range(1, len(path))
            )
            return Plan3DResult(True, path, total_len_mm=total, message="OK")
        pose_cur = state_to_pose(state)
        for dx, dy, dz in offsets:
            nst = (state[0] + dx, state[1] + dy, state[2] + dz)
            if not _idx_in_bounds(nst, min_idx, max_idx):
                continue
            pose_n = state_to_pose(nst)
            if not checker.is_pose_collision_free(pose_n):
                continue
            ng = g + cost_per_step
            if ng + 1e-9 < g_score.get(nst, float("inf")):
                g_score[nst] = ng
                came_from[nst] = state
                hn = float(np.linalg.norm(goal.t - pose_n.t))
                heapq.heappush(open_heap, (ng + hn, ng, nst))
    return Plan3DResult(False, [], message="No path found")


def subdivide_to_daily(path: List[PoseTR], max_mm: float) -> List[PoseTR]:
    if len(path) < 2:
        return path
    refined = [path[0]]
    for i in range(1, len(path)):
        a, b = refined[-1], path[i]
        dt = float(np.linalg.norm(b.t - a.t))
        n = int(math.ceil(dt / max_mm)) if max_mm > 0 else 1
        n = max(1, n)
        for k in range(1, n + 1):
            u = k / n
            t = (1 - u) * a.t + u * b.t
            refined.append(PoseTR(t=t.astype(float), q=b.q.copy()))
    refined[-1] = PoseTR(t=path[-1].t.copy(), q=path[-1].q.copy())
    return refined
