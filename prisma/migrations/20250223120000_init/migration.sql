-- MySQL: initial schema (Prisma enums as VARCHAR)
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `role` ENUM('ADMIN', 'DOCTOR', 'PATIENT') NOT NULL,
    `doctorCode` VARCHAR(191) NULL,
    `patientIdNumber` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Case` (
    `id` VARCHAR(191) NOT NULL,
    `patientId` VARCHAR(191) NOT NULL,
    `doctorId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_PLAN', 'PLANNED', 'COMPLETED') NOT NULL DEFAULT 'DRAFT',
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `File` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `type` ENUM('STL', 'FRONT', 'SIDE', 'REPORT', 'OTHER') NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Plan` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `algoType` ENUM('PLAN_2D', 'PLAN_3D') NOT NULL,
    `totalDistance` DOUBLE NULL,
    `totalDays` INTEGER NULL,
    `dailySteps` JSON NULL,
    `rawPath` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Log` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `User_email_key` ON `User`(`email`);
CREATE UNIQUE INDEX `User_doctorCode_key` ON `User`(`doctorCode`);
CREATE UNIQUE INDEX `User_patientIdNumber_key` ON `User`(`patientIdNumber`);
CREATE INDEX `User_role_idx` ON `User`(`role`);

CREATE INDEX `Case_patientId_idx` ON `Case`(`patientId`);
CREATE INDEX `Case_doctorId_idx` ON `Case`(`doctorId`);
CREATE INDEX `Case_status_idx` ON `Case`(`status`);

CREATE INDEX `File_caseId_idx` ON `File`(`caseId`);
CREATE INDEX `Plan_caseId_idx` ON `Plan`(`caseId`);
CREATE INDEX `Log_userId_idx` ON `Log`(`userId`);
CREATE INDEX `Log_createdAt_idx` ON `Log`(`createdAt`);

ALTER TABLE `Case` ADD CONSTRAINT `Case_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Case` ADD CONSTRAINT `Case_doctorId_fkey` FOREIGN KEY (`doctorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `File` ADD CONSTRAINT `File_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Plan` ADD CONSTRAINT `Plan_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Log` ADD CONSTRAINT `Log_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
