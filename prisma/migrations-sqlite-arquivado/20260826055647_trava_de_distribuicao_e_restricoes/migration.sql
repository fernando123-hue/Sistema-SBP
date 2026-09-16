-- CreateTable
CREATE TABLE "TravaDeDistribuicao" (
    "data" TEXT NOT NULL PRIMARY KEY,
    "execucoes" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailId" TEXT,
    "categoriaId" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL DEFAULT 1,
    "titulo" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "confianca" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'novo',
    "ligaId" TEXT,
    "modeloIa" TEXT,
    "versaoPrompt" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "Item_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "Liga" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("atualizadoEm", "categoriaId", "confianca", "criadoEm", "emailId", "id", "ligaId", "modeloIa", "payload", "sequencia", "status", "titulo", "versaoPrompt") SELECT "atualizadoEm", "categoriaId", "confianca", "criadoEm", "emailId", "id", "ligaId", "modeloIa", "payload", "sequencia", "status", "titulo", "versaoPrompt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE INDEX "Item_status_categoriaId_idx" ON "Item"("status", "categoriaId");
CREATE INDEX "Item_categoriaId_status_criadoEm_idx" ON "Item"("categoriaId", "status", "criadoEm");
CREATE UNIQUE INDEX "Item_emailId_sequencia_key" ON "Item"("emailId", "sequencia");
CREATE TABLE "new_SaldoCarga" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "recebido" INTEGER NOT NULL DEFAULT 0,
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
    "data" TEXT NOT NULL,
    "recebidoPonderado" REAL NOT NULL DEFAULT 0,
    "creditoGlobal" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "SaldoCargaGlobal_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaldoCargaGlobal" ("colaboradorId", "creditoGlobal", "data", "id", "recebidoPonderado") SELECT "colaboradorId", "creditoGlobal", "data", "id", "recebidoPonderado" FROM "SaldoCargaGlobal";
DROP TABLE "SaldoCargaGlobal";
ALTER TABLE "new_SaldoCargaGlobal" RENAME TO "SaldoCargaGlobal";
CREATE UNIQUE INDEX "SaldoCargaGlobal_colaboradorId_data_key" ON "SaldoCargaGlobal"("colaboradorId", "data");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
