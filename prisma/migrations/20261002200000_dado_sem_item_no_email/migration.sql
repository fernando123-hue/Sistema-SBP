-- `AT-73`, `A76`: o motivo pelo qual um e-mail sem item ficou guardado (cpf, crm ou anexo).
-- Só o rótulo, nunca o dado; nulo para todo e-mail que já existe.
ALTER TABLE `Email` ADD COLUMN `dadoSemItem` VARCHAR(10) NULL;
