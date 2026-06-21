"""比例球识别：从图像中检测比例球并计算 mm/px。参考球直径 20mm。"""
from __future__ import annotations

import base64
import os
from typing import Optional, Tuple

import cv2
import numpy as np

REF_BALL_MM = 20.0


def _decode_path_if_garbled(path: str) -> str:
    if not path or os.path.isfile(path):
        return path
    try:
        fixed = path.encode("gbk").decode("utf-8")
        if os.path.isfile(fixed):
            return fixed
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return path


def _img_from_base64(b64: str) -> np.ndarray:
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image base64")
    return img


def _img_from_path(path: str) -> np.ndarray:
    path = _decode_path_if_garbled(path)
    if not path or not os.path.isfile(path):
        raise FileNotFoundError(f"Image not found: {path}")
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Decode failed: {path}")
    return img


def detect_ball_hough(img: np.ndarray) -> Optional[Tuple[int, int, int]]:
    """使用 Hough 圆检测整图中最大圆，返回 (cx, cy, radius) 或 None。"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (9, 9), 2)
    h, w = gray.shape
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        1,
        minDist=min(h, w) // 4,
        param1=100,
        param2=30,
        minRadius=10,
        maxRadius=min(h, w) // 2,
    )
    if circles is None or len(circles[0]) == 0:
        return None
    circles = np.round(circles[0, :]).astype("int")
    best = max(circles, key=lambda c: c[2])
    return (int(best[0]), int(best[1]), int(best[2]))


def detect_ball_yolo(img: np.ndarray, model_path: Optional[str], image_path: Optional[str] = None) -> Optional[Tuple[int, int, int]]:
    """使用 YOLOv8 检测 Class 0 框，再在 ROI 内 Hough 圆。返回 (cx, cy, radius) 或 None。"""
    try:
        from ultralytics import YOLO
    except ImportError:
        return None
    if not model_path or not os.path.isfile(model_path):
        return None
    model = YOLO(model_path)
    source = image_path if image_path and os.path.isfile(image_path) else img
    results = model.predict(source=source, conf=0.01, iou=0.5, classes=[0], verbose=False)
    for result in results:
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            continue
        # 取置信度最高的 class 0 框
        idx = np.argmax(boxes.conf.cpu().numpy())
        x1, y1, x2, y2 = boxes.xyxy[idx].cpu().numpy().astype(int)
        roi = img[y1:y2, x1:x2]
        if roi.size == 0:
            continue
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (9, 9), 2)
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            1,
            minDist=roi.shape[0] / 8,
            param1=100,
            param2=30,
            minRadius=10,
            maxRadius=0,
        )
        if circles is not None and len(circles[0]) > 0:
            circles = np.round(circles[0, :]).astype("int")
            max_c = max(circles, key=lambda c: c[2])
            cx = int(max_c[0]) + x1
            cy = int(max_c[1]) + y1
            r = int(max_c[2])
            return (cx, cy, r)
    return None


def ratio_ball_detect(
    image_path: Optional[str] = None,
    image_base64: Optional[str] = None,
    yolo_model_path: Optional[str] = None,
) -> dict:
    """
    检测比例球，返回 mm_per_px, center_px, diameter_px, diameter_mm。
    参考球直径 REF_BALL_MM = 20mm。
    """
    if image_base64:
        img = _img_from_base64(image_base64)
    elif image_path:
        img = _img_from_path(image_path)
    else:
        raise ValueError("Provide image_path or image_base64")

    result = None
    if yolo_model_path:
        result = detect_ball_yolo(img, yolo_model_path, image_path)
    if result is None:
        result = detect_ball_hough(img)
    if result is None:
        return {
            "mm_per_px": 1.0,
            "center_px": [0, 0],
            "diameter_px": 20,
            "diameter_mm": REF_BALL_MM,
        }
    cx, cy, r = result
    diameter_px = 2 * r
    if diameter_px <= 0:
        diameter_px = 1
    mm_per_px = REF_BALL_MM / diameter_px
    diameter_mm = REF_BALL_MM
    return {
        "mm_per_px": round(mm_per_px, 6),
        "center_px": [int(cx), int(cy)],
        "diameter_px": int(diameter_px),
        "diameter_mm": diameter_mm,
    }
