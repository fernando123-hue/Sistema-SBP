-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventoProcessamento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dominio" TEXT NOT NULL DEFAULT 'distribuicao',
    "correlacaoId" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "referencia" TEXT,
    "mensagem" TEXT,
    "detalhe" TEXT,
    "duracaoMs" INTEGER,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_EventoProcessamento" ("correlacaoId", "criadoEm", "detalhe", "duracaoMs", "etapa", "id", "mensagem", "referencia", "situacao") SELECT "correlacaoId", "criadoEm", "detalhe", "duracaoMs", "etapa", "id", "mensagem", "referencia", "situacao" FROM "EventoProcessamento";
DROP TABLE "EventoProcessamento";
ALTER TABLE "new_EventoProcessamento" RENAME TO "EventoProcessamento";
CREATE INDEX "EventoProcessamento_correlacaoId_idx" ON "EventoProcessamento"("correlacaoId");
CREATE INDEX "EventoProcessamento_situacao_etapa_idx" ON "EventoProcessamento"("situacao", "etapa");
CREATE TABLE "new_LogAuditoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dominio" TEXT NOT NULL DEFAULT 'distribuicao',
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "antes" TEXT,
    "depois" TEXT,
    "usuario" TEXT NOT NULL,
    "correlacaoId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_LogAuditoria" ("acao", "antes", "correlacaoId", "depois", "entidade", "entidadeId", "id", "timestamp", "usuario") SELECT "acao", "antes", "correlacaoId", "depois", "entidade", "entidadeId", "id", "timestamp", "usuario" FROM "LogAuditoria";
DROP TABLE "LogAuditoria";
ALTER TABLE "new_LogAuditoria" RENAME TO "LogAuditoria";
CREATE INDEX "LogAuditoria_entidade_entidadeId_idx" ON "LogAuditoria"("entidade", "entidadeId");
CREATE INDEX "LogAuditoria_timestamp_idx" ON "LogAuditoria"("timestamp");
CREATE INDEX "LogAuditoria_correlacaoId_idx" ON "LogAuditoria"("correlacaoId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
