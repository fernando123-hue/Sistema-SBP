-- Invariante 14: toda linha de memória nasce sabendo de que domínio é.
-- Sem valor padrão, quem esquecer o domínio recebe erro do banco, em vez de
-- "distribuicao" gravado em silêncio numa trilha que nunca pode ser corrigida.

-- AlterTable
ALTER TABLE `EventoProcessamento` ALTER COLUMN `dominio` DROP DEFAULT;

-- AlterTable
ALTER TABLE `LogAuditoria` ALTER COLUMN `dominio` DROP DEFAULT;

-- AlterTable
ALTER TABLE `Nota` ALTER COLUMN `dominio` DROP DEFAULT;
