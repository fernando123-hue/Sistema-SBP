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
    "conteudoExpurgadoEm" DATETIME,
    "conteudoSuspeito" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Email" ("conteudoExpurgadoEm", "criadoEm", "id", "messageId", "modeloIa", "origem", "processadoEm", "recebidoEm", "versaoPrompt") SELECT "conteudoExpurgadoEm", "criadoEm", "id", "messageId", "modeloIa", "origem", "processadoEm", "recebidoEm", "versaoPrompt" FROM "Email";
DROP TABLE "Email";
ALTER TABLE "new_Email" RENAME TO "Email";
CREATE UNIQUE INDEX "Email_messageId_key" ON "Email"("messageId");
CREATE INDEX "Email_recebidoEm_idx" ON "Email"("recebidoEm");
CREATE INDEX "Email_origem_processadoEm_idx" ON "Email"("origem", "processadoEm");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
