-- CreateTable
CREATE TABLE "Colaborador" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" TEXT NOT NULL DEFAULT 'colaborador',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "dataEntrada" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSaida" DATETIME,
    "senhaHash" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "frente" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "divisivel" BOOLEAN NOT NULL DEFAULT true,
    "peso" REAL NOT NULL DEFAULT 1,
    "limiarIndivisivel" INTEGER NOT NULL DEFAULT 3,
    "limiarConfianca" REAL NOT NULL DEFAULT 0.85,
    "entraNoRateio" BOOLEAN NOT NULL DEFAULT true,
    "ativa" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Habilitacao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "podeReceber" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaInicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaFim" DATETIME,
    CONSTRAINT "Habilitacao_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Habilitacao_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Escala" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "capacidadeRelativa" REAL NOT NULL DEFAULT 1,
    "observacao" TEXT,
    CONSTRAINT "Escala_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "remetente" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "anexos" TEXT NOT NULL DEFAULT '[]',
    "origem" TEXT NOT NULL DEFAULT 'mock',
    "recebidoEm" DATETIME NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modeloIa" TEXT,
    "versaoPrompt" TEXT,
    "processadoEm" DATETIME
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailId" TEXT,
    "categoriaId" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL DEFAULT 1,
    "titulo" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "confianca" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'novo',
    "ligaId" TEXT,
    "modeloIa" TEXT,
    "versaoPrompt" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL,
    CONSTRAINT "Item_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Item_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "Liga" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RodadaDistribuicao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "quantidadeEntrada" INTEGER NOT NULL,
    "algoritmoVersao" TEXT NOT NULL,
    "criterio" TEXT NOT NULL,
    "base" INTEGER NOT NULL DEFAULT 0,
    "resto" INTEGER NOT NULL DEFAULT 0,
    "cotaJusta" REAL NOT NULL DEFAULT 0,
    "elegiveis" TEXT NOT NULL,
    "ordemDesempate" TEXT NOT NULL,
    "alocacao" TEXT NOT NULL,
    "creditoAntes" TEXT NOT NULL,
    "creditoDepois" TEXT NOT NULL,
    "executadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executadoPor" TEXT NOT NULL,
    "correlacaoId" TEXT NOT NULL,
    CONSTRAINT "RodadaDistribuicao_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Atribuicao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "rodadaId" TEXT,
    "motivo" TEXT NOT NULL,
    "justificativa" TEXT,
    "atribuidoPor" TEXT NOT NULL,
    "ativa" BOOLEAN,
    "atribuidoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradoEm" DATETIME,
    CONSTRAINT "Atribuicao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Atribuicao_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Atribuicao_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "RodadaDistribuicao" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Execucao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "iniciadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" DATETIME,
    "resultado" TEXT,
    "observacao" TEXT,
    CONSTRAINT "Execucao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Execucao_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaldoCarga" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "recebido" INTEGER NOT NULL DEFAULT 0,
    "cotaJusta" REAL NOT NULL DEFAULT 0,
    "creditoAcumulado" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "SaldoCarga_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SaldoCarga_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaldoCargaGlobal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "colaboradorId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "recebidoPonderado" REAL NOT NULL DEFAULT 0,
    "creditoGlobal" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "SaldoCargaGlobal_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Liga" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "instituicao" TEXT,
    "uf" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ativa',
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Ligante" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ligaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "vinculo" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ligante_ligaId_fkey" FOREIGN KEY ("ligaId") REFERENCES "Liga" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegraDistribuicao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoriaId" TEXT,
    "tipo" TEXT NOT NULL,
    "parametros" TEXT NOT NULL,
    "vigenciaInicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaFim" DATETIME,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoPor" TEXT NOT NULL,
    CONSTRAINT "RegraDistribuicao_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Revisao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "campoIncerto" TEXT,
    "sugestaoIa" TEXT NOT NULL,
    "confianca" REAL NOT NULL,
    "valorFinal" TEXT,
    "resolvidoPor" TEXT,
    "resolvidoEm" DATETIME,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Revisao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Revisao_resolvidoPor_fkey" FOREIGN KEY ("resolvidoPor") REFERENCES "Colaborador" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogAuditoria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "antes" TEXT,
    "depois" TEXT,
    "usuario" TEXT NOT NULL,
    "correlacaoId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EventoProcessamento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "correlacaoId" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "referencia" TEXT,
    "mensagem" TEXT,
    "detalhe" TEXT,
    "duracaoMs" INTEGER,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_email_key" ON "Colaborador"("email");

-- CreateIndex
CREATE INDEX "Colaborador_ativo_idx" ON "Colaborador"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_codigo_key" ON "Categoria"("codigo");

-- CreateIndex
CREATE INDEX "Categoria_frente_grupo_ordem_idx" ON "Categoria"("frente", "grupo", "ordem");

-- CreateIndex
CREATE INDEX "Habilitacao_categoriaId_podeReceber_idx" ON "Habilitacao"("categoriaId", "podeReceber");

-- CreateIndex
CREATE UNIQUE INDEX "Habilitacao_colaboradorId_categoriaId_vigenciaInicio_key" ON "Habilitacao"("colaboradorId", "categoriaId", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "Escala_data_disponivel_idx" ON "Escala"("data", "disponivel");

-- CreateIndex
CREATE UNIQUE INDEX "Escala_data_colaboradorId_key" ON "Escala"("data", "colaboradorId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_messageId_key" ON "Email"("messageId");

-- CreateIndex
CREATE INDEX "Email_recebidoEm_idx" ON "Email"("recebidoEm");

-- CreateIndex
CREATE INDEX "Email_origem_processadoEm_idx" ON "Email"("origem", "processadoEm");

-- CreateIndex
CREATE INDEX "Item_status_categoriaId_idx" ON "Item"("status", "categoriaId");

-- CreateIndex
CREATE INDEX "Item_categoriaId_status_criadoEm_idx" ON "Item"("categoriaId", "status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Item_emailId_sequencia_key" ON "Item"("emailId", "sequencia");

-- CreateIndex
CREATE INDEX "RodadaDistribuicao_data_categoriaId_idx" ON "RodadaDistribuicao"("data", "categoriaId");

-- CreateIndex
CREATE INDEX "RodadaDistribuicao_correlacaoId_idx" ON "RodadaDistribuicao"("correlacaoId");

-- CreateIndex
CREATE INDEX "Atribuicao_colaboradorId_ativa_idx" ON "Atribuicao"("colaboradorId", "ativa");

-- CreateIndex
CREATE INDEX "Atribuicao_rodadaId_idx" ON "Atribuicao"("rodadaId");

-- CreateIndex
CREATE UNIQUE INDEX "Atribuicao_itemId_ativa_key" ON "Atribuicao"("itemId", "ativa");

-- CreateIndex
CREATE INDEX "Execucao_colaboradorId_concluidoEm_idx" ON "Execucao"("colaboradorId", "concluidoEm");

-- CreateIndex
CREATE INDEX "Execucao_itemId_idx" ON "Execucao"("itemId");

-- CreateIndex
CREATE INDEX "SaldoCarga_categoriaId_data_idx" ON "SaldoCarga"("categoriaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "SaldoCarga_colaboradorId_categoriaId_data_key" ON "SaldoCarga"("colaboradorId", "categoriaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "SaldoCargaGlobal_colaboradorId_data_key" ON "SaldoCargaGlobal"("colaboradorId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "Liga_nome_instituicao_key" ON "Liga"("nome", "instituicao");

-- CreateIndex
CREATE INDEX "Ligante_ligaId_idx" ON "Ligante"("ligaId");

-- CreateIndex
CREATE INDEX "RegraDistribuicao_tipo_ativo_idx" ON "RegraDistribuicao"("tipo", "ativo");

-- CreateIndex
CREATE INDEX "Revisao_resolvidoEm_motivo_idx" ON "Revisao"("resolvidoEm", "motivo");

-- CreateIndex
CREATE INDEX "Revisao_itemId_idx" ON "Revisao"("itemId");

-- CreateIndex
CREATE INDEX "LogAuditoria_entidade_entidadeId_idx" ON "LogAuditoria"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "LogAuditoria_timestamp_idx" ON "LogAuditoria"("timestamp");

-- CreateIndex
CREATE INDEX "LogAuditoria_correlacaoId_idx" ON "LogAuditoria"("correlacaoId");

-- CreateIndex
CREATE INDEX "EventoProcessamento_correlacaoId_idx" ON "EventoProcessamento"("correlacaoId");

-- CreateIndex
CREATE INDEX "EventoProcessamento_situacao_etapa_idx" ON "EventoProcessamento"("situacao", "etapa");
