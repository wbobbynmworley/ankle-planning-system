#!/usr/bin/env bash
# Local dev: start postgres, then api, algo, web in separate terminals.
set -e
echo "Ensure PostgreSQL is running (e.g. docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine)"
echo "Then: cd apps/api && npm run start:dev"
echo "      cd apps/algo && uvicorn algo.main:app --reload --host 0.0.0.0"
echo "      cd apps/web && npm run dev"
