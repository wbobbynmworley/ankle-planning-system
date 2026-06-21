# Classic segmentation: Otsu + connected components (no Qt)
from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """与 2dmax.py 一字不差：填充孔洞。"""
    m = (mask.astype(np.uint8) * 255)
    h, w = m.shape
    flood = m.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ff, (0, 0), 255)
    flood_inv = cv2.bitwise_not(flood)
    return (cv2.bitwise_or(m, flood_inv) > 0)


def postprocess_mask(
    mask: np.ndarray,
    min_area_px: int = 500,
    morph_k: int = 3,
) -> np.ndarray:
    """与 2dmax.py 一字不差：连通域 + fill_holes + 形态学。"""
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
    return (m > 0).astype(bool)


def segment_roi_classic(gray: np.ndarray, box_xyxy: Tuple[int, int, int, int]) -> Optional[np.ndarray]:
    """Segment largest connected component in ROI using Otsu. Returns bool mask same shape as gray."""
    x1, y1, x2, y2 = box_xyxy
    w, h = gray.shape[1], gray.shape[0]
    x1, x2 = max(0, min(x1, w - 1)), max(0, min(x2, w - 1))
    y1, y2 = max(0, min(y1, h - 1)), max(0, min(y2, h - 1))
    if x1 >= x2 or y1 >= y2:
        return None
    roi = gray[y1 : y2 + 1, x1 : x2 + 1]
    if roi.size == 0:
        return None
    _, th = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(th, connectivity=8)
    if num <= 1:
        return None
    idx = int(np.argmax(stats[1:, cv2.CC_STAT_AREA])) + 1
    cc = (labels == idx).astype(np.uint8) * 255
    mask_full = np.zeros_like(gray, dtype=bool)
    mask_full[y1 : y2 + 1, x1 : x2 + 1] = (cc > 0)
    return postprocess_mask(mask_full, min_area_px=400, morph_k=3)
