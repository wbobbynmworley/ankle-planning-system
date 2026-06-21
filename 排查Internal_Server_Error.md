# 出现 Internal Server Error 时的排查

## 0. 登录时提示 ECONNREFUSED / 连不上 3001

**原因**：前端（3000）把请求转发到后端 API（3001），但 **API 没有启动**，所以连接被拒绝。

**做法**：必须同时启动 **API、Algo、Web** 三个服务：
- 在项目根目录双击 **`start.bat`**，会依次打开三个窗口（API-3001、Algo-8000、Web-3000）。
- 等约 30 秒，看到 API 窗口里出现类似 `API listening on http://localhost:3001/api` 后，再在浏览器打开 http://localhost:3000 并登录。

只开 Web 而不开 API 时，登录一定会报错（ECONNREFUSED 或 Internal Server Error）。

---

## 1. 看后端控制台（API 窗口）

运行 `start.bat` 后，**API 所在窗口**会打印错误栈。请把最后几行报错贴出来，便于精确定位。

常见情况：

- **数据库连接失败**  
  报错里出现 `ECONNREFUSED`、`connect`、`Prisma` 等：  
  - 确认本机 **MySQL 已启动**（服务里或命令行能连上）。  
  - 确认 **`apps/api/.env`** 里：  
    `DATABASE_URL="mysql://root:1234@localhost:3306/1234"`  
    端口、用户名、密码、库名是否与你的 MySQL 一致。

- **pdfkit 相关**  
  报错里出现 `pdfkit`、`Cannot find module`：  
  在项目根目录执行：  
  `cd apps\api` → `npm install`  
  确保安装了 `pdfkit`。

- **端口被占用**  
  报错 `EADDRINUSE`：  
  关闭占用 3001 端口的程序，或改 `apps/api/.env` 里的 `PORT`。

## 2. 确认是在哪一步报错

- **一打开页面就 500**：多半是 **登录态校验** 或 **列表接口**（如 `/api/auth/me`、`/api/cases`）失败，优先查数据库是否可连、`.env` 是否正确。
- **点「创建病例」「下载 PDF」等才 500**：看 API 窗口在该操作时的报错，对应修（如缺依赖、权限、参数等）。

## 3. 已做的代码改动（便于你对照）

- 全局校验已放宽（避免因多传字段导致 500）。
- 500 时会打完整错误栈到 API 控制台。
- 数据库连接/Prisma 相关错误会尽量返回「数据库连接失败」等中文提示。
- PDF 生成失败会返回「PDF 生成失败: xxx」而不是笼统的 Internal Server Error。

按上面步骤看 API 窗口报错并对照检查，一般就能定位并解决。
