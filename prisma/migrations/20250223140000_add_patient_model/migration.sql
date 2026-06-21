-- Migration: add Patient model (patient keyed by idNumber 身份证号); Case.patientId -> Patient.
-- This file is for MySQL. If you use PostgreSQL, run: npx prisma migrate dev --name add_patient_model (from apps/api with schema=../../prisma/schema.prisma) to generate the correct SQL.
-- CreateTable
CREATE TABLE `Patient` (
    `id` VARCHAR(191) NOT NULL,
    `idNumber` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Patient_idNumber_key`(`idNumber`),
    UNIQUE INDEX `Patient_userId_key`(`userId`),
    INDEX `Patient_idNumber_idx`(`idNumber`),
    INDEX `Patient_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Migrate: create Patient from existing User (role PATIENT) so Case.patientId can point to Patient
-- Using User.id as Patient.id so existing Case rows remain valid (Case.patientId = User.id = Patient.id)
INSERT INTO `Patient` (`id`, `idNumber`, `name`, `phone`, `userId`, `createdAt`, `updatedAt`)
SELECT `id`, COALESCE(`patientIdNumber`, `id`), `name`, `phone`, `id`, `createdAt`, `updatedAt`
FROM `User` WHERE `role` = 'PATIENT';

-- If no PATIENT users exist, Case may reference User.id that are doctors - then the INSERT is empty and we need to handle Case. For fresh DB with no Case data, next steps are safe.
-- Drop FK Case -> User
ALTER TABLE `Case` DROP FOREIGN KEY `Case_patientId_fkey`;

-- Add FK Case -> Patient
ALTER TABLE `Case` ADD CONSTRAINT `Case_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop User.patientIdNumber
DROP INDEX `User_patientIdNumber_key` ON `User`;
ALTER TABLE `User` DROP COLUMN `patientIdNumber`;
