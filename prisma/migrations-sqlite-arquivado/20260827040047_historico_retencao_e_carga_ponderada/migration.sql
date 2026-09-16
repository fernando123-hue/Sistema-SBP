/*
  Warnings:

  - You are about to drop the column `anexos` on the `Email` table. All the data in the column will be lost.
  - You are about to drop the column `assunto` on the `Email` table. All the data in the column will be lost.
  - You are about to drop the column `corpo` on the `Email` table. All the data in the column will be lost.
  - You are about to drop the column `remetente` on the `Email` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "EmailConteudo" (
    "emailId" TEXT NOT NULL PRIMARY KEY,
    "remetente" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    CONSTRAINT "EmailConteudo_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Anexo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailId" TEXT NOT NULL,
    "nomeSeguro" TEXT NOT NULL,
    "tipoDeclarado" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "hash" TEXT,
    "aceito" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,
    "chaveArmazenamento" TEXT,
    "armazenadoEm" DATETIME,
    "bytesExpurgadosEm" DATETIME,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Anexo_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Email" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'mock',
    "recebidoEm" DATETIME NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modeloIa" TEXT,
    "versaoPrompt" TEXT,
    "processadoEm" DATETIME,
    "conteudoExpurgadoEm" DATETIME
);
INSERT INTO "new_Email" ("criadoEm", "id", "messageId", "modeloIa", "origem", "processadoEm", "recebidoEm", "versaoPrompt") SELECT "criadoEm", "id", "messageId", "modeloIa", "origem", "processadoEm", "recebidoEm", "versaoPrompt" FROM "Email";
DROP TABLE "Email";
ALTER TABLE "new_Email" RENAME TO "Email";
CREATE UNIQUE INDEX "Email_messageId_key" ON "Email"("messageId");
CREATE INDEX "Email_recebidoEm_idx" ON "Email"("recebidoEm");
CREATE INDEX "Email_origem_processadoEm_idx" ON "Email"("origem", "processadoEm");
CREATE TABLE "new_SaldoCarga" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "recebido" INTEGER NOT NULL DEFAULT 0,
    "recebidoPonderado" REAL NOT NULL DEFAULT 0,
    "cotaJusta" REAL NOT NULL DEFAULT 0,
    "creditoAcumulado" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "SaldoCarga_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaldoCarga_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaldoCarga" ("categoriaId", "colaboradorId", "cotaJusta", "creditoAcumulado", "data", "id", "recebido") SELECT "categoriaId", "colaboradorId", "cotaJusta", "creditoAcumulado", "data", "id", "recebido" FROM "SaldoCarga";
DROP TABLE "SaldoCarga";
ALTER TABLE "new_SaldoCarga" RENAME TO "SaldoCarga";
CREATE INDEX "SaldoCarga_categoriaId_data_idx" ON "SaldoCarga"("categoriaId", "data");
CREATE UNIQUE INDEX "SaldoCarga_colaboradorId_categoriaId_data_key" ON "SaldoCarga"("colaboradorId", "categoriaId", "data");
CREATE TABLE "new_SaldoCargaGlobal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'CADASTRO',
    "data" TEXT NOT NULL,
    "recebidoPonderado" REAL NOT NULL DEFAULT 0,
    "creditoGlobal" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "SaldoCargaGlobal_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaldoCargaGlobal" ("colaboradorId", "creditoGlobal", "data", "id", "recebidoPonderado") SELECT "colaboradorId", "creditoGlobal", "data", "id", "recebidoPonderado" FROM "SaldoCargaGlobal";
DROP TABLE "SaldoCargaGlobal";
ALTER TABLE "new_SaldoCargaGlobal" RENAME TO "SaldoCargaGlobal";
CREATE INDEX "SaldoCargaGlobal_escopo_data_idx" ON "SaldoCargaGlobal"("escopo", "data");
CREATE UNIQUE INDEX "SaldoCargaGlobal_colaboradorId_escopo_data_key" ON "SaldoCargaGlobal"("colaboradorId", "escopo", "data");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Anexo_emailId_idx" ON "Anexo"("emailId");

-- CreateIndex
CREATE INDEX "Anexo_hash_idx" ON "Anexo"("hash");
