# Spec — Sistema de Distribuição de Demandas

> Responde **como**. Arquitetura, dados, motor, ports, telas, stack.

## 1. Princípio de arquitetura

```
IA para interpretar · Algoritmo para decidir · Banco para lembrar · Regra explícita para governar
```

Se um número do painel não puder ser reconstruído passo a passo a partir dos logs, o sistema falhou — mesmo que o número esteja certo.

## 2. Camadas

```
app/          Next.js — rotas, telas.                     Depende de servicos.
api/          Endpoints REST. Toda operação existe aqui primeiro.
servicos/     Transações, Prisma, orquestração.           Depende de core.
servidor/     Sessão, ator, http, prisma, observabilidade.
core/         Domínio puro. TypeScript, zero I/O.         Depende de NADA.
ports/        Contratos: AiPort · IngestaoPort · ArmazenamentoPort.
adapters/     Construídos: ia-mock · ia-anthropic · ingestao-mock
              · armazenamento-disco. Previstos: imap · graph · gmail · nuvem
```

**Regra de dependência:** as setas apontam só para dentro. `core/` não importa Prisma, React, Next nem `fetch`. Isso é o que torna o motor testável em milissegundos e auditável para sempre.

## 3. Fluxo

```
e-mail (adapter)
  → Item bruto, idempotente por message-id
  → IA: classifica · extrai · desdobra em N itens · pontua confiança
  → confiança ≥ limiar da categoria ? aprovado : fila de Revisão
  → revisão humana resolve exceções
  → itens aprovados entram na rodada
  → MOTOR (puro, determinístico) → alocação
  → verificação Σ == Q → commit ou aborta tudo
  → Atribuicao + RodadaDistribuicao + SaldoCarga atualizados
  → fila individual
  → Execucao com timestamp
  → painel (agregação) · exportação (adapter)
```

## 4. Modelo de dados

```
Colaborador        id · nome · email · ativo · papel · data_entrada · data_saida
Categoria          id · codigo · rotulo · frente · grupo · divisivel · peso
                   · limiar_indivisivel · limiar_confianca · entra_no_rateio · ordem
Habilitacao        colaborador_id · categoria_id · pode_receber · vigencia_inicio · vigencia_fim
Escala             data · colaborador_id · disponivel · capacidade_relativa

Email              id · message_id (unique) · recebido_em · origem · dominio
                   · modelo_ia · versao_prompt · conteudo_expurgado_em
EmailConteudo      email_id · remetente · assunto · corpo      ← retenção CURTA
Anexo              email_id · nome · tipo_real · hash · chave_armazenamento
                   · bytes_expurgados_em
Item               id · email_id? · categoria_id · sequencia_no_email · identificador_externo
                   · payload_extraido(json) · confianca_classificacao · liga_id? · associado_id?
                   · status(novo|aguardando_revisao|aprovado|distribuido|em_andamento|concluido|devolvido)
                   · modelo_ia · versao_prompt

Atribuicao         id · item_id · colaborador_id · rodada_id? · atribuido_em
                   · motivo(algoritmo|manual|transferencia|devolucao) · atribuido_por · justificativa · ativa
RodadaDistribuicao id · data · categoria_id · quantidade_entrada · algoritmo_versao
                   · elegiveis(json) · ordem_desempate(json) · alocacao(json)
                   · credito_antes(json) · credito_depois(json) · criterio
                   · executado_em · executado_por
Execucao           id · item_id · colaborador_id · iniciado_em · concluido_em · resultado

SaldoCarga         colaborador_id · categoria_id · data · recebido · cota_justa · credito_acumulado
SaldoCargaGlobal   colaborador_id · data · recebido_ponderado · credito_global

Liga               id · nome · instituicao · uf · status
Ligante            id · liga_id · nome · email · vinculo
RegraDistribuicao  id · categoria_id? · tipo · parametros(json) · vigencia_inicio · vigencia_fim · ativo
Revisao            id · item_id · motivo · campo_incerto · sugestao_ia · confianca
                   · resolvido_por · resolvido_em · valor_final(json)
LogAuditoria       id · entidade · entidade_id · acao · antes(json) · depois(json) · usuario · timestamp
```

**Não vira entidade:** `Mov. Extra` (é `Atribuicao` com outro `motivo`) · `Saldo`/`Aberto`/`Pend.` (são **consultas** sobre `Item.status`) · totais e percentuais (agregação na leitura) · "aba do mês" (filtro de data).

**Relacionamentos**

```
Colaborador ─┬─< Habilitacao >─┬─ Categoria
             ├─< Escala        │
             ├─< Atribuicao >── Item ──┤
             ├─< Execucao              │
             ├─< SaldoCarga >──────────┘
             └─< SaldoCargaGlobal

Email ──< Item          RodadaDistribuicao ──< Atribuicao
Liga  ──< Ligante       Liga ──< Item          Item ──< Revisao
```

### Categorias da V1

| codigo | rotulo | grupo | coluna origem |
|---|---|---|---|
| `DOC_CADASTRO` | Doc. Cadastro | ASSOCIADO | B |
| `FICHA_CADASTRO` | Atualização Cadastro (Ficha) | ASSOCIADO | C |
| `EMAIL_CADASTRO` | E-mail Cadastro | ASSOCIADO | D |
| `LIGA` | Liga | LIGA | F |
| `LIGANTE` | Ligante | LIGA | G |
| `EMAIL_LIGA` | E-mail Liga | LIGA | H |

`grupo` preserva a estrutura que as fórmulas `E=SUM(B:D)` e `I=SUM(F:H)` revelam e que o CONTEXTO tinha achatado.

`INADIMP` e `ISENTO`: `entra_no_rateio = false`. Registro manual, fora do rateio diário.

## 5. Motor de distribuição

### Contrato

```
IN  data · categoria · Q (inteiro ≥ 0) · elegiveis[] · algoritmoVersao
    elegivel = { colaboradorId, creditoCategoria, creditoGlobal,
                 recebidoPeriodo, recebidoDia, capacidadeRelativa }

OUT alocacao{ colaboradorId → inteiro ≥ 0 }  com  Σ alocacao == Q
    + ordemDesempate · criterio · base · resto · cotaJusta
    + creditoAntes · creditoDepois · algoritmoVersao
```

Erros explícitos: `SemElegiveisError` · `QuantidadeInvalidaError` · `ConservacaoVioladaError`.

### Algoritmo — resto maior com memória de crédito

```
1. Q não inteiro ou < 0            → QuantidadeInvalidaError
2. elegiveis vazio                 → SemElegiveisError. Nunca distribuir para ninguém.
3. ordem = ordenar(elegiveis)
4. Q == 0                          → alocação zerada, crédito inalterado, rodada registrada
5. !divisivel  ou  Q <= limiar_indivisivel
                                   → tudo para ordem[0]
6. base  = ⌊Q / n⌋ ;  resto = Q mod n
   cada elegível recebe base ; os primeiros `resto` da ordem recebem +1
7. VERIFICAR Σ alocacao == Q       → falhou: ConservacaoVioladaError, aborta a transação
8. cotaJusta = Q × peso / n
   credito[c] += cotaJusta − alocado[c] × peso
9. retornar snapshot completo
```

### Ordem de desempate

| # | Critério | Origem |
|---|---|---|
| a | maior `creditoCategoria` | RN-13 — formaliza a alternância ±0,5 |
| b | maior `creditoGlobal` | carga total ponderada, desempate secundário |
| c | menor `recebidoPeriodo` | |
| d | menor `recebidoDia` | |
| e | `colaboradorId` asc | determinismo estável |

### Prova

```
QUEBRA         15 ÷ 2 → base 7, resto 1 → o resto vai a quem tem maior crédito
               → 8 + 7 = 15 ✔   (o passo 7 torna 14 e 16 impossíveis de persistir)

BALANCEAMENTO  Seg 15 → Ana 8 · Bia 7   crédito: Ana −0,5 · Bia +0,5
               Ter 15 → Ana 7 · Bia 8   crédito: Ana  0   · Bia  0
               acumulado 15 / 15 ✔

INDIVISÍVEL    FICHA = 3, limiar 3 → 3 ≤ 3 → tudo para um: 3 + 0 ✔
               (reproduz CAD-AGOSTO dia 12)
```

### Precisão numérica

Crédito é fracionário (`Q/n`). Comparações usam `EPSILON = 1e-9`; valores persistidos são arredondados a 6 casas. Impede drift em `n = 3` sem sacrificar determinismo.

## 6. Ports e adapters

| Port | Contrato | Adapter V1 | Depois |
|---|---|---|---|
| `IngestaoPort` | `buscarNovos(): EmailBruto[]` idempotente por `message_id` | `mock` (seed) | `imap` · `graph` · `gmail` |
| `AiPort` | `interpretar(email): { itens[], confianca, evidencia, modelo, versaoPrompt }` | `mock` determinístico | `anthropic` (claude-sonnet-5, structured output) |
| `ExportPort` | `exportar(periodo, formato)` | *(nenhum — planejado, não construído)* | `rest` para o sistema legado |

O adapter mock da IA é determinístico de propósito: permite testar todo o pipeline sem chamar modelo e sem custo.

## 7. API

Envelope único em toda resposta: `{ sucesso, dados, erro, correlacaoId? }`.

**Estado em 28/08/2026 — 24 caminhos, 29 operações.** Auditado contra o código; o que estiver aqui existe, e o que existe está aqui.

```
── Ingestão e revisão ───────────────────────────────────────
POST   /api/ingestao                  dispara o adapter, cria Emails e Itens
GET    /api/revisao                   fila abaixo do limiar
POST   /api/revisao/resolver          aceita/corrige, grava valor_final (id no corpo)

── Itens ────────────────────────────────────────────────────
GET    /api/itens?status=&categoria=  caixa de entrada
POST   /api/itens                     registro manual (balcão, INADIMP., ISENTO)
POST   /api/itens/:id/concluir        gera Execucao
POST   /api/itens/:id/devolver        justificativa obrigatória
POST   /api/itens/:id/transferir      Atribuicao motivo=transferencia
GET    /api/fila?colaborador=         fila individual

── Distribuição ─────────────────────────────────────────────
GET    /api/escala?data=              escala do dia
PUT    /api/escala                    define disponibilidade
POST   /api/distribuicao/previa       roda o motor SEM gravar → prévia
POST   /api/distribuicao/confirmar    roda e grava em transação
GET    /api/rodadas/:id               snapshot completo, auditoria

── Leitura ──────────────────────────────────────────────────
GET    /api/painel?de=&ate=           agregações; nenhuma rota de escrita
GET    /api/qualidade                 taxa de acerto da IA, cobertura, calibração
GET    /api/categorias                categorias ativas
GET    /api/memoria?correlacao=       o que aconteceu num ciclo
GET    /api/memoria?entidade=&id=     a história de um registro

── Acesso ───────────────────────────────────────────────────
POST   /api/sessao                    entrada por e-mail e senha
GET    /api/sessao                    quem está autenticado
DELETE /api/sessao                    sair
POST   /api/sessao/senha              troca da própria senha

── Administração (gestor) ───────────────────────────────────
GET    /api/colaboradores             equipe, com estado de acesso
POST   /api/colaboradores             cadastra pessoa, devolve senha provisória
POST   /api/colaboradores/habilitacao o que a pessoa pode receber
POST   /api/colaboradores/ativacao    liga ou desliga o acesso
POST   /api/colaboradores/senha       senha provisória de alguém
POST   /api/colaboradores/destravar   tira do bloqueio por tentativas
GET    /api/diagnostico/origem        confere o tratamento de proxy
```

`previa` e `confirmar` chamam **a mesma função pura**. O que se vê na tela é literalmente o que será gravado.

**Previsto e ainda não implementado:** `GET /api/export?formato=xlsx` (`RF-30`, exportação para o sistema legado) — não existe rota, nem `ExportPort`, nem adapter. Era listado aqui como se existisse até 28/08/2026.

## 8. Telas

| # | Tela | Conteúdo |
|---|---|---|
| 1 | **Caixa de Entrada** | Itens por categoria, badge de confiança, agrupamento por e-mail de origem |
| 2 | **Revisão** | Sugestão da IA + evidência + campos editáveis + ajuste do desdobramento |
| 3 | **Distribuição do Dia** | Escala, prévia (`entrada 47 → Ana 24 · Bia 23`), confirmação |
| 4 | **Minha Fila** | Itens reais. Concluir · devolver · pedir ajuda. **Mobile-first, cards** |
| 5 | **Painel** | Recebido/distribuído/realizado/pendente. Zero campo digitável |
| 6 | **Auditoria da Rodada** | Entrada, elegíveis, ordem, créditos antes/depois, versão do algoritmo |

## 9. Design system

**O que este documento planejou e o que foi construído divergem aqui, e a divergência é deliberada.** O plano era shadcn/ui com matrizes validadas no Storybook. Nenhum dos dois entrou: não há `.storybook/`, não há dependência de `storybook` nem de `shadcn`, e o design system é **um arquivo**, `src/componentes/matrizes.tsx`, sobre Tailwind puro — o único import dele é `react`.

> **Correção de 31/08/2026.** Este parágrafo afirmava que as matrizes eram construídas "sobre Tailwind com `class-variance-authority`, `clsx`, `tailwind-merge` e `lucide-react`". Os quatro pacotes estavam **instalados e nunca importados** — sobra do plano shadcn/ui que foi abandonado, e o arquivo sempre resolveu composição de classe com a própria função `juntar()`, de duas linhas. Foram removidos do `package.json` na mesma data. Era o tipo de afirmação que só se descobre falsa quando alguém vai procurar o uso e não acha.

O motivo é o mesmo princípio do resto do projeto: com nove telas e um punhado de componentes, uma ferramenta de catálogo custa mais manutenção do que resolve. `RNF-05` do PRD, que pedia validação no Storybook, **não está atendido** — está sendo cumprido por revisão na tela. Se o número de componentes crescer, a decisão volta à mesa.

Matrizes que existem hoje, em `src/componentes/matrizes.tsx`: `Cartao` · `CabecalhoDeSecao` · `Selo` · `SeloDeConfianca` · `SeloDeStatus` · `Botao` · `Vazio` · `Carregando` · `Aviso` · `Metrica` (somente leitura por construção) · `ListaResponsiva` (tabela no desktop, cards no mobile).

## 10. Estrutura de pastas

```
docs/                     briefing · prd · spec · decisões
prisma/                   schema · seed · migrations
src/
  core/                   ← domínio puro, zero I/O
    tipos.ts
    erros.ts
    config.ts
    util/numero.ts
    distribuicao/
      ordenacao.ts
      motor.ts
      motor.test.ts
      simulacao.test.ts
    qualidade-ia.ts
    seguranca/
    pureza.test.ts        guarda automática da regra de dependência
  ports/                  ia · ingestao · armazenamento
  adapters/               ia-mock · ia-anthropic · ingestao-mock
                          · armazenamento-disco · fabrica
  servicos/               transações e orquestração
  servidor/               prisma · ambiente · ator · sessão · http
                          · credenciais · observabilidade
  app/
    (telas)
    api/                  rotas
  componentes/            matrizes.tsx · api.ts · navegacao.tsx
  generated/              cliente Prisma (não versionado)
scripts/                  demo · experimentar-ia · limpar-transacional
```

Os nomes são em **português** (`servicos`, `servidor`, `componentes`), como o resto do vocabulário do projeto — este documento dizia `services/` e `components/` até 28/08/2026. `carga/peso.ts` foi planejado e nunca existiu: o peso vive em `Categoria.peso`, lido pelo motor.

## 11. Stack

Next.js (App Router) · TypeScript strict · Tailwind · Prisma · Vitest · Zod nas bordas.

**Banco:** SQLite no protótipo (Docker ausente na máquina), provider trocável para Postgres em uma linha do schema. Enums como string + Zod; `json` serializado.

## 12. Testes obrigatórios do motor

`Q=0` · `Q=1` com 2 pessoas · `Q` ímpar · 1 elegível · 0 elegíveis (erro) · `Q <= limiar` · conservação em 1.000 casos aleatórios com seed fixa · alternância de crédito em 5 dias · 30 dias simulados verificando `|credito| < 1` continuamente · casos canônicos `47÷2`, `15÷2`, `FICHA=3`.

## 13. Ordem de construção

| Fase | Entrega |
|---|---|
| 0 | Núcleo puro do motor + suíte de testes ← **prova o conceito sem UI** |
| 1 | Prisma schema + seed com dados reais da planilha |
| 2 | Ports mock (ingestão + IA) + pipeline de classificação |
| 3 | Tela Revisão |
| 4 | Tela Distribuição do Dia + rodada + crédito |
| 5 | Minha Fila + Execução |
| 6 | Painel + Auditoria da Rodada |
| 7 | Adapter Anthropic real |
| 8 | Simulação de 30 dias contra os critérios de aceitação |
| 9 | Exportação e adapter de integração com o legado |
