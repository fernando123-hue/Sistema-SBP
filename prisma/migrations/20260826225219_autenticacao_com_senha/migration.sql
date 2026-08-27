-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Colaborador" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'colaborador',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataEntrada" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSaida" DATETIME,
    "senhaHash" TEXT,
    "senhaDefinidaEm" DATETIME,
    "precisaTrocarSenha" BOOLEAN NOT NULL DEFAULT false,
    "tentativasFalhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" DATETIME,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);
INSERT INTO "new_Colaborador" ("ativo", "atualizadoEm", "criadoEm", "dataEntrada", "dataSaida", "email", "id", "nome", "papel", "senhaHash") SELECT "ativo", "atualizadoEm", "criadoEm", "dataEntrada", "dataSaida", "email", "id", "nome", "papel", "senhaHash" FROM "Colaborador";
DROP TABLE "Colaborador";
ALTER TABLE "new_Colaborador" RENAME TO "Colaborador";
CREATE UNIQUE INDEX "Colaborador_email_key" ON "Colaborador"("email");
CREATE INDEX "Colaborador_ativo_idx" ON "Colaborador"("ativo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
