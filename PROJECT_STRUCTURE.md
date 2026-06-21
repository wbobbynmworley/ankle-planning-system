# 项目目录结构

```
足踝畸形矫正/
├── .gitignore
├── README.md
├── package.json                 # 根脚本 (dev:api, dev:web, db:migrate)
├── PROJECT_STRUCTURE.md
├── apps/
│   ├── web/                     # Next.js 前端
│   │   ├── Dockerfile
│   │   ├── next.config.js
│   │   ├── package.json
│   │   ├── postcss.config.js
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── app/
│   │           ├── globals.css
│   │           ├── layout.tsx
│   │           └── page.tsx
│   ├── api/                     # NestJS 主后端
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── prisma/
│   │       ├── auth/
│   │       ├── users/
│   │       ├── cases/
│   │       ├── files/
│   │       ├── plans/
│   │       ├── logs/
│   │       └── algo/
│   └── algo/                    # Python FastAPI 算法服务
│       ├── Dockerfile
│       ├── requirements.txt
│       └── algo/
│           ├── __init__.py
│           ├── main.py          # FastAPI 入口，/plan/2d, /plan/3d
│           ├── segmentation.py
│           ├── planner_2d.py
│           ├── planner_3d.py
│           ├── collision.py
│           └── daily_steps.py
├── prisma/
│   └── schema.prisma            # User, Case, File, Plan, Log
├── infra/
│   ├── docker-compose.yml       # web, api, algo, postgres, nginx
│   └── nginx.conf
└── scripts/
    └── dev.sh
```

## 服务与端口

| 服务     | 说明           | 内部端口 | 对外 (Nginx) |
|----------|----------------|----------|--------------|
| web      | Next.js        | 3000     | /            |
| api      | NestJS         | 3001     | /api/        |
| algo     | FastAPI 2D/3D  | 8000     | 不暴露       |
| postgres | PostgreSQL     | 5432     | 不暴露       |
| nginx    | 反向代理       | 80/443   | 80, 443      |
