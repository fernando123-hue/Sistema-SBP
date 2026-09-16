-- Colação sensível a maiúsculas e acentos em todas as tabelas (AT-10, AT-34).
--
-- O Prisma escreve `COLLATE utf8mb4_unicode_ci` em cada CREATE TABLE, e a
-- colação da tabela vence a da base. Com `unicode_ci`, "Liga de Neonatologia"
-- e "liga de neonatologia" colidem no índice único de `Liga` e viram a mesma
-- liga. Converter só afrouxa unicidade (o que era igual passa a ser diferente),
-- então nenhuma linha existente pode violar um índice por causa disto.
--
-- As chaves estrangeiras ligam colunas de texto entre tabelas, e o MySQL exige
-- a mesma colação dos dois lados. Convertidas uma de cada vez, a primeira
-- ficaria diferente da segunda; por isso a checagem sai durante a conversão e
-- volta no fim. Toda tabela nova precisa entrar aqui ou numa migração igual —
-- `src/servidor/colacao.test.ts` falha se alguma escapar.

ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `Colaborador` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Categoria` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Habilitacao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Escala` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Afastamento` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Email` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `EmailConteudo` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Anexo` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Item` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `TravaDeDistribuicao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `RodadaDistribuicao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Atribuicao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `JustificativaDeAtribuicao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Execucao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `SaldoCarga` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `SaldoCargaGlobal` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Liga` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Ligante` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Nota` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `RegraDistribuicao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `PrazoDeRetencao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `ExecucaoDeRotina` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `AvisoVisto` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `Revisao` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `LogAuditoria` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `EventoProcessamento` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
ALTER TABLE `ContagemDeBusca` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;

SET FOREIGN_KEY_CHECKS = 1;
