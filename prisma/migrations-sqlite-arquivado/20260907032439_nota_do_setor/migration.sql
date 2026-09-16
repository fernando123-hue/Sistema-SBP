-- CreateTable
CREATE TABLE "Nota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "texto" TEXT NOT NULL,
    "categoriaId" TEXT,
    "ligaId" TEXT,
    "autorId" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arquivadaEm" DATETIME,
    "arquivadaPor" TEXT,
    "motivoArquivo" TEXT,
    "dominio" TEXT NOT NULL DEFAULT 'distribuicao',
    CONSTRAINT "Nota_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Nota_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Nota_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "Liga" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Nota_categoriaId_arquivadaEm_idx" ON "Nota"("categoriaId", "arquivadaEm");

-- CreateIndex
CREATE INDEX "Nota_ligaId_arquivadaEm_idx" ON "Nota"("ligaId", "arquivadaEm");

-- CreateIndex
CREATE INDEX "Nota_arquivadaEm_criadoEm_idx" ON "Nota"("arquivadaEm", "criadoEm");
