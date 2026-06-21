# 2D / biplanar 3D A* planner (from 2dmax logic, no Qt)
from __future__ import annotations

import math
import heapq
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
import cv2


@dataclass
class Calibration:
    mm_per_px_x: float = 1.0
    mm_per_px_y: float = 1.0


def round_half_up(x: float) -> int:
    if x >= 0:
        return int(math.floor(x + 0.5))
    return int(math.ceil(x - 0.5))


def bbox_from_mask(mask: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    ys, xs = np.where(mask.astype(bool))
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def dilate_mask(mask: np.ndarray, k: int = 1) -> np.ndarray:
    if k <= 0:
        return mask.astype(bool)
    kernel = np.ones((2 * k + 1, 2 * k + 1), np.uint8)
    m = (mask.astype(np.uint8) * 255)
    d = cv2.dilate(m, kernel, iterations=1)
    return d > 0


def path_length_3d_mm(path_mm: List[Tuple[float, float, float]]) -> float:
    if len(path_mm) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(path_mm)):
        dx = path_mm[i][0] - path_mm[i - 1][0]
        dy = path_mm[i][1] - path_mm[i - 1][1]
        dz = path_mm[i][2] - path_mm[i - 1][2]
        total += math.sqrt(dx * dx + dy * dy + dz * dz)
    return total


class CollisionService:
    @staticmethod
    def overlap_area(a: np.ndarray, b: np.ndarray) -> int:
        return int(np.count_nonzero(a.astype(bool) & b.astype(bool)))


class DistanceService:
    @staticmethod
    def compute_dist_map_px(obstacle_mask: np.ndarray) -> np.ndarray:
        obs = obstacle_mask.astype(np.uint8)
        free = (1 - obs).astype(np.uint8) * 255
        return cv2.distanceTransform(free, cv2.DIST_L2, 3)

    @staticmethod
    def extract_boundary_points(mask: np.ndarray) -> np.ndarray:
        m = mask.astype(np.uint8) * 255
        edges = cv2.Canny(m, 50, 150)
        ys, xs = np.where(edges > 0)
        if len(xs) == 0:
            ys, xs = np.where(mask.astype(bool))
        if len(xs) == 0:
            return np.zeros((0, 2), dtype=np.int32)
        return np.stack([xs, ys], axis=1).astype(np.int32)

    @staticmethod
    def min_clearance_mm_for_shift(
        boundary_pts_xy: np.ndarray,
        shift_dxdy_px: Tuple[int, int],
        dist_map_px: np.ndarray,
        calib: Calibration,
    ) -> float:
        if boundary_pts_xy is None or len(boundary_pts_xy) == 0:
            return 1e9
        dx, dy = shift_dxdy_px
        h, w = dist_map_px.shape
        xs = boundary_pts_xy[:, 0] + dx
        ys = boundary_pts_xy[:, 1] + dy
        if xs.min() < 0 or ys.min() < 0 or xs.max() >= w or ys.max() >= h:
            return -float("inf")
        vals = dist_map_px[ys.astype(int), xs.astype(int)]
        return float(vals.min() * calib.mm_per_px_x)


class MaskTransform:
    @staticmethod
    def shift_bool_mask(mask: np.ndarray, dx: int, dy: int) -> np.ndarray:
        h, w = mask.shape
        out = np.zeros_like(mask, dtype=bool)
        src_x1 = max(0, -dx)
        src_x2 = min(w, w - dx)
        src_y1 = max(0, -dy)
        src_y2 = min(h, h - dy)
        dst_x1 = max(0, dx)
        dst_x2 = min(w, w + dx)
        dst_y1 = max(0, dy)
        dst_y2 = min(h, h + dy)
        if src_x1 >= src_x2 or src_y1 >= src_y2:
            return out
        out[dst_y1:dst_y2, dst_x1:dst_x2] = mask[src_y1:src_y2, src_x1:src_x2]
        return out


@dataclass
class Planner3DConfig:
    step_mm: float = 1.0
    neighbor26: bool = True
    edge_sample_mm: float = 0.8
    max_expand: int = 300000
    contact_as_collision: bool = True
    min_clearance_mm: float = 0.0


@dataclass
class Path3DResult:
    ok: bool
    path_mm: List[Tuple[float, float, float]]
    total_len_mm: float = 0.0
    message: str = ""


class AStarPlanner3D:
    def __init__(
        self,
        front_rigid_mask: np.ndarray,
        front_obstacle_mask: np.ndarray,
        front_calib: Calibration,
        side_rigid_mask: np.ndarray,
        side_obstacle_mask: np.ndarray,
        side_calib: Calibration,
        cfg: Planner3DConfig,
    ):
        self.cfg = cfg
        self.front_rigid = front_rigid_mask.astype(bool)
        self.side_rigid = side_rigid_mask.astype(bool)
        self.front_obstacle = front_obstacle_mask.astype(bool)
        self.side_obstacle = side_obstacle_mask.astype(bool)
        if cfg.contact_as_collision:
            self.front_obstacle = dilate_mask(self.front_obstacle, 1)
            self.side_obstacle = dilate_mask(self.side_obstacle, 1)
        self.front_calib = front_calib
        self.side_calib = side_calib
        self.fh, self.fw = self.front_rigid.shape
        self.sh, self.sw = self.side_rigid.shape
        self.front_bbox = bbox_from_mask(self.front_rigid)
        self.side_bbox = bbox_from_mask(self.side_rigid)
        self.front_dist = (
            DistanceService.compute_dist_map_px(self.front_obstacle)
            if cfg.min_clearance_mm > 0
            else None
        )
        self.side_dist = (
            DistanceService.compute_dist_map_px(self.side_obstacle)
            if cfg.min_clearance_mm > 0
            else None
        )
        self.front_bd = (
            DistanceService.extract_boundary_points(self.front_rigid)
            if cfg.min_clearance_mm > 0
            else None
        )
        self.side_bd = (
            DistanceService.extract_boundary_points(self.side_rigid)
            if cfg.min_clearance_mm > 0
            else None
        )
        self.step_mm = float(cfg.step_mm)
        self.neighbors = self._build_neighbors()
        self.valid_domain = True
        self.bounds_idx = self._compute_bounds_idx()

    def _build_neighbors(self):
        if self.cfg.neighbor26:
            return [
                (dx, dy, dz)
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
                for dz in (-1, 0, 1)
                if (dx, dy, dz) != (0, 0, 0)
            ]
        return [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]

    def _compute_bounds_idx(self):
        if self.front_bbox is None or self.side_bbox is None:
            self.valid_domain = False
            return None
        fx1, fy1, fx2, fy2 = self.front_bbox
        sx1, sy1, sx2, sy2 = self.side_bbox
        min_lr_mm = (-fx1) * self.front_calib.mm_per_px_x
        max_lr_mm = (self.fw - 1 - fx2) * self.front_calib.mm_per_px_x
        min_ud_front = (-fy1) * self.front_calib.mm_per_px_y
        max_ud_front = (self.fh - 1 - fy2) * self.front_calib.mm_per_px_y
        min_fb_mm = -(self.sw - 1 - sx2) * self.side_calib.mm_per_px_x
        max_fb_mm = (sx1) * self.side_calib.mm_per_px_x
        min_ud_side = (-sy1) * self.side_calib.mm_per_px_y
        max_ud_side = (self.sh - 1 - sy2) * self.side_calib.mm_per_px_y
        min_ud_mm = max(min_ud_front, min_ud_side)
        max_ud_mm = min(max_ud_front, max_ud_side)
        if min_ud_mm > max_ud_mm or min_fb_mm > max_fb_mm:
            self.valid_domain = False
            return None
        s = self.step_mm
        return (
            int(math.floor(min_lr_mm / s)),
            int(math.ceil(max_lr_mm / s)),
            int(math.floor(min_ud_mm / s)),
            int(math.ceil(max_ud_mm / s)),
            int(math.floor(min_fb_mm / s)),
            int(math.ceil(max_fb_mm / s)),
        )

    def _state_to_mm(self, st: Tuple[int, int, int]) -> Tuple[float, float, float]:
        return st[0] * self.step_mm, st[1] * self.step_mm, st[2] * self.step_mm

    def _mm_to_state(self, mm: Tuple[float, float, float]) -> Tuple[int, int, int]:
        return (
            round_half_up(mm[0] / self.step_mm),
            round_half_up(mm[1] / self.step_mm),
            round_half_up(mm[2] / self.step_mm),
        )

    def _within_bounds(self, st: Tuple[int, int, int]) -> bool:
        if not self.valid_domain or self.bounds_idx is None:
            return False
        lx0, lx1, ly0, ly1, lz0, lz1 = self.bounds_idx
        return lx0 <= st[0] <= lx1 and ly0 <= st[1] <= ly1 and lz0 <= st[2] <= lz1

    def _front_shift_px(self, mm_pose: Tuple[float, float, float]) -> Tuple[int, int]:
        lr, ud, _ = mm_pose
        return round_half_up(lr / self.front_calib.mm_per_px_x), round_half_up(
            ud / self.front_calib.mm_per_px_y
        )

    def _side_shift_px(self, mm_pose: Tuple[float, float, float]) -> Tuple[int, int]:
        _, ud, fb = mm_pose
        return round_half_up(-fb / self.side_calib.mm_per_px_x), round_half_up(
            ud / self.side_calib.mm_per_px_y
        )

    @staticmethod
    def _bbox_in_bounds(bbox, shift, w, h):
        if bbox is None:
            return False
        x1, y1, x2, y2 = bbox
        dx, dy = shift
        return x1 + dx >= 0 and y1 + dy >= 0 and x2 + dx < w and y2 + dy < h

    def _view_valid(
        self,
        rigid_mask: np.ndarray,
        rigid_bbox: Optional[Tuple[int, int, int, int]],
        obstacle_mask: np.ndarray,
        calib: Calibration,
        shift_px: Tuple[int, int],
        width: int,
        height: int,
        dist_map=None,
        bd_pts=None,
    ) -> bool:
        if not self._bbox_in_bounds(rigid_bbox, shift_px, width, height):
            return False
        moved = MaskTransform.shift_bool_mask(rigid_mask, shift_px[0], shift_px[1])
        if CollisionService.overlap_area(moved, obstacle_mask) > 0:
            return False
        if (
            self.cfg.min_clearance_mm > 0
            and dist_map is not None
            and bd_pts is not None
            and len(bd_pts) > 0
        ):
            clearance = DistanceService.min_clearance_mm_for_shift(
                bd_pts, shift_px, dist_map, calib
            )
            if clearance < self.cfg.min_clearance_mm:
                return False
        return True

    def node_valid(self, st: Tuple[int, int, int]) -> bool:
        if not self._within_bounds(st):
            return False
        mm_pose = self._state_to_mm(st)
        f_shift = self._front_shift_px(mm_pose)
        s_shift = self._side_shift_px(mm_pose)
        ok_f = self._view_valid(
            self.front_rigid,
            self.front_bbox,
            self.front_obstacle,
            self.front_calib,
            f_shift,
            self.fw,
            self.fh,
            self.front_dist,
            self.front_bd,
        )
        if not ok_f:
            return False
        ok_s = self._view_valid(
            self.side_rigid,
            self.side_bbox,
            self.side_obstacle,
            self.side_calib,
            s_shift,
            self.sw,
            self.sh,
            self.side_dist,
            self.side_bd,
        )
        return ok_s

    def edge_valid(self, a: Tuple[int, int, int], b: Tuple[int, int, int]) -> bool:
        seg_len = math.sqrt(
            (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2
        ) * self.step_mm
        if seg_len <= 1e-12:
            return True
        n = max(2, int(math.ceil(seg_len / self.cfg.edge_sample_mm)) + 1)
        for i in range(n):
            t = i / (n - 1)
            sx = round_half_up(a[0] + (b[0] - a[0]) * t)
            sy = round_half_up(a[1] + (b[1] - a[1]) * t)
            sz = round_half_up(a[2] + (b[2] - a[2]) * t)
            if not self.node_valid((sx, sy, sz)):
                return False
        return True

    @staticmethod
    def _step_cost(a: Tuple[int, int, int], b: Tuple[int, int, int], step_mm: float) -> float:
        dx = (b[0] - a[0]) * step_mm
        dy = (b[1] - a[1]) * step_mm
        dz = (b[2] - a[2]) * step_mm
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    def plan(
        self,
        start_mm: Tuple[float, float, float],
        goal_mm: Tuple[float, float, float],
    ) -> Path3DResult:
        if not self.valid_domain:
            return Path3DResult(False, [], message="Invalid search domain.")
        start = self._mm_to_state(start_mm)
        goal = self._mm_to_state(goal_mm)

        def h(st):
            return self._step_cost(st, goal, self.step_mm)

        if not self._within_bounds(start) or not self._within_bounds(goal):
            return Path3DResult(False, [], message="Start or goal out of bounds.")
        if not self.node_valid(start):
            return Path3DResult(False, [], message="Start invalid.")
        if not self.node_valid(goal):
            return Path3DResult(False, [], message="Goal invalid.")

        open_heap = []
        gscore = {start: 0.0}
        parent = {}
        visited = set()
        heapq.heappush(open_heap, (h(start), start))
        expanded = 0

        while open_heap:
            _, cur = heapq.heappop(open_heap)
            if cur in visited:
                continue
            visited.add(cur)
            if cur == goal:
                path_states = [cur]
                while cur in parent:
                    cur = parent[cur]
                    path_states.append(cur)
                path_states.reverse()
                path_mm = [self._state_to_mm(s) for s in path_states]
                total = path_length_3d_mm(path_mm)
                return Path3DResult(True, path_mm, total_len_mm=total, message="OK")
            expanded += 1
            if expanded > self.cfg.max_expand:
                return Path3DResult(False, [], message="A* expand limit reached.")
            for dn in self.neighbors:
                nb = (cur[0] + dn[0], cur[1] + dn[1], cur[2] + dn[2])
                if nb in visited:
                    continue
                if not self._within_bounds(nb) or not self.node_valid(nb) or not self.edge_valid(cur, nb):
                    continue
                tentative = gscore[cur] + self._step_cost(cur, nb, self.step_mm)
                if tentative < gscore.get(nb, float("inf")):
                    gscore[nb] = tentative
                    parent[nb] = cur
                    heapq.heappush(open_heap, (tentative + h(nb), nb))
        return Path3DResult(False, [], message="No feasible path found.")


def resample_daily_3d(
    path_mm: List[Tuple[float, float, float]],
    day_step_mm: float = 1.0,
) -> List[Tuple[float, float, float]]:
    if not path_mm:
        return []
    if len(path_mm) == 1:
        return [path_mm[0], path_mm[0]]
    cum = [0.0]
    for i in range(1, len(path_mm)):
        dx = path_mm[i][0] - path_mm[i - 1][0]
        dy = path_mm[i][1] - path_mm[i - 1][1]
        dz = path_mm[i][2] - path_mm[i - 1][2]
        cum.append(cum[-1] + math.sqrt(dx * dx + dy * dy + dz * dz))
    total = cum[-1]
    if total <= 1e-12:
        return [path_mm[0], path_mm[-1]]
    out = [path_mm[0]]
    t_mm = day_step_mm
    cum_np = np.array(cum, dtype=np.float64)
    while t_mm < total - 1e-8:
        idx = int(np.searchsorted(cum_np, t_mm) - 1)
        idx = max(0, min(idx, len(path_mm) - 2))
        t0, t1 = cum[idx], cum[idx + 1]
        if t1 <= t0:
            break
        alpha = (t_mm - t0) / (t1 - t0)
        x = path_mm[idx][0] + (path_mm[idx + 1][0] - path_mm[idx][0]) * alpha
        y = path_mm[idx][1] + (path_mm[idx + 1][1] - path_mm[idx][1]) * alpha
        z = path_mm[idx][2] + (path_mm[idx + 1][2] - path_mm[idx][2]) * alpha
        out.append((float(x), float(y), float(z)))
        t_mm += day_step_mm
    # 最后一段可能超过 day_step_mm，保证每天总增量不得超过 day_step_mm
    last_pt = out[-1]
    end_pt = path_mm[-1]
    d_end = math.sqrt(
        (end_pt[0] - last_pt[0]) ** 2
        + (end_pt[1] - last_pt[1]) ** 2
        + (end_pt[2] - last_pt[2]) ** 2
    )
    if d_end <= 1e-6:
        out.append(end_pt)  # 已是终点，仍保留
    elif d_end <= day_step_mm + 1e-9:
        out.append(end_pt)
    else:
        n_seg = int(math.ceil(d_end / day_step_mm))
        for i in range(1, n_seg):
            alpha = (i * day_step_mm) / d_end
            pt = (
                last_pt[0] + alpha * (end_pt[0] - last_pt[0]),
                last_pt[1] + alpha * (end_pt[1] - last_pt[1]),
                last_pt[2] + alpha * (end_pt[2] - last_pt[2]),
            )
            out.append(pt)
        out.append(end_pt)
    dedup = [out[0]]
    for p in out[1:]:
        d = math.sqrt(
            (p[0] - dedup[-1][0]) ** 2
            + (p[1] - dedup[-1][1]) ** 2
            + (p[2] - dedup[-1][2]) ** 2
        )
        if d > 1e-6:
            dedup.append(p)
    return dedup
