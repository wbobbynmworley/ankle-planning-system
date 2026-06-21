"""STL 三维模型投影为正位图、侧位图（二维），返回 base64 PNG。"""
from __future__ import annotations

import base64
import io
import os
from typing import List, Optional

import numpy as np


def _decode_path(p: str) -> str:
    if not p or os.path.isfile(p):
        return p
    try:
        fixed = p.encode("gbk").decode("utf-8")
        if os.path.isfile(fixed):
            return fixed
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return p


def render_orthographic(mesh, direction: str) -> np.ndarray:
    """PyVista 正交投影到二维图像。direction: 'front' (X-Y) 或 'side' (X-Z)。"""
    try:
        import pyvista as pv
    except ImportError:
        raise RuntimeError("pyvista is required for stl-to-2d")
    plotter = pv.Plotter(off_screen=True)
    plotter.set_background("black")
    plotter.add_mesh(mesh, color="white", opacity=0.9, lighting=False, show_edges=False)
    if direction == "front":
        plotter.view_xy()
    else:
        plotter.view_xz()
    plotter.camera.zoom(1.2)
    img = plotter.screenshot(return_img=True)
    plotter.close()
    return img


def stl_to_2d(
    stl_paths: List[str],
    front_view: bool = True,
    side_view: bool = True,
) -> dict:
    """
    将 STL 文件列表合并为一个 mesh，分别渲染正位、侧位图，返回 base64 PNG。
    """
    try:
        import pyvista as pv
    except ImportError:
        return {
            "front_base64": None,
            "side_base64": None,
            "error": "pyvista not installed",
        }
    paths = [_decode_path(p) for p in stl_paths if p and os.path.isfile(_decode_path(p))]
    if not paths:
        return {"front_base64": None, "side_base64": None, "error": "No valid STL paths"}

    merged = None
    for p in paths:
        mesh = pv.read(p)
        if hasattr(mesh, "extract_surface"):
            mesh = mesh.extract_surface()
        if hasattr(mesh, "triangulate"):
            mesh = mesh.triangulate()
        if merged is None:
            merged = mesh
        else:
            merged = merged.merge(mesh, merge_points=True)
    if merged is None:
        return {"front_base64": None, "side_base64": None, "error": "No mesh"}

    out = {}
    if front_view:
        img = render_orthographic(merged, "front")
        buf = io.BytesIO()
        import cv2
        if len(img.shape) == 3:
            img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        else:
            img_bgr = img
        _, enc = cv2.imencode(".png", img_bgr)
        out["front_base64"] = base64.b64encode(enc.tobytes()).decode("ascii")
    if side_view:
        img = render_orthographic(merged, "side")
        import cv2
        if len(img.shape) == 3:
            img_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        else:
            img_bgr = img
        _, enc = cv2.imencode(".png", img_bgr)
        out["side_base64"] = base64.b64encode(enc.tobytes()).decode("ascii")
    return out
