# -*- coding: utf-8 -*-
import os
import sys
import math
import time
import heapq
from datetime import datetime
from dataclasses import dataclass, field
from functools import partial
from typing import Optional, List, Dict, Tuple

import numpy as np
import cv2

from PySide6 import QtCore, QtGui, QtWidgets

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdf_canvas
    REPORTLAB_OK = True
except Exception:
    REPORTLAB_OK = False

try:
    from shiboken6 import isValid
except Exception:
    def isValid(obj):
        return True


# =========================
# 固定参数
# =========================
SAM_CKPT = r"D:\VIT-L\sam_vit_h_4b8939.pth"
SAM_MODEL_TYPE = "vit_h"


# =========================
# Utility
# =========================
def now_str() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())


def clamp_int(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def round_half_up(x: float) -> int:
    if x >= 0:
        return int(math.floor(x + 0.5))
    return int(math.ceil(x - 0.5))


def norm_path(path: str) -> str:
    return os.path.abspath(os.path.normpath(path))


def cv_read_image_safe(path: str, flags=cv2.IMREAD_UNCHANGED) -> Tuple[Optional[np.ndarray], str]:
    p = norm_path(path)
    if not os.path.isfile(p):
        return None, f"文件不存在：{p}"
    try:
        data = np.fromfile(p, dtype=np.uint8)
        if data.size == 0:
            return None, f"文件为空：{p}"
        img = cv2.imdecode(data, flags)
        if img is None:
            return None, f"OpenCV 解码失败：{p}"
        return img, ""
    except Exception as e:
        return None, f"读取异常：{e}"


def cv_write_image_safe(path: str, img: np.ndarray) -> Tuple[bool, str, str]:
    try:
        p = norm_path(path)
        _, ext = os.path.splitext(p)
        if ext == "":
            ext = ".png"
            p = p + ext
        os.makedirs(os.path.dirname(p), exist_ok=True)

        ok, buf = cv2.imencode(ext, img)
        if not ok:
            return False, f"OpenCV 编码失败：{p}", p
        buf.tofile(p)
        return True, "", p
    except Exception as e:
        return False, f"写入异常：{e}", path


def ensure_gray_u8(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        if img.dtype == np.uint8:
            return img
        img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX)
        return img.astype(np.uint8)
    if img.ndim == 3:
        if img.shape[2] == 3:
            return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if img.shape[2] == 4:
            return cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    raise ValueError("Unsupported image format")


def qimage_from_gray(gray_u8: np.ndarray) -> QtGui.QImage:
    h, w = gray_u8.shape
    qimg = QtGui.QImage(gray_u8.data, w, h, w, QtGui.QImage.Format_Grayscale8)
    return qimg.copy()


def qimage_from_rgba(rgba_u8: np.ndarray) -> QtGui.QImage:
    h, w, _ = rgba_u8.shape
    qimg = QtGui.QImage(rgba_u8.data, w, h, 4 * w, QtGui.QImage.Format_RGBA8888)
    return qimg.copy()


def mask_to_rgba(mask: np.ndarray, color_rgba=(0, 255, 0, 120)) -> np.ndarray:
    h, w = mask.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    m = mask.astype(bool)
    out[m, 0] = color_rgba[0]
    out[m, 1] = color_rgba[1]
    out[m, 2] = color_rgba[2]
    out[m, 3] = color_rgba[3]
    return out


def bbox_from_mask(mask: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    ys, xs = np.where(mask.astype(bool))
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def crop_mask(mask: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
    x1, y1, x2, y2 = bbox
    return mask[y1:y2 + 1, x1:x2 + 1]


def dilate_mask(mask: np.ndarray, k: int = 1) -> np.ndarray:
    if k <= 0:
        return mask.astype(bool)
    kernel = np.ones((2 * k + 1, 2 * k + 1), np.uint8)
    m = (mask.astype(np.uint8) * 255)
    d = cv2.dilate(m, kernel, iterations=1)
    return d > 0


def fill_holes(mask: np.ndarray) -> np.ndarray:
    m = (mask.astype(np.uint8) * 255)
    h, w = m.shape
    flood = m.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ff, (0, 0), 255)
    flood_inv = cv2.bitwise_not(flood)
    return (cv2.bitwise_or(m, flood_inv) > 0)


def postprocess_mask(mask: np.ndarray, min_area_px: int = 500, morph_k: int = 3) -> np.ndarray:
    m = (mask.astype(np.uint8) * 255)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = np.zeros_like(m)
    for i in range(1, num):
        if stats[i, cv2.CC_STAT_AREA] >= min_area_px:
            keep[labels == i] = 255
    m = keep
    m = (fill_holes(m > 0).astype(np.uint8) * 255)

    k = max(1, int(morph_k))
    kernel = np.ones((k, k), np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel, iterations=1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel, iterations=1)
    return m > 0


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


# =========================
# Domain Models
# =========================
@dataclass
class Calibration:
    mm_per_px_x: float = 1.0
    mm_per_px_y: float = 1.0
    method: str = "MANUAL"


@dataclass
class ImageData:
    path: str
    gray_u8: np.ndarray
    calib: Calibration


@dataclass
class Segment:
    id: str
    name: str
    mask: np.ndarray
    is_reference: bool = False
    pose_current_px: Tuple[int, int] = (0, 0)
    pose_demo_px: Tuple[int, int] = (0, 0)
    color_rgba: Tuple[int, int, int, int] = (0, 255, 0, 120)


@dataclass
class ViewData:
    key: str
    image: Optional[ImageData] = None
    segments: Dict[str, Segment] = field(default_factory=dict)


@dataclass
class PoseMM:
    lr: float = 0.0
    ud: float = 0.0
    fb: float = 0.0

    def as_tuple(self):
        return self.lr, self.ud, self.fb

    def copy(self):
        return PoseMM(self.lr, self.ud, self.fb)

    @staticmethod
    def from_tuple(t: Tuple[float, float, float]):
        return PoseMM(float(t[0]), float(t[1]), float(t[2]))


@dataclass
class DailyStep3D:
    day_index: int
    pose_mm: PoseMM
    delta_mm: float
    cumulative_mm: float
    dir_text: str
    front_px: Tuple[int, int]
    side_px: Tuple[int, int]
    ok_collision_free: bool


@dataclass
class Plan3D:
    ok: bool
    path_mm: List[Tuple[float, float, float]] = field(default_factory=list)
    total_len_mm: float = 0.0
    daily_steps: List[DailyStep3D] = field(default_factory=list)
    message: str = ""


@dataclass
class BiplanarProject:
    views: Dict[str, ViewData] = field(default_factory=dict)


# =========================
# Segmentation Engines
# =========================
class ISegmentationEngine(QtCore.QObject):
    sig_status = QtCore.Signal(str)
    sig_candidates = QtCore.Signal(object)

    def set_image(self, gray_u8: np.ndarray) -> None:
        raise NotImplementedError

    def set_box(self, box_xyxy: Optional[Tuple[int, int, int, int]]) -> None:
        raise NotImplementedError

    def add_point(self, x: int, y: int, positive: bool) -> None:
        raise NotImplementedError

    def clear_prompts(self) -> None:
        raise NotImplementedError

    def undo(self) -> None:
        raise NotImplementedError

    def redo(self) -> None:
        raise NotImplementedError

    def request_predict(self) -> None:
        raise NotImplementedError

    def get_candidates(self) -> List[dict]:
        raise NotImplementedError


class ClassicSegmentationEngine(ISegmentationEngine):
    def __init__(self):
        super().__init__()
        self._gray = None
        self._box = None
        self._cands: List[dict] = []

    def set_image(self, gray_u8: np.ndarray) -> None:
        self._gray = gray_u8
        self.clear_prompts()
        self.sig_status.emit("经典分割：图像已设置。")

    def set_box(self, box_xyxy: Optional[Tuple[int, int, int, int]]) -> None:
        self._box = box_xyxy
        self.request_predict()

    def add_point(self, x: int, y: int, positive: bool) -> None:
        pass

    def clear_prompts(self) -> None:
        self._box = None
        self._cands = []
        self.sig_candidates.emit(self._cands)

    def undo(self) -> None:
        self.clear_prompts()

    def redo(self) -> None:
        pass

    def request_predict(self) -> None:
        if self._gray is None or self._box is None:
            self.sig_status.emit("经典分割：请先框选ROI。")
            return

        x1, y1, x2, y2 = self._box
        x1, x2 = sorted([clamp_int(x1, 0, self._gray.shape[1] - 1), clamp_int(x2, 0, self._gray.shape[1] - 1)])
        y1, y2 = sorted([clamp_int(y1, 0, self._gray.shape[0] - 1), clamp_int(y2, 0, self._gray.shape[0] - 1)])

        roi = self._gray[y1:y2 + 1, x1:x2 + 1]
        if roi.size == 0:
            self.sig_status.emit("经典分割：无效ROI。")
            return

        _, th = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        num, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
        if num <= 1:
            self._cands = []
            self.sig_candidates.emit(self._cands)
            self.sig_status.emit("经典分割：未找到连通域。")
            return

        idx = int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) + 1
        cc = (labels == idx).astype(np.uint8) * 255

        mask_full = np.zeros_like(self._gray, dtype=bool)
        mask_full[y1:y2 + 1, x1:x2 + 1] = (cc > 0)
        mask_full = postprocess_mask(mask_full, min_area_px=400, morph_k=3)

        self._cands = [{"mask": mask_full, "score": 1.0, "engine": "classic"}]
        self.sig_candidates.emit(self._cands)
        self.sig_status.emit("经典分割：生成1个候选。")

    def get_candidates(self) -> List[dict]:
        return self._cands


@dataclass
class PromptSnapshot:
    box: Optional[Tuple[int, int, int, int]]
    points: List[Tuple[int, int, bool]]


class _WorkerSignals(QtCore.QObject):
    done = QtCore.Signal(int, object, str)


class _Runnable(QtCore.QRunnable):
    def __init__(self, fn, request_id: int):
        super().__init__()
        self.fn = fn
        self.request_id = request_id
        self.signals = _WorkerSignals()

    def run(self):
        try:
            res, msg = self.fn()
            self.signals.done.emit(self.request_id, res, msg)
        except Exception as e:
            self.signals.done.emit(self.request_id, None, f"ERROR: {e}")


class SamSegmentationEngine(ISegmentationEngine):
    def __init__(self):
        super().__init__()
        self._gray = None
        self._rgb = None
        self._predictor = None
        self._sam_loaded = False
        self._checkpoint = None
        self._model_type = SAM_MODEL_TYPE

        self._box: Optional[Tuple[int, int, int, int]] = None
        self._points: List[Tuple[int, int, bool]] = []
        self._cands: List[dict] = []

        self._undo: List[PromptSnapshot] = []
        self._redo: List[PromptSnapshot] = []

        self._pool = QtCore.QThreadPool.globalInstance()
        self._latest_request_id = 0
        self._embedding_ready = False
        self._pending_decode = False

        self._debounce = QtCore.QTimer()
        self._debounce.setSingleShot(True)
        self._debounce.timeout.connect(self._do_decode)

    def set_checkpoint(self, checkpoint_path: str, model_type: str = SAM_MODEL_TYPE) -> None:
        self._checkpoint = checkpoint_path
        self._model_type = model_type

    def is_available(self) -> bool:
        return self._sam_loaded and self._predictor is not None

    def _try_load(self) -> None:
        if self._sam_loaded:
            return
        if not self._checkpoint or not os.path.exists(self._checkpoint):
            self.sig_status.emit("SAM：checkpoint 未找到。")
            return
        try:
            import torch
            from segment_anything import sam_model_registry, SamPredictor
        except Exception:
            self.sig_status.emit("SAM：缺少 torch 或 segment_anything。")
            return

        sam = sam_model_registry[self._model_type](checkpoint=self._checkpoint)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        sam.to(device=device)
        self._predictor = SamPredictor(sam)
        self._sam_loaded = True
        self.sig_status.emit(f"SAM 已加载（{device}）。")

    def set_image(self, gray_u8: np.ndarray) -> None:
        self._try_load()
        self._gray = gray_u8
        self._rgb = cv2.cvtColor(gray_u8, cv2.COLOR_GRAY2RGB)
        self.clear_prompts()
        self._embedding_ready = False
        self._pending_decode = False

        if not self.is_available():
            self.sig_status.emit("SAM 不可用。")
            return

        self._latest_request_id += 1
        req_id = self._latest_request_id

        def job():
            self._predictor.set_image(self._rgb)
            return True, "SAM embedding 就绪。"

        r = _Runnable(job, req_id)
        r.signals.done.connect(self._on_embedding_done)
        self._pool.start(r)
        self.sig_status.emit("SAM 计算 embedding...")

    def _on_embedding_done(self, request_id: int, result: object, msg: str) -> None:
        if request_id != self._latest_request_id:
            return
        if result is True:
            self._embedding_ready = True
            self.sig_status.emit(msg)
            if self._pending_decode:
                self._pending_decode = False
                self._do_decode()
        else:
            self.sig_status.emit(msg)

    def _push_undo(self):
        self._undo.append(PromptSnapshot(self._box, list(self._points)))
        self._redo.clear()

    def set_box(self, box_xyxy: Optional[Tuple[int, int, int, int]]) -> None:
        self._push_undo()
        self._box = box_xyxy
        self.request_predict()

    def add_point(self, x: int, y: int, positive: bool) -> None:
        return

    def clear_prompts(self) -> None:
        self._box = None
        self._points = []
        self._undo.clear()
        self._redo.clear()
        self._cands = []
        self.sig_candidates.emit(self._cands)

    def undo(self) -> None:
        if not self._undo:
            return
        self._redo.append(PromptSnapshot(self._box, list(self._points)))
        snap = self._undo.pop()
        self._box = snap.box
        self._points = list(snap.points)
        self.request_predict()

    def redo(self) -> None:
        if not self._redo:
            return
        self._undo.append(PromptSnapshot(self._box, list(self._points)))
        snap = self._redo.pop()
        self._box = snap.box
        self._points = list(snap.points)
        self.request_predict()

    def request_predict(self, debounce_ms: int = 0) -> None:
        if not self.is_available():
            self.sig_status.emit("SAM 不可用。")
            return
        if self._gray is None:
            self.sig_status.emit("SAM 未设置图像。")
            return
        if not self._embedding_ready:
            self._pending_decode = True
            return
        if debounce_ms > 0:
            self._debounce.start(debounce_ms)
        else:
            self._do_decode()

    def _do_decode(self) -> None:
        if not self.is_available() or not self._embedding_ready:
            return
        if self._box is None:
            self._cands = []
            self.sig_candidates.emit(self._cands)
            return

        self._latest_request_id += 1
        req_id = self._latest_request_id
        box = self._box

        def job():
            h, w = self._gray.shape[:2]
            x1, y1, x2, y2 = box
            x1, x2 = sorted([clamp_int(x1, 0, w - 1), clamp_int(x2, 0, w - 1)])
            y1, y2 = sorted([clamp_int(y1, 0, h - 1), clamp_int(y2, 0, h - 1)])
            sam_box = np.array([x1, y1, x2, y2], dtype=np.float32)

            masks, scores, _ = self._predictor.predict(
                point_coords=None,
                point_labels=None,
                box=sam_box,
                multimask_output=True
            )
            cands = []
            for i in range(masks.shape[0]):
                cands.append({"mask": masks[i].astype(bool), "score": float(scores[i]), "engine": "sam"})
            cands.sort(key=lambda d: d["score"], reverse=True)
            return cands, f"SAM 生成 {len(cands)} 个候选。"

        r = _Runnable(job, req_id)
        r.signals.done.connect(self._on_decode_done)
        self._pool.start(r)

    def _on_decode_done(self, request_id: int, result: object, msg: str) -> None:
        if request_id != self._latest_request_id:
            return
        if result is None:
            self.sig_status.emit(msg)
            return
        self._cands = result
        self.sig_status.emit(msg)
        self.sig_candidates.emit(self._cands)

    def get_candidates(self) -> List[dict]:
        return self._cands


# =========================
# Collision / Distance / Transform
# =========================
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
    def min_clearance_mm_for_shift(boundary_pts_xy: np.ndarray,
                                   shift_dxdy_px: Tuple[int, int],
                                   dist_map_px: np.ndarray,
                                   calib: Calibration) -> float:
        if boundary_pts_xy is None or len(boundary_pts_xy) == 0:
            return 1e9
        dx, dy = shift_dxdy_px
        h, w = dist_map_px.shape
        xs = boundary_pts_xy[:, 0] + dx
        ys = boundary_pts_xy[:, 1] + dy
        if xs.min() < 0 or ys.min() < 0 or xs.max() >= w or ys.max() >= h:
            return -float("inf")
        vals = dist_map_px[ys, xs]
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


# =========================
# 3D A* Planner
# =========================
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
    path_mm: List[Tuple[float, float, float]] = field(default_factory=list)
    total_len_mm: float = 0.0
    message: str = ""


class AStarPlanner3D:
    def __init__(self,
                 front_rigid_mask: np.ndarray,
                 front_obstacle_mask: np.ndarray,
                 front_calib: Calibration,
                 side_rigid_mask: np.ndarray,
                 side_obstacle_mask: np.ndarray,
                 side_calib: Calibration,
                 cfg: Planner3DConfig,
                 pose_valid_fn=None):  # <- 与实时检测一致的回调
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

        self.front_dist = DistanceService.compute_dist_map_px(self.front_obstacle) if cfg.min_clearance_mm > 0 else None
        self.side_dist = DistanceService.compute_dist_map_px(self.side_obstacle) if cfg.min_clearance_mm > 0 else None
        self.front_bd = DistanceService.extract_boundary_points(self.front_rigid) if cfg.min_clearance_mm > 0 else None
        self.side_bd = DistanceService.extract_boundary_points(self.side_rigid) if cfg.min_clearance_mm > 0 else None

        self.step_mm = float(cfg.step_mm)
        self.neighbors = self._build_neighbors()
        self.valid_domain = True
        self.bounds_idx = self._compute_bounds_idx()

        self.pose_valid_fn = pose_valid_fn

    def _build_neighbors(self):
        nbs = []
        if self.cfg.neighbor26:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        if dx == 0 and dy == 0 and dz == 0:
                            continue
                        nbs.append((dx, dy, dz))
        else:
            nbs = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
        return nbs

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

        # side: dx_px = -fb/mm_per_px_x（前 -> x负方向）
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
            int(math.floor(min_lr_mm / s)), int(math.ceil(max_lr_mm / s)),
            int(math.floor(min_ud_mm / s)), int(math.ceil(max_ud_mm / s)),
            int(math.floor(min_fb_mm / s)), int(math.ceil(max_fb_mm / s)),
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
        return round_half_up(lr / self.front_calib.mm_per_px_x), round_half_up(ud / self.front_calib.mm_per_px_y)

    def _side_shift_px(self, mm_pose: Tuple[float, float, float]) -> Tuple[int, int]:
        _, ud, fb = mm_pose
        return round_half_up(-fb / self.side_calib.mm_per_px_x), round_half_up(ud / self.side_calib.mm_per_px_y)

    @staticmethod
    def _bbox_in_bounds(bbox, shift, w, h):
        if bbox is None:
            return False
        x1, y1, x2, y2 = bbox
        dx, dy = shift
        return x1 + dx >= 0 and y1 + dy >= 0 and x2 + dx < w and y2 + dy < h

    def _view_valid(self, rigid_mask, rigid_bbox, obstacle_mask, calib, shift_px,
                    width, height, dist_map=None, bd_pts=None) -> bool:
        if not self._bbox_in_bounds(rigid_bbox, shift_px, width, height):
            return False

        moved = MaskTransform.shift_bool_mask(rigid_mask, shift_px[0], shift_px[1])
        if CollisionService.overlap_area(moved, obstacle_mask) > 0:
            return False

        if self.cfg.min_clearance_mm > 0 and dist_map is not None and bd_pts is not None and len(bd_pts) > 0:
            clearance = DistanceService.min_clearance_mm_for_shift(bd_pts, shift_px, dist_map, calib)
            if clearance < self.cfg.min_clearance_mm:
                return False
        return True

    def node_valid(self, st: Tuple[int, int, int]) -> bool:
        if not self._within_bounds(st):
            return False

        # 优先复用实时检测逻辑（与 UI 检测一致）
        if self.pose_valid_fn is not None:
            mm_pose = self._state_to_mm(st)
            return bool(self.pose_valid_fn(mm_pose))

        # 兜底：原内部几何判定
        mm_pose = self._state_to_mm(st)
        f_shift = self._front_shift_px(mm_pose)
        s_shift = self._side_shift_px(mm_pose)

        ok_f = self._view_valid(
            self.front_rigid, self.front_bbox, self.front_obstacle, self.front_calib, f_shift,
            self.fw, self.fh, self.front_dist, self.front_bd
        )
        if not ok_f:
            return False

        ok_s = self._view_valid(
            self.side_rigid, self.side_bbox, self.side_obstacle, self.side_calib, s_shift,
            self.sw, self.sh, self.side_dist, self.side_bd
        )
        return ok_s

    def edge_valid(self, a: Tuple[int, int, int], b: Tuple[int, int, int]) -> bool:
        dx = (b[0] - a[0]) * self.step_mm
        dy = (b[1] - a[1]) * self.step_mm
        dz = (b[2] - a[2]) * self.step_mm
        seg_len = math.sqrt(dx * dx + dy * dy + dz * dz)
        if seg_len <= 1e-12:
            return True

        # 优先复用实时检测逻辑（按 mm 连续采样）
        if self.pose_valid_fn is not None:
            ax, ay, az = self._state_to_mm(a)
            bx, by, bz = self._state_to_mm(b)
            sample_mm = max(1e-6, float(self.cfg.edge_sample_mm))
            n = max(2, int(math.ceil(seg_len / sample_mm)) + 1)
            for i in range(n):
                t = i / (n - 1)
                mm = (
                    ax + (bx - ax) * t,
                    ay + (by - ay) * t,
                    az + (bz - az) * t
                )
                if not self.pose_valid_fn(mm):
                    return False
            return True

        # 兜底：原状态采样
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

    def plan(self, start_mm: Tuple[float, float, float], goal_mm: Tuple[float, float, float]) -> Path3DResult:
        if not self.valid_domain:
            return Path3DResult(False, message="Invalid search domain.")

        start = self._mm_to_state(start_mm)
        goal = self._mm_to_state(goal_mm)

        def h(st):
            return self._step_cost(st, goal, self.step_mm)

        if not self._within_bounds(start) or not self._within_bounds(goal):
            return Path3DResult(False, message="Start or goal out of bounds.")
        if not self.node_valid(start):
            return Path3DResult(False, message="Start invalid.")
        if not self.node_valid(goal):
            return Path3DResult(False, message="Goal invalid.")

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
                return Path3DResult(True, path_mm=path_mm, total_len_mm=total, message="OK")

            expanded += 1
            if expanded > self.cfg.max_expand:
                return Path3DResult(False, message="A* expand limit reached.")

            for dn in self.neighbors:
                nb = (cur[0] + dn[0], cur[1] + dn[1], cur[2] + dn[2])
                if nb in visited:
                    continue
                if not self._within_bounds(nb):
                    continue
                if not self.node_valid(nb):
                    continue
                if not self.edge_valid(cur, nb):
                    continue

                tentative = gscore[cur] + self._step_cost(cur, nb, self.step_mm)
                if tentative < gscore.get(nb, float("inf")):
                    gscore[nb] = tentative
                    parent[nb] = cur
                    heapq.heappush(open_heap, (tentative + h(nb), nb))

        return Path3DResult(False, message="No feasible path found.")


def resample_daily_3d(path_mm: List[Tuple[float, float, float]], day_step_mm: float = 1.0) -> List[Tuple[float, float, float]]:
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
        t0 = cum[idx]
        t1 = cum[idx + 1]
        if t1 <= t0:
            break
        alpha = (t_mm - t0) / (t1 - t0)
        x = path_mm[idx][0] + (path_mm[idx + 1][0] - path_mm[idx][0]) * alpha
        y = path_mm[idx][1] + (path_mm[idx + 1][1] - path_mm[idx][1]) * alpha
        z = path_mm[idx][2] + (path_mm[idx + 1][2] - path_mm[idx][2]) * alpha
        out.append((float(x), float(y), float(z)))
        t_mm += day_step_mm

    out.append(path_mm[-1])

    dedup = [out[0]]
    for p in out[1:]:
        d = math.sqrt((p[0] - dedup[-1][0]) ** 2 + (p[1] - dedup[-1][1]) ** 2 + (p[2] - dedup[-1][2]) ** 2)
        if d > 1e-6:
            dedup.append(p)
    return dedup


# =========================
# Graphics / Widgets
# =========================
class NoWheelComboBox(QtWidgets.QComboBox):
    def wheelEvent(self, event: QtGui.QWheelEvent):
        event.ignore()


class WorkspaceView(QtWidgets.QGraphicsView):
    sig_box_final = QtCore.Signal(object)
    sig_mouse_status = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setRenderHints(QtGui.QPainter.Antialiasing | QtGui.QPainter.SmoothPixmapTransform)
        self.setDragMode(QtWidgets.QGraphicsView.DragMode.ScrollHandDrag)
        self.setTransformationAnchor(QtWidgets.QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QtWidgets.QGraphicsView.ViewportAnchor.AnchorUnderMouse)

        self.mode = "box"
        self._drawing_box = False
        self._box_start = None
        self._box_item = None
        self._init_box_item()

    def _init_box_item(self):
        self._box_item = QtWidgets.QGraphicsRectItem()
        pen = QtGui.QPen(QtGui.QColor(0, 255, 0))
        pen.setWidth(2)
        self._box_item.setPen(pen)
        self._box_item.setBrush(QtGui.QBrush(QtGui.QColor(0, 255, 0, 40)))
        self._box_item.setZValue(50)
        self._box_item.setVisible(False)

    def reset_overlay_items(self):
        self._init_box_item()

    def _ensure_box_item(self):
        if self._box_item is None or not isValid(self._box_item):
            self._init_box_item()
            if self.scene() is not None:
                self.scene().addItem(self._box_item)

    def attach_scene(self, scene: QtWidgets.QGraphicsScene):
        self.setScene(scene)
        self._ensure_box_item()
        old_scene = self._box_item.scene()
        if old_scene is not None and old_scene is not scene:
            old_scene.removeItem(self._box_item)
        scene.addItem(self._box_item)

    def clear_box_visual(self):
        self._ensure_box_item()
        self._box_item.setVisible(False)

    def wheelEvent(self, event: QtGui.QWheelEvent):
        if event.angleDelta().y() > 0:
            self.scale(1.15, 1.15)
        else:
            self.scale(1 / 1.15, 1 / 1.15)

    def mousePressEvent(self, event: QtGui.QMouseEvent):
        if self.mode == "box" and event.button() == QtCore.Qt.MouseButton.LeftButton:
            self._ensure_box_item()
            self._drawing_box = True
            p = self.mapToScene(event.position().toPoint())
            self._box_start = (int(round(p.x())), int(round(p.y())))
            self._box_item.setRect(self._box_start[0], self._box_start[1], 1, 1)
            self._box_item.setVisible(True)
            self.sig_mouse_status.emit(f"Box start: {self._box_start}")
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QtGui.QMouseEvent):
        if self.mode == "box" and self._drawing_box and self._box_start is not None:
            self._ensure_box_item()
            p = self.mapToScene(event.position().toPoint())
            x2, y2 = int(round(p.x())), int(round(p.y()))
            x1, y1 = self._box_start
            rect = QtCore.QRectF(min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1))
            self._box_item.setRect(rect)
            self.sig_mouse_status.emit(f"Box: ({x1},{y1})-({x2},{y2})")
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event: QtGui.QMouseEvent):
        if self.mode == "box" and self._drawing_box and event.button() == QtCore.Qt.MouseButton.LeftButton:
            self._drawing_box = False
            p = self.mapToScene(event.position().toPoint())
            x2, y2 = int(round(p.x())), int(round(p.y()))
            x1, y1 = self._box_start if self._box_start else (x2, y2)
            self._box_start = None
            box = (x1, y1, x2, y2)
            self.sig_box_final.emit(box)
            self.sig_mouse_status.emit(f"Box final: {box}")
            event.accept()
            return
        super().mouseReleaseEvent(event)


class SegmentGraphics:
    def __init__(self, seg: Segment):
        self.seg = seg
        self.bbox = bbox_from_mask(seg.mask)
        self.item_main: Optional[QtWidgets.QGraphicsPixmapItem] = None
        self.item_demo: Optional[QtWidgets.QGraphicsPixmapItem] = None

    def _demo_color(self):
        r, g, b, a = self.seg.color_rgba
        return r, g, b, max(30, int(a * 0.4))

    def build_items(self) -> List[QtWidgets.QGraphicsPixmapItem]:
        if self.bbox is None:
            return []
        x1, y1, x2, y2 = self.bbox
        crop = crop_mask(self.seg.mask, self.bbox)

        rgba_main = mask_to_rgba(crop, self.seg.color_rgba)
        pix_main = QtGui.QPixmap.fromImage(qimage_from_rgba(rgba_main))
        self.item_main = QtWidgets.QGraphicsPixmapItem(pix_main)
        self.item_main.setZValue(10)
        self.item_main.setPos(x1 + self.seg.pose_current_px[0], y1 + self.seg.pose_current_px[1])

        items = []
        if not self.seg.is_reference:
            rgba_demo = mask_to_rgba(crop, self._demo_color())
            pix_demo = QtGui.QPixmap.fromImage(qimage_from_rgba(rgba_demo))
            self.item_demo = QtWidgets.QGraphicsPixmapItem(pix_demo)
            self.item_demo.setZValue(9)
            self.item_demo.setPos(x1 + self.seg.pose_demo_px[0], y1 + self.seg.pose_demo_px[1])
            items.append(self.item_demo)

        items.append(self.item_main)
        return items

    def update_pose_main(self):
        if self.item_main is None or self.bbox is None:
            return
        x1, y1, _, _ = self.bbox
        dx, dy = self.seg.pose_current_px
        self.item_main.setPos(x1 + dx, y1 + dy)

    def update_pose_demo(self):
        if self.item_demo is None or self.bbox is None:
            return
        x1, y1, _, _ = self.bbox
        dx, dy = self.seg.pose_demo_px
        self.item_demo.setPos(x1 + dx, y1 + dy)


@dataclass
class CanvasState:
    scene: QtWidgets.QGraphicsScene
    view: WorkspaceView
    image_item: Optional[QtWidgets.QGraphicsPixmapItem] = None
    candidate_item: Optional[QtWidgets.QGraphicsPixmapItem] = None
    overlap_item: Optional[QtWidgets.QGraphicsPixmapItem] = None
    path_item: Optional[QtWidgets.QGraphicsPathItem] = None
    seg_graphics: Dict[str, SegmentGraphics] = field(default_factory=dict)


# =========================
# Report
# =========================
class ReportService:
    @staticmethod
    def export_pdf(out_path: str, project: BiplanarProject, current_pose: PoseMM, target_pose: PoseMM, plan: Plan3D):
        if not REPORTLAB_OK:
            raise RuntimeError("reportlab not installed")

        c = pdf_canvas.Canvas(out_path, pagesize=A4)
        _, h = A4
        y = h - 36

        c.setFont("Helvetica-Bold", 12)
        c.drawString(36, y, "Biplanar Ankle Correction Report")
        y -= 18
        c.setFont("Helvetica", 9)
        c.drawString(36, y, f"Generated: {now_str()}")
        y -= 12

        for k in ("front", "side"):
            vd = project.views[k]
            p = vd.image.path if vd.image else "N/A"
            c.drawString(36, y, f"{k} image: {os.path.basename(p)}")
            y -= 12
            if vd.image:
                c.drawString(56, y, f"calib: x={vd.image.calib.mm_per_px_x:.4f}, y={vd.image.calib.mm_per_px_y:.4f} mm/px")
                y -= 12

        c.drawString(36, y, f"Current pose(mm): LR={current_pose.lr:.2f}, UD={current_pose.ud:.2f}, FB={current_pose.fb:.2f}")
        y -= 12
        c.drawString(36, y, f"Target pose(mm): LR={target_pose.lr:.2f}, UD={target_pose.ud:.2f}, FB={target_pose.fb:.2f}")
        y -= 12
        c.drawString(36, y, f"Path points={len(plan.path_mm)}, total={plan.total_len_mm:.2f} mm, days={len(plan.daily_steps)}")
        y -= 16

        c.drawString(36, y, "Day | delta(mm) | cum(mm) | direction | front(px) | side(px) | collision_free")
        y -= 12

        for d in plan.daily_steps:
            if y < 50:
                c.showPage()
                y = h - 36
                c.setFont("Helvetica", 9)
            line = (
                f"{d.day_index:3d} | {d.delta_mm:7.3f} | {d.cumulative_mm:7.3f} | "
                f"{d.dir_text[:30]} | ({d.front_px[0]},{d.front_px[1]}) | "
                f"({d.side_px[0]},{d.side_px[1]}) | {d.ok_collision_free}"
            )
            c.drawString(36, y, line)
            y -= 11

        c.save()


# =========================
# MainWindow
# =========================
class MainWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("足踝矫正系统（正侧位联动 + 3D A*）")
        self.resize(1720, 960)

        self.project = BiplanarProject(views={"front": ViewData("front"), "side": ViewData("side")})

        self.pose_mm = PoseMM(0.0, 0.0, 0.0)
        self.target_pose_mm = PoseMM(0.0, 0.0, 0.0)

        self.plan: Optional[Plan3D] = None
        self.plan_day_idx = 0

        self.mask_file_paths: Dict[Tuple[str, str], str] = {
            ("front", "reference"): "",
            ("front", "moving"): "",
            ("side", "reference"): "",
            ("side", "moving"): "",
        }

        self.mask_save_root = norm_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sam_auto_masks"))
        os.makedirs(self.mask_save_root, exist_ok=True)

        self.canvas: Dict[str, CanvasState] = {}
        for vk in ("front", "side"):
            sc = QtWidgets.QGraphicsScene()
            vw = WorkspaceView()
            vw.attach_scene(sc)
            vw.sig_box_final.connect(lambda box, v=vk: self._on_box_final(v, box))
            vw.sig_mouse_status.connect(self._set_status)
            self.canvas[vk] = CanvasState(scene=sc, view=vw)

        self.engines: Dict[str, Dict[str, ISegmentationEngine]] = {}
        self._engine_img_token: Dict[Tuple[str, str], Optional[Tuple[str, Tuple[int, int]]]] = {}
        self._cand_cache: Dict[Tuple[str, str], List[dict]] = {}

        for vk in ("front", "side"):
            classic = ClassicSegmentationEngine()
            sam = SamSegmentationEngine()
            sam.set_checkpoint(SAM_CKPT, SAM_MODEL_TYPE)
            self.engines[vk] = {"classic": classic, "sam": sam}

            for ename, eng in self.engines[vk].items():
                eng.sig_status.connect(partial(self._on_engine_status, vk, ename))
                eng.sig_candidates.connect(partial(self._on_engine_candidates, vk, ename))
                self._engine_img_token[(vk, ename)] = None
                self._cand_cache[(vk, ename)] = []

        self._seg_view_key = "front"
        self._seg_role_key = "reference"

        self._last_collision_popup_ts = 0.0
        self._collision_popup_cooldown_sec = 0.6

        self._day_play_timer = QtCore.QTimer(self)
        self._day_play_timer.timeout.connect(self._on_day_play_tick)

        self._build_ui()
        self._refresh_mask_file_list()
        self._update_region_status()
        self._update_pose_labels()

    # ---------- UI ----------
    def _build_ui(self):
        central = QtWidgets.QWidget()
        self.setCentralWidget(central)
        root = QtWidgets.QHBoxLayout(central)

        left = QtWidgets.QVBoxLayout()
        root.addLayout(left, 0)

        g_file = QtWidgets.QGroupBox("1) 图像导入 + 标定")
        lf = QtWidgets.QVBoxLayout(g_file)
        btn_open_front = QtWidgets.QPushButton("打开正位图像")
        btn_open_side = QtWidgets.QPushButton("打开侧位图像")
        lf.addWidget(btn_open_front)
        lf.addWidget(btn_open_side)

        row_cal_f = QtWidgets.QHBoxLayout()
        self.sp_mmpp_front = QtWidgets.QDoubleSpinBox()
        self.sp_mmpp_front.setDecimals(4)
        self.sp_mmpp_front.setRange(0.0001, 10.0)
        self.sp_mmpp_front.setValue(1.0)
        row_cal_f.addWidget(QtWidgets.QLabel("正位 mm/px"))
        row_cal_f.addWidget(self.sp_mmpp_front)
        lf.addLayout(row_cal_f)

        row_cal_s = QtWidgets.QHBoxLayout()
        self.sp_mmpp_side = QtWidgets.QDoubleSpinBox()
        self.sp_mmpp_side.setDecimals(4)
        self.sp_mmpp_side.setRange(0.0001, 10.0)
        self.sp_mmpp_side.setValue(1.0)
        row_cal_s.addWidget(QtWidgets.QLabel("侧位 mm/px"))
        row_cal_s.addWidget(self.sp_mmpp_side)
        lf.addLayout(row_cal_s)

        btn_apply_calib = QtWidgets.QPushButton("应用标定")
        lf.addWidget(btn_apply_calib)
        left.addWidget(g_file)

        g_mask = QtWidgets.QGroupBox("1.5) 四掩码保存记录")
        lmf = QtWidgets.QVBoxLayout(g_mask)
        lmf.addWidget(QtWidgets.QLabel("正位/侧位 各 Reference + Moving："))
        self.list_mask_files = QtWidgets.QListWidget()
        self.list_mask_files.setMinimumHeight(130)
        lmf.addWidget(self.list_mask_files)

        row_out = QtWidgets.QHBoxLayout()
        self.ed_mask_save_dir = QtWidgets.QLineEdit(self.mask_save_root)
        self.ed_mask_save_dir.setReadOnly(True)
        self.btn_choose_mask_dir = QtWidgets.QPushButton("设置保存目录")
        self.btn_open_mask_dir = QtWidgets.QPushButton("打开目录")
        row_out.addWidget(self.ed_mask_save_dir, 1)
        row_out.addWidget(self.btn_choose_mask_dir)
        row_out.addWidget(self.btn_open_mask_dir)
        lmf.addLayout(row_out)
        left.addWidget(g_mask)

        g_seg = QtWidgets.QGroupBox("2) 分割（正/侧独立）")
        ls = QtWidgets.QVBoxLayout(g_seg)

        row_ctx = QtWidgets.QHBoxLayout()
        self.cb_seg_view = NoWheelComboBox()
        self.cb_seg_view.addItem("正位(front)")
        self.cb_seg_view.addItem("侧位(side)")

        self.cb_seg_role = NoWheelComboBox()
        self.cb_seg_role.addItem("基准区域 Reference")
        self.cb_seg_role.addItem("矫正区域 Moving")

        row_ctx.addWidget(self.cb_seg_view)
        row_ctx.addWidget(self.cb_seg_role)
        ls.addLayout(row_ctx)

        self.lbl_seg_target = QtWidgets.QLabel("当前保存目标：正位 - 基准(reference)")
        self.lbl_seg_target.setStyleSheet("color:#444;")
        ls.addWidget(self.lbl_seg_target)

        row_engine = QtWidgets.QHBoxLayout()
        self.rb_classic = QtWidgets.QRadioButton("Classic")
        self.rb_sam = QtWidgets.QRadioButton("SAM(Box)")
        self.rb_sam.setChecked(True)
        row_engine.addWidget(self.rb_classic)
        row_engine.addWidget(self.rb_sam)
        ls.addLayout(row_engine)

        row_prompts = QtWidgets.QHBoxLayout()
        btn_clear = QtWidgets.QPushButton("清空")
        btn_undo = QtWidgets.QPushButton("Undo")
        btn_redo = QtWidgets.QPushButton("Redo")
        btn_predict = QtWidgets.QPushButton("预测")
        row_prompts.addWidget(btn_clear)
        row_prompts.addWidget(btn_undo)
        row_prompts.addWidget(btn_redo)
        row_prompts.addWidget(btn_predict)
        ls.addLayout(row_prompts)

        self.list_cands = QtWidgets.QListWidget()
        ls.addWidget(self.list_cands, 1)

        row_commit = QtWidgets.QHBoxLayout()
        self.btn_commit_sep = QtWidgets.QPushButton("保存（分别）到当前部位")
        self.btn_commit_union = QtWidgets.QPushButton("保存（合并）到当前部位")
        row_commit.addWidget(self.btn_commit_sep)
        row_commit.addWidget(self.btn_commit_union)
        ls.addLayout(row_commit)

        self.lbl_region = QtWidgets.QLabel("")
        self.lbl_region.setStyleSheet("color:#2a2a2a;")
        ls.addWidget(self.lbl_region)

        left.addWidget(g_seg, 1)

        splitter = QtWidgets.QSplitter(QtCore.Qt.Orientation.Horizontal)
        root.addWidget(splitter, 1)

        box_front = QtWidgets.QGroupBox("正位视图（水平=左右，垂直=上下）")
        bf = QtWidgets.QVBoxLayout(box_front)
        bf.addWidget(self.canvas["front"].view)
        splitter.addWidget(box_front)

        box_side = QtWidgets.QGroupBox("侧位视图（水平=前后，垂直=上下）")
        bs = QtWidgets.QVBoxLayout(box_side)
        bs.addWidget(self.canvas["side"].view)
        splitter.addWidget(box_side)

        right = QtWidgets.QVBoxLayout()
        root.addLayout(right, 0)

        g_move = QtWidgets.QGroupBox("3) 实时联动矫正（碰撞自动拦截）")
        lm = QtWidgets.QVBoxLayout(g_move)
        self.lbl_pose_current = QtWidgets.QLabel()
        self.lbl_pose_target = QtWidgets.QLabel()
        self.lbl_pose_px = QtWidgets.QLabel()
        lm.addWidget(self.lbl_pose_current)
        lm.addWidget(self.lbl_pose_target)
        lm.addWidget(self.lbl_pose_px)

        row_step = QtWidgets.QHBoxLayout()
        self.sp_step_mm = QtWidgets.QDoubleSpinBox()
        self.sp_step_mm.setDecimals(2)
        self.sp_step_mm.setRange(0.1, 10.0)
        self.sp_step_mm.setValue(0.5)
        row_step.addWidget(QtWidgets.QLabel("箭头步长(mm)"))
        row_step.addWidget(self.sp_step_mm)
        lm.addLayout(row_step)

        grid = QtWidgets.QGridLayout()
        self.btn_up = QtWidgets.QPushButton("↑ 上")
        self.btn_dn = QtWidgets.QPushButton("↓ 下")
        self.btn_lt = QtWidgets.QPushButton("← 左")
        self.btn_rt = QtWidgets.QPushButton("→ 右")
        self.btn_fr = QtWidgets.QPushButton("前")
        self.btn_bk = QtWidgets.QPushButton("后")
        grid.addWidget(self.btn_up, 0, 1)
        grid.addWidget(self.btn_lt, 1, 0)
        grid.addWidget(self.btn_rt, 1, 2)
        grid.addWidget(self.btn_dn, 2, 1)
        grid.addWidget(self.btn_bk, 1, 3)
        grid.addWidget(self.btn_fr, 1, 4)
        lm.addLayout(grid)

        right.addWidget(g_move)

        g_target = QtWidgets.QGroupBox("4) 输入目标（mm）")
        lt = QtWidgets.QGridLayout(g_target)
        self.sp_left = QtWidgets.QDoubleSpinBox(); self.sp_left.setRange(0, 200); self.sp_left.setDecimals(2)
        self.sp_right = QtWidgets.QDoubleSpinBox(); self.sp_right.setRange(0, 200); self.sp_right.setDecimals(2)
        self.sp_up = QtWidgets.QDoubleSpinBox(); self.sp_up.setRange(0, 200); self.sp_up.setDecimals(2)
        self.sp_down = QtWidgets.QDoubleSpinBox(); self.sp_down.setRange(0, 200); self.sp_down.setDecimals(2)
        self.sp_front = QtWidgets.QDoubleSpinBox(); self.sp_front.setRange(0, 200); self.sp_front.setDecimals(2)
        self.sp_back = QtWidgets.QDoubleSpinBox(); self.sp_back.setRange(0, 200); self.sp_back.setDecimals(2)

        lt.addWidget(QtWidgets.QLabel("左"), 0, 0); lt.addWidget(self.sp_left, 0, 1)
        lt.addWidget(QtWidgets.QLabel("右"), 0, 2); lt.addWidget(self.sp_right, 0, 3)
        lt.addWidget(QtWidgets.QLabel("上"), 1, 0); lt.addWidget(self.sp_up, 1, 1)
        lt.addWidget(QtWidgets.QLabel("下"), 1, 2); lt.addWidget(self.sp_down, 1, 3)
        lt.addWidget(QtWidgets.QLabel("前"), 2, 0); lt.addWidget(self.sp_front, 2, 1)
        lt.addWidget(QtWidgets.QLabel("后"), 2, 2); lt.addWidget(self.sp_back, 2, 3)
        btn_set_target = QtWidgets.QPushButton("将输入设为目标")
        lt.addWidget(btn_set_target, 3, 0, 1, 4)
        right.addWidget(g_target)

        g_plan = QtWidgets.QGroupBox("5) A*路径 + 每天<=1mm")
        lp = QtWidgets.QVBoxLayout(g_plan)
        btn_plan = QtWidgets.QPushButton("A* 规划到目标")
        lp.addWidget(btn_plan)

        row_day = QtWidgets.QHBoxLayout()
        self.btn_prev_day = QtWidgets.QPushButton("上一天")
        self.btn_next_day = QtWidgets.QPushButton("下一天")
        self.lbl_day = QtWidgets.QLabel("Day 0/0")
        row_day.addWidget(self.btn_prev_day)
        row_day.addWidget(self.btn_next_day)
        row_day.addWidget(self.lbl_day)
        lp.addLayout(row_day)

        row_play = QtWidgets.QHBoxLayout()
        self.btn_play_pause_day = QtWidgets.QPushButton("自动播放")
        self.btn_play_pause_day.setCheckable(True)
        self.sp_play_interval_ms = QtWidgets.QSpinBox()
        self.sp_play_interval_ms.setRange(100, 5000)
        self.sp_play_interval_ms.setValue(600)
        self.sp_play_interval_ms.setSuffix(" ms")
        self.ck_play_loop = QtWidgets.QCheckBox("循环")
        row_play.addWidget(self.btn_play_pause_day)
        row_play.addWidget(QtWidgets.QLabel("间隔"))
        row_play.addWidget(self.sp_play_interval_ms)
        row_play.addWidget(self.ck_play_loop)
        lp.addLayout(row_play)

        btn_apply_day = QtWidgets.QPushButton("应用当前预览日为当前姿态")
        btn_export_pdf = QtWidgets.QPushButton("导出PDF报告")
        lp.addWidget(btn_apply_day)
        lp.addWidget(btn_export_pdf)

        self.txt_plan = QtWidgets.QPlainTextEdit()
        self.txt_plan.setReadOnly(True)
        lp.addWidget(self.txt_plan, 1)
        right.addWidget(g_plan, 1)

        btn_open_front.clicked.connect(lambda: self._open_image_for_view("front"))
        btn_open_side.clicked.connect(lambda: self._open_image_for_view("side"))
        btn_apply_calib.clicked.connect(self._apply_calibration)

        self.btn_choose_mask_dir.clicked.connect(self._choose_mask_save_dir)
        self.btn_open_mask_dir.clicked.connect(self._open_mask_save_dir)

        self.cb_seg_view.currentIndexChanged.connect(self._on_seg_view_changed)
        self.cb_seg_role.currentIndexChanged.connect(self._on_seg_role_changed)
        self.rb_classic.toggled.connect(self._on_seg_context_changed)
        self.rb_sam.toggled.connect(self._on_seg_context_changed)

        btn_clear.clicked.connect(self._clear_prompts)
        btn_undo.clicked.connect(self._undo_prompt)
        btn_redo.clicked.connect(self._redo_prompt)
        btn_predict.clicked.connect(self._predict_prompt)

        self.list_cands.currentRowChanged.connect(self._on_candidate_row_changed)
        self.list_cands.itemChanged.connect(self._on_candidate_item_changed)

        self.btn_commit_sep.clicked.connect(self._commit_checked_separate)
        self.btn_commit_union.clicked.connect(self._commit_checked_union)

        self.btn_lt.clicked.connect(lambda: self._move_arrow("left"))
        self.btn_rt.clicked.connect(lambda: self._move_arrow("right"))
        self.btn_up.clicked.connect(lambda: self._move_arrow("up"))
        self.btn_dn.clicked.connect(lambda: self._move_arrow("down"))
        self.btn_fr.clicked.connect(lambda: self._move_arrow("front"))
        self.btn_bk.clicked.connect(lambda: self._move_arrow("back"))

        btn_set_target.clicked.connect(self._set_target_from_inputs)
        btn_plan.clicked.connect(self._plan_astar_to_target)

        self.btn_prev_day.clicked.connect(lambda: self._change_preview_day(-1))
        self.btn_next_day.clicked.connect(lambda: self._change_preview_day(+1))
        self.btn_play_pause_day.toggled.connect(self._toggle_day_autoplay)
        self.sp_play_interval_ms.valueChanged.connect(self._on_play_interval_changed)

        btn_apply_day.clicked.connect(self._apply_preview_day_as_current)
        btn_export_pdf.clicked.connect(self._export_pdf_report)

        self.status = QtWidgets.QStatusBar()
        self.setStatusBar(self.status)

        self._on_seg_view_changed(self.cb_seg_view.currentIndex())
        self._on_seg_role_changed(self.cb_seg_role.currentIndex())

    # ---------- helpers ----------
    @staticmethod
    def _view_cn(v: str) -> str:
        return "正位" if v == "front" else "侧位"

    @staticmethod
    def _role_cn(role: str) -> str:
        return "基准(reference)" if role == "reference" else "移动(moving)"

    def _set_status(self, msg: str):
        self.status.showMessage(msg, 6000)

    def _show_error(self, title: str, text: str):
        QtWidgets.QMessageBox.critical(self, title, text)

    def _on_seg_view_changed(self, idx: int):
        self._seg_view_key = "front" if idx == 0 else "side"
        self._update_seg_target_label()
        self._on_seg_context_changed()

    def _on_seg_role_changed(self, idx: int):
        self._seg_role_key = "reference" if idx == 0 else "moving"
        self._update_seg_target_label()

    def _update_seg_target_label(self):
        if hasattr(self, "lbl_seg_target"):
            self.lbl_seg_target.setText(
                f"当前保存目标：{self._view_cn(self._seg_view_key)} - {self._role_cn(self._seg_role_key)}"
            )

    def _active_seg_view(self) -> str:
        return self._seg_view_key

    def _active_seg_role(self) -> str:
        return self._seg_role_key

    def _active_engine_name(self) -> str:
        return "sam" if self.rb_sam.isChecked() else "classic"

    def _active_engine(self) -> ISegmentationEngine:
        v = self._active_seg_view()
        e = self._active_engine_name()
        self._ensure_engine_image(v, e)
        return self.engines[v][e]

    # ---------- 实时碰撞弹窗 ----------
    def _popup_collision_blocked(self, details: dict, title: str = "检测到碰撞，已停止移动"):
        now = time.time()
        if now - self._last_collision_popup_ts < self._collision_popup_cooldown_sec:
            return
        self._last_collision_popup_ts = now

        lines = []
        for v in ("front", "side"):
            d = details.get(v)
            if not d or d.get("ok", True):
                continue

            txt = self._view_cn(v)
            if not d.get("in_bounds", True):
                txt += "：越界"
            ov = int(d.get("overlap", 0))
            if ov > 0:
                if "：" in txt:
                    txt += "，"
                else:
                    txt += "："
                txt += f"与基准区碰撞（{ov} 像素）"
            lines.append(txt)

        if not lines:
            lines = ["姿态无效（原因未明）"]

        QtWidgets.QMessageBox.warning(self, title, "\n".join(lines))

    # ---------- 天数自动播放 ----------
    def _set_play_button_state(self, playing: bool):
        if not hasattr(self, "btn_play_pause_day"):
            return
        self.btn_play_pause_day.blockSignals(True)
        self.btn_play_pause_day.setChecked(playing)
        self.btn_play_pause_day.setText("暂停播放" if playing else "自动播放")
        self.btn_play_pause_day.blockSignals(False)

    def _stop_day_autoplay(self, update_button=True):
        if hasattr(self, "_day_play_timer") and self._day_play_timer.isActive():
            self._day_play_timer.stop()
        if update_button:
            self._set_play_button_state(False)

    def _toggle_day_autoplay(self, checked: bool):
        if checked:
            if self.plan is None or not self.plan.daily_steps:
                self._set_status("尚无规划结果，无法自动播放。")
                self._set_play_button_state(False)
                return
            if len(self.plan.daily_steps) <= 1:
                self._set_status("天数不足，无法自动播放。")
                self._set_play_button_state(False)
                return
            interval = max(100, int(self.sp_play_interval_ms.value()))
            self._day_play_timer.start(interval)
            self._set_play_button_state(True)
            self._set_status("开始自动播放。")
        else:
            self._stop_day_autoplay(update_button=True)
            self._set_status("已停止自动播放。")

    def _on_play_interval_changed(self, val: int):
        if self._day_play_timer.isActive():
            self._day_play_timer.start(max(100, int(val)))

    def _on_day_play_tick(self):
        if self.plan is None or not self.plan.daily_steps:
            self._stop_day_autoplay(update_button=True)
            return
        n = len(self.plan.daily_steps)
        if n <= 1:
            self._stop_day_autoplay(update_button=True)
            return

        if self.plan_day_idx >= n - 1:
            if self.ck_play_loop.isChecked():
                self.plan_day_idx = 0
                self._apply_plan_preview_day()
            else:
                self._stop_day_autoplay(update_button=True)
            return

        self.plan_day_idx += 1
        self._apply_plan_preview_day()

    # ---------- mask list ----------
    def _choose_mask_save_dir(self):
        d = QtWidgets.QFileDialog.getExistingDirectory(self, "选择自动保存掩码目录", self.mask_save_root)
        if not d:
            return
        self.mask_save_root = norm_path(d)
        os.makedirs(self.mask_save_root, exist_ok=True)
        self.ed_mask_save_dir.setText(self.mask_save_root)
        self._set_status(f"掩码保存目录：{self.mask_save_root}")

    def _open_mask_save_dir(self):
        if not os.path.isdir(self.mask_save_root):
            os.makedirs(self.mask_save_root, exist_ok=True)
        QtGui.QDesktopServices.openUrl(QtCore.QUrl.fromLocalFile(self.mask_save_root))

    def _refresh_mask_file_list(self):
        self.list_mask_files.clear()
        order = [("front", "reference"), ("front", "moving"), ("side", "reference"), ("side", "moving")]
        for v, r in order:
            p = self.mask_file_paths.get((v, r), "")
            self.list_mask_files.addItem(f"{self._view_cn(v)} - {self._role_cn(r)}: {p if p else '未保存'}")

    # ---------- image ----------
    def _open_image_for_view(self, view_key: str):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, f"打开{self._view_cn(view_key)}图像", "", "Images (*.png *.jpg *.jpeg *.bmp *.tif *.tiff);;All (*)"
        )
        if not path:
            return

        img, err = cv_read_image_safe(path, cv2.IMREAD_UNCHANGED)
        if img is None:
            self._show_error("图像读取失败", err)
            return

        try:
            gray = ensure_gray_u8(img)
        except Exception as e:
            self._show_error("图像读取失败", str(e))
            return

        mmpp = float(self.sp_mmpp_front.value()) if view_key == "front" else float(self.sp_mmpp_side.value())
        calib = Calibration(mm_per_px_x=mmpp, mm_per_px_y=mmpp, method="MANUAL")

        vd = self.project.views[view_key]
        vd.image = ImageData(path=norm_path(path), gray_u8=gray, calib=calib)
        vd.segments = {}

        self.mask_file_paths[(view_key, "reference")] = ""
        self.mask_file_paths[(view_key, "moving")] = ""
        self._refresh_mask_file_list()

        self._engine_img_token[(view_key, "classic")] = None
        self._engine_img_token[(view_key, "sam")] = None
        self._cand_cache[(view_key, "classic")] = []
        self._cand_cache[(view_key, "sam")] = []

        self._reset_scene_for_view(view_key)
        self._ensure_engine_image(view_key, self._active_engine_name())

        self._invalidate_plan(show_msg=False)
        self._update_region_status()
        self._update_pose_labels()
        self._set_status(f"{self._view_cn(view_key)}图像已加载。")

    def _apply_calibration(self):
        fv = self.project.views["front"]
        sv = self.project.views["side"]

        if fv.image is not None:
            fv.image.calib.mm_per_px_x = float(self.sp_mmpp_front.value())
            fv.image.calib.mm_per_px_y = float(self.sp_mmpp_front.value())
        if sv.image is not None:
            sv.image.calib.mm_per_px_x = float(self.sp_mmpp_side.value())
            sv.image.calib.mm_per_px_y = float(self.sp_mmpp_side.value())

        self._invalidate_plan(show_msg=False)
        self._sync_pose_to_segments(update_demo=True)
        self._validate_current_pose(False)
        self._update_pose_labels()
        self._set_status("标定已应用。")

    def _reset_scene_for_view(self, view_key: str):
        cs = self.canvas[view_key]
        vd = self.project.views[view_key]

        cs.scene.clear()
        cs.view.reset_overlay_items()
        cs.view.attach_scene(cs.scene)

        cs.image_item = None
        cs.candidate_item = None
        cs.overlap_item = None
        cs.path_item = None
        cs.seg_graphics = {}

        if vd.image is None:
            return

        pix = QtGui.QPixmap.fromImage(qimage_from_gray(vd.image.gray_u8))
        it = QtWidgets.QGraphicsPixmapItem(pix)
        it.setZValue(0)
        cs.scene.addItem(it)
        cs.image_item = it
        h, w = vd.image.gray_u8.shape
        cs.scene.setSceneRect(0, 0, w, h)

    def _rebuild_view_segment_graphics(self, view_key: str):
        cs = self.canvas[view_key]
        vd = self.project.views[view_key]

        for g in cs.seg_graphics.values():
            if g.item_main and isValid(g.item_main):
                cs.scene.removeItem(g.item_main)
            if g.item_demo and isValid(g.item_demo):
                cs.scene.removeItem(g.item_demo)
        cs.seg_graphics = {}

        mv = vd.segments.get("moving")
        if mv is not None:
            px = self._pose_mm_to_px(self.pose_mm, view_key)
            mv.pose_current_px = px
            if self.plan is None:
                mv.pose_demo_px = px

        for role in ("reference", "moving"):
            seg = vd.segments.get(role)
            if seg is None:
                continue
            g = SegmentGraphics(seg)
            for it in g.build_items():
                cs.scene.addItem(it)
            cs.seg_graphics[role] = g

    # ---------- segmentation ----------
    def _on_engine_status(self, view_key: str, engine_name: str, msg: str):
        self._set_status(f"[{self._view_cn(view_key)}-{engine_name}] {msg}")

    def _on_engine_candidates(self, view_key: str, engine_name: str, cands_obj):
        cands = cands_obj if cands_obj else []
        self._cand_cache[(view_key, engine_name)] = cands

        if view_key == self._active_seg_view() and engine_name == self._active_engine_name():
            self._refresh_candidate_list()

    def _ensure_engine_image(self, view_key: str, engine_name: str):
        vd = self.project.views[view_key]
        if vd.image is None:
            return
        token = (vd.image.path, vd.image.gray_u8.shape)
        if self._engine_img_token.get((view_key, engine_name)) == token:
            return
        self.engines[view_key][engine_name].set_image(vd.image.gray_u8)
        self._engine_img_token[(view_key, engine_name)] = token

    def _on_seg_context_changed(self):
        v = self._active_seg_view()
        e = self._active_engine_name()
        self._ensure_engine_image(v, e)

        if e == "sam":
            eng = self.engines[v]["sam"]
            vd = self.project.views[v]
            if vd.image is not None and isinstance(eng, SamSegmentationEngine) and not eng.is_available():
                self._set_status("SAM 不可用，请切换 Classic。")

        self._refresh_candidate_list()

    def _refresh_candidate_list(self):
        v = self._active_seg_view()
        e = self._active_engine_name()
        cands = self._cand_cache.get((v, e), [])

        self.list_cands.blockSignals(True)
        self.list_cands.clear()
        for i, c in enumerate(cands):
            it = QtWidgets.QListWidgetItem(f"[{i}] score={float(c.get('score', 0.0)):.4f} ({c.get('engine', '?')})")
            it.setFlags(it.flags() | QtCore.Qt.ItemFlag.ItemIsUserCheckable | QtCore.Qt.ItemFlag.ItemIsSelectable)
            it.setCheckState(QtCore.Qt.CheckState.Checked if i == 0 else QtCore.Qt.CheckState.Unchecked)
            self.list_cands.addItem(it)
        self.list_cands.blockSignals(False)

        self._update_candidate_overlay_active()

    def _checked_candidate_indices(self) -> List[int]:
        idxs = []
        for i in range(self.list_cands.count()):
            if self.list_cands.item(i).checkState() == QtCore.Qt.CheckState.Checked:
                idxs.append(i)
        return idxs

    def _compose_checked_mask(self, view_key: str, engine_name: str) -> Optional[np.ndarray]:
        cands = self._cand_cache.get((view_key, engine_name), [])
        if not cands:
            return None

        idxs = self._checked_candidate_indices()
        if not idxs:
            row = self.list_cands.currentRow()
            idxs = [row] if 0 <= row < len(cands) else [0]

        m = np.zeros_like(cands[0]["mask"], dtype=bool)
        for i in idxs:
            if 0 <= i < len(cands):
                m |= cands[i]["mask"].astype(bool)
        return m

    def _on_candidate_row_changed(self, row: int):
        if row < 0:
            return
        self._update_candidate_overlay_active()

    def _on_candidate_item_changed(self, _item: QtWidgets.QListWidgetItem):
        self._update_candidate_overlay_active()

    def _update_candidate_overlay_active(self):
        self._clear_candidate_overlay("front")
        self._clear_candidate_overlay("side")

        v = self._active_seg_view()
        e = self._active_engine_name()
        mask = self._compose_checked_mask(v, e)
        if mask is not None:
            self._show_candidate_overlay(v, mask)

    def _on_box_final(self, view_key: str, box):
        vd = self.project.views[view_key]
        if vd.image is None:
            self._set_status(f"{self._view_cn(view_key)}尚未加载图像。")
            return

        self.cb_seg_view.setCurrentIndex(0 if view_key == "front" else 1)

        e = self._active_engine_name()
        self._ensure_engine_image(view_key, e)
        self.engines[view_key][e].set_box(box)

    def _clear_prompts(self):
        v = self._active_seg_view()
        e = self._active_engine_name()
        self.engines[v][e].clear_prompts()
        self._clear_candidate_overlay(v)

    def _undo_prompt(self):
        self._active_engine().undo()

    def _redo_prompt(self):
        self._active_engine().redo()

    def _predict_prompt(self):
        self._active_engine().request_predict()

    def _show_candidate_overlay(self, view_key: str, mask: np.ndarray):
        self._clear_candidate_overlay(view_key)
        cs = self.canvas[view_key]
        rgba = mask_to_rgba(mask, (0, 255, 255, 95))
        pix = QtGui.QPixmap.fromImage(qimage_from_rgba(rgba))
        it = QtWidgets.QGraphicsPixmapItem(pix)
        it.setZValue(40)
        it.setPos(0, 0)
        cs.scene.addItem(it)
        cs.candidate_item = it

    def _clear_candidate_overlay(self, view_key: str):
        cs = self.canvas[view_key]
        if cs.candidate_item is not None and isValid(cs.candidate_item):
            cs.scene.removeItem(cs.candidate_item)
        cs.candidate_item = None

    # ---------- 保存四掩码 ----------
    def _save_mask_file(self, mask: np.ndarray, view_key: str, role: str, engine_name: str) -> str:
        day_dir = os.path.join(self.mask_save_root, datetime.now().strftime("%Y%m%d"))
        os.makedirs(day_dir, exist_ok=True)
        ts = datetime.now().strftime("%H%M%S_%f")
        file_name = f"{view_key}_{role}_{engine_name}_{ts}.png"
        out_path = os.path.join(day_dir, file_name)

        u8 = (mask.astype(np.uint8) * 255)
        ok, err, real_path = cv_write_image_safe(out_path, u8)
        if not ok:
            raise RuntimeError(err)
        return real_path

    def _confirm_and_apply_mask(self, view_key: str, role: str, engine_name: str, mask: np.ndarray, mode_text: str):
        if role not in ("reference", "moving"):
            QtWidgets.QMessageBox.warning(self, "保存失败", f"无效角色：{role}")
            return

        area = int(np.count_nonzero(mask))
        old = self.mask_file_paths.get((view_key, role), "")

        text = (
            f"保存目标：{self._view_cn(view_key)} - {self._role_cn(role)}\n"
            f"来源：{mode_text}\n"
            f"前景像素：{area}\n"
        )
        if old:
            text += f"\n该部位已有掩码，将覆盖记录：\n{old}\n"
        text += "\n确认保存？"

        ret = QtWidgets.QMessageBox.question(
            self, "确认保存掩码", text,
            QtWidgets.QMessageBox.StandardButton.Yes | QtWidgets.QMessageBox.StandardButton.No,
            QtWidgets.QMessageBox.StandardButton.Yes
        )
        if ret != QtWidgets.QMessageBox.StandardButton.Yes:
            return

        print(f"[SAVE_CTX] view={view_key}, role={role}, engine={engine_name}")
        self._apply_mask_to_role(view_key, role, engine_name, mask)

    def _apply_mask_to_role(self, view_key: str, role: str, engine_name: str, mask_raw: np.ndarray):
        mask = postprocess_mask(mask_raw, min_area_px=400, morph_k=3)
        if np.count_nonzero(mask) == 0:
            self._set_status("掩码为空，保存失败。")
            return

        if role == "reference":
            seg = Segment(
                id=f"{view_key}_reference",
                name=f"{view_key}_reference",
                mask=mask,
                is_reference=True,
                pose_current_px=(0, 0),
                pose_demo_px=(0, 0),
                color_rgba=(255, 80, 80, 130),
            )
        else:
            px = self._pose_mm_to_px(self.pose_mm, view_key)
            seg = Segment(
                id=f"{view_key}_moving",
                name=f"{view_key}_moving",
                mask=mask,
                is_reference=False,
                pose_current_px=px,
                pose_demo_px=px,
                color_rgba=(0, 200, 255, 130),
            )

        self.project.views[view_key].segments[role] = seg

        try:
            saved = self._save_mask_file(mask, view_key, role, engine_name)
            self.mask_file_paths[(view_key, role)] = saved
            self._set_status(f"{self._view_cn(view_key)}-{self._role_cn(role)} 已保存：{saved}")
        except Exception as e:
            self.mask_file_paths[(view_key, role)] = "[已应用内存，写盘失败]"
            self._set_status(f"已应用但写盘失败：{e}")

        self._invalidate_plan(show_msg=False)
        self._rebuild_view_segment_graphics(view_key)
        self._update_region_status()
        self._refresh_mask_file_list()
        self._validate_current_pose(False)

    def _commit_checked_separate(self):
        view_key = self._active_seg_view()
        role = self._active_seg_role()
        engine_name = self._active_engine_name()

        cands = self._cand_cache.get((view_key, engine_name), [])
        if not cands:
            self._set_status("无候选，请先预测。")
            return

        idxs = self._checked_candidate_indices()
        if not idxs:
            row = self.list_cands.currentRow()
            if 0 <= row < len(cands):
                idxs = [row]
        if not idxs:
            self._set_status("请勾选或选中一个候选。")
            return

        if len(idxs) > 1:
            self._set_status("分别模式一次只能保存一个候选；多个请用“合并”。")
            return

        idx = max(0, min(idxs[0], len(cands) - 1))
        self._confirm_and_apply_mask(view_key, role, engine_name, cands[idx]["mask"].astype(bool), f"分别候选#{idx}")

    def _commit_checked_union(self):
        view_key = self._active_seg_view()
        role = self._active_seg_role()
        engine_name = self._active_engine_name()

        cands = self._cand_cache.get((view_key, engine_name), [])
        if not cands:
            self._set_status("无候选，请先预测。")
            return

        idxs = self._checked_candidate_indices()
        if not idxs:
            row = self.list_cands.currentRow()
            if 0 <= row < len(cands):
                idxs = [row]
        if not idxs:
            self._set_status("请勾选至少一个候选。")
            return

        mask = np.zeros_like(cands[0]["mask"], dtype=bool)
        valid = []
        for i in idxs:
            if 0 <= i < len(cands):
                mask |= cands[i]["mask"].astype(bool)
                valid.append(i)

        if not valid:
            self._set_status("有效候选为空。")
            return

        self._confirm_and_apply_mask(view_key, role, engine_name, mask, f"合并候选{valid}")

    def _update_region_status(self):
        f = self.project.views["front"].segments
        s = self.project.views["side"].segments
        txt = (
            "四区域状态（分割独立 / 移动协同）："
            f" 正位[Ref {'✅' if 'reference' in f else '❌'} / Mov {'✅' if 'moving' in f else '❌'}]"
            f"  侧位[Ref {'✅' if 'reference' in s else '❌'} / Mov {'✅' if 'moving' in s else '❌'}]"
        )
        self.lbl_region.setText(txt)

    # ---------- pose / collision ----------
    def _regions_complete(self) -> bool:
        for k in ("front", "side"):
            vd = self.project.views[k]
            if vd.image is None:
                return False
            if "reference" not in vd.segments or "moving" not in vd.segments:
                return False
        return True

    def _pose_mm_to_px(self, pose: PoseMM, view_key: str) -> Tuple[int, int]:
        vd = self.project.views[view_key]
        if vd.image is None:
            return 0, 0
        c = vd.image.calib
        if view_key == "front":
            dx = round_half_up(pose.lr / c.mm_per_px_x)    # 左右（前后不体现）
        else:
            dx = round_half_up(-pose.fb / c.mm_per_px_x)   # 前后（左右不体现），前->x负
        dy = round_half_up(pose.ud / c.mm_per_px_y)        # 上下
        return dx, dy

    @staticmethod
    def _bbox_shift_in_bounds(mask: np.ndarray, shift_px: Tuple[int, int], shape_hw: Tuple[int, int]) -> bool:
        bb = bbox_from_mask(mask)
        if bb is None:
            return False
        x1, y1, x2, y2 = bb
        dx, dy = shift_px
        h, w = shape_hw
        return x1 + dx >= 0 and y1 + dy >= 0 and x2 + dx < w and y2 + dy < h

    def _pose_valid(self, pose: PoseMM, draw_overlay=False):
        details = {}
        checked = 0
        ok_all = True

        for v in ("front", "side"):
            vd = self.project.views[v]
            if vd.image is None or "reference" not in vd.segments or "moving" not in vd.segments:
                if draw_overlay:
                    self._clear_overlap_overlay(v)
                continue

            checked += 1
            ref_seg = vd.segments["reference"]
            mov_seg = vd.segments["moving"]

            shift = self._pose_mm_to_px(pose, v)
            in_bounds = self._bbox_shift_in_bounds(mov_seg.mask, shift, vd.image.gray_u8.shape)

            moved = MaskTransform.shift_bool_mask(mov_seg.mask, shift[0], shift[1])
            ref = MaskTransform.shift_bool_mask(ref_seg.mask, ref_seg.pose_current_px[0], ref_seg.pose_current_px[1])

            ref_col = dilate_mask(ref, 1)
            overlap_mask = moved & ref_col
            overlap = int(np.count_nonzero(overlap_mask))

            ok = in_bounds and (overlap == 0)
            details[v] = {"ok": ok, "in_bounds": in_bounds, "overlap": overlap, "overlap_mask": overlap_mask}
            if not ok:
                ok_all = False

            if draw_overlay:
                if overlap > 0:
                    self._show_overlap_overlay(v, overlap_mask)
                else:
                    self._clear_overlap_overlay(v)

        if checked < 2:
            return False, details
        return ok_all, details

    # 供 A* 复用：完全按实时检测判定
    def _pose_valid_for_planner(self, mm_pose_tuple: Tuple[float, float, float]) -> bool:
        p = PoseMM.from_tuple(mm_pose_tuple)
        ok, _ = self._pose_valid(p, draw_overlay=False)
        return ok

    def _show_overlap_overlay(self, view_key: str, mask: np.ndarray):
        self._clear_overlap_overlay(view_key)
        cs = self.canvas[view_key]
        rgba = mask_to_rgba(mask, (255, 0, 0, 170))
        pix = QtGui.QPixmap.fromImage(qimage_from_rgba(rgba))
        it = QtWidgets.QGraphicsPixmapItem(pix)
        it.setZValue(100)
        it.setPos(0, 0)
        cs.scene.addItem(it)
        cs.overlap_item = it

    def _clear_overlap_overlay(self, view_key: str):
        cs = self.canvas[view_key]
        if cs.overlap_item is not None and isValid(cs.overlap_item):
            cs.scene.removeItem(cs.overlap_item)
        cs.overlap_item = None

    def _draw_details_overlay(self, details):
        for v in ("front", "side"):
            d = details.get(v, None)
            if d is None:
                self._clear_overlap_overlay(v)
                continue
            if d.get("overlap", 0) > 0:
                self._show_overlap_overlay(v, d["overlap_mask"])
            else:
                self._clear_overlap_overlay(v)

    def _collision_lines_for_details(self, details: dict) -> List[str]:
        lines = []
        for v in ("front", "side"):
            d = details.get(v)
            if not d or d.get("ok", True):
                continue

            parts = []
            if not d.get("in_bounds", True):
                parts.append("越界")

            ov = int(d.get("overlap", 0))
            if ov > 0:
                msg = f"碰撞 {ov}px"
                om = d.get("overlap_mask", None)
                if isinstance(om, np.ndarray):
                    ys, xs = np.where(om)
                    if len(xs) > 0:
                        cx, cy = int(np.mean(xs)), int(np.mean(ys))
                        msg += f"（中心≈{cx},{cy}）"
                parts.append(msg)

            if not parts:
                parts.append("姿态无效")

            lines.append(f"{self._view_cn(v)}：{'，'.join(parts)}")
        return lines

    def _show_astar_collision_diagnosis(self, header: str, pose: PoseMM, details: dict):
        self._draw_details_overlay(details)

        msg = [
            header,
            f"姿态(mm)：LR={pose.lr:.2f}, UD={pose.ud:.2f}, FB={pose.fb:.2f}"
        ]
        msg.extend(self._collision_lines_for_details(details))
        if len(msg) <= 2:
            msg.append("未捕获到重叠像素，可能主要是越界导致。")

        QtWidgets.QMessageBox.warning(self, "A*碰撞定位", "\n".join(msg))

    def _find_first_invalid_pose_on_line(
        self, start: PoseMM, goal: PoseMM, sample_step_mm: float = 0.5
    ) -> Optional[Tuple[PoseMM, dict, int, int]]:
        dx = goal.lr - start.lr
        dy = goal.ud - start.ud
        dz = goal.fb - start.fb
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)

        if dist <= 1e-9:
            ok, det = self._pose_valid(goal, draw_overlay=False)
            if not ok:
                return goal.copy(), det, 0, 0
            return None

        step = max(0.1, float(sample_step_mm))
        n = max(2, int(math.ceil(dist / step)) + 1)

        for i in range(1, n):
            t = i / (n - 1)
            p = PoseMM(
                lr=start.lr + dx * t,
                ud=start.ud + dy * t,
                fb=start.fb + dz * t
            )
            ok, det = self._pose_valid(p, draw_overlay=False)
            if not ok:
                return p, det, i, (n - 1)

        return None

    def _sync_pose_to_segments(self, update_demo=True):
        for v in ("front", "side"):
            vd = self.project.views[v]
            mov = vd.segments.get("moving")
            if mov is None:
                continue
            px = self._pose_mm_to_px(self.pose_mm, v)
            mov.pose_current_px = px
            if update_demo:
                mov.pose_demo_px = px
            g = self.canvas[v].seg_graphics.get("moving")
            if g:
                g.update_pose_main()
                g.update_pose_demo()

    def _set_preview_pose_for_view(self, view_key: str, px: Tuple[int, int]):
        vd = self.project.views[view_key]
        mv = vd.segments.get("moving")
        if mv is None:
            return

        px_i = (int(px[0]), int(px[1]))
        mv.pose_current_px = px_i
        mv.pose_demo_px = px_i

        g = self.canvas[view_key].seg_graphics.get("moving")
        if g:
            g.update_pose_main()
            g.update_pose_demo()

    def _validate_current_pose(self, show_status=True):
        ok, details = self._pose_valid(self.pose_mm, draw_overlay=True)
        if show_status:
            if ok:
                self._set_status("当前姿态：无碰撞。")
            else:
                if not self._regions_complete():
                    self._set_status("请先完成四个掩码（正Ref/正Mov/侧Ref/侧Mov）。")
                else:
                    msgs = []
                    for v in ("front", "side"):
                        d = details.get(v)
                        if d and not d["ok"]:
                            m = self._view_cn(v)
                            if not d["in_bounds"]:
                                m += "[越界]"
                            if d["overlap"] > 0:
                                m += f"[碰撞像素={d['overlap']}]"
                            msgs.append(m)
                    self._set_status("当前姿态冲突：" + " ".join(msgs))
        return ok

    def _move_arrow(self, key: str):
        if not self._regions_complete():
            self._set_status("请先完成四个掩码（正Ref/正Mov/侧Ref/侧Mov）。")
            return

        step = float(self.sp_step_mm.value())
        dlr = dud = dfb = 0.0

        if key == "left":
            dlr = -step
        elif key == "right":
            dlr = +step
        elif key == "up":
            dud = -step
        elif key == "down":
            dud = +step
        elif key == "front":
            dfb = +step
        elif key == "back":
            dfb = -step

        new_pose = PoseMM(
            lr=self.pose_mm.lr + dlr,
            ud=self.pose_mm.ud + dud,
            fb=self.pose_mm.fb + dfb
        )

        ok, details = self._pose_valid(new_pose, draw_overlay=False)
        if not ok:
            self._draw_details_overlay(details)
            self._popup_collision_blocked(details, title="检测到碰撞/越界，已停止移动")
            self._set_status("移动被阻止：检测到碰撞或越界。")
            return

        if self.plan is not None:
            self._invalidate_plan(show_msg=False)

        self.pose_mm = new_pose
        self._sync_pose_to_segments(update_demo=True)
        self._validate_current_pose(False)
        self._update_pose_labels()

    # ---------- target / planning ----------
    def _set_target_from_inputs(self):
        lr = float(self.sp_right.value()) - float(self.sp_left.value())
        ud = float(self.sp_down.value()) - float(self.sp_up.value())
        fb = float(self.sp_front.value()) - float(self.sp_back.value())
        self.target_pose_mm = PoseMM(lr=lr, ud=ud, fb=fb)
        self._update_pose_labels()
        self._set_status("目标位姿已更新。")

    def _delta_to_text(self, dlr: float, dud: float, dfb: float) -> str:
        parts = []
        if abs(dlr) > 1e-6:
            parts.append(f"{'右' if dlr > 0 else '左'}{abs(dlr):.2f}mm")
        if abs(dud) > 1e-6:
            parts.append(f"{'下' if dud > 0 else '上'}{abs(dud):.2f}mm")
        if abs(dfb) > 1e-6:
            parts.append(f"{'前' if dfb > 0 else '后'}{abs(dfb):.2f}mm")
        return " + ".join(parts) if parts else "静止"

    def _plan_astar_to_target(self):
        self._stop_day_autoplay(update_button=True)

        if not self._regions_complete():
            self._set_status("请先完成四个掩码后再规划。")
            return

        start_ok, start_det = self._pose_valid(self.pose_mm, draw_overlay=False)
        if not start_ok:
            self._show_astar_collision_diagnosis(
                "当前姿态已碰撞/越界，无法开始 A*，请先调整。",
                self.pose_mm, start_det
            )
            self._set_status("A*启动失败：当前姿态无效。")
            return

        goal_ok, detail_goal = self._pose_valid(self.target_pose_mm, draw_overlay=False)
        if not goal_ok:
            self._show_astar_collision_diagnosis(
                "目标姿态不可达（碰撞/越界），请调整目标。",
                self.target_pose_mm, detail_goal
            )
            self._set_status("目标位姿不可达（碰撞/越界）。")
            return

        self._clear_overlap_overlay("front")
        self._clear_overlap_overlay("side")

        fv = self.project.views["front"]
        sv = self.project.views["side"]

        f_mov = fv.segments["moving"].mask
        f_ref = MaskTransform.shift_bool_mask(fv.segments["reference"].mask, *fv.segments["reference"].pose_current_px)
        s_mov = sv.segments["moving"].mask
        s_ref = MaskTransform.shift_bool_mask(sv.segments["reference"].mask, *sv.segments["reference"].pose_current_px)

        start = self.pose_mm.as_tuple()
        goal = self.target_pose_mm.as_tuple()

        # 与实时检测尺度一致
        step_ui = max(0.1, float(self.sp_step_mm.value()))
        if step_ui >= 0.5:
            max_expand = 600000
        elif step_ui >= 0.25:
            max_expand = 900000
        else:
            max_expand = 1200000

        cfgs = [
            Planner3DConfig(
                step_mm=step_ui,
                neighbor26=True,
                edge_sample_mm=step_ui,
                max_expand=max_expand,
                contact_as_collision=True
            ),
            Planner3DConfig(
                step_mm=step_ui,
                neighbor26=False,
                edge_sample_mm=step_ui,
                max_expand=max_expand,
                contact_as_collision=True
            ),
        ]

        best = None
        last_msg = ""
        for cfg in cfgs:
            planner = AStarPlanner3D(
                front_rigid_mask=f_mov, front_obstacle_mask=f_ref, front_calib=fv.image.calib,
                side_rigid_mask=s_mov, side_obstacle_mask=s_ref, side_calib=sv.image.calib,
                cfg=cfg,
                pose_valid_fn=self._pose_valid_for_planner  # 关键：复用实时检测
            )
            res = planner.plan(start, goal)
            if res.ok:
                best = res
                break
            last_msg = res.message

        if best is None or not best.ok:
            hit = self._find_first_invalid_pose_on_line(self.pose_mm, self.target_pose_mm, sample_step_mm=step_ui)
            if hit is not None:
                bad_pose, bad_details, idx, total = hit
                self._show_astar_collision_diagnosis(
                    f"A*规划失败：{last_msg}\n直线诊断在第 {idx}/{total} 段发现阻挡。",
                    bad_pose, bad_details
                )
            else:
                QtWidgets.QMessageBox.warning(
                    self, "A*规划失败",
                    f"A*规划失败：{last_msg}\n"
                    f"未在直线采样上发现直接碰撞，可能是可行域断开或步长过粗。\n"
                    f"建议：减小步长、微调目标、或重分割。"
                )
            self._set_status(f"A*规划失败：{last_msg}")
            return

        path_mm = list(best.path_mm)
        if path_mm:
            path_mm[0] = start
            path_mm[-1] = goal

        daily_pts = resample_daily_3d(path_mm, day_step_mm=1.0)

        daily = []
        cum = 0.0
        prev = daily_pts[0]
        for i, p in enumerate(daily_pts):
            if i == 0:
                dlr = dud = dfb = 0.0
                delta = 0.0
            else:
                dlr = p[0] - prev[0]
                dud = p[1] - prev[1]
                dfb = p[2] - prev[2]
                delta = math.sqrt(dlr * dlr + dud * dud + dfb * dfb)
                cum += delta

            pose = PoseMM.from_tuple(p)
            ok, _ = self._pose_valid(pose, draw_overlay=False)
            daily.append(DailyStep3D(
                day_index=i,
                pose_mm=pose,
                delta_mm=delta,
                cumulative_mm=cum,
                dir_text=self._delta_to_text(dlr, dud, dfb),
                front_px=self._pose_mm_to_px(pose, "front"),
                side_px=self._pose_mm_to_px(pose, "side"),
                ok_collision_free=ok
            ))
            prev = p

        self.plan = Plan3D(
            ok=True,
            path_mm=path_mm,
            total_len_mm=path_length_3d_mm(path_mm),
            daily_steps=daily,
            message="OK"
        )
        self.plan_day_idx = 0
        self._build_path_overlays(path_mm)
        self._apply_plan_preview_day()
        self._render_plan_text()
        self._set_play_button_state(False)
        self._set_status("A*规划完成。")

    def _build_path_overlays(self, path_mm: List[Tuple[float, float, float]]):
        self._clear_path_overlays()
        if len(path_mm) < 2:
            return

        for v in ("front", "side"):
            vd = self.project.views[v]
            cs = self.canvas[v]
            mov = vd.segments.get("moving")
            if mov is None:
                continue
            bb = bbox_from_mask(mov.mask)
            if bb is None:
                continue
            x1, y1, x2, y2 = bb
            anchor = ((x1 + x2) * 0.5, (y1 + y2) * 0.5)

            pts = []
            for p in path_mm:
                pose = PoseMM.from_tuple(p)
                dx, dy = self._pose_mm_to_px(pose, v)
                pts.append((anchor[0] + dx, anchor[1] + dy))

            if len(pts) < 2:
                continue

            path = QtGui.QPainterPath(QtCore.QPointF(pts[0][0], pts[0][1]))
            for x, y in pts[1:]:
                path.lineTo(x, y)

            item = QtWidgets.QGraphicsPathItem(path)
            pen = QtGui.QPen(QtGui.QColor(40, 220, 40, 220))
            pen.setWidth(2)
            pen.setCosmetic(True)
            item.setPen(pen)
            item.setZValue(35)
            cs.scene.addItem(item)
            cs.path_item = item

    def _clear_path_overlays(self):
        for v in ("front", "side"):
            cs = self.canvas[v]
            if cs.path_item is not None and isValid(cs.path_item):
                cs.scene.removeItem(cs.path_item)
            cs.path_item = None

    def _invalidate_plan(self, show_msg=False):
        self._stop_day_autoplay(update_button=True)

        if self.plan is None:
            self._sync_pose_to_segments(update_demo=True)
            return

        self.plan = None
        self.plan_day_idx = 0
        self._clear_path_overlays()
        self.lbl_day.setText("Day 0/0")
        self.txt_plan.clear()

        self._sync_pose_to_segments(update_demo=True)

        if show_msg:
            self._set_status("规划已失效（几何发生变化）。")

    def _apply_plan_preview_day(self):
        if self.plan is None or not self.plan.daily_steps:
            self.lbl_day.setText("Day 0/0")
            self._sync_pose_to_segments(update_demo=True)
            return

        self.plan_day_idx = max(0, min(self.plan_day_idx, len(self.plan.daily_steps) - 1))
        d = self.plan.daily_steps[self.plan_day_idx]

        self._set_preview_pose_for_view("front", d.front_px)
        self._set_preview_pose_for_view("side", d.side_px)

        self.lbl_day.setText(f"Day {self.plan_day_idx}/{len(self.plan.daily_steps)-1}")

    def _change_preview_day(self, delta: int):
        self._stop_day_autoplay(update_button=True)
        if self.plan is None or not self.plan.daily_steps:
            self._set_status("尚无规划结果。")
            return
        self.plan_day_idx = max(0, min(len(self.plan.daily_steps) - 1, self.plan_day_idx + delta))
        self._apply_plan_preview_day()

    def _apply_preview_day_as_current(self):
        self._stop_day_autoplay(update_button=True)
        if self.plan is None or not self.plan.daily_steps:
            return
        pose = self.plan.daily_steps[self.plan_day_idx].pose_mm.copy()
        ok, details = self._pose_valid(pose, draw_overlay=False)
        if not ok:
            self._draw_details_overlay(details)
            self._set_status("该预览日姿态不可应用（碰撞/越界）。")
            return
        self.pose_mm = pose
        self._sync_pose_to_segments(update_demo=True)
        self._validate_current_pose(False)
        self._update_pose_labels()
        self._set_status(f"已应用 Day {self.plan_day_idx}。")

    def _render_plan_text(self):
        if self.plan is None:
            self.txt_plan.clear()
            return
        lines = [
            f"Path points: {len(self.plan.path_mm)}",
            f"Total length: {self.plan.total_len_mm:.3f} mm",
            f"Days: {len(self.plan.daily_steps)}",
            "-" * 80,
            "Day | Delta(mm) | Cum(mm) | Direction | Front(px) | Side(px) | OK"
        ]
        for d in self.plan.daily_steps:
            lines.append(
                f"{d.day_index:3d} | {d.delta_mm:8.3f} | {d.cumulative_mm:7.3f} | "
                f"{d.dir_text:20s} | ({d.front_px[0]:4d},{d.front_px[1]:4d}) | "
                f"({d.side_px[0]:4d},{d.side_px[1]:4d}) | {d.ok_collision_free}"
            )
        self.txt_plan.setPlainText("\n".join(lines))

    def _export_pdf_report(self):
        if self.plan is None or not self.plan.ok:
            self._set_status("无可导出的规划结果。")
            return
        if not REPORTLAB_OK:
            self._set_status("未安装 reportlab，无法导出 PDF。")
            return

        out, _ = QtWidgets.QFileDialog.getSaveFileName(self, "导出 PDF", "", "PDF (*.pdf)")
        if not out:
            return
        try:
            ReportService.export_pdf(out, self.project, self.pose_mm, self.target_pose_mm, self.plan)
            self._set_status(f"报告已导出：{out}")
        except Exception as e:
            self._set_status(f"导出失败：{e}")

    def _update_pose_labels(self):
        self.lbl_pose_current.setText(
            f"当前(mm): 左右={self.pose_mm.lr:.2f}, 上下={self.pose_mm.ud:.2f}, 前后={self.pose_mm.fb:.2f}"
        )
        self.lbl_pose_target.setText(
            f"目标(mm): 左右={self.target_pose_mm.lr:.2f}, 上下={self.target_pose_mm.ud:.2f}, 前后={self.target_pose_mm.fb:.2f}"
        )
        fpx = self._pose_mm_to_px(self.pose_mm, "front")
        spx = self._pose_mm_to_px(self.pose_mm, "side")
        self.lbl_pose_px.setText(
            f"Front(LR,UD)=({fpx[0]:+d},{fpx[1]:+d}) [FB不体现] | "
            f"Side(FB,UD)=({spx[0]:+d},{spx[1]:+d}) [LR不体现]"
        )

    def closeEvent(self, event: QtGui.QCloseEvent):
        self._stop_day_autoplay(update_button=False)
        super().closeEvent(event)


# =========================
# main
# =========================
if __name__ == "__main__":
    print("[BOOT] running file:", os.path.abspath(__file__))
    app = QtWidgets.QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())
