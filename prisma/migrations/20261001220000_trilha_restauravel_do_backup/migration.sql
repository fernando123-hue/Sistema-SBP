-- As triggers da trilha, recriadas para que o backup do banco RESTAURE.
--
-- O defeito (achado no ensaio da instalação, 01/10/2026): a migração
-- `20260918010000_trilha_append_only` criou as duas triggers num mesmo lote de
-- comandos, com o corpo de um comando só, sem `BEGIN … END`. O MySQL guardou o
-- corpo de `LogAuditoria_append_only` COM o `;` do fim (o da última trigger do
-- arquivo saiu sem). O `mysqldump` escreve esse corpo dentro de um comentário
-- `/*!50003 … */`, o `;` fecha o comando antes do `*/`, e a restauração para
-- com `ERROR 1064`. O `mysql` aborta ali: as tabelas que vêm depois de
-- `LogAuditoria` no arquivo não voltam. Medido: um backup feito com a migração
-- antiga não restaura.
--
-- A trava em si não muda: as mesmas duas triggers, a mesma mensagem, o mesmo
-- `BEFORE UPDATE`. Muda só a forma do corpo. Com `BEGIN … END` o corpo termina
-- em `END` e o `mysqldump` o devolve inteiro; conferido com um backup e uma
-- restauração completos, as 29 tabelas e as duas triggers de volta.
--
-- A regra para o futuro, que `trilha-append-only.test.ts` confere em toda
-- trigger da base: corpo de trigger sempre entre `BEGIN` e `END`.
--
-- Com binlog ligado (o padrão do MySQL 8.4), criar trigger exige `SUPER` de
-- quem migra: ver `docs/INSTALACAO.md`.

DROP TRIGGER IF EXISTS LogAuditoria_append_only;
DROP TRIGGER IF EXISTS EventoProcessamento_append_only;

CREATE TRIGGER LogAuditoria_append_only
BEFORE UPDATE ON LogAuditoria
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'LogAuditoria e append-only: grave um registro novo em vez de alterar o passado';
END;

CREATE TRIGGER EventoProcessamento_append_only
BEFORE UPDATE ON EventoProcessamento
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'EventoProcessamento e append-only: grave um registro novo em vez de alterar o passado';
END;
