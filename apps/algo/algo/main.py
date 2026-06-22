from __future__ import annotations

import base64
import os
from typing import List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .segmentation import postprocess_mask
from .sam_server import (
    decode_image_from_base64,
    encode_mask_to_base64,
    get_sam_checkpoint_path,
    predict_with_box,
)
from .planner_2d import (
    AStarPlanner3D,
    Calibration,
    MaskTransform,
    Path3DResult,
    Planner3DConfig,
    resample_daily_3d,
    path_length_3d_mm,
)
from .daily_steps import daily_steps_from_resampled_path

app = FastAPI(title="Ankle Planning Algo API", version="0.1.0")


class Plan2DRequest(BaseModel):
    front_image_path: Optional[str] = None
    side_image_path: Optional[str] = None
    front_ref_mask_path: Optional[str] = None
    front_mov_mask_path: Optional[str] = None
    side_ref_mask_path: Optional[str] = None
    side_mov_mask_path: Optional[str] = None
    front_mm_per_px: float = 1.0
    side_mm_per_px: float = 1.0
    start_mm: List[float] = [0.0, 0.0, 0.0]
    goal_mm: List[float] = [0.0, 0.0, 0.0]
    day_step_mm: float = 1.0


class Plan3DRequest(BaseModel):
    # 兼容旧字段：单个 STL 路径
    stl_path: Optional[str] = None
    # 新字段：多个 STL 路径（按原始坐标导入，保持相对位置）
    stl_paths: Optional[List[str]] = None
    stl_b64: Optional[List[str]] = None  # 分机部署时传 STL 文件内容（base64）
    # 起点/终点位姿（仅平移，mm），与 CT3D 逻辑一致
    start_t: Optional[List[float]] = None
    goal_t: Optional[List[float]] = None
    day_step_mm: float = 1.0


class Validate3DCollisionRequest(BaseModel):
    """校验多 mesh 在目标位姿下是否发生三角形级碰撞（与 CT3D 一致）"""
    # 同机部署可传本地路径；分机部署（如 API 在 Render、算法在 HF Space）必须传 stl_b64 文件内容
    stl_paths: Optional[List[str]] = None
    stl_b64: Optional[List[str]] = None
    target_poses: List[dict]  # [{"t": [x,y,z], "q": [w,x,y,z]}, ...]


class Plan3DMultiRequest(BaseModel):
    """与 CT3D 一致：参考固定，其余顺序 A*（体素+旋转），每日限制"""
    stl_paths: Optional[List[str]] = None
    stl_b64: Optional[List[str]] = None  # 分机部署时传 STL 文件内容（base64）
    ref_index: int  # 参考件在 stl_paths/stl_b64 中的下标
    start_poses: List[dict]  # [{"t": [x,y,z], "q": [w,x,y,z]}, ...]
    target_poses: List[dict]
    max_mm: float = 1.0
    max_deg: float = 1.0


def _materialize_stls(
    stl_paths: Optional[List[str]], stl_b64: Optional[List[str]]
) -> tuple[List[str], List[str]]:
    """解析 STL 来源：优先用 base64 内容写临时文件（API 与算法分机部署时唯一可行），
    否则回退到本地路径（同机部署）。返回 (可读取的路径列表, 需在请求结束后清理的临时文件列表)。"""
    if stl_b64:
        import tempfile

        tmp_paths: List[str] = []
        for i, b64 in enumerate(stl_b64):
            if not b64:
                continue
            data = base64.b64decode(b64)
            fd, p = tempfile.mkstemp(suffix=".stl", prefix=f"ankle_stl_{i}_")
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            tmp_paths.append(p)
        return tmp_paths, tmp_paths
    resolved = [_decode_path_if_garbled(p) for p in (stl_paths or []) if p]
    return resolved, []


def _cleanup_tmp(paths: List[str]) -> None:
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


def _decode_path_if_garbled(path: str) -> str:
    """若路径含中文被误解码为 GBK，尝试还原为 UTF-8 路径（Windows 下 API 传过来的路径可能乱码）"""
    if not path or os.path.isfile(path):
        return path
    try:
        fixed = path.encode("gbk").decode("utf-8")
        if os.path.isfile(fixed):
            return fixed
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return path


def _load_image(path: str) -> np.ndarray:
    path = _decode_path_if_garbled(path)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Image not found: {path}")
    try:
        with open(path, "rb") as f:
            data = np.frombuffer(f.read(), dtype=np.uint8)
    except OSError:
        data = np.fromfile(path, dtype=np.uint8)
    if data.size == 0:
        raise HTTPException(status_code=400, detail=f"Empty file: {path}")
    img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise HTTPException(status_code=400, detail=f"Decode failed: {path}")
    if img.ndim == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if img.dtype != np.uint8:
        img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    return img


def _load_mask(path: str, ref_shape: tuple) -> np.ndarray:
    path = _decode_path_if_garbled(path)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Mask not found: {path}")
    try:
        with open(path, "rb") as f:
            data = np.frombuffer(f.read(), dtype=np.uint8)
    except OSError:
        data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise HTTPException(status_code=400, detail=f"Mask decode failed: {path}")
    if img.shape != ref_shape:
        img = cv2.resize(img, (ref_shape[1], ref_shape[0]))
    return (img > 127).astype(bool)


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- SAM 分割（2D 工作台画框预测） ----------
class SegmentationPredictRequest(BaseModel):
    """图像 base64 + 矩形框 [x1,y1,x2,y2]"""
    image_base64: str
    box: List[int]  # [x1, y1, x2, y2]


class SegmentationCandidate(BaseModel):
    score: float
    mask_base64: str


@app.get("/segmentation/health")
def segmentation_health():
    """检查 SAM 是否可用（checkpoint 是否存在）。"""
    ckpt = get_sam_checkpoint_path()
    exists = os.path.isfile(ckpt)
    return {"available": exists, "checkpoint": ckpt}


@app.post("/segmentation/predict")
def segmentation_predict(req: SegmentationPredictRequest) -> dict:
    """SAM box 预测：返回多个候选 mask（base64 PNG）及 score。"""
    if len(req.box) != 4:
        raise HTTPException(status_code=400, detail="box 必须为 [x1,y1,x2,y2]")
    box_tuple = (int(req.box[0]), int(req.box[1]), int(req.box[2]), int(req.box[3]))
    try:
        rgb = decode_image_from_base64(req.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"图像解码失败: {e}")
    try:
        results = predict_with_box(rgb, box_tuple, multimask_output=True)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ImportError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    candidates = []
    for mask, score in results:
        try:
            b64 = encode_mask_to_base64(mask)
            candidates.append(SegmentationCandidate(score=score, mask_base64=b64))
        except Exception:
            continue
    return {"candidates": candidates}


# ---------- 掩码后处理（与 2dmax.py 完全一致：min_area_px=400, morph_k=3） ----------
class PostprocessMaskRequest(BaseModel):
    mask_base64: str


@app.post("/segmentation/postprocess-mask")
def postprocess_mask_endpoint(req: PostprocessMaskRequest) -> dict:
    """与 Python _apply_mask_to_role 一致：postprocess_mask(mask_raw, min_area_px=400, morph_k=3)。"""
    try:
        raw = base64.b64decode(req.mask_base64)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise HTTPException(status_code=400, detail="掩码解码失败")
        mask_bool = (img > 127).astype(bool)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        out = postprocess_mask(mask_bool, min_area_px=400, morph_k=3)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if np.count_nonzero(out) == 0:
        raise HTTPException(status_code=400, detail="掩码为空，后处理无有效区域")
    u8 = (out.astype(np.uint8)) * 255
    ok, buf = cv2.imencode(".png", u8)
    if not ok:
        raise HTTPException(status_code=500, detail="掩码编码失败")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return {"mask_base64": b64}


@app.post("/plan/2d")
def plan_2d(req: Plan2DRequest) -> dict:
    start = (req.start_mm[0], req.start_mm[1], req.start_mm[2])
    goal = (req.goal_mm[0], req.goal_mm[1], req.goal_mm[2])

    if not req.front_image_path or not req.side_image_path:
        return {
            "totalDistance": 0.0,
            "totalDays": 0,
            "dailySteps": [],
            "rawPath": [],
        }

    front_gray = _load_image(req.front_image_path)
    side_gray = _load_image(req.side_image_path)
    front_calib = Calibration(mm_per_px_x=req.front_mm_per_px, mm_per_px_y=req.front_mm_per_px)
    side_calib = Calibration(mm_per_px_x=req.side_mm_per_px, mm_per_px_y=req.side_mm_per_px)

    if req.front_ref_mask_path and req.front_mov_mask_path and req.side_ref_mask_path and req.side_mov_mask_path:
        front_ref = _load_mask(req.front_ref_mask_path, front_gray.shape)
        front_mov = _load_mask(req.front_mov_mask_path, front_gray.shape)
        side_ref = _load_mask(req.side_ref_mask_path, side_gray.shape)
        side_mov = _load_mask(req.side_mov_mask_path, side_gray.shape)
    else:
        # Fallback: use full image as single mask (no obstacle)
        hf, wf = front_gray.shape
        hs, ws = side_gray.shape
        front_ref = np.zeros((hf, wf), dtype=bool)
        front_mov = np.ones((hf, wf), dtype=bool)
        side_ref = np.zeros((hs, ws), dtype=bool)
        side_mov = np.ones((hs, ws), dtype=bool)

    cfg = Planner3DConfig(step_mm=0.5, neighbor26=True, edge_sample_mm=0.5, max_expand=300000)
    planner = AStarPlanner3D(
        front_rigid_mask=front_mov,
        front_obstacle_mask=front_ref,
        front_calib=front_calib,
        side_rigid_mask=side_mov,
        side_obstacle_mask=side_ref,
        side_calib=side_calib,
        cfg=cfg,
    )
    result = planner.plan(start, goal)
    if not result.ok:
        return {
            "totalDistance": 0.0,
            "totalDays": 0,
            "dailySteps": [],
            "rawPath": [],
            "message": result.message,
        }
    path_mm = result.path_mm
    daily_pts = resample_daily_3d(path_mm, day_step_mm=req.day_step_mm)
    daily_steps = daily_steps_from_resampled_path(daily_pts)
    raw_path = [[p[0], p[1], p[2]] for p in path_mm]
    return {
        "totalDistance": round(result.total_len_mm, 6),
        "totalDays": max(0, len(daily_pts) - 1),
        "dailySteps": daily_steps,
        "rawPath": raw_path,
    }


@app.post("/plan/3d")
def plan_3d(req: Plan3DRequest) -> dict:
    from .planner_3d import plan_3d_astar, subdivide_to_daily
    from .collision import PoseTR

    # 聚合所有 STL 路径（兼容旧的 stl_path）
    paths: List[str] = []
    if req.stl_paths:
        paths.extend(req.stl_paths)
    if req.stl_path:
        paths.append(req.stl_path)
    paths = [p for p in paths if p]

    if not paths:
        return {
            "totalDistance": 0.0,
            "totalDays": 0,
            "dailySteps": [],
            "rawPath": [],
        }
    try:
        import pyvista as pv

        # 逐个读取 STL，并在世界坐标系下合并为一个整体刚体，保持相对位置不变
        merged = None
        for raw_path in paths:
            p = _decode_path_if_garbled(raw_path)
            if not os.path.isfile(p):
                continue
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
            return {
                "totalDistance": 0.0,
                "totalDays": 0,
                "dailySteps": [],
                "rawPath": [],
            }

        moving_vtk = merged if hasattr(merged, "GetBounds") else merged.GetVTK()

        # 起点/终点平移（mm），默认与旧逻辑一致：start=[0,0,0], goal=[5,0,0]
        start_t = req.start_t if req.start_t and len(req.start_t) >= 3 else [0.0, 0.0, 0.0]
        goal_t = req.goal_t if req.goal_t and len(req.goal_t) >= 3 else [5.0, 0.0, 0.0]
        start = PoseTR(t=np.array(start_t[:3], dtype=float), q=np.array([1.0, 0.0, 0.0, 0.0], dtype=float))
        goal = PoseTR(t=np.array(goal_t[:3], dtype=float), q=start.q.copy())
        result = plan_3d_astar(start, goal, moving_vtk, [], voxel_mm=1.0, margin_mm=10.0)
        if not result.ok:
            return {
                "totalDistance": 0.0,
                "totalDays": 0,
                "dailySteps": [],
                "rawPath": [],
                "message": result.message,
            }
        path_sub = subdivide_to_daily(result.path, req.day_step_mm)
        raw_path = [[float(p.t[0]), float(p.t[1]), float(p.t[2])] for p in path_sub]
        daily_steps = daily_steps_from_resampled_path(
            [(float(p.t[0]), float(p.t[1]), float(p.t[2])) for p in path_sub]
        )
        return {
            "totalDistance": round(result.total_len_mm, 6),
            "totalDays": max(0, len(path_sub) - 1),
            "dailySteps": daily_steps,
            "rawPath": raw_path,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/plan/3d/validate-collision")
def validate_3d_collision(req: Validate3DCollisionRequest) -> dict:
    """校验多 STL 在目标位姿下是否发生三角形级碰撞（VTK CollisionDetectionFilter，与 CT3D 一致）"""
    from .collision import PoseTR, check_pair_collision_exact

    paths, _tmp = _materialize_stls(req.stl_paths, req.stl_b64)
    if len(paths) != len(req.target_poses):
        _cleanup_tmp(_tmp)
        raise HTTPException(
            status_code=400,
            detail=f"stl count ({len(paths)}) must match target_poses length ({len(req.target_poses)})",
        )
    if len(paths) < 2:
        _cleanup_tmp(_tmp)
        return {"collisions": []}

    try:
        import pyvista as pv

        polys = []
        poses = []
        for raw_path, pose_dict in zip(paths, req.target_poses):
            if not os.path.isfile(raw_path):
                raise HTTPException(status_code=400, detail=f"STL not found: {raw_path}")
            mesh = pv.read(raw_path)
            if hasattr(mesh, "extract_surface"):
                try:
                    mesh = mesh.extract_surface(algorithm="dataset_surface")
                except TypeError:
                    mesh = mesh.extract_surface()
            if hasattr(mesh, "triangulate"):
                mesh = mesh.triangulate()
            vtk_poly = mesh if hasattr(mesh, "GetBounds") else mesh.GetVTK()
            polys.append(vtk_poly)
            t = pose_dict.get("t") or [0, 0, 0]
            q = pose_dict.get("q") or [1.0, 0.0, 0.0, 0.0]
            poses.append(
                PoseTR(
                    t=np.array(t[:3], dtype=float),
                    q=np.array(q[:4], dtype=float),
                )
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Load STL: {e}")
    finally:
        _cleanup_tmp(_tmp)

    if len(polys) < 2:
        return {"collisions": []}

    collisions = []
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            if check_pair_collision_exact(polys[i], poses[i], polys[j], poses[j]):
                collisions.append([i, j])
    return {"collisions": collisions}


def _pose_to_dict(pose) -> dict:
    return {"t": [float(pose.t[0]), float(pose.t[1]), float(pose.t[2])], "q": [float(pose.q[0]), float(pose.q[1]), float(pose.q[2]), float(pose.q[3])]}


@app.post("/plan/3d/multi")
def plan_3d_multi(req: Plan3DMultiRequest) -> dict:
    """与 CT3D 完全一致：参考固定，其余顺序体素 A*（平移+旋转），shortcut/nudge，每日 max_mm/max_deg 细分"""
    import traceback

    from .planner_3d_ct3d import generate_plan_multi
    from .collision import PoseTR

    paths, _tmp = _materialize_stls(req.stl_paths, req.stl_b64)
    if req.ref_index < 0 or req.ref_index >= len(paths):
        _cleanup_tmp(_tmp)
        raise HTTPException(status_code=400, detail="ref_index 越界")
    if len(paths) != len(req.start_poses) or len(paths) != len(req.target_poses):
        _cleanup_tmp(_tmp)
        raise HTTPException(status_code=400, detail="stl 数量与 start_poses/target_poses 长度须一致")
    if len(paths) < 2:
        _cleanup_tmp(_tmp)
        raise HTTPException(status_code=400, detail="至少需要 2 个 STL")

    try:
        import pyvista as pv

        polys = []
        centers = []
        start_poses = []
        target_poses = []
        for raw_path, sp, tp in zip(paths, req.start_poses, req.target_poses):
            if not os.path.isfile(raw_path):
                raise HTTPException(status_code=400, detail=f"STL not found: {raw_path}")
            mesh = pv.read(raw_path)
            if hasattr(mesh, "extract_surface"):
                try:
                    mesh = mesh.extract_surface(algorithm="dataset_surface")
                except TypeError:
                    mesh = mesh.extract_surface()
            if hasattr(mesh, "triangulate"):
                mesh = mesh.triangulate()
            vtk_poly = mesh if hasattr(mesh, "GetBounds") else mesh.GetVTK()
            polys.append(vtk_poly)
            # pyvista DataSet.center is a property (x,y,z)
            c = getattr(mesh, "center", (0.0, 0.0, 0.0))
            centers.append(np.array(c, dtype=float))
            start_poses.append(
                PoseTR(
                    t=np.array((sp.get("t") or [0, 0, 0])[:3], dtype=float),
                    q=np.array((sp.get("q") or [1, 0, 0, 0])[:4], dtype=float),
                )
            )
            target_poses.append(
                PoseTR(
                    t=np.array((tp.get("t") or [0, 0, 0])[:3], dtype=float),
                    q=np.array((tp.get("q") or [1, 0, 0, 0])[:4], dtype=float),
                )
            )

        result = generate_plan_multi(
            ref_index=req.ref_index,
            polys=polys,
            centers=centers,
            start_poses=start_poses,
            target_poses=target_poses,
            max_mm=req.max_mm,
            max_deg=req.max_deg,
            names=[str(i) for i in range(len(polys))],
        )
        if result is None:
            raise HTTPException(status_code=500, detail="规划失败（某骨无碰撞路径或细分后碰撞）")

        plan_paths = {k: [_pose_to_dict(p) for p in v] for k, v in result["plan_paths"].items()}
        plan_start_poses = {k: _pose_to_dict(v) for k, v in result["plan_start_poses"].items()}
        plan_goal_poses = {k: _pose_to_dict(v) for k, v in result["plan_goal_poses"].items()}
        return {
            "plan_paths": plan_paths,
            "plan_offsets": result["plan_offsets"],
            "plan_steps": result["plan_steps"],
            "plan_order": result["plan_order"],
            "plan_total_days": result["plan_total_days"],
            "plan_start_poses": plan_start_poses,
            "plan_goal_poses": plan_goal_poses,
            "plan_infos": result["plan_infos"],
            "total_cost": result["total_cost"],
        }
    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        detail = f"{e!s}\n\n{tb}"
        raise HTTPException(status_code=500, detail=detail)
    finally:
        _cleanup_tmp(_tmp)


class RatioBallRequest(BaseModel):
    image_path: Optional[str] = None
    image_base64: Optional[str] = None


class StlTo2DRequest(BaseModel):
    case_id: Optional[str] = None
    stl_paths: Optional[List[str]] = None


@app.post("/ratio-ball")
def ratio_ball(req: RatioBallRequest) -> dict:
    """比例球识别：YOLO/Hough 圆检测，参考球 20mm，返回 mm_per_px、圆心、直径。"""
    from .ratio_ball import ratio_ball_detect
    yolo_path = os.environ.get("YOLO_MODEL_PATH") or os.path.join(os.path.dirname(__file__), "..", "weights", "ball.pt")
    try:
        return ratio_ball_detect(
            image_path=req.image_path,
            image_base64=req.image_base64,
            yolo_model_path=yolo_path if os.path.isfile(yolo_path) else None,
        )
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/stl-to-2d")
def stl_to_2d(req: StlTo2DRequest) -> dict:
    """STL 三维转二维：正位图、侧位图 base64。"""
    from .stl_to_2d import stl_to_2d as _stl_to_2d
    stl_paths = req.stl_paths or []
    if not stl_paths and req.case_id:
        # 若只传 case_id，由调用方（Nest）解析 case 下 STL 路径后传 stl_paths；此处不支持直接查库
        raise HTTPException(status_code=400, detail="Provide stl_paths or ensure API layer passes resolved paths")
    try:
        return _stl_to_2d(stl_paths=stl_paths, front_view=True, side_view=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
