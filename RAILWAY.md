# 直接用 Railway 部署

Railway 用 **PostgreSQL**。本仓库已默认使用 PostgreSQL，按下面做即可上线。

**管理员账号**：API 首次启动或执行 `npx prisma db seed` 后会创建默认管理员：
- 邮箱：`admin@example.com`
- 密码：`Admin123!`（上线后请尽快在应用内修改）

---

## 一、部署前

- `prisma/schema.prisma` 已为 `provider = "postgresql"`，无需再改。
- 保存后**提交并推送到 GitHub**（Railway 从 GitHub 拉代码）。

> 本地想用 MySQL 时：把 `provider` 改为 `mysql`，并把 `apps/api/.env` 的 `DATABASE_URL` 改为 MySQL 连接串。

---

## 二、Railway 控制台操作

### 1. 注册与项目

- 打开 https://railway.app ，用 GitHub 登录。
- 点 **New Project**。

### 2. 添加数据库

- 点 **New** → **Database** → **PostgreSQL**。
- 等创建好后，点进该 Postgres 服务 → **Variables**，复制 **DATABASE_URL**（后面给 API 用）。

### 3. 部署「算法服务」Algo

- 点 **New** → **GitHub Repo**，选你这个仓库（需先推到 GitHub）。
- 选好后，点进该服务 → **Settings**：
  - **Root Directory**：留空
  - **Dockerfile Path**：填 `apps/algo/Dockerfile`
  - **Watch Paths**（若有）：可填 `apps/algo/**`，改算法代码时再部署
- **Variables**：可不填，或加 `PYTHONUNBUFFERED=1`。
- 点 **Deploy** 等构建完成。
- 再点 **Settings** → **Networking** → **Generate Domain**，会得到一个公网地址（可选，API 用内网即可）。
- 记下该服务的**名称**（如 `algo`），后面 API 里用。

### 4. 部署「主后端」API

- 再点 **New** → **GitHub Repo**，还是选同一仓库。
- 进入该服务 **Settings**：
  - **Dockerfile Path**：`apps/api/Dockerfile`
  - **Watch Paths**（若有）：`apps/api/**`、`prisma/**`
- **Variables**（在 **Variables** 页签里添加）：

  | 变量名 | 值 |
  |--------|-----|
  | `DATABASE_URL` | 从第 2 步 Postgres 里复制的连接串 |
  | `JWT_SECRET` | 自己设一长串随机字符串（生产必改） |
  | `ALGO_SERVICE_URL` | `http://<algo 服务名>:8000`，例如本项目中 algo 服务名是 `algo` 就填 `http://algo:8000`（Railway 同项目内用服务名访问） |
  | `PORT` | `3001`（Railway 若自动注入则可省略） |
  | `CORS_ORIGIN` | 第 5 步 Web 的域名，如 `https://xxx.up.railway.app` |

- **Deploy** 等构建完成。
- **Networking** → **Generate Domain**，得到 API 的公网地址，例如：`https://xxx.up.railway.app`。  
  前端要请求的 API 根地址就是：`https://xxx.up.railway.app`（不要加 `/api`，代码里会加）。

### 5. 部署「前端」Web

- 再 **New** → **GitHub Repo**，同一仓库。
- **Settings**：
  - **Dockerfile Path**：`apps/web/Dockerfile`
  - **Watch Paths**（若有）：`apps/web/**`
- **Variables**：

  | 变量名 | 值 |
  |--------|-----|
  | `NEXT_PUBLIC_API_URL` | 第 4 步 API 的域名，如 `https://你的api服务.up.railway.app`（浏览器会直接请求这个地址，需和 API 的 CORS_ORIGIN 一致） |

- **Deploy** 等构建完成。
- **Networking** → **Generate Domain**，得到前端访问地址，如 `https://你的web服务.up.railway.app`。

### 6. 数据库表结构与管理员

- API 的 Dockerfile 已在启动时执行：迁移（或 db push）→ 执行 seed（创建默认管理员）→ 启动服务。无需在 Railway 再配 Custom Start Command。
- 默认管理员：`admin@example.com` / `Admin123!`，上线后请尽快修改密码。
- 若没有 Release Command，第一次部署完 API 后，在 Railway 里对该服务点 **…** → **Run Command**（或 One-off Job），执行：  
  `npx prisma migrate deploy --schema=./prisma/schema.prisma`  
  若没有迁移文件，可改为：  
  `npx prisma db push --schema=./prisma/schema.prisma`

---

## 三、汇总：最少要做的

1. 把 `prisma/schema.prisma` 的 `provider` 改成 `postgresql` 并推送到 GitHub。
2. Railway 新建项目 → 加 Postgres → 部署 3 个服务（algo、api、web），每个都选同一仓库、对应 Dockerfile 和变量。
3. API 的 `DATABASE_URL` 用 Postgres 的；`ALGO_SERVICE_URL` 用 `http://algo:8000`（或你的 algo 服务名）。
4. Web 的 `NEXT_PUBLIC_API_URL` 填 API 的域名；API 的 `CORS_ORIGIN` 填 Web 的域名。
5. 第一次部署完 API 后跑一次 `prisma migrate deploy` 或 `prisma db push`。

完成后，直接打开 Web 的域名即可使用；API 和 Algo 不一定要生成公网域名，只要 API 能访问到 Algo 即可（内网服务名）。

---

## 四、Algo 不暴露公网（推荐）

- Algo 服务不要点 **Generate Domain**，只让 API 通过 `ALGO_SERVICE_URL`（如 `http://algo:8000`）在 Railway 内网访问，更安全。
