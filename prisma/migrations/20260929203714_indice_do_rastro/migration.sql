-- Índice do rastro (pendência 11). O novo nasce ANTES de o velho sair: numa
-- tabela grande, a ordem inversa deixaria as leituras por tipo sem índice
-- nenhum durante a criação. O `[situacao, etapa]` sai porque é prefixo do novo.
--
-- `ALGORITHM=INPLACE, LOCK=NONE`: leitura e escrita seguem durante a criação;
-- se o MySQL não puder garantir isso, RECUSA, em vez de cair calado numa cópia
-- que trava a trilha (revisões do #147). O `lock_wait_timeout` limita a espera
-- pela trava de metadado: sem ele, uma transação esquecida aberta faria o DDL
-- esperar até um ano, com toda consulta nova à tabela na fila atrás dele —
-- inclusive a de cada tentativa de entrada.
--
-- Se falhar no meio (DDL no MySQL não é transacional):
-- - no CREATE: nada fica pela metade, o índice antigo continua; corrigir a
--   causa e rodar `npx prisma migrate resolve --rolled-back 20260929203714_indice_do_rastro`
--   antes do próximo deploy;
-- - no DROP: ficam os dois índices, estado inofensivo; apagar o antigo à mão
--   e rodar `npx prisma migrate resolve --applied 20260929203714_indice_do_rastro`.
SET SESSION lock_wait_timeout = 30;

-- CreateIndex
CREATE INDEX `EventoProcessamento_situacao_etapa_referencia_criadoEm_idx` ON `EventoProcessamento`(`situacao`, `etapa`, `referencia`, `criadoEm`) ALGORITHM=INPLACE LOCK=NONE;

-- DropIndex
DROP INDEX `EventoProcessamento_situacao_etapa_idx` ON `EventoProcessamento` ALGORITHM=INPLACE LOCK=NONE;
