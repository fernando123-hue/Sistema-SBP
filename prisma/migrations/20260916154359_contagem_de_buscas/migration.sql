-- CreateTable
CREATE TABLE `ContagemDeBusca` (
    `colaboradorId` VARCHAR(191) NOT NULL,
    `dia` VARCHAR(191) NOT NULL,
    `buscas` INTEGER NOT NULL DEFAULT 0,
    `semResultado` INTEGER NOT NULL DEFAULT 0,

    INDEX `ContagemDeBusca_dia_idx`(`dia`),
    PRIMARY KEY (`colaboradorId`, `dia`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContagemDeBusca` ADD CONSTRAINT `ContagemDeBusca_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
