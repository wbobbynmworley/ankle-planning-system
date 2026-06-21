-- CaseStatus: add PREOP_DONE, POSTOP_DONE
ALTER TABLE `Case` MODIFY COLUMN `status` ENUM('DRAFT', 'PENDING_PLAN', 'PLANNED', 'PREOP_DONE', 'POSTOP_DONE', 'COMPLETED') NOT NULL DEFAULT 'DRAFT';

-- Plan: add instrumentConfig, initialScales, measurementSnapshot
ALTER TABLE `Plan` ADD COLUMN `instrumentConfig` JSON NULL;
ALTER TABLE `Plan` ADD COLUMN `initialScales` JSON NULL;
ALTER TABLE `Plan` ADD COLUMN `measurementSnapshot` JSON NULL;

-- Measurement
CREATE TABLE `Measurement` (
    `id` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `stage` ENUM('PREOP_2D', 'PREOP_3D', 'POSTOP_2D', 'POSTOP_3D') NOT NULL,
    `viewKey` VARCHAR(191) NULL,
    `values` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Measurement_caseId_idx` ON `Measurement`(`caseId`);
CREATE INDEX `Measurement_caseId_stage_idx` ON `Measurement`(`caseId`, `stage`);
ALTER TABLE `Measurement` ADD CONSTRAINT `Measurement_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `Case`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- InstrumentRing
CREATE TABLE `InstrumentRing` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `diameterMm` DOUBLE NULL,
    `spec` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `InstrumentRing_code_key` ON `InstrumentRing`(`code`);

-- InstrumentRod
CREATE TABLE `InstrumentRod` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `lengthMm` DOUBLE NULL,
    `spec` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `InstrumentRod_code_key` ON `InstrumentRod`(`code`);

-- InstrumentCombination
CREATE TABLE `InstrumentCombination` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `ringRefIds` JSON NOT NULL,
    `rodRefIds` JSON NOT NULL,
    `configSchema` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `InstrumentCombination_code_key` ON `InstrumentCombination`(`code`);

-- RolePermission
CREATE TABLE `RolePermission` (
    `id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `allowed` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `RolePermission_role_resource_action_key` ON `RolePermission`(`role`, `resource`, `action`);
CREATE INDEX `RolePermission_role_idx` ON `RolePermission`(`role`);

-- DataPermission
CREATE TABLE `DataPermission` (
    `id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DataPermission_role_idx` ON `DataPermission`(`role`);
