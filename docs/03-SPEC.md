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
ports/        Contratos: AiPort · IngestaoPort · ArmazenamentoPort · AssistentePort.
adapters/     Construídos: fornecedor (fronteira do fornecedor de IA) · ia-estruturada (política comum)
              · ia-mock · ia-gemini · ia-anthropic · ingestao-mock · armazenamento-disco (cifrado)
              · assistente-busca · assistente-modelo. Previstos: imap · graph · gmail · nuvem
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

Afastamento        id · colaborador_id · tipo(ferias|falta|atestado|licenca|outro)
                   · inicio · fim? · observacao?      ← DADO DE SAÚDE (LGPD art. 11)
                   · registrado_por · registrado_em · cancelado_em? · cancelado_por?
TravaDeDistribuicao data (pk) · execucoes · atualizado_em
                   Serializa as confirmações do MESMO dia. Sem ela, duas
                   confirmações concorrentes leem o crédito uma da outra e
                   desempatam com dado obsoleto — sem exceção nenhuma.
Nota               id · texto · categoria_id? · liga_id? · autor_id · criado_em
                   · arquivado_em? · arquivado_por? · motivo_arquivo?

LogAuditoria       id · dominio · entidade · entidade_id · acao · antes(json)
                   · depois(json) · usuario · correlacao_id? · timestamp
EventoProcessamento id · dominio · correlacao_id · etapa · situacao · referencia?
                   · mensagem? · detalhe(json)? · duracao_ms? · criado_em
```

**`dominio` não é enfeite.** As duas tabelas de memória nascem sabendo de que
sistema do ecossistema vieram (invariante 14). Como a trilha é append-only, uma
linha gravada sem domínio só ganharia um por `UPDATE` — a única escrita que este
sistema promete nunca fazer.

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
Colaborador ──< Afastamento     Colaborador ──< Nota (autor)
Categoria ──< Nota              Liga ──< Nota
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

### Agrupamento por liga (`A4`) — segundo modo do motor

Decisão `A4` + `A4.1`: **a liga é a unidade que não se separa; o e-mail não é.** Todos os ligantes de uma liga **num mesmo dia** vão inteiros para uma pessoa, inclusive quando chegaram em e-mails diferentes. Ligas diferentes podem ir para pessoas diferentes. Entre dias, nenhuma afinidade fixa.

#### Contrato estendido

```
IN  … + grupos?: [{ chave: string, tamanho: inteiro ≥ 1 }]   // opcional

    PRÉ-CONDIÇÃO: Σ tamanhos == Q
```

`grupos` **refina** `Q`, não o substitui: a trava de conservação continua sendo `Σ alocacao == Q`, exatamente a mesma. Sem `grupos`, o motor se comporta como sempre — este modo não altera nenhuma rodada existente.

#### Algoritmo — guloso maior-primeiro

```
5b. categoria agrupa E grupos presentes E Q > limiar_indivisivel:
      criterio = 'por_grupo'
      ordena grupos por tamanho DESC, chave ASC   (determinismo em empate)
      recebido[c] = 0 para todos
      para cada grupo g:
          alvo = ordenar(elegiveis, projetando credito − recebido × peso)[0]
          alocacao[alvo] += g.tamanho
          recebido[alvo] += g.tamanho
```

**"Menos carga acumulada" é lido como "maior crédito".** O `A4` diz que cada liga vai para quem estiver com menos carga naquele instante. Isso **não** vira um segundo critério: crédito já é a medida de quem está devendo trabalho no resto do sistema (`A2`, `RN-13`), e criar uma segunda definição de "quem é o próximo" produziria dois números que discordam. O que muda é a **frequência**: a ordem é recalculada a cada liga entregue, projetando o que a pessoa já levou nesta rodada.

**O corte de lote pequeno vem antes.** Se `Q <= limiar_indivisivel`, vale a regra de sempre (tudo para o primeiro da ordem), mesmo com várias ligas. `A4` permite ligas diferentes irem para pessoas diferentes; não obriga.

#### O desequilíbrio do dia é intencional

Uma pessoa leva 30 e outra 20 — e isso está certo. O `A4` descarta explicitamente afinidade fixa por liga; o equilíbrio vem do crédito acumulado nos dias seguintes (`A2`), somado à janela deslizante de 30 dias (`A9`).

#### De onde vêm os grupos — e o que não existe hoje

`Item.ligaId` é a chave do grupo, e **em 06/09/2026 nada o preenche.** As tabelas `Liga` e `Ligante` existem no schema desde a fundação e estão vazias: zero escritores, zero leitores. O que existe é `ligaMencionada` — **texto livre** que a IA extrai e guarda no payload do item.

Então o `A4` exige um passo que a documentação anterior não mencionava: **transformar um nome em identidade**. Ele acontece na ingestão, não no motor.

```
ligaMencionada: "Liga de Cardiologia da UFMG"   (texto livre da IA)
        ↓ normalizar: minúsculas, sem acento, espaços colapsados
"liga de cardiologia da ufmg"                    (chave de comparação)
        ↓ buscar exata; criar se não existir
Liga { id, nome }  →  Item.ligaId
```

**A comparação é exata sobre o nome normalizado. Nunca aproximada.** Duas grafias diferentes viram duas ligas, e possivelmente duas pessoas. É o lado visível e corrigível do erro: um operador percebe "a mesma liga apareceu duas vezes" e junta. O erro oposto — casar por semelhança e unir duas ligas que são diferentes — entrega a liga errada para a pessoa errada **sem nada acusar**, e é a classe de defeito que este sistema existe para eliminar. Registrado como hipótese em `DECISOES.md § AT-10`.

Item **sem** liga (`ligaId` nulo) é grupo de tamanho 1 — indivisível por definição, e portanto neutro no algoritmo.

## 6. Ports e adapters

| Port | Contrato | Adapter V1 | Depois |
|---|---|---|---|
| `IngestaoPort` | `buscarNovos(): EmailBruto[]` idempotente por `message_id` | `mock` (seed) | `imap` · `graph` · `gmail` |
| `AiPort` | `interpretar(email): { itens[], confianca, evidencia, modelo, versaoPrompt }` | `mock` determinístico | `gemini` (gemini-3.5-flash, JSON + validação nossa) e `anthropic` (claude-sonnet-5, structured output). A política é comum: `ia-estruturada.ts` |
| `ArmazenamentoPort` | `guardar(bytes, extensao)` · `ler(chave)` · `remover(chave)` | `disco`, cifrado em AES-256-GCM (`H-D19`) | nuvem |
| `AssistentePort` | `responder(quem, pergunta): { resposta, verbetesUsados, telaSugerida? }` | `busca` no manual local (sem rede) e `modelo` | — |
| `ExportPort` | `exportar(periodo, formato)` | *(nenhum — planejado, não construído)* | `rest` para o sistema legado |

**O `AssistentePort` é o único port cujo desenho é uma PROIBIÇÃO.** O retorno não
tem campo de ação, e a ausência é deliberada: um assistente capaz de devolver
`{acao: 'distribuir'}` seria um caminho para operar o sistema por texto livre,
sujeito a quem escrever a pergunta mais persuasiva (invariante 13). Quem for
"preencher a lacuna" está desfazendo a decisão.

O adapter mock da IA é determinístico de propósito: permite testar todo o pipeline sem chamar modelo e sem custo.

## 7. API

Envelope único em toda resposta: `{ sucesso, dados, erro, correlacaoId? }`.

**Estado em 10/09/2026 — 31 caminhos, 39 operações.** Auditado contra o código (contagem dos handlers exportados em `src/app/api/**/route.ts`); o que estiver aqui existe, e o que existe está aqui.

> **E a própria correção de 08/09/2026 perdeu uma.** Esta seção passou a dizer 38
> operações no mesmo dia em que o `PATCH /api/afastamentos/:id` ("Voltou hoje")
> entrou no código, e a linha dele nunca chegou aqui. Encontrada em 10/09/2026
> contando os handlers, não relendo a lista.

> A auditoria de documentação de 08/09/2026 encontrou cinco operações fora desta
> lista, num documento que promete completude — inclusive a do assistente, que é
> a única rota governada por um invariante próprio (`CLAUDE.md` nº 13). Um mapa
> incompleto que se declara completo é pior que mapa nenhum: o legado do cliente
> seria programado contra ele.

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

── Memória do setor e ajuda ─────────────────────────────────
GET    /api/notas?categoria=&liga=    notas do setor no contexto da tela
POST   /api/notas                     registra nota (categoria e/ou liga)
DELETE /api/notas/:id                 arquiva — tira da vista, não apaga
GET    /api/ligas                     ligas ativas, para filtrar a caixa
POST   /api/assistente                pergunta sobre COMO o sistema funciona.
                                      Não executa nada: a resposta traz texto e,
                                      no máximo, o nome de uma tela existente —
                                      não há campo de ação, e a ausência é o
                                      desenho (invariante 13)

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
GET    /api/afastamentos              ficha completa (gestor) — motivo e observação
GET    /api/afastamentos/hoje         quem está fora hoje, redigido pelo papel
POST   /api/afastamentos              registra ausência (tira do rateio no período)
PATCH  /api/afastamentos/:id          encerra hoje ("Voltou hoje") — grava o fim,
                                      não cancela: a licença aconteceu
DELETE /api/afastamentos/:id          cancela — CARIMBA, não apaga
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
| 7 | **Entrada** (`/entrar`) | E-mail e senha. Mensagem única para conta inexistente e senha errada, e piso de tempo igual nos dois — a diferença de relógio entregava a lista de contas |
| 8 | **Troca de senha** (`/senha`) | Obrigatória enquanto a senha for a provisória do gestor. Bloqueia o resto do sistema |
| 9 | **Acesso** (`/acesso`) | Gestor: cadastra, habilita por categoria, ativa/desativa, destrava, gera senha provisória, registra e cancela afastamento |

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
    tipos.ts              inclui os contratos de tela e `NaRede<T>` (`H-D7`)
    erros.ts
    config.ts
    notas.ts              seleção de nota do setor — função PURA, hoje ligada só
                          à tela; ligar o modelo depois é trocar o destino de uma
                          chamada, não reescrever a regra
    util/numero.ts
    util/datas.ts         fuso da operação; `toISOString` fazia 22h virar o dia seguinte
    distribuicao/
      ordenacao.ts
      motor.ts
      motor.test.ts
      simulacao.test.ts
    assistente/
      conhecimento.ts     o manual do assistente, filtrado por papel EM CÓDIGO
    marca/                contorno · especificação · física do campo de partículas
    qualidade-ia.ts
    seguranca/
    pureza.test.ts        guarda automática da regra de dependência
  ports/                  ia · ingestao · armazenamento · assistente
  adapters/               fornecedor · ia-estruturada · ia-mock · ia-gemini · ia-anthropic
                          · ingestao-mock · armazenamento-disco · assistente-busca
                          · assistente-modelo · fabrica
  servicos/               transações e orquestração
  servidor/               prisma · ambiente · ator · sessão · http
                          · credenciais · observabilidade
  middleware.ts           CSP com nonce por requisição
  app/
    (telas)
    api/                  rotas
  componentes/            matrizes.tsx · api.ts · navegacao.tsx · notas.tsx
                          · assistente.tsx · marca.tsx
  generated/              cliente Prisma (não versionado)
scripts/                  demo · experimentar-ia · limpar-transacional · expurgo
                          · recifrar-anexos
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

## 14. Implantação: o usuário do banco

A aplicação **não** se conecta como `root`. A trilha (`LogAuditoria`,
`EventoProcessamento`) é append-only por invariante, e essa promessa tem três
camadas — duas no repositório e uma aqui:

| Camada | O que impede | Onde vive |
|---|---|---|
| Varredura de código | `update`/`delete`/`upsert` na trilha escritos no sistema | `src/servicos/trilha-append-only.test.ts` |
| TRIGGER do MySQL | qualquer `UPDATE`, venha de onde vier | migração `20260918010000_trilha_append_only` |
| **Privilégio do usuário** | `DELETE`, `DROP`, `ALTER` e `TRIGGER` na trilha | **este documento, aplicado na implantação** |

A terceira é a única que vale contra um cliente de linha de comando aberto
direto no servidor, onde nem o código nem a aplicação estão no caminho. Sem ela
a trigger também cai: quem tem `TRIGGER` na tabela pode derrubar a trava e
reescrever o passado em seguida.

### Concessão mínima

Crie um usuário próprio para a aplicação e conceda, tabela a tabela, só o que
ela precisa. O trecho abaixo é o mínimo; ajuste o nome da base e do host.

```sql
CREATE USER 'sbp_app'@'localhost' IDENTIFIED BY 'a-senha-que-so-o-servidor-sabe';

-- O resto do sistema: leitura e escrita normais.
GRANT SELECT, INSERT, UPDATE, DELETE ON `sbp`.* TO 'sbp_app'@'localhost';

-- A trilha: só nasce, nunca muda nem some.
REVOKE UPDATE, DELETE ON `sbp`.`LogAuditoria` FROM 'sbp_app'@'localhost';
REVOKE UPDATE, DELETE ON `sbp`.`EventoProcessamento` FROM 'sbp_app'@'localhost';

FLUSH PRIVILEGES;
```

**As migrações não rodam com este usuário.** `prisma migrate deploy` precisa de
DDL (`CREATE`, `ALTER`, `TRIGGER`), que a aplicação não deve ter; use uma
credencial de manutenção, separada, só no momento de migrar.

### Conferir

```bash
npm run db:privilegios
```

Lê `SHOW GRANTS FOR CURRENT_USER()` e lista o que ainda alcança a trilha. Em
desenvolvimento apenas relata — a base local roda como `root` de propósito, e
transformar isso em erro treinaria a equipe a ignorar o aviso. Em produção
(`NODE_ENV=production`, ou `EXIGIR_PRIVILEGIO_MINIMO=sim` em qualquer ambiente)
ele **recusa**, com código de saída 1.

Rode na implantação e sempre que a credencial do banco mudar. É o tipo de
garantia que envelhece calada: ninguém percebe que voltou a ser `root` até
precisar da trilha para investigar alguma coisa — e aí ela já não prova nada.
