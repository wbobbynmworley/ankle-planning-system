# STL collision detection (from CT3D, vtk only)
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple

import numpy as np

try:
    import vtk
except ImportError:
    vtk = None  # type: ignore


@dataclass
class PoseTR:
    t: np.ndarray  # (3,)
    q: np.ndarray  # (4,) wxyz


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


def _vtk_matrix_from_pose(pose: PoseTR):
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
    return M


def _transform_bounds(bounds: Tuple, pose: PoseTR, pad: float = 0.0) -> Tuple:
    if vtk is None:
        return bounds
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


def _bounds_overlap(a: Tuple, b: Tuple) -> bool:
    if a[1] < b[0] or a[0] > b[1]:
        return False
    if a[3] < b[2] or a[2] > b[3]:
        return False
    if a[5] < b[4] or a[4] > b[5]:
        return False
    return True


COLLISION_BOUNDS_PAD_MM = 0.01


def _bounds_radius(bounds: Tuple) -> float:
    dx = bounds[1] - bounds[0]
    dy = bounds[3] - bounds[2]
    dz = bounds[5] - bounds[4]
    return 0.5 * math.sqrt(dx * dx + dy * dy + dz * dz)


@dataclass
class ObstacleData:
    """与 CT3D 一致：障碍物 = poly + pose（用于 A* 规划时构建 Obstacle）"""
    poly: object
    pose: PoseTR


@dataclass
class Obstacle:
    poly: object
    pose: PoseTR
    bounds_world: Tuple
    matrix: object


def _make_obstacle(poly, pose: PoseTR) -> Obstacle:
    if vtk is None:
        raise RuntimeError("vtk not installed")
    bounds_world = _transform_bounds(poly.GetBounds(), pose, pad=COLLISION_BOUNDS_PAD_MM)
    matrix = _vtk_matrix_from_pose(pose)
    return Obstacle(poly=poly, pose=pose, bounds_world=bounds_world, matrix=matrix)


def _make_collision_filter(poly_a, poly_b, matrix_b):
    if vtk is None:
        raise RuntimeError("vtk not installed")
    collide = vtk.vtkCollisionDetectionFilter()
    collide.SetInputData(0, poly_a)
    collide.SetInputData(1, poly_b)
    collide.SetMatrix(0, vtk.vtkMatrix4x4())
    collide.SetMatrix(1, matrix_b)
    collide.SetBoxTolerance(0.0)
    collide.SetCellTolerance(0.0)
    collide.SetNumberOfCellsPerNode(4)
    return collide


def _collision_filter_hit(collide, moving_matrix) -> bool:
    collide.SetMatrix(0, moving_matrix)
    collide.Update()
    return collide.GetNumberOfContacts() > 0


def check_pair_collision_exact(poly_a, pose_a: PoseTR, poly_b, pose_b: PoseTR) -> bool:
    """两 mesh 在给定位姿下是否发生三角形级碰撞（与 CT3D _find_target_collisions_exact 一致）"""
    if vtk is None:
        return False
    bounds_a = _transform_bounds(poly_a.GetBounds(), pose_a, pad=COLLISION_BOUNDS_PAD_MM)
    bounds_b = _transform_bounds(poly_b.GetBounds(), pose_b, pad=COLLISION_BOUNDS_PAD_MM)
    if not _bounds_overlap(bounds_a, bounds_b):
        return False
    collide = vtk.vtkCollisionDetectionFilter()
    collide.SetInputData(0, poly_a)
    collide.SetInputData(1, poly_b)
    collide.SetMatrix(0, _vtk_matrix_from_pose(pose_a))
    collide.SetMatrix(1, _vtk_matrix_from_pose(pose_b))
    collide.SetBoxTolerance(0.0)
    collide.SetCellTolerance(0.0)
    collide.SetNumberOfCellsPerNode(4)
    collide.Update()
    return collide.GetNumberOfContacts() > 0


class CollisionChecker:
    """与 CT3D 一致：支持 max_step_deg、radius、segment_steps（用于路径段碰撞检测）"""

    def __init__(
        self,
        moving_poly,
        obstacles: List[Obstacle],
        max_step_mm: float = 0.5,
        max_step_deg: float = 0.5,
    ):
        self.moving_poly = moving_poly
        self.obstacles = obstacles
        self.max_step_mm = max_step_mm
        self.max_step_deg = max_step_deg
        self.moving_bounds_local = moving_poly.GetBounds()
        self.radius = _bounds_radius(self.moving_bounds_local)
        self.pairs = []
        if vtk is None:
            return
        for obs in obstacles:
            filt = _make_collision_filter(moving_poly, obs.poly, obs.matrix)
            self.pairs.append((obs, filt))

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
