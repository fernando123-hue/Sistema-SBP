-- A trilha é append-only no BANCO, não só por convenção (achado N-19).
--
-- `LogAuditoria` e `EventoProcessamento` são a memória que os invariantes 11,
-- 12 e 14 do `CLAUDE.md` prometem nunca reescrever. Até aqui a promessa vivia
-- só no código: a aplicação conecta com um usuário que pode tudo, e um
-- `UPDATE` — por engano, por script solto ou por um cliente aberto às pressas
-- numa madrugada — passaria sem deixar sinal. Que é justamente o que uma
-- trilha existe para impedir.
--
-- Corrigir registro errado continua possível, e do jeito certo: gravando um
-- registro NOVO que explique o anterior.
--
-- O DELETE fica de fora de propósito: a suíte limpa as tabelas entre casos, e
-- `db:limpar` reinicia a demo em desenvolvimento. Em produção quem impede
-- DELETE é o privilégio do usuário do banco (ver `docs/03-SPEC.md`), que é a
-- ferramenta certa para isso — uma trava aqui seria paga todo dia para
-- proteger o que o GRANT já resolve.

DROP TRIGGER IF EXISTS LogAuditoria_append_only;
DROP TRIGGER IF EXISTS EventoProcessamento_append_only;

CREATE TRIGGER LogAuditoria_append_only
BEFORE UPDATE ON LogAuditoria
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'LogAuditoria e append-only: grave um registro novo em vez de alterar o passado';

CREATE TRIGGER EventoProcessamento_append_only
BEFORE UPDATE ON EventoProcessamento
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'EventoProcessamento e append-only: grave um registro novo em vez de alterar o passado';
