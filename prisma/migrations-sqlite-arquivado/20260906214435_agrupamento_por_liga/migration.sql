-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Categoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "frente" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "divisivel" BOOLEAN NOT NULL DEFAULT true,
    "peso" REAL NOT NULL DEFAULT 1,
    "limiarIndivisivel" INTEGER NOT NULL DEFAULT 3,
    "limiarConfianca" REAL NOT NULL DEFAULT 0.85,
    "entraNoRateio" BOOLEAN NOT NULL DEFAULT true,
    "agrupaPorLiga" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Categoria" ("ativa", "codigo", "divisivel", "entraNoRateio", "frente", "grupo", "id", "limiarConfianca", "limiarIndivisivel", "ordem", "peso", "rotulo") SELECT "ativa", "codigo", "divisivel", "entraNoRateio", "frente", "grupo", "id", "limiarConfianca", "limiarIndivisivel", "ordem", "peso", "rotulo" FROM "Categoria";
DROP TABLE "Categoria";
ALTER TABLE "new_Categoria" RENAME TO "Categoria";
CREATE UNIQUE INDEX "Categoria_codigo_key" ON "Categoria"("codigo");
CREATE INDEX "Categoria_frente_grupo_ordem_idx" ON "Categoria"("frente", "grupo", "ordem");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Decisao A4: a liga e a unidade que nao se separa em LIGANTE e EMAIL_LIGA.
--
-- A coluna nasce `false` para todas as categorias, o que preserva o
-- comportamento atual em qualquer base existente. As duas abaixo passam a
-- agrupar — e so elas, porque so nelas a liga e a unidade de trabalho.
--
-- Como em `peso` e `limiarConfianca` (A11/A12), o valor entra por MIGRACAO e
-- fica de fora do `update` do seed: mudanca por decisao do dono e explicita e
-- roda uma vez; o seed nao pode reescrever ajuste deliberado do operador.
UPDATE "Categoria" SET "agrupaPorLiga" = true WHERE "codigo" IN ('LIGANTE', 'EMAIL_LIGA');
