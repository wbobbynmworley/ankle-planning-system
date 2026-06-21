# Railway 上 Railway 完整步骤

按顺序做完下面步骤即可在 Railway 上跑通整个系统。

---

## 第 0 步：部署前（本地完成）

1. 确认本仓库已推送到 **GitHub**（Railway 从 GitHub 拉代码）。
2. 确认 `prisma/schema.prisma` 里是 **`provider = "postgresql"`**（本项目已默认，一般不用改）。

---

## 第 1 步：打开 Railway 并建项目

1. 打开浏览器访问：**https://railway.app**
2. 用 **GitHub** 登录。
3. 点击 **New Project**（新建项目）。

---

## 第 2 步：添加 PostgreSQL 数据库

1. 在项目里点击 **New**。
2. 选择 **Database** → **PostgreSQL**。
3. 等数据库创建完成（几秒到几十秒）。
4. 点进这个 **PostgreSQL 服务**（卡片或左侧列表）。
5. 打开 **Variables** 页签。
6. 找到 **DATABASE_URL**，点击复制（或复制整段连接串），**保存到记事本**，后面给 API 用。

---

## 第 3 步：部署「算法服务」Algo

1. 在项目里再点 **New**。
2. 选择 **GitHub Repo**。
3. 选择你这个**足踝畸形矫正**的仓库（若未出现，先到 GitHub 授权 Railway 访问该仓库）。
4. 选好后会生成一个服务，点进这个服务。
5. 打开 **Settings**：
   - **Root Directory**：留空（不填）。
   - **Dockerfile Path**：填 **`apps/algo/Dockerfile`**
   - 若有 **Watch Paths**：可填 **`apps/algo/**`**（可选，用于改代码时自动重新部署）。
6. 打开 **Variables**：可不填，或加一条 **`PYTHONUNBUFFERED`** = **`1`**（可选）。
7. 点 **Deploy**（或等自动部署），等构建完成。
8. 打开 **Settings** → **Networking**：
   - **不要**点 Generate Domain（推荐：Algo 只在内网给 API 用，不暴露公网）。
9. 记下这个服务的**名称**（在服务卡片或 Settings 里能看到，一般是 **`algo`** 或你起的名字），后面 API 的 `ALGO_SERVICE_URL` 要用。

---

## 第 4 步：部署「主后端」API

1. 再点 **New** → **GitHub Repo**，仍然选**同一个仓库**。
2. 点进这个新服务（API）。
3. 打开 **Settings**：
   - **Dockerfile Path**：填 **`apps/api/Dockerfile`**
   - 若有 **Watch Paths**：可填 **`apps/api/**`** 和 **`prisma/**`**
4. 打开 **Variables**，点击 **Add Variable** 或 **Bulk Add**，添加下面所有变量（值按说明填）：

   | 变量名 | 值（说明） |
   |--------|------------|
   | **DATABASE_URL** | 第 2 步复制的 PostgreSQL 的 **DATABASE_URL**（整段粘贴） |
   | **JWT_SECRET** | 自己设一长串随机字符串，例如：`MyProductionJwtSecret2024ChangeMe`（生产环境必改） |
   | **ALGO_SERVICE_URL** | 填 **`http://algo:8000`**（若第 3 步服务名不是 `algo`，把 `algo` 改成你的 Algo 服务名） |
   | **PORT** | **`3001`**（若 Railway 自动注入 PORT 可省略） |
   | **CORS_ORIGIN** | 先留空或随便填，第 5 步部署完 Web 拿到域名后再回来改成 Web 的域名（见下） |

5. 点 **Deploy**，等构建、启动完成。
6. 打开 **Settings** → **Networking** → **Generate Domain**，生成一个公网域名，例如：`https://xxx-production-xxxx.up.railway.app`。
7. **复制这个 API 的域名**，保存到记事本（后面给 Web 用；并且要回到 **Variables** 里把 **CORS_ORIGIN** 改成第 5 步的 Web 域名）。

**说明**：API 启动时会自动执行数据库迁移和 seed，默认管理员账号会自动创建。

---

## 第 5 步：部署「前端」Web

1. 再点 **New** → **GitHub Repo**，还是选**同一个仓库**。
2. 点进这个新服务（Web）。
3. 打开 **Settings**：
   - **Dockerfile Path**：填 **`apps/web/Dockerfile`**
   - 若有 **Watch Paths**：可填 **`apps/web/**`**
4. 打开 **Variables**，添加：

   | 变量名 | 值 |
   |--------|-----|
   | **NEXT_PUBLIC_API_URL** | 第 4 步复制的 **API 的域名**，例如：`https://xxx-production-xxxx.up.railway.app`（不要加 `/api`） |

5. 点 **Deploy**，等构建完成。
6. 打开 **Settings** → **Networking** → **Generate Domain**，得到前端的公网地址，例如：`https://yyy-production-yyyy.up.railway.app`。
7. **复制这个 Web 的域名**。

---

## 第 6 步：把 CORS 和 API 地址对上（重要）

1. 回到 **API 服务** → **Variables**。
2. 把 **CORS_ORIGIN** 改成第 5 步的 **Web 域名**（例如 `https://yyy-production-yyyy.up.railway.app`），保存。
3. Railway 会自动重新部署 API；等部署完成即可。

这样浏览器访问 Web 时，请求 API 不会被 CORS 拦截。

---

## 第 7 步：验证与登录

1. 在浏览器打开第 5 步得到的 **Web 域名**（例如 `https://yyy-production-yyyy.up.railway.app`）。
2. 用默认管理员登录：
   - 邮箱：**admin@example.com**
   - 密码：**Admin123!**
3. 若能登录并看到后台，说明部署成功。**上线后请尽快在应用内修改该管理员密码。**

---

## 若 API 首次启动没有自动建表

若打开 Web 发现接口报错、数据库相关错误，可能是迁移没跑。在 Railway 里对 **API 服务**：

1. 点服务右侧 **…**（或 **More**）→ **Run Command**（或 **One-off Job**）。
2. 命令填：  
   **`npx prisma migrate deploy --schema=./prisma/schema.prisma`**  
   执行一次。
3. 若提示没有迁移文件，可改为：  
   **`npx prisma db push --schema=./prisma/schema.prisma`**  
   再执行：  
   **`npx prisma db seed`**

---

## 汇总：你要填的 3 个关键值

| 填在哪里 | 变量/用途 | 值从哪来 |
|----------|-----------|----------|
| API → Variables | **DATABASE_URL** | 第 2 步 Postgres 的 Variables 里复制 |
| API → Variables | **ALGO_SERVICE_URL** | 填 `http://algo:8000`（或你的 Algo 服务名） |
| API → Variables | **CORS_ORIGIN** | 第 5 步 Web 的域名 |
| Web → Variables | **NEXT_PUBLIC_API_URL** | 第 4 步 API 的域名 |

按上面步骤做完，即可在 Railway 上完整跑通；日常访问只记 **Web 的域名** 即可。
