# 足踝畸形矫正智能规划系统（Web版）

医疗级足踝畸形矫正智能规划系统，支持双平面 2D A* 与 STL 3D 碰撞检测规划，可部署于 Railway。

## 技术栈

- **前端**: Next.js (App Router), TypeScript, TailwindCSS, shadcn/ui
- **主后端**: NestJS, Prisma, PostgreSQL, JWT + RBAC
- **算法服务**: Python FastAPI（2D/3D 规划）
- **部署**: Docker Compose, Nginx, Railway

## 目录结构

```
├── apps/
│   ├── web/          # Next.js 前端
│   ├── api/          # NestJS 主后端
│   └── algo/         # Python FastAPI 算法服务
├── prisma/           # Prisma schema 与迁移
├── infra/            # Docker、Nginx、Railway 配置
└── scripts/          # 开发与部署脚本
```

## 快速开始

### 本地开发

**推荐：一键启动（Windows）**

```batch
# 项目根目录双击或命令行执行，会打开 3 个窗口：API(3001) + Algo(8000) + Web(3000)
start.bat
```

等待约 30 秒后访问 http://localhost:3000。

**若出现 `Failed to proxy ... ECONNREFUSED`**：说明后端 API 未启动。请先启动 API 或使用 `start.bat`。

**若出现 `EADDRINUSE: address already in use :::3001`**：说明 3001 端口已被占用（例如上次 API 未关或启动了两次）。可先关掉占用 3001 的窗口，或在项目根目录执行：`for /f "tokens=5" %a in ('netstat -ano ^| findstr ":3001"') do taskkill /F /PID %a`（CMD 下用 `%a`；若在 .bat 里用 `%%a`），再重新启动 API 或运行 `start.bat`。`start.bat` 现已会在启动前自动尝试释放 3001。

**手动分步启动：**

```bash
# 安装依赖
cd apps/api && npm install
cd ../web && npm install
cd ../algo && pip install -r requirements.txt

# 数据库（需先启动 MySQL/Postgres）
cd ../.. && npx prisma migrate dev

# 启动（需先启动数据库）
# 终端1: API（必须，端口 3001）
cd apps/api && npm run start:dev
# 终端2: Algo（2D/3D 规划、SAM 等，端口 8000）
cd apps/algo && uvicorn algo.main:app --reload
# 终端3: Web（端口 3000）
cd apps/web && npm run dev
```

### Docker

```bash
cd infra && docker-compose up -d
```

## 角色与权限

- **管理员**: 用户管理、批量导入医生、病例总览、系统日志
- **医护人员**: 注册、创建病例、上传影像/STL、触发规划、导出 PDF
- **患者**: 注册、查看本人病例与规划结果（只读）

## 安全

- bcrypt 密码、JWT 鉴权、RBAC、文件白名单与大小限制、CORS、Helmet、限流
