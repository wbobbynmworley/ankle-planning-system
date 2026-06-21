---
title: Ankle Algo
emoji: 🦶
colorFrom: teal
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
---

# 足踝矫正算法服务（Hugging Face Docker Space）

把 `apps/algo` 整个目录作为一个 Hugging Face **Docker Space** 仓库的根：

1. 在 https://huggingface.co/new-space 新建 Space，SDK 选 **Docker**（Blank）。
2. 将本目录（`apps/algo`）下的全部文件推送到该 Space 仓库根，并把**本文件改名为 `README.md`**（HF 需要带上面 frontmatter 的 README.md，其中 `app_port: 8000` 必须保留）。
3. Space 会自动用根目录的 `Dockerfile` 构建并运行。
4. 在 Space 的 **Settings → Variables** 里按需设置：
   - `SAM_MODEL_TYPE=vit_b`（免费 CPU 推荐；首次预测会自动下载 ~375MB checkpoint）
   - 如需更高精度可用 `vit_h`，但内存与冷启动下载更大。

启动后服务地址形如 `https://<用户名>-<space名>.hf.space`，把它填入 Render 后端的 `ALGO_SERVICE_URL`。

> 免费 Space 闲置会休眠，首次请求需等待冷启动；SAM 推理在 CPU 上单张约数十秒，属正常。
