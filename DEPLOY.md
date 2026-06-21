# 足踝畸形矫正系统 - 完整部署步骤与命令

**当前默认：本机本地运行，访问 http://localhost:3000。** 详见 [本地部署说明.md](./本地部署说明.md)。

---

## 一、本地开发（需本机 Node 18+、Python 3、PostgreSQL）

### 1.1 一键准备环境（推荐）

```bat
# 在项目根目录执行
setup.bat
```

会依次：创建 `apps/api/.env`、安装 API/Web 依赖、Prisma 生成与迁移、执行 seed（创建管理员）、安装 Algo 依赖。

### 1.2 手动命令（与 setup.bat 等价）

```bat
cd /d "项目根目录"

REM 1) 创建 API 环境变量（若无 .env）
echo DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ankle> apps\api\.env
echo JWT_SECRET=change-me-in-production>> apps\api\.env
echo ALGO_SERVICE_URL=http://localhost:8000>> apps\api\.env

REM 2) 安装依赖
cd apps\api && npm install && npx prisma generate --schema=..\..\prisma\schema.prisma
cd ..\..
cd apps\web && npm install
cd ..\..
cd apps\algo && python -m pip install -r requirements.txt
cd ..\..

REM 3) 数据库（需先启动 PostgreSQL，并创建库 ankle）
cd apps\api
npx prisma migrate deploy --schema=..\..\prisma\schema.prisma
npx prisma db seed --schema=..\..\prisma\schema.prisma
cd ..\..
```

### 1.3 启动本地服务

```bat
start.bat
```

或分别开三个终端：

```bat
REM 终端 1 - API（需先设置 DATABASE_URL）
cd apps\api
set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ankle
npm run start:dev

REM 终端 2 - Web
cd apps\web
npm run dev

REM 终端 3 - Algo
cd apps\algo
uvicorn algo.main:app --reload --host 0.0.0.0 --port 8000
```

浏览器访问：**http://localhost:3000**  
默认管理员：**admin@example.com** / **Admin123!**

---

## 二、本地 Docker 一键部署（需本机 Docker）

在项目根目录执行：

```bat
cd infra
docker compose up -d --build
```

- 首次会构建并启动：PostgreSQL、Algo、API、Web、Nginx。
- 访问：**http://localhost**（80 端口，由 Nginx 反向代理到 Web 与 API）。

环境变量已在 `infra/docker-compose.yml` 中配置；API 启动时会自动执行迁移和 seed，管理员账号同上。

停止：

```bat
cd infra
docker compose down
```

---

## 三、Railway 云端部署

### 3.1 前置条件

- GitHub 账号，仓库已推送到 GitHub。
- Railway 账号：https://railway.app ，用 GitHub 登录。

### 3.2 步骤与命令汇总

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | Railway → **New Project** | 新建项目 |
| 2 | **New** → **Database** → **PostgreSQL** | 创建数据库，复制 **DATABASE_URL** |
| 3 | **New** → **GitHub Repo** → 选本仓库 | 部署 Algo |
| 4 | Algo 服务 **Settings**：Dockerfile Path = `apps/algo/Dockerfile` | 构建路径 |
| 5 | Algo **Deploy** → **Networking** 可选 **Generate Domain** | 记下服务名（如 `algo`） |
| 6 | 再 **New** → **GitHub Repo**（同一仓库） | 部署 API |
| 7 | API **Settings**：Dockerfile Path = `apps/api/Dockerfile` | |
| 8 | API **Variables** 见下表 | 必填 |
| 9 | API **Deploy** → **Networking** → **Generate Domain** | 得到 API 公网地址 |
| 10 | 再 **New** → **GitHub Repo**（同一仓库） | 部署 Web |
| 11 | Web **Settings**：Dockerfile Path = `apps/web/Dockerfile` | |
| 12 | Web **Variables**：`NEXT_PUBLIC_API_URL` = API 的域名 | |
| 13 | Web **Deploy** → **Networking** → **Generate Domain** | 得到前端访问地址 |

### 3.3 API 环境变量（Railway Variables）

| 变量名 | 值 |
|--------|-----|
| `DATABASE_URL` | 第 2 步 Postgres 的 **DATABASE_URL** |
| `JWT_SECRET` | 生产环境用长随机字符串 |
| `ALGO_SERVICE_URL` | `http://algo:8000`（或你的 Algo 服务名） |
| `PORT` | `3001`（若 Railway 自动注入可省略） |
| `CORS_ORIGIN` | Web 的域名，如 `https://你的web服务.up.railway.app` |

### 3.4 Web 环境变量

| 变量名 | 值 |
|--------|-----|
| `NEXT_PUBLIC_API_URL` | API 的域名，如 `https://你的api服务.up.railway.app` |

### 3.5 部署后

- 表结构与管理员：API 容器启动时已执行 **迁移 + seed**，无需再配启动命令。
- 默认管理员：**admin@example.com** / **Admin123!**，上线后请尽快修改密码。
- 若首次未自动迁移，可在 API 服务中 **Run Command** 执行：
  ```bash
  npx prisma migrate deploy --schema=./prisma/schema.prisma
  ```
  或（无迁移文件时）：
  ```bash
  npx prisma db push --schema=./prisma/schema.prisma
  npx prisma db seed
  ```

---

## 四、本机可自动执行的命令

以下在**项目根目录**执行（若路径含中文导致 PowerShell 报错，请在资源管理器中右键项目根目录选「在终端中打开」再用 CMD 或 PowerShell 执行）：

```bat
npm install
cd apps\api
npm install
npx prisma generate --schema=..\..\prisma\schema.prisma
cd ..\web
npm install
cd ..\..
```

**助手已代为执行**：根目录与 `apps/api` 的 `npm install`、`apps/api` 的 `npx prisma generate`。你可再在本地执行 `apps\web` 的 `npm install`（或直接运行 `setup.bat` 做完整准备）。

**本地 Docker 一键部署**（需已安装 Docker）：

```bat
cd infra
docker compose up -d --build
```

---

## 五、快速对照

| 场景 | 主要命令 | 访问地址 |
|------|----------|----------|
| 本地开发 | `setup.bat` → `start.bat` | http://localhost:3000 |
| 本地 Docker | `cd infra && docker compose up -d --build` | http://localhost |
| Railway | 按第三节在控制台添加 3 个服务 + 变量 | Web 生成的域名 |

管理员账号（三种部署方式一致）：**admin@example.com** / **Admin123!**
