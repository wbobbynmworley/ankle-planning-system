import sys
import math
import random
import time
import heapq
from dataclasses import dataclass
from typing import Dict, Optional, Tuple, List

import numpy as np

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QMainWindow,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QGridLayout,
    QPushButton,
    QFileDialog,
    QListWidget,
    QListWidgetItem,
    QLabel,
    QMessageBox,
    QSplitter,
    QGroupBox,
    QTextEdit,
    QDoubleSpinBox,
    QCheckBox,
    QLineEdit,
    QScrollArea,
)

import pyvista as pv
from pyvistaqt import QtInteractor
import vtk

COLLISION_MAX_STEP_MM = 0.5
COLLISION_MAX_STEP_DEG = 0.5
COLLISION_BOUNDS_PAD_MM = 0.01
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

TRY_ALT_ORDERS = True
ORDER_TRY_MODE = "first"


@dataclass
class PoseTR:
    t: np.ndarray  # (3,)
    q: np.ndarray  # (4,) wxyz


@dataclass
class MeshItem:
    path: str
    name: str
    poly: pv.PolyData
    actor: object
    highlight_name: str
    pose: PoseTR
    target_pose: PoseTR
    target_actor: object
    target_actor_name: str
    transformed_world_vtk: Optional[vtk.vtkPolyData] = None


@dataclass
class ObstacleData:
    poly: vtk.vtkPolyData
    pose: PoseTR


@dataclass
class Obstacle:
    poly: vtk.vtkPolyData
    pose: PoseTR
    bounds_world: Tuple[float, float, float, float, float, float]
    matrix: vtk.vtkMatrix4x4


@dataclass
class PlannerResult:
    path: List[PoseTR]
    planner_used: str
    cost: float


@dataclass
class VoxelGrid:
    origin: np.ndarray
    min_idx: np.ndarray
    max_idx: np.ndarray
    voxel: float


def _quat_norm(q: np.ndarray) -> np.ndarray:
    q = np.asarray(q, dtype=float)
    n = float(np.linalg.norm(q))
    if n < 1e-12:
        return np.array([1.0, 0.0, 0.0, 0.0], dtype=float)
    return q / n


def _quat_inv(q: np.ndarray) -> np.ndarray:
    q = _quat_norm(q)
    return np.array([q[0], -q[1], -q[2], -q[3]], dtype=float)


def _quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return np.array(
        [
            aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
        ],
        dtype=float,
    )


def _rotmat_to_quat(R: np.ndarray) -> np.ndarray:
    m = R
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        S = math.sqrt(tr + 1.0) * 2
        w = 0.25 * S
        x = (m[2, 1] - m[1, 2]) / S
        y = (m[0, 2] - m[2, 0]) / S
        z = (m[1, 0] - m[0, 1]) / S
    elif (m[0, 0] > m[1, 1]) and (m[0, 0] > m[2, 2]):
        S = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / S
        x = 0.25 * S
        y = (m[0, 1] + m[1, 0]) / S
        z = (m[0, 2] + m[2, 0]) / S
    elif m[1, 1] > m[2, 2]:
        S = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / S
        x = (m[0, 1] + m[1, 0]) / S
        y = 0.25 * S
        z = (m[1, 2] + m[2, 1]) / S
    else:
        S = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / S
        x = (m[0, 2] + m[2, 0]) / S
        y = (m[1, 2] + m[2, 1]) / S
        z = 0.25 * S

    return _quat_norm(np.array([w, x, y, z], dtype=float))


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


def _rotmat_to_euler_xyz(R: np.ndarray) -> np.ndarray:
    sy = math.sqrt(R[0, 0] * R[0, 0] + R[1, 0] * R[1, 0])
    singular = sy < 1e-6
    if not singular:
        x = math.atan2(R[2, 1], R[2, 2])
        y = math.atan2(-R[2, 0], sy)
        z = math.atan2(R[1, 0], R[0, 0])
    else:
        x = math.atan2(-R[1, 2], R[1, 1])
        y = math.atan2(-R[2, 0], sy)
        z = 0.0
    return np.array([x, y, z], dtype=float) * 180.0 / math.pi


def _rotation_decompose_xyz(euler_deg: np.ndarray) -> Dict[str, float]:
    rx, ry, rz = euler_deg.tolist()
    return {
        "up": max(rx, 0.0),
        "down": max(-rx, 0.0),
        "left_tilt": max(ry, 0.0),
        "right_tilt": max(-ry, 0.0),
        "left_spin": max(rz, 0.0),
        "right_spin": max(-rz, 0.0),
    }


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


def _vtk_matrix_from_pose(pose: PoseTR) -> vtk.vtkMatrix4x4:
    R = _quat_to_rotmat(pose.q)
    M = vtk.vtkMatrix4x4()
    for i in range(3):
        for j in range(3):
            M.SetElement(i, j, float(R[i, j]))
    M.SetElement(0, 3, float(pose.t[0]))
    M.SetElement(1, 3, float(pose.t[1]))
    M.SetElement(2, 3, float(pose.t[2]))
    M.SetElement(3, 3, 1.0)
    return M


def _vtk_transform_from_pose(pose: PoseTR) -> vtk.vtkTransform:
    tr = vtk.vtkTransform()
    tr.SetMatrix(_vtk_matrix_from_pose(pose))
    return tr


def _pose_from_vtk_matrix(M: vtk.vtkMatrix4x4) -> PoseTR:
    R = np.array([[M.GetElement(i, j) for j in range(3)] for i in range(3)], dtype=float)
    t = np.array([M.GetElement(0, 3), M.GetElement(1, 3), M.GetElement(2, 3)], dtype=float)
    q = _rotmat_to_quat(R)
    return PoseTR(t=t.astype(float), q=_quat_norm(q))


def _apply_transform_to_vtk_polydata(poly: pv.PolyData, transform: vtk.vtkTransform) -> vtk.vtkPolyData:
    filt = vtk.vtkTransformPolyDataFilter()
    filt.SetTransform(transform)
    filt.SetInputData(poly)
    filt.Update()
    out = vtk.vtkPolyData()
    out.ShallowCopy(filt.GetOutput())
    return out


def _bounds_overlap(
    a: Tuple[float, float, float, float, float, float],
    b: Tuple[float, float, float, float, float, float],
) -> bool:
    if a[1] < b[0] or a[0] > b[1]:
        return False
    if a[3] < b[2] or a[2] > b[3]:
        return False
    if a[5] < b[4] or a[4] > b[5]:
        return False
    return True


def _transform_bounds(
    bounds: Tuple[float, float, float, float, float, float],
    pose: PoseTR,
    pad: float = 0.0,
) -> Tuple[float, float, float, float, float, float]:
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    center = np.array([(xmin + xmax) * 0.5, (ymin + ymax) * 0.5, (zmin + zmax) * 0.5], dtype=float)
    ext = np.array([(xmax - xmin) * 0.5, (ymax - ymin) * 0.5, (zmax - zmin) * 0.5], dtype=float)

    R = _quat_to_rotmat(pose.q)
    ext_w = np.abs(R) @ ext
    center_w = R @ center + pose.t

    return (
        center_w[0] - ext_w[0] - pad,
        center_w[0] + ext_w[0] + pad,
        center_w[1] - ext_w[1] - pad,
        center_w[1] + ext_w[1] + pad,
        center_w[2] - ext_w[2] - pad,
        center_w[2] + ext_w[2] + pad,
    )


def _bounds_radius(bounds: Tuple[float, float, float, float, float, float]) -> float:
    dx = bounds[1] - bounds[0]
    dy = bounds[3] - bounds[2]
    dz = bounds[5] - bounds[4]
    return 0.5 * math.sqrt(dx * dx + dy * dy + dz * dz)


def _within_bounds(t: np.ndarray, bounds: Tuple[float, float, float, float, float, float]) -> bool:
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    return xmin <= t[0] <= xmax and ymin <= t[1] <= ymax and zmin <= t[2] <= zmax


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


def _make_obstacle(poly: vtk.vtkPolyData, pose: PoseTR) -> Obstacle:
    bounds_world = _transform_bounds(poly.GetBounds(), pose, pad=COLLISION_BOUNDS_PAD_MM)
    matrix = _vtk_matrix_from_pose(pose)
    return Obstacle(poly=poly, pose=pose, bounds_world=bounds_world, matrix=matrix)


def _make_collision_filter(
    poly_a: vtk.vtkPolyData,
    poly_b: vtk.vtkPolyData,
    matrix_b: vtk.vtkMatrix4x4,
) -> vtk.vtkCollisionDetectionFilter:
    collide = vtk.vtkCollisionDetectionFilter()
    collide.SetInputData(0, poly_a)
    collide.SetInputData(1, poly_b)
    collide.SetMatrix(0, vtk.vtkMatrix4x4())
    collide.SetMatrix(1, matrix_b)
    collide.SetBoxTolerance(0.0)
    collide.SetCellTolerance(0.0)
    collide.SetNumberOfCellsPerNode(4)
    if hasattr(collide, "SetCollisionModeToFirstContact"):
        collide.SetCollisionModeToFirstContact()
    else:
        collide.SetCollisionModeToAllContacts()
    return collide


def _collision_filter_hit(
    collide: vtk.vtkCollisionDetectionFilter,
    moving_matrix: vtk.vtkMatrix4x4,
) -> bool:
    collide.SetMatrix(0, moving_matrix)
    collide.Update()
    return collide.GetNumberOfContacts() > 0


class CollisionChecker:
    def __init__(
        self,
        moving_poly: vtk.vtkPolyData,
        obstacles: List[Obstacle],
        max_step_mm: float = COLLISION_MAX_STEP_MM,
        max_step_deg: float = COLLISION_MAX_STEP_DEG,
    ):
        self.moving_poly = moving_poly
        self.obstacles = obstacles
        self.max_step_mm = max_step_mm
        self.max_step_deg = max_step_deg

        self.moving_bounds_local = moving_poly.GetBounds()
        self.radius = _bounds_radius(self.moving_bounds_local)

        self.pairs = []
        for obs in obstacles:
            filt = _make_collision_filter(moving_poly, obs.poly, obs.matrix)
            self.pairs.append((obs, filt))

    def segment_steps(self, a: PoseTR, b: PoseTR) -> int:
        return _segment_steps(a, b, self.radius, self.max_step_mm, self.max_step_deg)

    def is_pose_collision_free(self, pose: PoseTR) -> bool:
        if not self.pairs:
            return True

        bounds = _transform_bounds(self.moving_bounds_local, pose, pad=COLLISION_BOUNDS_PAD_MM)
        candidates = [pair for pair in self.pairs if _bounds_overlap(bounds, pair[0].bounds_world)]
        if not candidates:
            return True

        moving_matrix = _vtk_matrix_from_pose(pose)

        for _, filt in candidates:
            if _collision_filter_hit(filt, moving_matrix):
                return False
        return True


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
        n = max(ADAPTIVE_FALLBACK_MIN_STEPS, checker.segment_steps(a, b))
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

    return _segment_collision_free_adaptive(checker, a, mid, depth + 1, check_endpoints=False) and \
        _segment_collision_free_adaptive(checker, mid, b, depth + 1, check_endpoints=False)


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
                a = out[i]
                b = out[j]
                if i == 0 and allow_start_collision:
                    ok = _segment_collision_free_midpoints(checker, a, b)
                else:
                    ok = _segment_collision_free(checker, a, b)
                if ok:
                    candidate = out[: i + 1] + out[j:]
                    cand_score = _path_score_post(candidate, center_local, ref_center_world)
                    if cand_score + 1e-9 < best_score:
                        out = candidate
                        best_score = cand_score
                        changed = True
                        break
                j -= 1
            i += 1

        for _ in range(random_iters):
            if len(out) < 3:
                break
            i = random.randint(0, len(out) - 3)
            j = random.randint(i + 2, len(out) - 1)
            a = out[i]
            b = out[j]
            if i == 0 and allow_start_collision:
                ok = _segment_collision_free_midpoints(checker, a, b)
            else:
                ok = _segment_collision_free(checker, a, b)
            if ok:
                candidate = out[: i + 1] + out[j:]
                cand_score = _path_score_post(candidate, center_local, ref_center_world)
                if cand_score + 1e-9 < best_score:
                    out = candidate
                    best_score = cand_score
                    changed = True

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
    if center_local is None or ref_center_world is None or REF_DISTANCE_WEIGHT <= 1e-9:
        return path
    if len(path) < 3:
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

            prev = out[i - 1]
            next_p = out[i + 1]
            if allow_start_collision and i == 1:
                ok_prev = _segment_collision_free_midpoints(checker, prev, cand)
            else:
                ok_prev = _segment_collision_free(checker, prev, cand)
            if not ok_prev or not _segment_collision_free(checker, cand, next_p):
                continue

            old_cost = _edge_cost_post(prev, pose, center_local, ref_center_world) + \
                _edge_cost_post(pose, next_p, center_local, ref_center_world)
            new_cost = _edge_cost_post(prev, cand, center_local, ref_center_world) + \
                _edge_cost_post(cand, next_p, center_local, ref_center_world)
            if new_cost + 1e-9 < old_cost:
                out[i] = cand
                changed = True

        if not changed:
            break

    return out


def _subdivide_to_daily_limits(path: List[PoseTR], max_mm: float, max_deg: float) -> List[PoseTR]:
    if len(path) < 2:
        return path

    refined = [path[0]]
    for i in range(1, len(path)):
        a = refined[-1]
        b = path[i]
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
    gnorm = float(np.linalg.norm(goal_vec))
    cnorm = float(np.linalg.norm(cand_vec))
    if gnorm > 1e-9 and cnorm > 1e-9:
        cos = float(np.dot(goal_vec, cand_vec) / (gnorm * cnorm))
        if cos < 0.0:
            score += ESCAPE_DIRECTION_PENALTY * (-cos) * cnorm
    return score


def _find_escape_pose(start_pose: PoseTR, goal_pose: PoseTR, checker: CollisionChecker, max_escape_mm: float) -> Optional[PoseTR]:
    candidates = _escape_candidate_poses(start_pose, max_escape_mm)
    best = None
    best_score = float("inf")
    for cand in candidates:
        if not checker.is_pose_collision_free(cand):
            continue
        if not _segment_collision_free_midpoints(checker, start_pose, cand):
            continue
        score = _escape_pose_score(start_pose, goal_pose, cand)
        if score < best_score:
            best_score = score
            best = cand
    return best


def _build_voxel_grid(start_t: np.ndarray, bounds: Tuple[float, float, float, float, float, float], voxel: float) -> VoxelGrid:
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
                nf = ng + heuristic(nstate)
                heapq.heappush(open_heap, (nf, ng, nstate))

    return None


def _plan_path_astar(
    start: PoseTR,
    goal: PoseTR,
    moving_poly: vtk.vtkPolyData,
    obstacle_data: List[ObstacleData],
    allow_start_collision: bool,
) -> Optional[PlannerResult]:
    obstacles = [_make_obstacle(od.poly, od.pose) for od in obstacle_data]
    checker = CollisionChecker(moving_poly, obstacles, max_step_mm=COLLISION_MAX_STEP_MM, max_step_deg=COLLISION_MAX_STEP_DEG)

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


def _make_cell_locator(polydata: vtk.vtkPolyData) -> vtk.vtkCellLocator:
    locator = vtk.vtkCellLocator()
    locator.SetDataSet(polydata)
    locator.BuildLocator()
    return locator


def _closest_points_min_distance(a: vtk.vtkPolyData, b: vtk.vtkPolyData) -> Tuple[float, np.ndarray, np.ndarray]:
    loc_b = _make_cell_locator(b)
    loc_a = _make_cell_locator(a)

    def scan(src: vtk.vtkPolyData, loc: vtk.vtkCellLocator):
        n = src.GetNumberOfPoints()
        min_d2 = float("inf")
        best_p_src = None
        best_p_tgt = None

        closest = [0.0, 0.0, 0.0]
        cid = vtk.mutable(0)
        sid = vtk.mutable(0)
        dist2 = vtk.mutable(0.0)

        for i in range(n):
            p = src.GetPoint(i)
            loc.FindClosestPoint(p, closest, cid, sid, dist2)
            d2 = float(dist2)
            if d2 < min_d2:
                min_d2 = d2
                best_p_src = np.array(p, dtype=float)
                best_p_tgt = np.array(closest, dtype=float)

        return min_d2, best_p_src, best_p_tgt

    d2_1, pa1, pb1 = scan(a, loc_b)
    d2_2, pb2, pa2 = scan(b, loc_a)

    if d2_1 <= d2_2:
        return float(np.sqrt(d2_1)), pa1, pb1
    else:
        return float(np.sqrt(d2_2)), pa2, pb2


def _direction_decompose(vec: np.ndarray) -> Dict[str, float]:
    dx, dy, dz = vec.tolist()
    return {
        "dx": dx, "dy": dy, "dz": dz,
        "right": max(dx, 0.0), "left": max(-dx, 0.0),
        "front": max(dy, 0.0), "back": max(-dy, 0.0),
        "up": max(dz, 0.0), "down": max(-dz, 0.0),
    }


def _format_translation(dt_vec: np.ndarray) -> str:
    dec = _direction_decompose(dt_vec)
    parts = []
    if dec["right"] > 1e-6:
        parts.append(f"右 {dec['right']:.3f}mm")
    if dec["left"] > 1e-6:
        parts.append(f"左 {dec['left']:.3f}mm")
    if dec["front"] > 1e-6:
        parts.append(f"前 {dec['front']:.3f}mm")
    if dec["back"] > 1e-6:
        parts.append(f"后 {dec['back']:.3f}mm")
    if dec["up"] > 1e-6:
        parts.append(f"上 {dec['up']:.3f}mm")
    if dec["down"] > 1e-6:
        parts.append(f"下 {dec['down']:.3f}mm")
    return " ".join(parts) if parts else "平移 0"


def _format_rotation(euler_deg: np.ndarray) -> str:
    dec = _rotation_decompose_xyz(euler_deg)
    parts = []
    if dec["up"] > 1e-6:
        parts.append(f"俯仰+ {dec['up']:.3f}deg")
    if dec["down"] > 1e-6:
        parts.append(f"俯仰- {dec['down']:.3f}deg")
    if dec["left_tilt"] > 1e-6:
        parts.append(f"横滚+ {dec['left_tilt']:.3f}deg")
    if dec["right_tilt"] > 1e-6:
        parts.append(f"横滚- {dec['right_tilt']:.3f}deg")
    if dec["left_spin"] > 1e-6:
        parts.append(f"偏航+ {dec['left_spin']:.3f}deg")
    if dec["right_spin"] > 1e-6:
        parts.append(f"偏航- {dec['right_spin']:.3f}deg")
    return " ".join(parts) if parts else "旋转 0"


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("STL 多骨规划器（体素A*）")

        self.meshes: Dict[str, MeshItem] = {}
        self._base_opacity = 0.65
        self._target_visible = True

        self.ref_init_name: Optional[str] = None
        self._active_target_name: Optional[str] = None

        self._plan_paths: Dict[str, List[PoseTR]] = {}
        self._plan_offsets: Dict[str, int] = {}
        self._plan_steps: Dict[str, int] = {}
        self._plan_start_poses: Dict[str, PoseTR] = {}
        self._plan_goal_poses: Dict[str, PoseTR] = {}
        self._plan_order: List[str] = []
        self._plan_total_days: int = 0
        self._plan_day_idx: int = 0

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)

        row = QHBoxLayout()
        self.btn_add = QPushButton("导入初始STL")
        self.btn_remove = QPushButton("删除所选")
        self.btn_clear = QPushButton("清空全部")
        row.addWidget(self.btn_add)
        row.addWidget(self.btn_remove)
        row.addWidget(self.btn_clear)
        left_layout.addLayout(row)

        self.list_widget = QListWidget()
        self.list_widget.setSelectionMode(QListWidget.ExtendedSelection)
        left_layout.addWidget(self.list_widget)

        ref_group = QGroupBox("参考件（固定）")
        rg_layout = QVBoxLayout(ref_group)

        rg_row1 = QHBoxLayout()
        rg_row1.addWidget(QLabel("参考件："))
        self.ref_init_edit = QLineEdit()
        self.ref_init_edit.setReadOnly(True)
        self.btn_set_ref_init = QPushButton("设为参考")
        rg_row1.addWidget(self.ref_init_edit)
        rg_row1.addWidget(self.btn_set_ref_init)
        rg_layout.addLayout(rg_row1)

        self.btn_clear_ref = QPushButton("清除参考")
        rg_layout.addWidget(self.btn_clear_ref)

        left_layout.addWidget(ref_group)

        transform_group = QGroupBox("目标调整（选择1个模型）")
        t_layout = QVBoxLayout(transform_group)

        step_row = QHBoxLayout()
        step_row.addWidget(QLabel("步长（mm）："))
        self.step_spin = QDoubleSpinBox()
        self.step_spin.setRange(0.01, 1.00)
        self.step_spin.setDecimals(2)
        self.step_spin.setSingleStep(0.01)
        self.step_spin.setValue(1.00)
        step_row.addWidget(self.step_spin)
        step_row.addStretch(1)
        t_layout.addLayout(step_row)

        move_grid = QGridLayout()
        self.btn_y_plus = QPushButton("Y+（前）")
        self.btn_y_minus = QPushButton("Y-（后）")
        self.btn_x_minus = QPushButton("X-（左）")
        self.btn_x_plus = QPushButton("X+（右）")
        self.btn_z_plus = QPushButton("Z+（上）")
        self.btn_z_minus = QPushButton("Z-（下）")
        move_grid.addWidget(self.btn_y_plus, 0, 1)
        move_grid.addWidget(self.btn_x_minus, 1, 0)
        move_grid.addWidget(self.btn_x_plus, 1, 2)
        move_grid.addWidget(self.btn_y_minus, 2, 1)
        move_grid.addWidget(self.btn_z_plus, 0, 3)
        move_grid.addWidget(self.btn_z_minus, 2, 3)
        t_layout.addLayout(move_grid)

        rot_row = QHBoxLayout()
        self.cb_mouse_rotate = QCheckBox("鼠标旋转目标")
        self.btn_reset_target = QPushButton("重置目标")
        self.cb_show_targets = QCheckBox("显示目标线框")
        self.cb_show_targets.setChecked(True)
        self.cb_hide_orig = QCheckBox("隐藏非参考原件")
        self.cb_hide_orig.setChecked(False)
        rot_row.addWidget(self.cb_mouse_rotate)
        rot_row.addWidget(self.btn_reset_target)
        rot_row.addWidget(self.cb_show_targets)
        rot_row.addWidget(self.cb_hide_orig)
        rot_row.addStretch(1)
        t_layout.addLayout(rot_row)

        validate_row = QHBoxLayout()
        self.btn_validate_targets = QPushButton("校验目标碰撞（精确）")
        validate_row.addWidget(self.btn_validate_targets)
        validate_row.addStretch(1)
        t_layout.addLayout(validate_row)

        self.pose_label = QLabel("目标位姿：未单选")
        self.pose_label.setWordWrap(True)
        t_layout.addWidget(self.pose_label)

        left_layout.addWidget(transform_group)

        dist_group = QGroupBox("测量：两模型最小距离")
        dist_layout = QVBoxLayout(dist_group)
        self.btn_calc = QPushButton("计算最小距离")
        self.info = QTextEdit()
        self.info.setReadOnly(True)
        self.info.setMinimumHeight(140)
        dist_layout.addWidget(self.btn_calc)
        dist_layout.addWidget(self.info)
        left_layout.addWidget(dist_group)

        plan_group = QGroupBox("规划：参考固定；其余顺序移动（每天<=1mm或1度）")
        pg_layout = QVBoxLayout(plan_group)

        lim_row = QHBoxLayout()
        lim_row.addWidget(QLabel("每日最大平移（mm）："))
        self.max_mm_spin = QDoubleSpinBox()
        self.max_mm_spin.setRange(0.1, 5.0)
        self.max_mm_spin.setDecimals(2)
        self.max_mm_spin.setValue(1.00)
        lim_row.addWidget(self.max_mm_spin)

        lim_row.addWidget(QLabel("每日最大旋转（deg）："))
        self.max_deg_spin = QDoubleSpinBox()
        self.max_deg_spin.setRange(0.1, 10.0)
        self.max_deg_spin.setDecimals(2)
        self.max_deg_spin.setValue(1.00)
        lim_row.addWidget(self.max_deg_spin)
        lim_row.addStretch(1)
        pg_layout.addLayout(lim_row)

        btnp = QHBoxLayout()
        self.btn_plan = QPushButton("生成无碰撞规划（体素A*）")
        self.btn_preview_prev = QPushButton("预览：前一天")
        self.btn_preview_next = QPushButton("预览：后一天")
        btnp.addWidget(self.btn_plan)
        btnp.addWidget(self.btn_preview_prev)
        btnp.addWidget(self.btn_preview_next)
        pg_layout.addLayout(btnp)

        self.plan_text = QTextEdit()
        self.plan_text.setReadOnly(True)
        self.plan_text.setMinimumHeight(220)
        pg_layout.addWidget(self.plan_text)

        left_layout.addWidget(plan_group)

        left_panel.setMinimumWidth(420)
        left_scroll = QScrollArea()
        left_scroll.setWidgetResizable(True)
        left_scroll.setWidget(left_panel)

        self.plotter = QtInteractor()
        self.plotter.set_background("white")
        self.plotter.add_axes()
        self.plotter.reset_camera()

        self._style_camera = vtk.vtkInteractorStyleTrackballCamera()
        self._style_actor = vtk.vtkInteractorStyleTrackballActor()
        self.plotter.interactor.SetInteractorStyle(self._style_camera)
        self._style_actor.AddObserver("EndInteractionEvent", self._on_actor_interaction_end)

        splitter.addWidget(left_scroll)
        splitter.addWidget(self.plotter.interactor)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)

        container = QWidget()
        root = QVBoxLayout(container)
        root.addWidget(splitter)
        self.setCentralWidget(container)
        self.setMinimumSize(1200, 720)

        self.btn_add.clicked.connect(self.add_files)
        self.btn_remove.clicked.connect(self.remove_selected)
        self.btn_clear.clicked.connect(self.clear_all)
        self.list_widget.itemSelectionChanged.connect(self.update_selection_state)

        self.btn_x_plus.clicked.connect(lambda: self.move_target_selected(+1, 0, 0))
        self.btn_x_minus.clicked.connect(lambda: self.move_target_selected(-1, 0, 0))
        self.btn_y_plus.clicked.connect(lambda: self.move_target_selected(0, +1, 0))
        self.btn_y_minus.clicked.connect(lambda: self.move_target_selected(0, -1, 0))
        self.btn_z_plus.clicked.connect(lambda: self.move_target_selected(0, 0, +1))
        self.btn_z_minus.clicked.connect(lambda: self.move_target_selected(0, 0, -1))
        self.cb_mouse_rotate.toggled.connect(self.toggle_mouse_rotate)
        self.btn_reset_target.clicked.connect(self.reset_target_pose)
        self.cb_show_targets.toggled.connect(self.refresh_targets_visibility)
        self.cb_hide_orig.toggled.connect(self.refresh_original_visibility)
        self.btn_validate_targets.clicked.connect(self.validate_targets)

        self.btn_calc.clicked.connect(self.calc_distance)

        self.btn_set_ref_init.clicked.connect(self.set_ref_initial)
        self.btn_clear_ref.clicked.connect(self.clear_reference)

        self.btn_plan.clicked.connect(self.generate_plan)
        self.btn_preview_next.clicked.connect(lambda: self.preview_day(+1))
        self.btn_preview_prev.clicked.connect(lambda: self.preview_day(-1))

        self.set_transform_controls_enabled(False)

    def set_transform_controls_enabled(self, enabled: bool):
        for w in (
            self.step_spin,
            self.btn_x_plus, self.btn_x_minus, self.btn_y_plus, self.btn_y_minus, self.btn_z_plus, self.btn_z_minus,
            self.cb_mouse_rotate, self.btn_reset_target, self.cb_show_targets
        ):
            w.setEnabled(enabled)

    def _should_show_original(self, name: str) -> bool:
        if not self.cb_hide_orig.isChecked():
            return True
        if not self.ref_init_name:
            return True
        return name == self.ref_init_name

    def _set_mesh_pose(self, mi: MeshItem, pose: PoseTR):
        mi.pose = PoseTR(t=pose.t.copy(), q=_quat_norm(pose.q))
        tr = _vtk_transform_from_pose(mi.pose)
        mi.actor.SetUserTransform(tr)

        hl = self.plotter.actors.get(mi.highlight_name) if hasattr(self.plotter, "actors") else None
        if hl is not None:
            hl.SetUserTransform(tr)

        mi.transformed_world_vtk = _apply_transform_to_vtk_polydata(mi.poly, tr)

    def _set_target_pose(self, mi: MeshItem, pose: PoseTR):
        mi.target_pose = PoseTR(t=pose.t.copy(), q=_quat_norm(pose.q))
        tr = _vtk_transform_from_pose(mi.target_pose)
        mi.target_actor.SetUserTransform(tr)

    def _sync_target_pose_from_actor(self, mi: MeshItem):
        M = mi.target_actor.GetMatrix()
        mi.target_pose = _pose_from_vtk_matrix(M)

    def _ensure_world_cache(self, mi: MeshItem):
        if mi.transformed_world_vtk is None:
            self._set_mesh_pose(mi, mi.pose)

    def _update_pose_ui(self, mi: MeshItem):
        self.pose_label.setText(
            f"目标位姿：\n"
            f"  T = [{mi.target_pose.t[0]:.3f}, {mi.target_pose.t[1]:.3f}, {mi.target_pose.t[2]:.3f}] mm\n"
            f"  |R| = {_rot_angle_deg_between(np.array([1, 0, 0, 0], dtype=float), mi.target_pose.q):.2f} deg"
        )

    def _all_names(self, list_widget: QListWidget) -> List[str]:
        names = []
        for i in range(list_widget.count()):
            names.append(list_widget.item(i).text())
        return names

    def add_files(self):
        paths, _ = QFileDialog.getOpenFileNames(self, "选择STL文件", "", "STL 文件 (*.stl);;所有文件 (*.*)")
        if not paths:
            return

        for path in paths:
            try:
                poly = pv.read(path)
                if not isinstance(poly, pv.PolyData):
                    poly = poly.extract_surface().triangulate()
                else:
                    poly = poly.triangulate()

                name = path.split("/")[-1]
                base = name
                k = 1
                while name in self.meshes:
                    name = f"{base} ({k})"
                    k += 1

                actor = self.plotter.add_mesh(poly, opacity=self._base_opacity, smooth_shading=True)
                target_actor_name = f"tgt::{name}"
                target_actor = self.plotter.add_mesh(
                    poly,
                    name=target_actor_name,
                    style="wireframe",
                    line_width=2,
                    opacity=1.0,
                    color=(0.1, 0.75, 0.2),
                )
                target_actor.SetPickable(False)

                pose0 = PoseTR(t=np.zeros(3, dtype=float), q=np.array([1.0, 0.0, 0.0, 0.0], dtype=float))
                mi = MeshItem(
                    path=path,
                    name=name,
                    poly=poly,
                    actor=actor,
                    highlight_name=f"hl::{name}",
                    pose=pose0,
                    target_pose=PoseTR(t=pose0.t.copy(), q=pose0.q.copy()),
                    target_actor=target_actor,
                    target_actor_name=target_actor_name,
                    transformed_world_vtk=None,
                )
                self.meshes[name] = mi
                self._set_mesh_pose(mi, mi.pose)
                self._set_target_pose(mi, mi.target_pose)
                self.list_widget.addItem(QListWidgetItem(name))

            except Exception as e:
                QMessageBox.critical(self, "导入失败", f"{path}\n\n错误：{e}")

        self.refresh_original_visibility(render=False)
        self.plotter.reset_camera()
        self.plotter.render()

    def remove_selected(self):
        items = self.list_widget.selectedItems()
        if not items:
            return

        for it in items:
            name = it.text()
            mi = self.meshes.get(name)
            if mi is not None:
                try:
                    self.plotter.remove_actor(mi.highlight_name, reset_camera=False)
                except Exception:
                    pass
                try:
                    self.plotter.remove_actor(mi.actor, reset_camera=False)
                except Exception:
                    pass
                try:
                    self.plotter.remove_actor(mi.target_actor_name, reset_camera=False)
                except Exception:
                    pass
                self.meshes.pop(name, None)

            self.list_widget.takeItem(self.list_widget.row(it))

        self.plotter.render()
        self.update_selection_state()

    def clear_all(self):
        self.list_widget.clear()
        self.meshes.clear()

        self.plotter.clear()
        self.plotter.add_axes()
        self.plotter.render()

        self.info.clear()
        self.plan_text.clear()

        self.ref_init_name = None
        self.ref_init_edit.clear()

        self._plan_paths.clear()
        self._plan_offsets.clear()
        self._plan_steps.clear()
        self._plan_start_poses.clear()
        self._plan_goal_poses.clear()
        self._plan_order = []
        self._plan_total_days = 0
        self._plan_day_idx = 0

        self.pose_label.setText("目标位姿：未单选")
        self.cb_mouse_rotate.setChecked(False)
        self.set_transform_controls_enabled(False)

    def _update_target_pickable(self):
        active = self._active_target_name
        allow = self.cb_mouse_rotate.isChecked() and active is not None
        for name, mi in self.meshes.items():
            if mi.target_actor is not None:
                mi.target_actor.SetPickable(allow and name == active)

    def update_selection_state(self):
        selected = {it.text() for it in self.list_widget.selectedItems()}
        actors_dict = getattr(self.plotter, "actors", {})

        for name, mi in self.meshes.items():
            is_sel = name in selected
            show_orig = self._should_show_original(name)

            if is_sel and show_orig:
                if mi.highlight_name not in actors_dict:
                    self.plotter.add_mesh(
                        mi.poly,
                        name=mi.highlight_name,
                        style="wireframe",
                        line_width=3,
                        opacity=1.0,
                        color=(1.0, 0.84, 0.0),
                    )
                    hl = self.plotter.actors.get(mi.highlight_name) if hasattr(self.plotter, "actors") else None
                    if hl is not None:
                        hl.SetUserTransform(_vtk_transform_from_pose(mi.pose))
                try:
                    mi.actor.GetProperty().SetOpacity(0.85)
                except Exception:
                    pass
            else:
                try:
                    self.plotter.remove_actor(mi.highlight_name, reset_camera=False)
                except Exception:
                    pass
                try:
                    mi.actor.GetProperty().SetOpacity(self._base_opacity)
                except Exception:
                    pass

            try:
                if name in selected:
                    mi.target_actor.GetProperty().SetColor(1.0, 0.6, 0.0)
                    mi.target_actor.GetProperty().SetLineWidth(3)
                else:
                    mi.target_actor.GetProperty().SetColor(0.1, 0.75, 0.2)
                    mi.target_actor.GetProperty().SetLineWidth(2)
            except Exception:
                pass

        sel = self.list_widget.selectedItems()
        if len(sel) == 1:
            name = sel[0].text()
            self._active_target_name = name
            if name == self.ref_init_name:
                self.set_transform_controls_enabled(False)
                self.cb_mouse_rotate.setChecked(False)
                self.pose_label.setText("目标位姿：参考模型固定")
            else:
                self.set_transform_controls_enabled(True)
                self._update_pose_ui(self.meshes[name])
        else:
            self._active_target_name = None
            self.cb_mouse_rotate.setChecked(False)
            self.set_transform_controls_enabled(False)
            self.pose_label.setText("目标位姿：未单选")

        self._update_target_pickable()
        self.refresh_original_visibility(render=False)
        self.plotter.render()

    def move_target_selected(self, dx: int, dy: int, dz: int):
        sel = self.list_widget.selectedItems()
        if len(sel) != 1:
            QMessageBox.information(self, "提示", "请选择且仅选择1个模型来移动目标。")
            return

        name = sel[0].text()
        if name == self.ref_init_name:
            QMessageBox.warning(self, "警告", "参考模型固定，无法移动。")
            return

        mi = self.meshes[name]
        step = float(self.step_spin.value())
        new_pose = PoseTR(
            t=mi.target_pose.t + np.array([dx * step, dy * step, dz * step], dtype=float),
            q=mi.target_pose.q.copy(),
        )

        self._set_target_pose(mi, new_pose)
        self._update_pose_ui(mi)
        self.plotter.render()

    def reset_target_pose(self):
        sel = self.list_widget.selectedItems()
        if len(sel) != 1:
            return
        name = sel[0].text()
        if name == self.ref_init_name:
            QMessageBox.warning(self, "警告", "参考模型固定，无法重置。")
            return
        mi = self.meshes[name]
        new_pose = PoseTR(t=mi.pose.t.copy(), q=mi.pose.q.copy())
        self._set_target_pose(mi, new_pose)
        self._update_pose_ui(mi)
        self.plotter.render()

    def toggle_mouse_rotate(self, checked: bool):
        sel = self.list_widget.selectedItems()
        if checked:
            if len(sel) != 1:
                QMessageBox.information(self, "提示", "在鼠标旋转前请选择1个模型。")
                self.cb_mouse_rotate.setChecked(False)
                return
            name = sel[0].text()
            if name == self.ref_init_name:
                QMessageBox.warning(self, "警告", "参考模型固定，无法旋转。")
                self.cb_mouse_rotate.setChecked(False)
                return
            self.plotter.interactor.SetInteractorStyle(self._style_actor)
        else:
            self.plotter.interactor.SetInteractorStyle(self._style_camera)
        self._update_target_pickable()

    def _on_actor_interaction_end(self, obj=None, evt=None):
        if not self.cb_mouse_rotate.isChecked():
            return
        if self._active_target_name is None:
            return
        mi = self.meshes.get(self._active_target_name)
        if mi is None:
            return

        self._sync_target_pose_from_actor(mi)
        self._update_pose_ui(mi)
        self.plotter.render()

    def refresh_targets_visibility(self):
        self._target_visible = self.cb_show_targets.isChecked()
        for mi in self.meshes.values():
            try:
                mi.target_actor.SetVisibility(self._target_visible)
            except Exception:
                pass
        self.plotter.render()

    def refresh_original_visibility(self, render: bool = True):
        for name, mi in self.meshes.items():
            visible = self._should_show_original(name)
            try:
                mi.actor.SetVisibility(visible)
            except Exception:
                pass
            hl = self.plotter.actors.get(mi.highlight_name) if hasattr(self.plotter, "actors") else None
            if hl is not None:
                try:
                    hl.SetVisibility(visible)
                except Exception:
                    pass
        if render:
            self.plotter.render()

    def _build_target_poses(self) -> Dict[str, PoseTR]:
        return {
            name: PoseTR(t=mi.target_pose.t.copy(), q=mi.target_pose.q.copy())
            for name, mi in self.meshes.items()
        }

    def _find_target_collisions_exact(self) -> List[Tuple[str, str]]:
        names = list(self.meshes.keys())
        if len(names) < 2:
            return []

        target_poses = self._build_target_poses()
        collisions = []

        for i in range(len(names)):
            name_i = names[i]
            mi_i = self.meshes[name_i]
            pose_i = target_poses[name_i]
            bounds_i = _transform_bounds(mi_i.poly.GetBounds(), pose_i, pad=COLLISION_BOUNDS_PAD_MM)

            for j in range(i + 1, len(names)):
                name_j = names[j]
                mi_j = self.meshes[name_j]
                pose_j = target_poses[name_j]
                bounds_j = _transform_bounds(mi_j.poly.GetBounds(), pose_j, pad=COLLISION_BOUNDS_PAD_MM)

                if not _bounds_overlap(bounds_i, bounds_j):
                    continue

                collide = vtk.vtkCollisionDetectionFilter()
                collide.SetInputData(0, mi_i.poly)
                collide.SetInputData(1, mi_j.poly)
                collide.SetMatrix(0, _vtk_matrix_from_pose(pose_i))
                collide.SetMatrix(1, _vtk_matrix_from_pose(pose_j))
                collide.SetBoxTolerance(0.0)
                collide.SetCellTolerance(0.0)
                collide.SetNumberOfCellsPerNode(4)
                collide.Update()
                if collide.GetNumberOfContacts() > 0:
                    collisions.append((name_i, name_j))
        return collisions

    def validate_targets(self):
        if not self.meshes:
            QMessageBox.information(self, "提示", "请先导入STL。")
            return

        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            collisions = self._find_target_collisions_exact()
        finally:
            QApplication.restoreOverrideCursor()

        if not collisions:
            QMessageBox.information(self, "结果", "目标位姿无碰撞。")
            return

        lines = ["检测到目标碰撞："]
        for a, b in collisions:
            lines.append(f"- {a} 与 {b}")
        QMessageBox.warning(self, "结果", "\n".join(lines))

    def calc_distance(self):
        items = self.list_widget.selectedItems()
        if len(items) != 2:
            QMessageBox.information(self, "提示", "请选择2个模型。")
            return

        a_name, b_name = items[0].text(), items[1].text()
        a = self.meshes[a_name]
        b = self.meshes[b_name]
        self._ensure_world_cache(a)
        self._ensure_world_cache(b)

        try:
            dmin, pa, pb = _closest_points_min_distance(a.transformed_world_vtk, b.transformed_world_vtk)
            vec = pb - pa
            dec = _direction_decompose(vec)

            self.plotter.remove_actor("min_dist_line", reset_camera=False)
            self.plotter.remove_actor("min_dist_pts", reset_camera=False)

            line = pv.Line(pa, pb)
            self.plotter.add_mesh(line, name="min_dist_line", line_width=6, color="red")
            pts = pv.PolyData(np.vstack([pa, pb]))
            self.plotter.add_mesh(pts, name="min_dist_pts", point_size=14, render_points_as_spheres=True, color="red")
            self.plotter.render()

            self.info.setPlainText(
                f"模型A：{a_name}\n模型B：{b_name}\n\n"
                f"最小距离 = {dmin:.4f} mm\n\n"
                f"dx={dec['dx']:.4f}  dy={dec['dy']:.4f}  dz={dec['dz']:.4f}\n"
                f"右={dec['right']:.4f} 左={dec['left']:.4f} 前={dec['front']:.4f} 后={dec['back']:.4f}\n"
                f"上={dec['up']:.4f} 下={dec['down']:.4f}\n"
            )
        except Exception as e:
            QMessageBox.critical(self, "计算失败", f"错误：{e}")

    def set_ref_initial(self):
        sel = self.list_widget.selectedItems()
        if len(sel) != 1:
            QMessageBox.information(self, "提示", "请选择1个模型作为参考。")
            return
        self.ref_init_name = sel[0].text()
        self.ref_init_edit.setText(self.ref_init_name)
        self.update_selection_state()
        self.refresh_original_visibility()

    def clear_reference(self):
        self.ref_init_name = None
        self.ref_init_edit.clear()
        self.update_selection_state()
        self.refresh_original_visibility()

    def _collect_obstacles_data(self, current_pose: Dict[str, PoseTR], moving_name: str) -> List[ObstacleData]:
        obs = []
        for name, mi in self.meshes.items():
            if name == moving_name:
                continue
            pose = current_pose[name]
            obs.append(ObstacleData(poly=mi.poly, pose=pose))
        return obs

    def _plan_single_bone(
        self,
        name: str,
        start_pose: PoseTR,
        goal_pose: PoseTR,
        current_pose: Dict[str, PoseTR],
        max_mm: float,
        max_deg: float,
    ) -> Optional[Tuple[List[PoseTR], str, float]]:
        mi = self.meshes[name]
        obstacle_data = self._collect_obstacles_data(current_pose, name)
        obstacles = [_make_obstacle(od.poly, od.pose) for od in obstacle_data]
        checker = CollisionChecker(mi.poly, obstacles, max_step_mm=COLLISION_MAX_STEP_MM, max_step_deg=COLLISION_MAX_STEP_DEG)

        ref_name = self.ref_init_name
        if not ref_name or ref_name not in self.meshes:
            QMessageBox.warning(self, "规划失败", "参考模型缺失。")
            return None

        ref_pose = current_pose[ref_name]
        ref_center_local = np.array(self.meshes[ref_name].poly.center, dtype=float)
        ref_center_world = _pose_center_world(ref_center_local, ref_pose)
        moving_center_local = np.array(mi.poly.center, dtype=float)

        start_collide = not checker.is_pose_collision_free(start_pose)
        goal_collide = not checker.is_pose_collision_free(goal_pose)

        if goal_collide:
            QMessageBox.warning(self, "规划失败", f"{name} 目标位姿发生碰撞。")
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
                moving_poly=mi.poly,
                obstacle_data=obstacle_data,
                allow_start_collision=allow_start_core,
            )
            if plan is None:
                QMessageBox.critical(self, "规划失败", f"{name} 未找到无碰撞路径。")
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
            QMessageBox.critical(self, "规划失败", f"{name} 路径细分后仍有碰撞。")
            return None

        cost = _path_score_post(full, moving_center_local, ref_center_world)
        return full, planner_used, cost

    def generate_plan(self):
        if not self.ref_init_name:
            QMessageBox.information(self, "提示", "请先设置参考模型。")
            return
        if self.ref_init_name not in self.meshes:
            QMessageBox.information(self, "提示", "参考模型已不存在。")
            return

        init_names_all = self._all_names(self.list_widget)
        if not init_names_all:
            QMessageBox.information(self, "提示", "请先导入STL。")
            return

        plan_names = [n for n in init_names_all if n != self.ref_init_name]
        if not plan_names:
            QMessageBox.information(self, "提示", "没有可移动模型（已排除参考）。")
            return

        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            collisions = self._find_target_collisions_exact()
        finally:
            QApplication.restoreOverrideCursor()

        if collisions:
            QMessageBox.warning(self, "规划失败", "目标位姿发生碰撞，请调整后重新校验。")
            return

        max_mm = float(self.max_mm_spin.value())
        max_deg = float(self.max_deg_spin.value())

        start_pose_all = {name: PoseTR(t=mi.pose.t.copy(), q=mi.pose.q.copy()) for name, mi in self.meshes.items()}
        target_pose_all = {name: PoseTR(t=mi.target_pose.t.copy(), q=mi.target_pose.q.copy()) for name, mi in self.meshes.items()}

        orders = [plan_names]
        if TRY_ALT_ORDERS:
            by_dist = sorted(plan_names, key=lambda n: _pose_distance(start_pose_all[n], target_pose_all[n]))
            orders.append(by_dist)
            orders.append(list(reversed(by_dist)))

        best_result = None

        for order in orders:
            current_pose = {name: PoseTR(t=mi.pose.t.copy(), q=mi.pose.q.copy()) for name, mi in self.meshes.items()}

            plan_paths = {}
            plan_offsets = {}
            plan_steps = {}
            plan_start_poses = {}
            plan_goal_poses = {}
            plan_infos = []
            offset = 0
            total_cost = 0.0

            failed = False
            for name in order:
                res = self._plan_single_bone(name, current_pose[name], target_pose_all[name], current_pose, max_mm, max_deg)
                if res is None:
                    failed = True
                    break
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

            if failed:
                continue

            candidate = {
                "plan_paths": plan_paths,
                "plan_offsets": plan_offsets,
                "plan_steps": plan_steps,
                "plan_start_poses": plan_start_poses,
                "plan_goal_poses": plan_goal_poses,
                "plan_infos": plan_infos,
                "plan_order": order,
                "plan_total_days": offset,
                "total_cost": total_cost,
            }

            if best_result is None or candidate["total_cost"] < best_result["total_cost"]:
                best_result = candidate

            if ORDER_TRY_MODE == "first":
                break

        if best_result is None:
            QMessageBox.critical(self, "规划失败", "所有顺序尝试均失败。")
            return

        self._plan_paths = best_result["plan_paths"]
        self._plan_offsets = best_result["plan_offsets"]
        self._plan_steps = best_result["plan_steps"]
        self._plan_start_poses = best_result["plan_start_poses"]
        self._plan_goal_poses = best_result["plan_goal_poses"]
        self._plan_order = best_result["plan_order"]
        self._plan_total_days = best_result["plan_total_days"]
        self._plan_day_idx = 0

        for name, mi in self.meshes.items():
            self._set_mesh_pose(mi, self._plan_start_poses.get(name, mi.pose))

        self.plotter.render()

        lines = []
        lines.append(f"参考件：{self.ref_init_name}")
        lines.append(f"可移动模型数：{len(self._plan_order)}")
        lines.append("规划方式：顺序移动（一次一个模型）")
        lines.append(f"总天数：{self._plan_total_days}")
        lines.append("")

        for name, s, e, planner_used in best_result["plan_infos"]:
            lines.append(f"模型：{name}  天数：{s + 1}-{e}  规划器：{planner_used}")
        lines.append("")

        for name, s, e, planner_used in best_result["plan_infos"]:
            path = self._plan_paths[name]
            steps = self._plan_steps[name]
            lines.append(f"【{name}】  规划器={planner_used}  天数={steps}")
            lines.append("天数, 平移(mm), 旋转(deg)")
            for local_day in range(1, steps + 1):
                a = path[local_day - 1]
                b = path[local_day]
                dt_vec = b.t - a.t
                q_rel = _quat_mul(b.q, _quat_inv(a.q))
                euler = _rotmat_to_euler_xyz(_quat_to_rotmat(q_rel))
                t_str = _format_translation(dt_vec)
                r_str = _format_rotation(euler)
                global_day = self._plan_offsets[name] + local_day
                lines.append(f"{global_day}, {t_str}, {r_str}")
            lines.append("")

        lines.append("注：预览基于全局天数索引（顺序规划）。")
        self.plan_text.setPlainText("\n".join(lines))

    def preview_day(self, delta: int):
        if self._plan_total_days <= 0 and not self._plan_paths:
            QMessageBox.information(self, "提示", "尚未生成规划。")
            return

        self._plan_day_idx = max(0, min(self._plan_total_days, self._plan_day_idx + delta))
        for name, mi in self.meshes.items():
            if name in self._plan_paths:
                offset = self._plan_offsets[name]
                steps = self._plan_steps[name]
                if self._plan_day_idx < offset:
                    pose = self._plan_start_poses[name]
                elif self._plan_day_idx > offset + steps:
                    pose = self._plan_goal_poses[name]
                else:
                    pose = self._plan_paths[name][self._plan_day_idx - offset]
            else:
                pose = self._plan_start_poses.get(name, mi.pose)
            self._set_mesh_pose(mi, pose)

        self.plotter.render()
        self.statusBar().showMessage(f"预览 第{self._plan_day_idx}/{self._plan_total_days}天", 3000)


def main():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.resize(1550, 860)
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
