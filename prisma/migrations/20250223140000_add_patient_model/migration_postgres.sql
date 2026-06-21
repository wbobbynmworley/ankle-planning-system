-- PostgreSQL 版本（若 datasource 为 postgresql 且 migration.sql 执行失败，可手动执行本文件后执行: npx prisma migrate resolve --applied 20250223140000_add_patient_model）
-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "idNumber" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Patient_idNumber_key" ON "Patient"("idNumber");
CREATE UNIQUE INDEX "Patient_userId_key" ON "Patient"("userId");
CREATE INDEX "Patient_idNumber_idx" ON "Patient"("idNumber");
CREATE INDEX "Patient_userId_idx" ON "Patient"("userId");

-- 迁移：从 User (role=PATIENT) 生成 Patient，使 Case.patientId 可指向 Patient
INSERT INTO "Patient" ("id", "idNumber", "name", "phone", "userId", "createdAt", "updatedAt")
SELECT "id", COALESCE("patientIdNumber", "id"), "name", "phone", "id", "createdAt", "updatedAt"
FROM "User" WHERE "role" = 'PATIENT';

ALTER TABLE "Case" DROP CONSTRAINT IF EXISTS "Case_patientId_fkey";
ALTER TABLE "Case" ADD CONSTRAINT "Case_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "User_patientIdNumber_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "patientIdNumber";
