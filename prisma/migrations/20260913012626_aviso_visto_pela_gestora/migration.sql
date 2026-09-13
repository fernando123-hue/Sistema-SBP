-- CreateTable
CREATE TABLE "AvisoVisto" (
    "colaboradorId" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "chaves" TEXT NOT NULL,
    "vistoEm" DATETIME NOT NULL,
    CONSTRAINT "AvisoVisto_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
