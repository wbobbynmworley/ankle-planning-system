# 足踝规划 Algo 服务

## SAM 分割（2D 工作台）

- **Checkpoint 位置（相对路径，便于迁移）**：默认从**项目根目录**读取 `sam_vit_h_4b8939.pth`。  
  即：将 `sam_vit_h_4b8939.pth` 放在与 `apps` 同级目录下即可，整体移动项目时无需改配置。
- **自定义路径**：可设置环境变量 `SAM_CHECKPOINT`：
  - 绝对路径：直接使用；
  - 相对路径：相对于项目根目录解析。
- **启动**：在 `apps/algo` 下执行 `start-algo.bat` 或：
  ```bash
  python -m pip install -r requirements.txt
  python -m uvicorn algo.main:app --host 0.0.0.0 --port 8000
  ```
- **依赖**：`requirements.txt` 已包含 `torch` 与 `segment-anything`。**首次使用前必须安装**：
  ```bash
  cd apps/algo
  pip install -r requirements.txt
  ```
  若出现 503「请安装 SAM 依赖」，即未安装或未激活上述环境。

## 接口

- `GET /health`：服务存活
- `GET /segmentation/health`：SAM 是否可用（checkpoint 是否存在）
- `POST /segmentation/predict`：Body `{ "image_base64": "...", "box": [x1,y1,x2,y2] }`，返回 `{ "candidates": [ { "score": float, "mask_base64": "..." } ] }`
- `POST /plan/2d`、`POST /plan/3d`：规划接口
