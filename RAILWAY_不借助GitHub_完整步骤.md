# Railway 部署完整步骤（不借助 GitHub，仅用本机 + Railway 控制台）

用 **Railway CLI** 从本机直接上传代码部署，无需把仓库推到 GitHub。

---

## 前置准备

- 本机已安装 **Node.js 18+**（用于安装 Railway CLI）。
- 项目目录已准备好（`prisma/schema.prisma` 为 `provider = "postgresql"`，本项目默认已是）。

---

## 一、安装并登录 Railway CLI

在**任意终端**执行：

```bash
# 安装 CLI（任选一种）
npm install -g @railway/cli
# 或
corepack enable
pnpm add -g @railway/cli
```

登录（会打开浏览器）：

```bash
railway login
```

---

## 二、在项目根目录创建 Railway 项目并加数据库

在**项目根目录**（包含 `apps`、`prisma` 的目录）执行：

```bash
cd /d "你的项目根目录路径"
```

**方式 A：全新项目（推荐）**

```bash
# 创建新项目（会提示起名，或自动生成）
railway init
```

然后添加 PostgreSQL：

```bash
railway add --database postgres
```

等数据库创建完成。到 Railway 网页 **Dashboard** → 点进刚建的 **PostgreSQL 服务** → **Variables** → 复制 **DATABASE_URL** 存好，后面给 API 用。

**方式 B：已有项目**

若你已经在网页上建好了项目：

```bash
railway link
```

按提示选择你的项目、环境。再在网页里 **New** → **Database** → **PostgreSQL**，创建好后同样复制 **DATABASE_URL**。

---

## 三、部署「算法服务」Algo

仍在项目根目录执行：

```bash
# 新建一个空服务，命名为 algo
railway add --service algo
```

到 **Railway 网页**：

1. 点进刚创建的 **algo** 服务。
2. **Settings**：
   - **Root Directory**：留空（不填）。
   - **Dockerfile Path**：填 **`apps/algo/Dockerfile`**
   - （若没有 Dockerfile Path，可能在 **Build** 或 **Deploy** 子菜单里，或叫 **Custom Dockerfile Path**）
3. **Variables**（可选）：`PYTHONUNBUFFERED` = `1`

回到终端，在**项目根目录**执行（上传整份代码，由 Railway 用上面设置的 Dockerfile 构建）：

```bash
railway up
```

等构建、部署完成。记下 **algo** 在项目里的**服务名**（一般是 `algo`），后面 API 的 `ALGO_SERVICE_URL` 要用。

---

## 四、部署「主后端」API

在项目根目录执行：

```bash
# 先解除当前链接，再新建 api 服务
railway link
```

在提示里选**当前项目**、**当前环境**，然后选 **“Create new service”** 或先选一个已有服务再改。若没有“新建服务”选项，到网页 **New** → **Empty Service**，命名为 **api**，再执行：

```bash
railway link
```

选刚建的 **api** 服务。

到 **Railway 网页**，点进 **api** 服务：

1. **Settings**：
   - **Dockerfile Path**：**`apps/api/Dockerfile`**
2. **Variables** → 添加：

   | 变量名 | 值 |
   |--------|-----|
   | **DATABASE_URL** | 第二步复制的 PostgreSQL **DATABASE_URL**（整段） |
   | **JWT_SECRET** | 自设长随机字符串，如 `MyProductionJwtSecret2024ChangeMe` |
   | **ALGO_SERVICE_URL** | **`http://algo:8000`**（若 Algo 服务名不是 `algo` 就改成实际服务名） |
   | **PORT** | **`3001`** |
   | **CORS_ORIGIN** | 先填 `https://placeholder.up.railway.app`，第五步部署完 Web 后再回来改成 Web 的域名 |

回到终端，在**项目根目录**执行：

```bash
railway up
```

（若当前已 link 到 api，会直接部署到 api；否则先 `railway link` 选 api 再 `railway up`。）

部署完成后：**Settings** → **Networking** → **Generate Domain**，复制 **API 的域名**（如 `https://xxx.up.railway.app`），后面给 Web 用。

---

## 五、部署「前端」Web

在项目根目录执行：

```bash
railway link
```

选**当前项目、当前环境**，再选 **“Create new service”** 或到网页 **New** → **Empty Service**，命名为 **web**，然后 `railway link` 选 **web**。

到 **Railway 网页**，点进 **web** 服务：

1. **Settings**：
   - **Dockerfile Path**：**`apps/web/Dockerfile`**
2. **Variables**：
   - **NEXT_PUBLIC_API_URL** = 第四步复制的 **API 域名**（不要加 `/api`）

回到终端，在**项目根目录**执行：

```bash
railway up
```

部署完成后：**Settings** → **Networking** → **Generate Domain**，得到 **Web 的域名**。

---

## 六、把 CORS 对上

回到 **api** 服务 → **Variables**，把 **CORS_ORIGIN** 改成第五步得到的 **Web 域名**，保存。Railway 会重新部署 API。

---

## 七、验证与登录

浏览器打开 **Web 域名**，用默认管理员登录：

- 邮箱：**admin@example.com**
- 密码：**Admin123!**

上线后请在应用内尽快修改该管理员密码。

---

## 以后更新代码（不借助 GitHub）

改完代码后，在项目根目录：

```bash
# 部署到当前 link 的服务
railway up
```

要部署到指定服务时，先切换 link 再 up：

```bash
railway link
# 选 algo / api / web 之一
railway up
```

或一次部署多个服务：分别 `railway link` 到 algo、api、web，各执行一次 `railway up`。

---

## 常见问题

**Q：没有 “Dockerfile Path” 或 “Custom Dockerfile Path”？**  
在服务 **Settings** 里找 **Build** 相关项；或在该服务的 **Variables** 里加 **RAILWAY_DOCKERFILE_PATH** = `apps/api/Dockerfile`（把路径换成对应服务：algo / api / web）。

**Q：上传体积太大或超时？**  
CLI 默认会尊重 `.gitignore`。可增加 **.railwayignore**，写法同 `.gitignore`，排除 `node_modules`、`.git`、`apps/*/node_modules` 等，只保留构建所需文件。

**Q：API 报错、表不存在？**  
在网页里对 **api** 服务点 **…** → **Run Command**，执行：

```bash
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

若无迁移文件则执行：

```bash
npx prisma db push --schema=./prisma/schema.prisma
npx prisma db seed
```

---

## 汇总：不借助 GitHub 的流程

| 步骤 | 操作 |
|------|------|
| 1 | 本机安装并 `railway login` |
| 2 | 项目根目录 `railway init`，再 `railway add --database postgres`，复制 **DATABASE_URL** |
| 3 | `railway add --service algo`，网页设置 Dockerfile Path = `apps/algo/Dockerfile`，再 `railway up` |
| 4 | 新建 api 服务并 link，网页设置 Dockerfile = `apps/api/Dockerfile`、填变量（含 DATABASE_URL、ALGO_SERVICE_URL 等），`railway up`，生成 API 域名 |
| 5 | 新建 web 服务并 link，设置 Dockerfile = `apps/web/Dockerfile`、NEXT_PUBLIC_API_URL = API 域名，`railway up`，生成 Web 域名 |
| 6 | 把 api 的 **CORS_ORIGIN** 改为 Web 域名 |
| 7 | 浏览器打开 Web 域名，用 admin@example.com / Admin123! 登录 |

全部在本地 + Railway 网页完成，无需 GitHub。
