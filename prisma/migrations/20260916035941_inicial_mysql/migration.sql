-- CreateTable
CREATE TABLE `Colaborador` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(200) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `papel` VARCHAR(191) NOT NULL DEFAULT 'colaborador',
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `dataEntrada` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataSaida` DATETIME(3) NULL,
    `senhaHash` VARCHAR(255) NULL,
    `senhaDefinidaEm` DATETIME(3) NULL,
    `precisaTrocarSenha` BOOLEAN NOT NULL DEFAULT false,
    `tentativasFalhas` INTEGER NOT NULL DEFAULT 0,
    `bloqueadoAte` DATETIME(3) NULL,
    `sessoesInvalidasAntes` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Colaborador_email_key`(`email`),
    INDEX `Colaborador_ativo_idx`(`ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Categoria` (
    `id` VARCHAR(191) NOT NULL,
    `codigo` VARCHAR(191) NOT NULL,
    `rotulo` VARCHAR(191) NOT NULL,
    `frente` VARCHAR(191) NOT NULL,
    `grupo` VARCHAR(191) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `divisivel` BOOLEAN NOT NULL DEFAULT true,
    `peso` DOUBLE NOT NULL DEFAULT 1,
    `limiarIndivisivel` INTEGER NOT NULL DEFAULT 3,
    `limiarConfianca` DOUBLE NOT NULL DEFAULT 0.85,
    `entraNoRateio` BOOLEAN NOT NULL DEFAULT true,
    `agrupaPorLiga` BOOLEAN NOT NULL DEFAULT false,
    `ativa` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Categoria_codigo_key`(`codigo`),
    INDEX `Categoria_frente_grupo_ordem_idx`(`frente`, `grupo`, `ordem`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Habilitacao` (
    `id` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `categoriaId` VARCHAR(191) NOT NULL,
    `podeReceber` BOOLEAN NOT NULL DEFAULT true,
    `vigenciaInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `vigenciaFim` DATETIME(3) NULL,

    INDEX `Habilitacao_categoriaId_podeReceber_idx`(`categoriaId`, `podeReceber`),
    UNIQUE INDEX `Habilitacao_colaboradorId_categoriaId_vigenciaInicio_key`(`colaboradorId`, `categoriaId`, `vigenciaInicio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Escala` (
    `id` VARCHAR(191) NOT NULL,
    `data` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `disponivel` BOOLEAN NOT NULL DEFAULT true,
    `capacidadeRelativa` DOUBLE NOT NULL DEFAULT 1,
    `observacao` TEXT NULL,

    INDEX `Escala_data_disponivel_idx`(`data`, `disponivel`),
    UNIQUE INDEX `Escala_data_colaboradorId_key`(`data`, `colaboradorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Afastamento` (
    `id` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `inicio` VARCHAR(191) NOT NULL,
    `fim` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `registradoPor` VARCHAR(191) NOT NULL,
    `registradoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `canceladoEm` DATETIME(3) NULL,
    `canceladoPor` VARCHAR(191) NULL,
    `encerradoPor` VARCHAR(191) NULL,
    `motivoExpurgadoEm` DATETIME(3) NULL,

    INDEX `Afastamento_colaboradorId_inicio_idx`(`colaboradorId`, `inicio`),
    INDEX `Afastamento_inicio_fim_idx`(`inicio`, `fim`),
    INDEX `Afastamento_motivoExpurgadoEm_idx`(`motivoExpurgadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Email` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `origem` VARCHAR(191) NOT NULL DEFAULT 'mock',
    `recebidoEm` DATETIME(3) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `modeloIa` VARCHAR(191) NULL,
    `versaoPrompt` VARCHAR(191) NULL,
    `processadoEm` DATETIME(3) NULL,
    `conteudoExpurgadoEm` DATETIME(3) NULL,
    `conteudoSuspeito` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Email_messageId_key`(`messageId`),
    INDEX `Email_recebidoEm_idx`(`recebidoEm`),
    INDEX `Email_origem_processadoEm_idx`(`origem`, `processadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailConteudo` (
    `emailId` VARCHAR(191) NOT NULL,
    `remetente` VARCHAR(320) NOT NULL,
    `assunto` TEXT NOT NULL,
    `corpo` LONGTEXT NOT NULL,

    PRIMARY KEY (`emailId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Anexo` (
    `id` VARCHAR(191) NOT NULL,
    `emailId` VARCHAR(191) NOT NULL,
    `nomeSeguro` VARCHAR(255) NOT NULL,
    `tipoDeclarado` VARCHAR(200) NOT NULL,
    `tamanho` INTEGER NOT NULL,
    `hash` VARCHAR(191) NULL,
    `aceito` BOOLEAN NOT NULL DEFAULT false,
    `motivo` TEXT NULL,
    `chaveArmazenamento` VARCHAR(191) NULL,
    `armazenadoEm` DATETIME(3) NULL,
    `bytesExpurgadosEm` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Anexo_emailId_idx`(`emailId`),
    INDEX `Anexo_hash_idx`(`hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` VARCHAR(191) NOT NULL,
    `emailId` VARCHAR(191) NULL,
    `categoriaId` VARCHAR(191) NOT NULL,
    `sequencia` INTEGER NOT NULL DEFAULT 1,
    `titulo` VARCHAR(300) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `confianca` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'novo',
    `ligaId` VARCHAR(191) NULL,
    `modeloIa` VARCHAR(191) NULL,
    `versaoPrompt` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,
    `cpfProtegido` VARCHAR(191) NULL,
    `matricula` VARCHAR(191) NULL,
    `dadosExtraidosExpurgadosEm` DATETIME(3) NULL,
    `canceladoEm` DATETIME(3) NULL,

    INDEX `Item_status_categoriaId_idx`(`status`, `categoriaId`),
    INDEX `Item_categoriaId_status_criadoEm_idx`(`categoriaId`, `status`, `criadoEm`),
    INDEX `Item_cpfProtegido_idx`(`cpfProtegido`),
    INDEX `Item_matricula_idx`(`matricula`),
    INDEX `Item_dadosExtraidosExpurgadosEm_idx`(`dadosExtraidosExpurgadosEm`),
    UNIQUE INDEX `Item_emailId_sequencia_key`(`emailId`, `sequencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TravaDeDistribuicao` (
    `data` VARCHAR(191) NOT NULL,
    `execucoes` INTEGER NOT NULL DEFAULT 0,
    `atualizadoEm` DATETIME(3) NOT NULL,

    PRIMARY KEY (`data`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RodadaDistribuicao` (
    `id` VARCHAR(191) NOT NULL,
    `data` VARCHAR(191) NOT NULL,
    `categoriaId` VARCHAR(191) NOT NULL,
    `quantidadeEntrada` INTEGER NOT NULL,
    `algoritmoVersao` VARCHAR(191) NOT NULL,
    `criterio` VARCHAR(191) NOT NULL,
    `base` INTEGER NOT NULL DEFAULT 0,
    `resto` INTEGER NOT NULL DEFAULT 0,
    `cotaJusta` DOUBLE NOT NULL DEFAULT 0,
    `elegiveis` TEXT NOT NULL,
    `ordemDesempate` TEXT NOT NULL,
    `alocacao` TEXT NOT NULL,
    `creditoAntes` TEXT NOT NULL,
    `creditoDepois` TEXT NOT NULL,
    `executadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `executadoPor` VARCHAR(191) NOT NULL,
    `correlacaoId` VARCHAR(191) NOT NULL,

    INDEX `RodadaDistribuicao_data_categoriaId_idx`(`data`, `categoriaId`),
    INDEX `RodadaDistribuicao_correlacaoId_idx`(`correlacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Atribuicao` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `rodadaId` VARCHAR(191) NULL,
    `motivo` VARCHAR(191) NOT NULL,
    `atribuidoPor` VARCHAR(191) NOT NULL,
    `ativa` BOOLEAN NULL,
    `atribuidoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `encerradoEm` DATETIME(3) NULL,

    INDEX `Atribuicao_colaboradorId_ativa_idx`(`colaboradorId`, `ativa`),
    INDEX `Atribuicao_rodadaId_idx`(`rodadaId`),
    UNIQUE INDEX `Atribuicao_itemId_ativa_key`(`itemId`, `ativa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JustificativaDeAtribuicao` (
    `id` VARCHAR(191) NOT NULL,
    `atribuicaoId` VARCHAR(191) NOT NULL,
    `motivo` VARCHAR(191) NOT NULL,
    `texto` TEXT NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JustificativaDeAtribuicao_atribuicaoId_idx`(`atribuicaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Execucao` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `iniciadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `concluidoEm` DATETIME(3) NULL,
    `resultado` VARCHAR(191) NULL,
    `observacao` TEXT NULL,

    INDEX `Execucao_colaboradorId_concluidoEm_idx`(`colaboradorId`, `concluidoEm`),
    INDEX `Execucao_itemId_idx`(`itemId`),
    INDEX `Execucao_resultado_concluidoEm_idx`(`resultado`, `concluidoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaldoCarga` (
    `id` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `categoriaId` VARCHAR(191) NOT NULL,
    `data` VARCHAR(191) NOT NULL,
    `recebido` INTEGER NOT NULL DEFAULT 0,
    `recebidoPonderado` DOUBLE NOT NULL DEFAULT 0,
    `cotaJusta` DOUBLE NOT NULL DEFAULT 0,
    `creditoAcumulado` DOUBLE NOT NULL DEFAULT 0,

    INDEX `SaldoCarga_categoriaId_data_idx`(`categoriaId`, `data`),
    UNIQUE INDEX `SaldoCarga_colaboradorId_categoriaId_data_key`(`colaboradorId`, `categoriaId`, `data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaldoCargaGlobal` (
    `id` VARCHAR(191) NOT NULL,
    `colaboradorId` VARCHAR(191) NOT NULL,
    `escopo` VARCHAR(191) NOT NULL DEFAULT 'CADASTRO',
    `data` VARCHAR(191) NOT NULL,
    `recebidoPonderado` DOUBLE NOT NULL DEFAULT 0,
    `creditoGlobal` DOUBLE NOT NULL DEFAULT 0,

    INDEX `SaldoCargaGlobal_escopo_data_idx`(`escopo`, `data`),
    UNIQUE INDEX `SaldoCargaGlobal_colaboradorId_escopo_data_key`(`colaboradorId`, `escopo`, `data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Liga` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(200) NOT NULL,
    `instituicao` VARCHAR(200) NULL,
    `uf` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ativa',
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Liga_nome_instituicao_key`(`nome`, `instituicao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ligante` (
    `id` VARCHAR(191) NOT NULL,
    `ligaId` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `vinculo` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Ligante_ligaId_idx`(`ligaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Nota` (
    `id` VARCHAR(191) NOT NULL,
    `texto` TEXT NOT NULL,
    `categoriaId` VARCHAR(191) NULL,
    `ligaId` VARCHAR(191) NULL,
    `autorId` VARCHAR(191) NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `arquivadaEm` DATETIME(3) NULL,
    `arquivadaPor` VARCHAR(191) NULL,
    `motivoArquivo` TEXT NULL,
    `dominio` VARCHAR(191) NOT NULL DEFAULT 'distribuicao',

    INDEX `Nota_categoriaId_arquivadaEm_idx`(`categoriaId`, `arquivadaEm`),
    INDEX `Nota_ligaId_arquivadaEm_idx`(`ligaId`, `arquivadaEm`),
    INDEX `Nota_arquivadaEm_criadoEm_idx`(`arquivadaEm`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegraDistribuicao` (
    `id` VARCHAR(191) NOT NULL,
    `categoriaId` VARCHAR(191) NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `parametros` TEXT NOT NULL,
    `vigenciaInicio` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `vigenciaFim` DATETIME(3) NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `criadoPor` VARCHAR(191) NOT NULL,

    INDEX `RegraDistribuicao_tipo_ativo_idx`(`tipo`, `ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrazoDeRetencao` (
    `chave` VARCHAR(191) NOT NULL,
    `dias` INTEGER NOT NULL,
    `alteradoPor` VARCHAR(191) NOT NULL,
    `alteradoEm` DATETIME(3) NOT NULL,

    PRIMARY KEY (`chave`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExecucaoDeRotina` (
    `id` VARCHAR(191) NOT NULL,
    `rotina` VARCHAR(191) NOT NULL,
    `data` VARCHAR(191) NOT NULL,
    `situacao` VARCHAR(191) NOT NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 1,
    `iniciadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `concluidaEm` DATETIME(3) NULL,
    `resumo` TEXT NULL,
    `mensagem` TEXT NULL,
    `correlacaoId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ExecucaoDeRotina_rotina_data_key`(`rotina`, `data`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AvisoVisto` (
    `colaboradorId` VARCHAR(191) NOT NULL,
    `data` VARCHAR(191) NOT NULL,
    `chaves` TEXT NOT NULL,
    `vistoEm` DATETIME(3) NOT NULL,

    PRIMARY KEY (`colaboradorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Revisao` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `motivo` VARCHAR(191) NOT NULL,
    `campoIncerto` VARCHAR(191) NULL,
    `sugestaoIa` TEXT NOT NULL,
    `confianca` DOUBLE NOT NULL,
    `valorFinal` TEXT NULL,
    `desfecho` VARCHAR(191) NULL,
    `correcoes` TEXT NULL,
    `resolvidoPor` VARCHAR(191) NULL,
    `resolvidoEm` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Revisao_resolvidoEm_motivo_idx`(`resolvidoEm`, `motivo`),
    INDEX `Revisao_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogAuditoria` (
    `id` VARCHAR(191) NOT NULL,
    `dominio` VARCHAR(191) NOT NULL DEFAULT 'distribuicao',
    `entidade` VARCHAR(191) NOT NULL,
    `entidadeId` VARCHAR(191) NOT NULL,
    `acao` VARCHAR(191) NOT NULL,
    `antes` TEXT NULL,
    `depois` TEXT NULL,
    `usuario` VARCHAR(191) NOT NULL,
    `correlacaoId` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LogAuditoria_entidade_entidadeId_idx`(`entidade`, `entidadeId`),
    INDEX `LogAuditoria_timestamp_idx`(`timestamp`),
    INDEX `LogAuditoria_correlacaoId_idx`(`correlacaoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventoProcessamento` (
    `id` VARCHAR(191) NOT NULL,
    `dominio` VARCHAR(191) NOT NULL DEFAULT 'distribuicao',
    `correlacaoId` VARCHAR(191) NOT NULL,
    `etapa` VARCHAR(191) NOT NULL,
    `situacao` VARCHAR(191) NOT NULL,
    `referencia` VARCHAR(191) NULL,
    `mensagem` TEXT NULL,
    `detalhe` TEXT NULL,
    `duracaoMs` INTEGER NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EventoProcessamento_correlacaoId_idx`(`correlacaoId`),
    INDEX `EventoProcessamento_situacao_etapa_idx`(`situacao`, `etapa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Habilitacao` ADD CONSTRAINT `Habilitacao_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Habilitacao` ADD CONSTRAINT `Habilitacao_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `Categoria`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Escala` ADD CONSTRAINT `Escala_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Afastamento` ADD CONSTRAINT `Afastamento_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailConteudo` ADD CONSTRAINT `EmailConteudo_emailId_fkey` FOREIGN KEY (`emailId`) REFERENCES `Email`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Anexo` ADD CONSTRAINT `Anexo_emailId_fkey` FOREIGN KEY (`emailId`) REFERENCES `Email`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_emailId_fkey` FOREIGN KEY (`emailId`) REFERENCES `Email`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `Categoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_ligaId_fkey` FOREIGN KEY (`ligaId`) REFERENCES `Liga`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RodadaDistribuicao` ADD CONSTRAINT `RodadaDistribuicao_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `Categoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Atribuicao` ADD CONSTRAINT `Atribuicao_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Atribuicao` ADD CONSTRAINT `Atribuicao_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Atribuicao` ADD CONSTRAINT `Atribuicao_rodadaId_fkey` FOREIGN KEY (`rodadaId`) REFERENCES `RodadaDistribuicao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JustificativaDeAtribuicao` ADD CONSTRAINT `JustificativaDeAtribuicao_atribuicaoId_fkey` FOREIGN KEY (`atribuicaoId`) REFERENCES `Atribuicao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execucao` ADD CONSTRAINT `Execucao_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Execucao` ADD CONSTRAINT `Execucao_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaldoCarga` ADD CONSTRAINT `SaldoCarga_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaldoCarga` ADD CONSTRAINT `SaldoCarga_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `Categoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaldoCargaGlobal` ADD CONSTRAINT `SaldoCargaGlobal_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ligante` ADD CONSTRAINT `Ligante_ligaId_fkey` FOREIGN KEY (`ligaId`) REFERENCES `Liga`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Nota` ADD CONSTRAINT `Nota_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `Colaborador`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Nota` ADD CONSTRAINT `Nota_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `Categoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Nota` ADD CONSTRAINT `Nota_ligaId_fkey` FOREIGN KEY (`ligaId`) REFERENCES `Liga`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegraDistribuicao` ADD CONSTRAINT `RegraDistribuicao_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `Categoria`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AvisoVisto` ADD CONSTRAINT `AvisoVisto_colaboradorId_fkey` FOREIGN KEY (`colaboradorId`) REFERENCES `Colaborador`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Revisao` ADD CONSTRAINT `Revisao_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Revisao` ADD CONSTRAINT `Revisao_resolvidoPor_fkey` FOREIGN KEY (`resolvidoPor`) REFERENCES `Colaborador`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
