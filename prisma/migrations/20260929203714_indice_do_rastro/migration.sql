-- Índice do rastro (pendência 11). O novo nasce ANTES de o velho sair: numa
-- tabela grande, a ordem inversa deixaria as leituras por tipo sem índice
-- nenhum durante a criação. O `[situacao, etapa]` sai porque é prefixo do novo.

-- CreateIndex
CREATE INDEX `EventoProcessamento_situacao_etapa_referencia_criadoEm_idx` ON `EventoProcessamento`(`situacao`, `etapa`, `referencia`, `criadoEm`);

-- DropIndex
DROP INDEX `EventoProcessamento_situacao_etapa_idx` ON `EventoProcessamento`;
