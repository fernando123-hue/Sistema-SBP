-- `A75`: o "obrigado" de um associado vira item, e a fila escreve o texto fixo.
-- Sinal da IA, sem dado pessoal; falso para todo item que já existe.
ALTER TABLE `Item` ADD COLUMN `agradecimento` BOOLEAN NOT NULL DEFAULT false;
