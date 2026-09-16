-- AlterTable
ALTER TABLE "Item" ADD COLUMN "cpfProtegido" TEXT;

-- CreateIndex
CREATE INDEX "Item_cpfProtegido_idx" ON "Item"("cpfProtegido");
