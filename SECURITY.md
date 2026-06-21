# 安全说明

本系统按医疗与商业级要求实现以下安全措施。

## 认证与授权

- **密码**：bcrypt 加密存储（SALT_ROUNDS=12），不明文保存。
- **JWT**：登录签发 JWT，过期时间可配置（默认 7 天）；接口通过 `JwtAuthGuard` 校验。
- **RBAC**：`RolesGuard` + `@Roles('ADMIN'|'DOCTOR'|'PATIENT')` 控制接口访问；病例与规划按角色做行级隔离（医生仅本人病例，患者仅本人数据）。

## API 与输入

- **全局校验**：`ValidationPipe` 开启 `whitelist`、`forbidNonWhitelisted`、`transform`，避免非法字段与类型问题。
- **SQL 注入**：全部数据访问经 Prisma ORM，无拼接原始 SQL，参数化查询。
- **限流**：`ThrottlerGuard` 全局生效，默认 60s 内 100 次请求，防止滥用。
- **CORS**：仅允许配置的 `CORS_ORIGIN`（生产应设为前端域名）。
- **Helmet**：启用 Helmet 中间件，加固 HTTP 头。

## 文件与上传

- **类型白名单**：仅允许 STL、JPG、PNG 等指定 MIME/扩展名。
- **大小限制**：单文件上限（如 100MB），Multer 与业务双重校验。
- **路径隔离**：按 `caseId` 与类型分目录存储，不暴露真实路径；下载需鉴权并由服务端读文件流返回。

## 部署与网络

- **算法服务**：algo 仅内网暴露端口，由 api 通过 `ALGO_SERVICE_URL` 调用，不对公网开放。
- **数据库**：PostgreSQL 不对外暴露，仅 api 访问。
- **密钥**：`JWT_SECRET`、`DATABASE_URL` 等仅通过环境变量配置，不入库、不提交代码。

## 建议

- 生产环境必须更换默认 `JWT_SECRET`，使用强随机串。
- 启用 HTTPS（Railway/反向代理层）。
- 定期轮换密钥、审计日志与权限。
