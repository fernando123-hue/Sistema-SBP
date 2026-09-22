-- ATENÇÃO À CAIXA DOS NOMES — irmã da armadilha registrada em `AT-32`.
--
-- O `prisma migrate dev` que gerou este arquivo rodou no Windows, onde o MySQL
-- guarda nome de tabela em minúsculas (`lower_case_table_names = 1`). Ele
-- escreveu os `DROP FOREIGN KEY` como `ALTER TABLE atribuicao`. No Linux — que
-- é onde o CI roda e para onde a implantação vai — a tabela se chama
-- `Atribuicao`, e a migração morre com "Table 'sbp_sombra.atribuicao' doesn't
-- exist".
--
-- Os nomes abaixo foram corrigidos à mão para a caixa do schema. Quem gerar
-- migração nesta máquina precisa conferir isto ANTES de abrir o PR:
-- localmente passa, e só o CI acusa.

-- Histórico operacional não desaparece em cascata (achado N-22).
--
-- `Atribuicao`, `Execucao`, `JustificativaDeAtribuicao` e `Revisao` guardam o
-- que de fato aconteceu: quem recebeu o quê, quem concluiu, por que devolveu,
-- o que a revisão decidiu. Com `ON DELETE CASCADE`, um `DELETE` no `Item` —
-- script de limpeza, engano num cliente de banco aberto no servidor — levava
-- tudo isso junto, em silêncio. O invariante 11 promete o contrário: conteúdo
-- tem retenção, histórico operacional não se apaga.
--
-- Com `RESTRICT`, o banco RECUSA apagar o pai enquanto houver histórico. Quem
-- precisa limpar de verdade (`db:limpar`, só em desenvolvimento) já apaga os
-- filhos antes, na ordem certa — nada muda para ele.
--
-- `ON UPDATE CASCADE` fica como está: id de item não muda, e se um dia mudar,
-- a referência deve acompanhar.

-- DropForeignKey
ALTER TABLE `Atribuicao` DROP FOREIGN KEY `Atribuicao_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `Execucao` DROP FOREIGN KEY `Execucao_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `JustificativaDeAtribuicao` DROP FOREIGN KEY `JustificativaDeAtribuicao_atribuicaoId_fkey`;

-- DropForeignKey
ALTER TABLE `Revisao` DROP FOREIGN KEY `Revisao_itemId_fkey`;

-- AddForeignKey
ALTER TABLE `Atribuicao` ADD CONSTRAINT `Atribuicao_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JustificativaDeAtribuicao` ADD CONSTRAINT `JustificativaDeAtribuicao_atribuicaoId_fkey` FOREIGN KEY (`atribuicaoId`) REFERENCES `Atribuicao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execucao` ADD CONSTRAINT `Execucao_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Revisao` ADD CONSTRAINT `Revisao_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
