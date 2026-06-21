# SAM (Segment Anything) 预测服务：相对路径加载 checkpoint，便于迁移部署
from __future__ import annotations

import base64
import os
from typing import Any, List, Optional, Tuple

import cv2
import numpy as np


def _project_root() -> str:
    """项目根目录（足踝畸形矫正）：从 apps/algo/algo 向上三级。"""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


# 不同 SAM 模型大小：vit_h(2.4GB,精度最高) / vit_l(1.2GB) / vit_b(375MB,适合免费部署)
# 通过环境变量 SAM_MODEL_TYPE 切换，免费云端建议用 vit_b 以降低内存与冷启动下载量。
SAM_MODEL_TYPE = os.environ.get("SAM_MODEL_TYPE", "vit_h").strip().lower()

_DEFAULT_CKPT_FILENAME = {
    "vit_h": "sam_vit_h_4b8939.pth",
    "vit_l": "sam_vit_l_0b3195.pth",
    "vit_b": "sam_vit_b_01ec64.pth",
}
_DEFAULT_CKPT_URL = {
    "vit_h": "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
    "vit_l": "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth",
    "vit_b": "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
}


def _default_checkpoint_path() -> str:
    """默认 checkpoint 相对项目根目录，文件名随 SAM_MODEL_TYPE 变化，便于整体移动部署。"""
    root = _project_root()
    fname = _DEFAULT_CKPT_FILENAME.get(SAM_MODEL_TYPE, "sam_vit_h_4b8939.pth")
    return os.path.join(root, fname)


def get_sam_checkpoint_path() -> str:
    """优先使用环境变量 SAM_CHECKPOINT，否则为项目根下与模型类型匹配的默认 checkpoint。"""
    env = os.environ.get("SAM_CHECKPOINT", "").strip()
    if env:
        if os.path.isabs(env):
            return env
        return os.path.abspath(os.path.join(_project_root(), env))
    return _default_checkpoint_path()


def _ensure_checkpoint(ckpt: str) -> None:
    """免费云端部署：若 checkpoint 不存在，则按 SAM_CHECKPOINT_URL（或模型类型默认地址）下载。"""
    if os.path.isfile(ckpt):
        return
    url = os.environ.get("SAM_CHECKPOINT_URL", "").strip() or _DEFAULT_CKPT_URL.get(SAM_MODEL_TYPE, "")
    if not url:
        return
    import urllib.request

    os.makedirs(os.path.dirname(ckpt) or ".", exist_ok=True)
    tmp = ckpt + ".part"
    print(f"[SAM] downloading checkpoint ({SAM_MODEL_TYPE}) from {url} ...", flush=True)
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, ckpt)
    print(f"[SAM] checkpoint ready: {ckpt}", flush=True)

_predictor: Any = None
_loaded_image_id: Optional[str] = None
_embedding_ready = False


def _get_predictor():
    global _predictor
    if _predictor is not None:
        return _predictor
    ckpt = get_sam_checkpoint_path()
    _ensure_checkpoint(ckpt)
    if not os.path.isfile(ckpt):
        raise FileNotFoundError(
            f"SAM checkpoint 未找到: {ckpt}\n"
            f"请将对应 checkpoint 放在项目根目录，或设置环境变量 SAM_CHECKPOINT 指向该文件，\n"
            f"或设置 SAM_CHECKPOINT_URL 让服务自动下载（免费云端部署推荐 SAM_MODEL_TYPE=vit_b）。"
        )
    try:
        import torch
        from segment_anything import SamPredictor, sam_model_registry
    except ImportError as e:
        raise ImportError(
            "请安装 SAM 依赖。在项目根目录或 apps/algo 下执行:\n"
            "  pip install -r apps/algo/requirements.txt\n"
            "或仅 SAM: pip install torch segment-anything"
        ) from e
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=ckpt)
    sam.to(device=device)
    _predictor = SamPredictor(sam)
    return _predictor


def set_image(rgb: np.ndarray) -> None:
    """设置当前图像并计算 embedding。rgb: (H,W,3) uint8。"""
    global _loaded_image_id, _embedding_ready
    pred = _get_predictor()
    img_id = id(rgb)
    if _loaded_image_id == img_id and _embedding_ready:
        return
    pred.set_image(rgb)
    _loaded_image_id = img_id
    _embedding_ready = True


def predict_with_box(
    rgb: np.ndarray,
    box_xyxy: Tuple[int, int, int, int],
    multimask_output: bool = True,
) -> List[Tuple[np.ndarray, float]]:
    """
    使用 box 提示做 SAM 预测。
    rgb: (H,W,3) uint8
    box_xyxy: (x1, y1, x2, y2)
    返回: [(mask_bool, score), ...]，按 score 降序。
    """
    set_image(rgb)
    pred = _get_predictor()
    h, w = rgb.shape[:2]
    x1, y1, x2, y2 = box_xyxy
    x1, x2 = max(0, min(x1, w - 1)), max(0, min(x2, w - 1))
    y1, y2 = max(0, min(y1, h - 1)), max(0, min(y2, h - 1))
    if x1 >= x2 or y1 >= y2:
        return []
    sam_box = np.array([x1, y1, x2, y2], dtype=np.float32)
    masks, scores, _ = pred.predict(
        point_coords=None,
        point_labels=None,
        box=sam_box,
        multimask_output=multimask_output,
    )
    out = []
    for i in range(masks.shape[0]):
        out.append((masks[i].astype(bool), float(scores[i])))
    out.sort(key=lambda x: x[1], reverse=True)
    return out


def decode_image_from_base64(b64: str) -> np.ndarray:
    """Base64 解码为 RGB (H,W,3) uint8。"""
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("无法解码图像")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2RGB)
    else:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img


def encode_mask_to_base64(mask: np.ndarray) -> str:
    """Bool mask (H,W) 转为 PNG base64。"""
    u8 = (mask.astype(np.uint8)) * 255
    ok, buf = cv2.imencode(".png", u8)
    if not ok:
        raise ValueError("掩码编码失败")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def decode_mask_from_base64(b64: str, shape_hw: Tuple[int, int]) -> np.ndarray:
    """PNG base64 解码为 bool mask。"""
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("无法解码掩码")
    if (img.shape[0], img.shape[1]) != shape_hw:
        img = cv2.resize(img, (shape_hw[1], shape_hw[0]))
    return (img > 127).astype(bool)
