-- Uso da IA por dia, fornecedor, modelo e tarefa (A54, achado C-06).
--
-- Só contagem: nenhuma coluna guarda conteúdo de e-mail, pergunta ou resposta.
--
-- A colação vem no fim por causa da regra de AT-34: o Prisma escreve
-- `utf8mb4_unicode_ci` em todo CREATE TABLE, e sem a conversão "Gemini" e
-- "gemini" virariam a mesma linha de contagem.
CREATE TABLE `UsoDaIa` (
    `dia` VARCHAR(191) NOT NULL,
    `fornecedor` VARCHAR(191) NOT NULL,
    `modelo` VARCHAR(191) NOT NULL,
    `tarefa` VARCHAR(191) NOT NULL,
    `chamadas` INTEGER NOT NULL DEFAULT 0,
    `falhas` INTEGER NOT NULL DEFAULT 0,
    `duracaoMsTotal` INTEGER NOT NULL DEFAULT 0,

    INDEX `UsoDaIa_dia_idx`(`dia`),
    PRIMARY KEY (`dia`, `fornecedor`, `modelo`, `tarefa`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UsoDaIa` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
