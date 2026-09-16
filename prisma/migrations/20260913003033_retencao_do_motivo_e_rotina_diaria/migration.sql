-- AlterTable
ALTER TABLE "Afastamento" ADD COLUMN "motivoExpurgadoEm" DATETIME;

-- CreateTable
CREATE TABLE "PrazoDeRetencao" (
    "chave" TEXT NOT NULL PRIMARY KEY,
    "dias" INTEGER NOT NULL,
    "alteradoPor" TEXT NOT NULL,
    "alteradoEm" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExecucaoDeRotina" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rotina" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "iniciadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" DATETIME,
    "resumo" TEXT,
    "mensagem" TEXT,
    "correlacaoId" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecucaoDeRotina_rotina_data_key" ON "ExecucaoDeRotina"("rotina", "data");

-- CreateIndex
CREATE INDEX "Afastamento_motivoExpurgadoEm_idx" ON "Afastamento"("motivoExpurgadoEm");
