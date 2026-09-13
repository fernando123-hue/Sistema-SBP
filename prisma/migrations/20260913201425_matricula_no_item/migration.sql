-- AlterTable
ALTER TABLE "Item" ADD COLUMN "matricula" TEXT;

-- CreateIndex
CREATE INDEX "Item_matricula_idx" ON "Item"("matricula");
