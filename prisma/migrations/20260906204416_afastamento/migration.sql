-- CreateTable
CREATE TABLE "Afastamento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "inicio" TEXT NOT NULL,
    "fim" TEXT,
    "observacao" TEXT,
    "registradoPor" TEXT NOT NULL,
    "registradoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceladoEm" DATETIME,
    "canceladoPor" TEXT,
    CONSTRAINT "Afastamento_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Afastamento_colaboradorId_inicio_idx" ON "Afastamento"("colaboradorId", "inicio");

-- CreateIndex
CREATE INDEX "Afastamento_inicio_fim_idx" ON "Afastamento"("inicio", "fim");
