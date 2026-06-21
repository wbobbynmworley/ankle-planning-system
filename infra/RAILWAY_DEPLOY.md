# Railway 部署步骤

## 1. 准备

- 在 [Railway](https://railway.app) 注册并创建新项目。
- 安装 Railway CLI（可选）：`npm i -g @railway/cli`，`railway login`。

## 2. 添加 PostgreSQL

- 在项目中点击 **New** → **Database** → **PostgreSQL**。
- 创建后记下 `DATABASE_URL`（在 Variables 中）。

## 3. 部署服务

建议为每个服务创建单独 Service，并从同一仓库根目录用不同 Dockerfile 构建。

### 3.1 算法服务 (algo)

- **New** → **GitHub Repo** 选择本仓库。
- **Settings** → **Root Directory** 留空；**Dockerfile Path** 填 `apps/algo/Dockerfile`。
- **Settings** → **Build**：Build Command 留空（用 Docker 构建）；Start Command 留空（用 Dockerfile CMD）。
- 若构建上下文为仓库根目录，在 **Settings** 中设置 **Docker Build Context** 为仓库根（或使用 Monorepo 配置）。
- Railway 会从根构建：在 **Settings** → **Dockerfile Path** 填 `apps/algo/Dockerfile`，并确认 **Root Directory** 为 `/` 或留空以便 context 为根目录。
- 添加变量：无必须（可选 `PYTHONUNBUFFERED=1`）。
- 部署后记下 **Internal URL**（如 `http://algo.railway.internal:8000`），供 API 使用。

### 3.2 主 API (api)

- **New** → **GitHub Repo** 同一仓库。
- **Dockerfile Path**: `apps/api/Dockerfile`。
- **Variables**：
  - `DATABASE_URL` = 从 PostgreSQL 服务复制的连接串。
  - `JWT_SECRET` = 随机长字符串（生产必须更换）。
  - `ALGO_SERVICE_URL` = algo 的内部地址（如 `http://algo.railway.internal:8000` 或 Railway 分配的服务名）。
  - `FILE_STORAGE_PATH` = `/app/storage`（容器内持久化目录，若用 Volume 可挂载）。
  - `PORT` = `3001`（若 Railway 自动注入则可不设）。
- 部署后执行迁移：在 **Settings** → **Deploy** 中可添加 **Post Deploy Command**：  
  `npx prisma migrate deploy --schema=./prisma/schema.prisma`（需在 Dockerfile 中把 prisma 拷入并安装 prisma CLI，或单独跑一次 Job）。

### 3.3 前端 (web)

- **New** → **GitHub Repo** 同一仓库。
- **Dockerfile Path**: `apps/web/Dockerfile`。
- **Variables**：
  - `NEXT_PUBLIC_API_URL` = 对外的 API 地址（如 `https://your-api.up.railway.app/api`），用于浏览器请求。
- 若 API 与 Web 同域由 Nginx 代理，可设为相对路径 `/api`。

### 3.4 Nginx（可选）

- 若希望单域名对外，可在 Railway 再起一个 Service，用 Nginx 镜像，挂载 `infra/nginx.conf`，将 `/` 代理到 web，`/api` 代理到 api。或使用 Railway 的 **Public Networking** 为 api、web 分别生成域名，前端通过 `NEXT_PUBLIC_API_URL` 指向 api 域名。

## 4. 环境变量汇总

| 服务 | 变量 | 说明 |
|------|------|------|
| postgres | (自动) | DATABASE_URL 供 api 使用 |
| api | DATABASE_URL | 来自 Postgres 服务 |
| api | JWT_SECRET | 生产随机密钥 |
| api | ALGO_SERVICE_URL | algo 内部 URL |
| api | FILE_STORAGE_PATH | 文件存储路径 |
| api | CORS_ORIGIN | 前端域名（如 https://xxx.up.railway.app） |
| web | NEXT_PUBLIC_API_URL | 浏览器请求的 API 根地址 |
| algo | (可选) | PYTHONUNBUFFERED=1 |

## 5. 迁移与健康检查

- **Prisma 迁移**：在 api 镜像中已包含 prisma，可在 Dockerfile 的 CMD 前加一步 `npx prisma migrate deploy`，或使用 Railway 的 **One-off Job** 从 api 镜像执行同一命令。
- **健康检查**：api 可暴露 `/api` 根或自定义 health；algo 有 `/health`。在 Railway 的 **Settings** → **Health Check** 中配置路径与端口。

## 6. 安全与网络

- algo 不对外暴露公网，仅通过 ALGO_SERVICE_URL 由 api 内网调用。
- 生产环境务必设置强 `JWT_SECRET`、限制 `CORS_ORIGIN`、使用 HTTPS（Railway 默认提供）。
