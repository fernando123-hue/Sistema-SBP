-- As triggers da trilha, recriadas para que o backup do banco RESTAURE.
--
-- O defeito (achado no ensaio da instalação, 01/10/2026, `AT-66`): a migração
-- `20260918010000_trilha_append_only` criou as duas triggers num mesmo lote de
-- comandos, com o corpo de um comando só, sem `BEGIN … END`. O MySQL guardou o
-- corpo de `LogAuditoria_append_only` COM o `;` do fim (o da última trigger do
-- arquivo saiu sem). O `mysqldump` escreve esse corpo dentro de um comentário
-- `/*!50003 … */`, o `;` fecha o comando antes do `*/`, e a restauração para
-- com `ERROR 1064`. O `mysql` aborta ali: `LogAuditoria` volta SEM a trava, e
-- as tabelas que vêm depois dela no arquivo não voltam.
--
-- A trava em si não muda: o mesmo `BEFORE UPDATE`, a mesma mensagem. Muda a
-- forma do corpo, com `BEGIN … END`, que termina em `END` e o `mysqldump`
-- devolve inteiro; e o nome, pela ordem abaixo.
--
-- ═══ A ORDEM: CRIAR AS NOVAS ANTES DE APAGAR AS ANTIGAS ═══
--
-- DDL no MySQL não é transacional. Apagando primeiro, um `CREATE` que falhe
-- deixa a trilha sem trava nenhuma, e a aplicação sobe normal (revisões do
-- #184, medido): com binlog ligado, criar trigger exige `SUPER` de quem migra
-- (`ERROR 1419`), e quem rodasse este arquivo pelo cliente `mysql`, sem
-- `DELIMITER`, também quebraria no primeiro `BEGIN`. O MySQL 8 aceita mais de
-- uma trigger no mesmo evento, então as novas nascem ao lado das antigas, e
-- só depois as antigas saem. Qualquer falha no meio deixa ao menos uma trava.
--
-- Os `DROP … IF EXISTS` do começo tiram só as NOVAS, de uma tentativa anterior
-- que parou no meio: assim o arquivo pode rodar de novo depois de um
-- `prisma migrate resolve --rolled-back`.
--
-- Aplique só por `prisma migrate deploy`, com a conta administradora do MySQL.
-- Depois, `npm run db:conferir-trilha`, com a mesma conta, confirma as duas.
-- A regra para o futuro, que `trilha-append-only.test.ts` confere em toda
-- trigger da base: corpo de trigger sempre entre `BEGIN` e `END`.

DROP TRIGGER IF EXISTS LogAuditoria_recusa_update;
DROP TRIGGER IF EXISTS EventoProcessamento_recusa_update;

CREATE TRIGGER LogAuditoria_recusa_update
BEFORE UPDATE ON LogAuditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'LogAuditoria e append-only: grave um registro novo em vez de alterar o passado';
END;

CREATE TRIGGER EventoProcessamento_recusa_update
BEFORE UPDATE ON EventoProcessamento
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'EventoProcessamento e append-only: grave um registro novo em vez de alterar o passado';
END;

DROP TRIGGER IF EXISTS LogAuditoria_append_only;
DROP TRIGGER IF EXISTS EventoProcessamento_append_only;
