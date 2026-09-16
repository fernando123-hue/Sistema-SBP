/*
  A justificativa de transferência e devolução sai de `Atribuicao` e passa a
  morar em tabela própria, que o prazo do conteúdo alcança (`A40`, resposta 25).

  O Prisma gerou esta migração avisando que a coluna seria apagada com os dados.
  O INSERT abaixo foi acrescentado à mão: copia cada texto existente ANTES de a
  tabela ser redefinida. O id segue o formato que o SQLite consegue gerar; o
  Prisma só exige texto único.
*/
-- CreateTable
CREATE TABLE "JustificativaDeAtribuicao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "atribuicaoId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JustificativaDeAtribuicao_atribuicaoId_fkey" FOREIGN KEY ("atribuicaoId") REFERENCES "Atribuicao" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Copia os textos existentes (acrescentado à mão)
INSERT INTO "JustificativaDeAtribuicao" ("id", "atribuicaoId", "motivo", "texto", "criadoEm")
SELECT
    'mig' || lower(hex(randomblob(12))),
    "id",
    CASE WHEN "motivo" = 'devolucao' THEN 'devolucao' ELSE 'transferencia' END,
    "justificativa",
    COALESCE("encerradoEm", "atribuidoEm")
FROM "Atribuicao"
WHERE "justificativa" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Atribuicao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "rodadaId" TEXT,
    "motivo" TEXT NOT NULL,
    "atribuidoPor" TEXT NOT NULL,
    "ativa" BOOLEAN,
    "atribuidoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradoEm" DATETIME,
    CONSTRAINT "Atribuicao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Atribuicao_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Atribuicao_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "RodadaDistribuicao" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Atribuicao" ("ativa", "atribuidoEm", "atribuidoPor", "colaboradorId", "encerradoEm", "id", "itemId", "motivo", "rodadaId") SELECT "ativa", "atribuidoEm", "atribuidoPor", "colaboradorId", "encerradoEm", "id", "itemId", "motivo", "rodadaId" FROM "Atribuicao";
DROP TABLE "Atribuicao";
ALTER TABLE "new_Atribuicao" RENAME TO "Atribuicao";
CREATE INDEX "Atribuicao_colaboradorId_ativa_idx" ON "Atribuicao"("colaboradorId", "ativa");
CREATE INDEX "Atribuicao_rodadaId_idx" ON "Atribuicao"("rodadaId");
CREATE UNIQUE INDEX "Atribuicao_itemId_ativa_key" ON "Atribuicao"("itemId", "ativa");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "JustificativaDeAtribuicao_atribuicaoId_idx" ON "JustificativaDeAtribuicao"("atribuicaoId");
