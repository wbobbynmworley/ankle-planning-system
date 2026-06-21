# 与 CT3D 完全一致的多骨 A* 规划：参考固定，其余顺序移动，体素A*（平移+旋转），每日限制
from __future__ import annotations

import math
import random
import time
import heapq
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from .collision import (
    COLLISION_BOUNDS_PAD_MM,
    Obstacle,
    ObstacleData,
    PoseTR,
    CollisionChecker,
    _make_obstacle,
    _transform_bounds,
    _bounds_overlap,
    _quat_norm,
    _quat_to_rotmat,
    _quat_inv,
    _quat_mul,
    _vtk_matrix_from_pose,
)

# 与 CT3D 完全一致的常量
COLLISION_MAX_STEP_MM = 0.5
COLLISION_MAX_STEP_DEG = 0.5
ADAPTIVE_MAX_DEPTH = 12
ADAPTIVE_FALLBACK_MIN_STEPS = 6
ESCAPE_MAX_MM = 5.0
ESCAPE_RADII = [0.5, 1.0, 2.0, 3.0, 4.0, 5.0]
ESCAPE_RANDOM_DIRS = 18
ESCAPE_DIRECTION_PENALTY = 3.0
ASTAR_MARGIN_SCHEDULE = [5.0, 10.0, 20.0, 30.0]
VOXEL_SCHEDULE_MM = [2.0, 1.5, 1.0, 0.7]
ROT_STEP_DEG = 10.0
ROT_WEIGHT = 0.3
ASTAR_TIMEOUT_SEC = 30.0
ASTAR_MAX_NODES = 400000
REF_DISTANCE_WEIGHT = 1.0
REF_DISTANCE_SAMPLES = 3
REF_NUDGE_STEP_MM = 0.3
REF_NUDGE_ITERS = 2
SHORTCUT_MAX_PASSES = 3
SHORTCUT_RANDOM_ITERS = 300


def _quat_slerp(q0: np.ndarray, q1: np.ndarray, t: float) -> np.ndarray:
    q0 = _quat_norm(q0)
    q1 = _quat_norm(q1)
    dot = float(np.dot(q0, q1))
    if dot < 0.0:
        q1 = -q1
        dot = -dot
    if dot > 0.9995:
        out = q0 + t * (q1 - q0)
        return _quat_norm(out)
    theta_0 = math.acos(max(-1.0, min(1.0, dot)))
    sin_0 = math.sin(theta_0)
    theta = theta_0 * t
    s0 = math.sin(theta_0 - theta) / sin_0
    s1 = math.sin(theta) / sin_0
    return _quat_norm(s0 * q0 + s1 * q1)


def _rot_angle_deg_between(q0: np.ndarray, q1: np.ndarray) -> float:
    q0 = _quat_norm(q0)
    q1 = _quat_norm(q1)
    q_rel = _quat_mul(q1, _quat_inv(q0))
    q_rel = _quat_norm(q_rel)
    w = float(max(-1.0, min(1.0, abs(q_rel[0]))))
    ang = 2.0 * math.acos(w)
    return ang * 180.0 / math.pi


def _random_unit_vector() -> np.ndarray:
    v = np.random.normal(size=3)
    n = float(np.linalg.norm(v))
    if n < 1e-9:
        return np.array([1.0, 0.0, 0.0], dtype=float)
    return v / n


def _pose_distance(a: PoseTR, b: PoseTR, w_rot: float = ROT_WEIGHT) -> float:
    dt = float(np.linalg.norm(a.t - b.t))
    dth = _rot_angle_deg_between(a.q, b.q)
    return dt + w_rot * dth


def _path_cost(path: List[PoseTR], w_rot: float = ROT_WEIGHT) -> float:
    if len(path) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(path)):
        total += _pose_distance(path[i - 1], path[i], w_rot=w_rot)
    return total


def _pose_center_world(center_local: np.ndarray, pose: PoseTR) -> np.ndarray:
    R = _quat_to_rotmat(pose.q)
    return (R @ center_local + pose.t).astype(float)


def _pose_ref_distance(pose: PoseTR, center_local: np.ndarray, ref_center_world: np.ndarray) -> float:
    center_world = _pose_center_world(center_local, pose)
    return float(np.linalg.norm(center_world - ref_center_world))


def _segment_ref_avg_distance(
    a: PoseTR,
    b: PoseTR,
    center_local: np.ndarray,
    ref_center_world: np.ndarray,
    samples: int = REF_DISTANCE_SAMPLES,
) -> float:
    if samples < 2:
        samples = 2
    total = 0.0
    for i in range(samples):
        u = i / (samples - 1)
        pose = PoseTR(
            t=((1 - u) * a.t + u * b.t).astype(float),
            q=_quat_slerp(a.q, b.q, u),
        )
        total += _pose_ref_distance(pose, center_local, ref_center_world)
    return total / samples


def _edge_cost_post(
    a: PoseTR,
    b: PoseTR,
    center_local: Optional[np.ndarray],
    ref_center_world: Optional[np.ndarray],
) -> float:
    base = _pose_distance(a, b, w_rot=ROT_WEIGHT)
    if center_local is None or ref_center_world is None or REF_DISTANCE_WEIGHT <= 1e-9:
        return base
    ref_avg = _segment_ref_avg_distance(a, b, center_local, ref_center_world, REF_DISTANCE_SAMPLES)
    return base + REF_DISTANCE_WEIGHT * ref_avg


def _path_score_post(
    path: List[PoseTR],
    center_local: Optional[np.ndarray],
    ref_center_world: Optional[np.ndarray],
) -> float:
    if len(path) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(path)):
        total += _edge_cost_post(path[i - 1], path[i], center_local, ref_center_world)
    return total


def _segment_steps(
    a: PoseTR,
    b: PoseTR,
    radius: float,
    max_step_mm: float,
    max_step_deg: float,
) -> int:
    dt = float(np.linalg.norm(b.t - a.t))
    dth_deg = _rot_angle_deg_between(a.q, b.q)
    dth_rad = math.radians(dth_deg)
    max_disp = dt + 2.0 * radius * math.sin(dth_rad * 0.5)
    n1 = int(math.ceil(max_disp / max_step_mm)) if max_step_mm > 0 else 1
    n2 = int(math.ceil(dth_deg / max_step_deg)) if max_step_deg > 0 else 1
    return max(2, n1, n2)


def _segment_motion_bound(a: PoseTR, b: PoseTR, radius: float) -> Tuple[float, float]:
    dt = float(np.linalg.norm(b.t - a.t))
    dth_deg = _rot_angle_deg_between(a.q, b.q)
    dth_rad = math.radians(dth_deg)
    max_disp = dt + 2.0 * radius * math.sin(dth_rad * 0.5)
    return max_disp, dth_deg


def _segment_collision_free_adaptive(
    checker: CollisionChecker,
    a: PoseTR,
    b: PoseTR,
    depth: int = 0,
    check_endpoints: bool = True,
) -> bool:
    if check_endpoints and depth == 0:
        if not checker.is_pose_collision_free(a):
            return False
        if not checker.is_pose_collision_free(b):
            return False
    max_disp, dth_deg = _segment_motion_bound(a, b, checker.radius)
    if max_disp <= checker.max_step_mm and dth_deg <= checker.max_step_deg:
        return True
    if depth >= ADAPTIVE_MAX_DEPTH:
        n = max(ADAPTIVE_FALLBACK_MIN_STEPS, _segment_steps(a, b, checker.radius, checker.max_step_mm, checker.max_step_deg))
        for i in range(1, n):
            u = i / n
            pose = PoseTR(
                t=((1 - u) * a.t + u * b.t).astype(float),
                q=_quat_slerp(a.q, b.q, u),
            )
            if not checker.is_pose_collision_free(pose):
                return False
        return True
    mid = PoseTR(
        t=(0.5 * (a.t + b.t)).astype(float),
        q=_quat_slerp(a.q, b.q, 0.5),
    )
    if not checker.is_pose_collision_free(mid):
        return False
    return _segment_collision_free_adaptive(checker, a, mid, depth + 1, check_endpoints=False) and _segment_collision_free_adaptive(
        checker, mid, b, depth + 1, check_endpoints=False
    )


def _segment_collision_free(checker: CollisionChecker, a: PoseTR, b: PoseTR) -> bool:
    return _segment_collision_free_adaptive(checker, a, b, depth=0, check_endpoints=True)


def _segment_collision_free_midpoints(checker: CollisionChecker, a: PoseTR, b: PoseTR) -> bool:
    dt = float(np.linalg.norm(b.t - a.t))
    dth = _rot_angle_deg_between(a.q, b.q)
    if dt < 1e-9 and dth < 1e-9:
        return True
    return _segment_collision_free_adaptive(checker, a, b, depth=0, check_endpoints=False)


def _path_collision_free(checker: CollisionChecker, path: List[PoseTR]) -> bool:
    if not path:
        return False
    if not checker.is_pose_collision_free(path[0]):
        return False
    for i in range(1, len(path)):
        if not _segment_collision_free(checker, path[i - 1], path[i]):
            return False
    return True


def _path_collision_free_relaxed(
    checker: CollisionChecker,
    path: List[PoseTR],
    allow_start: bool,
    allow_end: bool,
) -> bool:
    if not path:
        return False
    last = len(path) - 1
    for i, pose in enumerate(path):
        if (i == 0 and allow_start) or (i == last and allow_end):
            continue
        if not checker.is_pose_collision_free(pose):
            return False
    for i in range(1, len(path)):
        if not _segment_collision_free_midpoints(checker, path[i - 1], path[i]):
            return False
    return True


def _shortcut_path(
    path: List[PoseTR],
    checker: CollisionChecker,
    allow_start_collision: bool,
    center_local: Optional[np.ndarray],
    ref_center_world: Optional[np.ndarray],
    max_passes: int = SHORTCUT_MAX_PASSES,
    random_iters: int = SHORTCUT_RANDOM_ITERS,
) -> List[PoseTR]:
    if len(path) < 3:
        return path
    out = path[:]
    best_score = _path_score_post(out, center_local, ref_center_world)
    for _ in range(max_passes):
        changed = False
        i = 0
        while i < len(out) - 2:
            j = len(out) - 1
            while j > i + 1:
                a, b = out[i], out[j]
                ok = _segment_collision_free_midpoints(checker, a, b) if (i == 0 and allow_start_collision) else _segment_collision_free(checker, a, b)
                if ok:
                    candidate = out[: i + 1] + out[j:]
                    cand_score = _path_score_post(candidate, center_local, ref_center_world)
                    if cand_score + 1e-9 < best_score:
                        out, best_score, changed = candidate, cand_score, True
                        break
                j -= 1
            i += 1
        for _ in range(random_iters):
            if len(out) < 3:
                break
            i = random.randint(0, len(out) - 3)
            j = random.randint(i + 2, len(out) - 1)
            a, b = out[i], out[j]
            ok = _segment_collision_free_midpoints(checker, a, b) if (i == 0 and allow_start_collision) else _segment_collision_free(checker, a, b)
            if ok:
                candidate = out[: i + 1] + out[j:]
                cand_score = _path_score_post(candidate, center_local, ref_center_world)
                if cand_score + 1e-9 < best_score:
                    out, best_score, changed = candidate, cand_score, True
        if not changed:
            break
    return out


def _nudge_path_toward_ref(
    path: List[PoseTR],
    checker: CollisionChecker,
    allow_start_collision: bool,
    center_local: Optional[np.ndarray],
    ref_center_world: Optional[np.ndarray],
) -> List[PoseTR]:
    if center_local is None or ref_center_world is None or REF_DISTANCE_WEIGHT <= 1e-9 or len(path) < 3:
        return path
    out = path[:]
    for _ in range(REF_NUDGE_ITERS):
        changed = False
        for i in range(1, len(out) - 1):
            pose = out[i]
            center_world = _pose_center_world(center_local, pose)
            vec = ref_center_world - center_world
            dist = float(np.linalg.norm(vec))
            if dist < 1e-6:
                continue
            step = min(REF_NUDGE_STEP_MM, dist)
            move = vec / dist * step
            cand = PoseTR(t=(pose.t + move).astype(float), q=pose.q.copy())
            if not checker.is_pose_collision_free(cand):
                continue
            prev, next_p = out[i - 1], out[i + 1]
            ok_prev = _segment_collision_free_midpoints(checker, prev, cand) if (allow_start_collision and i == 1) else _segment_collision_free(checker, prev, cand)
            if not ok_prev or not _segment_collision_free(checker, cand, next_p):
                continue
            old_cost = _edge_cost_post(prev, pose, center_local, ref_center_world) + _edge_cost_post(pose, next_p, center_local, ref_center_world)
            new_cost = _edge_cost_post(prev, cand, center_local, ref_center_world) + _edge_cost_post(cand, next_p, center_local, ref_center_world)
            if new_cost + 1e-9 < old_cost:
                out[i], changed = cand, True
        if not changed:
            break
    return out


def _subdivide_to_daily_limits(path: List[PoseTR], max_mm: float, max_deg: float) -> List[PoseTR]:
    if len(path) < 2:
        return path
    refined = [path[0]]
    for i in range(1, len(path)):
        a, b = refined[-1], path[i]
        dt = float(np.linalg.norm(b.t - a.t))
        dth = _rot_angle_deg_between(a.q, b.q)
        n1 = int(math.ceil(dt / max_mm)) if max_mm > 0 else 1
        n2 = int(math.ceil(dth / max_deg)) if max_deg > 0 else 1
        n = max(1, n1, n2)
        for k in range(1, n + 1):
            u = k / n
            t = (1 - u) * a.t + u * b.t
            q = _quat_slerp(a.q, b.q, u)
            refined.append(PoseTR(t=t.astype(float), q=q))
    refined[-1] = PoseTR(t=path[-1].t.copy(), q=path[-1].q.copy())
    return refined


def _escape_candidate_poses(start_pose: PoseTR, max_radius: float) -> List[PoseTR]:
    dirs = [
        np.array([1.0, 0.0, 0.0], dtype=float),
        np.array([-1.0, 0.0, 0.0], dtype=float),
        np.array([0.0, 1.0, 0.0], dtype=float),
        np.array([0.0, -1.0, 0.0], dtype=float),
        np.array([0.0, 0.0, 1.0], dtype=float),
        np.array([0.0, 0.0, -1.0], dtype=float),
    ]
    for _ in range(ESCAPE_RANDOM_DIRS):
        dirs.append(_random_unit_vector())
    radii = [r for r in ESCAPE_RADII if r <= max_radius + 1e-9]
    if not radii:
        radii = [max_radius]
    out = []
    for r in radii:
        for d in dirs:
            out.append(PoseTR(t=start_pose.t + d * r, q=start_pose.q.copy()))
    return out


def _escape_pose_score(start_pose: PoseTR, goal_pose: PoseTR, cand_pose: PoseTR) -> float:
    score = _pose_distance(cand_pose, goal_pose, w_rot=ROT_WEIGHT)
    goal_vec = goal_pose.t - start_pose.t
    cand_vec = cand_pose.t - start_pose.t
    gnorm, cnorm = float(np.linalg.norm(goal_vec)), float(np.linalg.norm(cand_vec))
    if gnorm > 1e-9 and cnorm > 1e-9:
        cos = float(np.dot(goal_vec, cand_vec) / (gnorm * cnorm))
        if cos < 0.0:
            score += ESCAPE_DIRECTION_PENALTY * (-cos) * cnorm
    return score


def _find_escape_pose(
    start_pose: PoseTR, goal_pose: PoseTR, checker: CollisionChecker, max_escape_mm: float
) -> Optional[PoseTR]:
    candidates = _escape_candidate_poses(start_pose, max_escape_mm)
    best, best_score = None, float("inf")
    for cand in candidates:
        if not checker.is_pose_collision_free(cand):
            continue
        if not _segment_collision_free_midpoints(checker, start_pose, cand):
            continue
        score = _escape_pose_score(start_pose, goal_pose, cand)
        if score < best_score:
            best_score, best = score, cand
    return best


@dataclass
class VoxelGrid:
    origin: np.ndarray
    min_idx: np.ndarray
    max_idx: np.ndarray
    voxel: float


def _build_voxel_grid(
    start_t: np.ndarray, bounds: Tuple[float, float, float, float, float, float], voxel: float
) -> VoxelGrid:
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    origin = start_t.copy()
    min_idx = np.floor((np.array([xmin, ymin, zmin], dtype=float) - origin) / voxel).astype(int)
    max_idx = np.ceil((np.array([xmax, ymax, zmax], dtype=float) - origin) / voxel).astype(int)
    return VoxelGrid(origin=origin, min_idx=min_idx, max_idx=max_idx, voxel=voxel)


def _pos_to_idx(pos: np.ndarray, grid: VoxelGrid) -> Tuple[int, int, int]:
    rel = (pos - grid.origin) / grid.voxel
    return (int(round(rel[0])), int(round(rel[1])), int(round(rel[2])))


def _idx_to_pos(idx: Tuple[int, int, int], grid: VoxelGrid) -> np.ndarray:
    return (grid.origin + np.array(idx, dtype=float) * grid.voxel).astype(float)


def _idx_in_bounds(idx: Tuple[int, int, int], grid: VoxelGrid) -> bool:
    return (
        grid.min_idx[0] <= idx[0] <= grid.max_idx[0]
        and grid.min_idx[1] <= idx[1] <= grid.max_idx[1]
        and grid.min_idx[2] <= idx[2] <= grid.max_idx[2]
    )


def _compute_search_bounds(
    start: PoseTR,
    goal: PoseTR,
    obstacles: List[Obstacle],
    margin: float,
) -> Tuple[float, float, float, float, float, float]:
    mins = np.minimum(start.t, goal.t)
    maxs = np.maximum(start.t, goal.t)
    for obs in obstacles:
        b = obs.bounds_world
        mins = np.minimum(mins, np.array([b[0], b[2], b[4]], dtype=float))
        maxs = np.maximum(maxs, np.array([b[1], b[3], b[5]], dtype=float))
    mins -= margin
    maxs += margin
    return (mins[0], maxs[0], mins[1], maxs[1], mins[2], maxs[2])


@dataclass
class PlannerResult:
    path: List[PoseTR]
    planner_used: str
    cost: float


def _astar_plan(
    checker: CollisionChecker,
    start: PoseTR,
    goal: PoseTR,
    bounds: Tuple[float, float, float, float, float, float],
    voxel_mm: float,
    rot_step_deg: float,
    allow_start_collision: bool,
) -> Optional[List[PoseTR]]:
    grid = _build_voxel_grid(start.t, bounds, voxel_mm)
    goal_idx = _pos_to_idx(goal.t, grid)
    if not _idx_in_bounds(goal_idx, grid):
        return None
    rot_total = _rot_angle_deg_between(start.q, goal.q)
    rot_steps = max(1, int(math.ceil(rot_total / max(rot_step_deg, 1e-6))))
    rot_unit = rot_total / rot_steps if rot_steps > 0 else 0.0
    start_state = (0, 0, 0, 0)
    goal_state = (goal_idx[0], goal_idx[1], goal_idx[2], rot_steps)
    pose_cache: Dict[Tuple[int, int, int, int], PoseTR] = {}
    free_cache: Dict[Tuple[int, int, int, int], bool] = {}

    def state_to_pose(state: Tuple[int, int, int, int]) -> PoseTR:
        if state in pose_cache:
            return pose_cache[state]
        ix, iy, iz, ir = state
        t = _idx_to_pos((ix, iy, iz), grid)
        u = ir / rot_steps if rot_steps > 0 else 0.0
        q = _quat_slerp(start.q, goal.q, u)
        pose = PoseTR(t=t, q=_quat_norm(q))
        pose_cache[state] = pose
        return pose

    def node_free(state: Tuple[int, int, int, int]) -> bool:
        if state == start_state and allow_start_collision:
            return True
        if state in free_cache:
            return free_cache[state]
        pose = state_to_pose(state)
        free_cache[state] = checker.is_pose_collision_free(pose)
        return free_cache[state]

    if not allow_start_collision and not node_free(start_state):
        return None
    if not node_free(goal_state):
        return None

    offsets = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    if dx == 0 and dy == 0 and dz == 0 and dr == 0:
                        continue
                    dist = voxel_mm * math.sqrt(dx * dx + dy * dy + dz * dz)
                    rot_cost = ROT_WEIGHT * (rot_unit * abs(dr))
                    offsets.append((dx, dy, dz, dr, dist + rot_cost))
    goal_pos = _idx_to_pos(goal_idx, grid)

    def heuristic(state: Tuple[int, int, int, int]) -> float:
        ix, iy, iz, ir = state
        pos = _idx_to_pos((ix, iy, iz), grid)
        t_rem = float(np.linalg.norm(goal_pos - pos))
        r_rem = abs(rot_steps - ir) * rot_unit
        return t_rem + ROT_WEIGHT * r_rem

    open_heap = []
    g_score = {start_state: 0.0}
    came_from: Dict[Tuple[int, int, int, int], Optional[Tuple[int, int, int, int]]] = {start_state: None}
    h0 = heuristic(start_state)
    heapq.heappush(open_heap, (h0, 0.0, start_state))
    closed = set()
    start_time = time.time()
    expanded = 0

    while open_heap:
        if time.time() - start_time > ASTAR_TIMEOUT_SEC:
            return None
        f, g, state = heapq.heappop(open_heap)
        if state in closed:
            continue
        if g > g_score.get(state, float("inf")) + 1e-9:
            continue
        closed.add(state)
        expanded += 1
        if expanded > ASTAR_MAX_NODES:
            return None
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
            return path
        ix, iy, iz, ir = state
        pose_cur = state_to_pose(state)
        for dx, dy, dz, dr, step_cost in offsets:
            nx, ny, nz, nr = ix + dx, iy + dy, iz + dz, ir + dr
            if nr < 0 or nr > rot_steps:
                continue
            if not _idx_in_bounds((nx, ny, nz), grid):
                continue
            nstate = (nx, ny, nz, nr)
            if not node_free(nstate):
                continue
            pose_n = state_to_pose(nstate)
            if state == start_state and allow_start_collision:
                if not _segment_collision_free_midpoints(checker, pose_cur, pose_n):
                    continue
            else:
                if not _segment_collision_free(checker, pose_cur, pose_n):
                    continue
            ng = g + step_cost
            if ng + 1e-9 < g_score.get(nstate, float("inf")):
                g_score[nstate] = ng
                came_from[nstate] = state
                heapq.heappush(open_heap, (ng + heuristic(nstate), ng, nstate))
    return None


def _plan_path_astar(
    start: PoseTR,
    goal: PoseTR,
    moving_poly,
    obstacle_data: List[ObstacleData],
    allow_start_collision: bool,
) -> Optional[PlannerResult]:
    obstacles = [_make_obstacle(od.poly, od.pose) for od in obstacle_data]
    checker = CollisionChecker(
        moving_poly, obstacles, max_step_mm=COLLISION_MAX_STEP_MM, max_step_deg=COLLISION_MAX_STEP_DEG
    )
    if not allow_start_collision and not checker.is_pose_collision_free(start):
        return None
    if not checker.is_pose_collision_free(goal):
        return None
    for voxel_mm in VOXEL_SCHEDULE_MM:
        for margin in ASTAR_MARGIN_SCHEDULE:
            bounds = _compute_search_bounds(start, goal, obstacles, margin)
            path = _astar_plan(
                checker=checker,
                start=start,
                goal=goal,
                bounds=bounds,
                voxel_mm=voxel_mm,
                rot_step_deg=ROT_STEP_DEG,
                allow_start_collision=allow_start_collision,
            )
            if path is None:
                continue
            return PlannerResult(path=path, planner_used=f"体素A*({voxel_mm}mm)", cost=_path_cost(path, w_rot=ROT_WEIGHT))
    return None


def plan_single_bone(
    name: str,
    start_pose: PoseTR,
    goal_pose: PoseTR,
    current_pose: Dict[str, PoseTR],
    meshes: Dict[str, Tuple],  # name -> (poly, center_local)
    ref_name: str,
    max_mm: float,
    max_deg: float,
) -> Optional[Tuple[List[PoseTR], str, float]]:
    """与 CT3D _plan_single_bone 一致：单骨从 start 到 goal，其余为障碍物。"""
    poly, _ = meshes[name]
    obstacle_data = [
        ObstacleData(poly=meshes[n][0], pose=current_pose[n])
        for n in meshes
        if n != name
    ]
    obstacles = [_make_obstacle(od.poly, od.pose) for od in obstacle_data]
    checker = CollisionChecker(
        poly, obstacles, max_step_mm=COLLISION_MAX_STEP_MM, max_step_deg=COLLISION_MAX_STEP_DEG
    )
    ref_pose = current_pose[ref_name]
    ref_center_local = np.array(meshes[ref_name][1], dtype=float)
    ref_center_world = _pose_center_world(ref_center_local, ref_pose)
    moving_center_local = np.array(meshes[name][1], dtype=float)

    start_collide = not checker.is_pose_collision_free(start_pose)
    goal_collide = not checker.is_pose_collision_free(goal_pose)
    if goal_collide:
        return None
    escape_pose = _find_escape_pose(start_pose, goal_pose, checker, ESCAPE_MAX_MM) if start_collide else None
    prefix = [start_pose, escape_pose] if escape_pose is not None else []
    start_plan = escape_pose if escape_pose is not None else start_pose
    allow_start_core = start_collide and escape_pose is None
    allow_start_full = start_collide

    planner_used = "体素A*"
    core_path = [start_plan]
    total_t = float(np.linalg.norm(goal_pose.t - start_plan.t))
    total_r = _rot_angle_deg_between(start_plan.q, goal_pose.q)

    if total_t >= 1e-6 or total_r >= 1e-6:
        plan = _plan_path_astar(
            start=start_plan,
            goal=goal_pose,
            moving_poly=poly,
            obstacle_data=obstacle_data,
            allow_start_collision=allow_start_core,
        )
        if plan is None:
            return None
        core_path = plan.path
        planner_used = plan.planner_used
    else:
        planner_used = "无需规划"

    full = core_path[:]
    if prefix:
        full = prefix[:-1] + full
    before_score = _path_score_post(full, moving_center_local, ref_center_world)
    full = _shortcut_path(full, checker, allow_start_full, moving_center_local, ref_center_world)
    full = _nudge_path_toward_ref(full, checker, allow_start_full, moving_center_local, ref_center_world)
    full = _shortcut_path(full, checker, allow_start_full, moving_center_local, ref_center_world)
    after_score = _path_score_post(full, moving_center_local, ref_center_world)
    if after_score + 1e-9 < before_score and planner_used != "无需规划":
        planner_used = f"{planner_used}+优化"
    full = _subdivide_to_daily_limits(full, max_mm=max_mm, max_deg=max_deg)
    full[-1] = PoseTR(t=goal_pose.t.copy(), q=goal_pose.q.copy())
    if allow_start_full:
        ok = _path_collision_free_relaxed(checker, full, True, False)
    else:
        ok = _path_collision_free(checker, full)
    if not ok:
        return None
    cost = _path_score_post(full, moving_center_local, ref_center_world)
    return full, planner_used, cost


def generate_plan_multi(
    ref_index: int,
    polys: List,
    centers: List[np.ndarray],
    start_poses: List[PoseTR],
    target_poses: List[PoseTR],
    max_mm: float,
    max_deg: float,
    names: Optional[List[str]] = None,
) -> Optional[Dict]:
    """与 CT3D generate_plan 一致：参考固定，其余按 order 顺序规划。names 为可选显示名，缺省用索引。"""
    n = len(polys)
    if n < 2 or ref_index < 0 or ref_index >= n:
        return None
    if names is None:
        names = [str(i) for i in range(n)]
    ref_name = names[ref_index]
    order = [names[i] for i in range(n) if i != ref_index]
    meshes = {}
    for i in range(n):
        meshes[names[i]] = (polys[i], centers[i])
    current_pose = {names[i]: PoseTR(t=start_poses[i].t.copy(), q=start_poses[i].q.copy()) for i in range(n)}
    target_pose_all = {names[i]: PoseTR(t=target_poses[i].t.copy(), q=target_poses[i].q.copy()) for i in range(n)}

    plan_paths = {}
    plan_offsets = {}
    plan_steps = {}
    plan_start_poses = {}
    plan_goal_poses = {}
    plan_infos = []
    offset = 0
    total_cost = 0.0

    for name in order:
        res = plan_single_bone(
            name,
            current_pose[name],
            target_pose_all[name],
            current_pose,
            meshes,
            ref_name,
            max_mm,
            max_deg,
        )
        if res is None:
            return None
        path, planner_used, cost = res
        total_cost += cost
        steps = len(path) - 1
        plan_paths[name] = path
        plan_offsets[name] = offset
        plan_steps[name] = steps
        plan_start_poses[name] = current_pose[name]
        plan_goal_poses[name] = target_pose_all[name]
        plan_infos.append((name, offset, offset + steps, planner_used))
        if steps > 0:
            offset += steps
        current_pose[name] = target_pose_all[name]

    return {
        "plan_paths": plan_paths,
        "plan_offsets": plan_offsets,
        "plan_steps": plan_steps,
        "plan_start_poses": plan_start_poses,
        "plan_goal_poses": plan_goal_poses,
        "plan_order": order,
        "plan_total_days": offset,
        "plan_infos": plan_infos,
        "total_cost": total_cost,
    }
