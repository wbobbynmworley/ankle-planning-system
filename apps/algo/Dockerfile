# 自包含 Dockerfile：构建上下文 = apps/algo 目录。
# 可直接用于 Hugging Face Docker Space（把 apps/algo 整个目录作为 Space 仓库根）。
FROM python:3.11-slim

WORKDIR /app

# VTK / PyVista / OpenCV 运行所需的系统库（headless 渲染）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libxrender1 \
    libxext6 \
    libsm6 \
    && rm -rf /var/lib/apt/lists/*

# 先装 CPU 版 torch，避免默认拉取数 GB 的 CUDA 轮子（免费云端只有 CPU）
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY algo ./algo

# 免费部署默认轻量模型 + 首次预测自动下载 checkpoint（不把 2.4GB 文件打进镜像）
ENV SAM_MODEL_TYPE=vit_b \
    PYTHONUNBUFFERED=1

EXPOSE 8000
# 平台（Railway / HF Space 等）可注入 PORT；默认 8000
CMD ["sh", "-c", "uvicorn algo.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
