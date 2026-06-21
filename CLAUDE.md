# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

医疗级足踝畸形矫正智能规划系统 (Ankle/foot deformity correction planning system). A monorepo with three services that together let doctors import patient X-ray images / CT-derived STL models, segment bones, plan a collision-free correction trajectory (2D dual-plane A* and 3D voxel A*), generate daily correction steps, and export PDF reports. Patients can view and log execution progress.

The UI and most comments are in Chinese; keep new user-facing strings and doc comments in Chinese to match.

## Architecture

Three apps under `apps/`, each independently installed and run:

- **`apps/web`** — Next.js 14 (App Router) + TypeScript + TailwindCSS + shadcn-style components. Port **3000**. 3D viewing uses `@react-three/fiber` / `three`. All server calls go through `apps/web/src/lib/api.ts` (one wrapper per endpoint; JWT from `localStorage`). 2D/3D workbenches live in `apps/web/src/components/Workbench2D` and `Workbench3D`.
- **`apps/api`** — NestJS 10 + Prisma. Port **3001**, global prefix `/api`. Feature modules (`auth`, `users`, `cases`, `files`, `plans`, `measurements`, `instruments`, `taylor`, `execution`, `perms`, `logs`, `algo`) registered in `src/app.module.ts`. JWT + RBAC (`Role` enum ADMIN/DOCTOR/PATIENT), Helmet, throttling (100 req/60s), 50 MB body limit (SAM base64 images). The **`algo` module is a thin HTTP client** (`src/algo/algo.service.ts`) — it does no computation itself, it forwards to the Python service.
- **`apps/algo`** — Python FastAPI + VTK/PyVista + OpenCV + (optionally) Segment Anything (SAM) + Torch. Port **8000**, not exposed publicly. Entry `apps/algo/algo/main.py`. Does all heavy lifting: SAM box segmentation, 2D dual-plane A* (`planner_2d.py`), 3D voxel A* multi-bone planning (`planner_3d.py`, `planner_3d_ct3d.py`), exact triangle-level collision detection (`collision.py`, VTK `CollisionDetectionFilter`), daily-step subdivision (`daily_steps.py`), STL→2D projection (`stl_to_2d.py`), ratio-ball calibration (`ratio_ball.py`).

**Request flow:** web → `api.ts` → NestJS `/api/*` → (for planning/segmentation) `AlgoService` → FastAPI `:8000`. The web app talks only to NestJS, never directly to the algo service.

### Algo service is ported 1:1 from desktop prototypes

The root-level Python files — `2dmax.py` (PyQt 2D workbench), `CT3D.py` (3D planner), `stl.py`, `005.py` (YOLO ratio-ball) — are the **original standalone desktop prototypes**. The `apps/algo` modules are intended to reproduce their behavior exactly. `docs/WORKFLOW_2D_3D.md` documents the expected workflow and explicitly maps it to these files. **When changing algo behavior, consult the corresponding root `.py` prototype** (e.g. mask post-processing uses `min_area_px=400, morph_k=3` to match `2dmax.py`; 3D multi-bone planning matches `CT3D.py`). `sam_vit_h_4b8939.pth` at the repo root is the SAM checkpoint.

### Data model (Prisma, `prisma/schema.prisma`)

Datasource is **MySQL** (despite README mentioning PostgreSQL; `.env`, `start.bat`, and the schema all use `mysql://`). Core chain: `User` (doctor/patient/admin) → `Patient` → `Case` → `File` (STL/FRONT/SIDE images) + `Plan` (2D/3D, stores `dailySteps`, `rawPath`, `instrumentConfig`, `initialScales`, pose snapshots as JSON) + `Measurement`. `InstrumentRing`/`InstrumentRod`/`InstrumentCombination` model the Taylor frame hardware. `RolePermission`/`DataPermission` back the dynamic perms UI. `Log` records audited actions.

Generated Prisma client output path is `node_modules/.prisma/client` (the `generator.output` in the schema); `@prisma/client` is imported from `apps/api`. The schema lives at the repo root `prisma/`, but the api build runs `prisma generate --schema=../../prisma/schema.prisma`.

### File storage

Uploaded files are stored on disk under `FILE_STORAGE_PATH` (default `<api cwd>/storage/cases/<caseId>`), not in the DB — the `File` row only holds the `path`. Masks generated in the 2D workbench are saved to a dated folder structure (`YYYYMMDD/view_role_engine_ts.png`).

## Commands

Root `package.json` provides convenience scripts (each just `cd`s into an app):

```bash
npm run dev:api        # cd apps/api && npm run start:dev   (Nest watch, :3001)
npm run dev:web        # cd apps/web && npm run dev          (Next dev, :3000)
npm run build:api      # prisma generate + nest build
npm run build:web      # next build
npm run db:migrate     # cd apps/api && npx prisma migrate dev
npm run db:generate    # prisma generate
npm run db:studio      # prisma studio
```

The algo service has no npm script — run it directly (must be a Python env that has `requirements.txt` installed, ideally with torch + segment_anything for SAM):

```bash
cd apps/algo && python -m uvicorn algo.main:app --host 0.0.0.0 --port 8000
# or use apps/algo/start-algo.bat which installs deps + runs check_sam.py first
```

### One-click local dev (Windows)

`start.bat` (repo root) opens three cmd windows: API (3001), Algo (8000), Web (3000). It also frees port 3001 first, copies a Chinese font (`simsun.ttc`) into `apps/api/fonts` for PDF generation, and **hardcodes `DATABASE_URL=mysql://root:1234@localhost:3306/ankle_app` and the Anaconda python path `E:\anaconda3\python.exe`** — edit these in `start.bat` for your machine. Requires MySQL already running.

### Per-app scripts

- **api**: `npm run start:dev` (watch), `npm run start:prod` (`node dist/main`), `npm run lint` (eslint `**/*.ts`), `npm test` (jest). Run a single test: `npx jest path/to/file.spec.ts` or `npx jest -t "test name"`.
- **web**: `npm run dev`, `npm run build`, `npm run start`, `npm run lint` (next lint).

### Tests

There are currently no `*.spec.ts` test files in the repo; `npm test` (jest) is configured but unused. Verify behavior by running the stack.

## Conventions & gotchas

- **Ports are load-bearing**: web 3000, api 3001, algo 8000. In dev the web app connects directly to `http://localhost:3001/api` (see `getApiBase()` in `lib/api.ts`); in production it uses relative `/api` or `NEXT_PUBLIC_API_URL`.
- **Algo connectivity**: if the algo service is down, NestJS returns a `BadGatewayException` with a Chinese message telling the user to start it. The web app surfaces algo health via `/api/plans/algo-health`.
- **Path encoding**: Windows + Chinese paths get mangled (GBK↔UTF-8). `apps/algo/algo/main.py` has `_decode_path_if_garbled()` to recover paths — preserve this when touching file loading.
- **Env vars**: `DATABASE_URL` (MySQL), `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` (seeded admin via `admin-seed.service.ts`), `CORS_ORIGIN`, `PORT`, `FILE_STORAGE_PATH`, `ALGO_SERVICE_URL`, `NEXT_PUBLIC_API_URL`, `YOLO_MODEL_PATH`.
- **Seeding**: `apps/api/prisma-seed.js` (run via `prisma db seed`) seeds the admin user.
- **Deployment**: `infra/docker-compose.yml` + `infra/nginx.conf` (nginx fronts web at `/`, api at `/api/`, algo internal). Railway docs are the several `RAILWAY*.md` / `DEPLOY.md` files at the root.
</content>
</invoke>
