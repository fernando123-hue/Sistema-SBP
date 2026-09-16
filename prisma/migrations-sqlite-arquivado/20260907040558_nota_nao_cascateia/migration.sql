-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Nota" (
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
    CONSTRAINT "Nota_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Nota_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "Liga" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Nota" ("arquivadaEm", "arquivadaPor", "autorId", "categoriaId", "criadoEm", "dominio", "id", "ligaId", "motivoArquivo", "texto") SELECT "arquivadaEm", "arquivadaPor", "autorId", "categoriaId", "criadoEm", "dominio", "id", "ligaId", "motivoArquivo", "texto" FROM "Nota";
DROP TABLE "Nota";
ALTER TABLE "new_Nota" RENAME TO "Nota";
CREATE INDEX "Nota_categoriaId_arquivadaEm_idx" ON "Nota"("categoriaId", "arquivadaEm");
CREATE INDEX "Nota_ligaId_arquivadaEm_idx" ON "Nota"("ligaId", "arquivadaEm");
CREATE INDEX "Nota_arquivadaEm_criadoEm_idx" ON "Nota"("arquivadaEm", "criadoEm");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
