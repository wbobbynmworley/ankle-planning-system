# 创建 patient 表（解决 “table patient does not exist”）

**说明**：`DATABASE_URL` 在 `apps/api/.env` 中，因此迁移需在 **`apps/api` 目录**下执行，否则会报 `Environment variable not found: DATABASE_URL`。

## 1. 使用 MySQL 时（schema 中 `provider = "mysql"`）

在 **`apps/api`** 目录下执行：

```bash
cd apps/api
npx prisma migrate deploy --schema=../../prisma/schema.prisma
```

## 2. 使用 PostgreSQL 时

若上面命令报错（例如语法不兼容），说明当前数据库是 PostgreSQL，请**手动执行**迁移：

1. 用 psql 或其它客户端连接数据库。
2. 执行文件中的 SQL：  
   `prisma/migrations/20250223140000_add_patient_model/migration_postgres.sql`
3. 将该迁移标记为已应用（避免 Prisma 再次执行）：

```bash
npx prisma migrate resolve --applied 20250223140000_add_patient_model --schema=prisma/schema.prisma
```

## 3. 验证

执行后应存在表 `Patient`，且 `Case` 表的外键指向 `Patient`。重启 API 后再试创建病例。
