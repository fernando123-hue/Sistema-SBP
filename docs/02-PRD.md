# PRD — Sistema de Distribuição de Demandas

> Responde **o quê**. Requisitos, histórias, aceitação, fora de escopo.

## 1. Requisitos funcionais

### Ingestão e interpretação

| ID | Requisito |
|---|---|
| RF-01 | Ingerir e-mails de forma idempotente por `message-id`. V1: adapter mock com seed. |
| RF-02 | IA classifica cada e-mail em uma das 6 categorias de `CADASTRO`, com score de confiança. |
| RF-03 | IA extrai campos (nome, CPF, CRM, liga, instituição, tipo de documento) e lê anexos. |
| RF-04 | **Um e-mail pode gerar N itens.** A IA propõe o desdobramento; ele é revisável. Um e-mail de liga com 30 ligantes vale 30 unidades de carga, não 1. |
| RF-05 | Toda extração persiste versão do modelo, versão do prompt, confiança e evidência. |
| RF-06 | Confiança abaixo do limiar da categoria → fila de Revisão. Limiar configurável **por categoria**. |
| RF-07 | Detectar duplicata e campo obrigatório ausente. |

### Revisão humana

| ID | Requisito |
|---|---|
| RF-08 | Fila de revisão mostra sugestão da IA, confiança, evidência e campos editáveis. |
| RF-09 | Operador aceita, corrige ou reclassifica. Pode ajustar o desdobramento (N itens). |
| RF-10 | Toda correção humana é gravada como dado de melhoria (`Revisao.valor_final`). |
| RF-11 | Item só entra na distribuição depois de aprovado — automaticamente ou por revisão. |

### Distribuição

| ID | Requisito |
|---|---|
| RF-12 | Operador define a escala do dia: quem está disponível, por colaborador. Substitui a coluna `J`. |
| RF-13 | Elegível = `Habilitacao` ativa na categoria ∩ `Escala` do dia. Dado, nunca fórmula. |
| RF-14 | Motor distribui por categoria, independentemente (RN-01). |
| RF-15 | Regra do resto: piso + resto inteiro a um subconjunto ordenado. Nunca arredondar. |
| RF-16 | `Σ alocação == Q` verificado antes do commit. Falha aborta a transação inteira. |
| RF-17 | `Q <= limiar_indivisivel` → tudo para um só. Default `3`, configurável por categoria. |
| RF-18 | Ordem de desempate: maior crédito da categoria → maior crédito global → menor recebido no período → menor recebido no dia → id. |
| RF-19 | Prévia antes de confirmar: `entrada 47 → Ana 24 · Bia 23`. |
| RF-20 | Múltiplas rodadas por dia. Cada rodada é registro imutável próprio. |
| RF-21 | Transferência manual **não altera a rodada** — cria `Atribuicao` nova com `motivo=transferencia`, justificativa e autor. |
| RF-22 | Rodada grava entrada, elegíveis, créditos antes/depois, ordem, critério e versão do algoritmo. |

### Fila e execução

| ID | Requisito |
|---|---|
| RF-23 | Colaborador vê seus itens reais — assunto, remetente, categoria, data. |
| RF-24 | Concluir item gera `Execucao` com timestamp. Substitui o `Realizado` digitado. |
| RF-25 | Devolver item e pedir ajuda, ambos com justificativa. |
| RF-26 | Backlog é automático: item não concluído permanece na fila. Sem carry-over digitado, sem "aba do mês". |

### Painel e integração

| ID | Requisito |
|---|---|
| RF-27 | Recebido / distribuído / realizado / pendente por dia, categoria, grupo e pessoa. |
| RF-28 | Nenhum campo do painel é digitável. Toda métrica é agregação de `Item.status`. |
| RF-29 | Qualquer número do painel é reconstruível passo a passo a partir do log. |
| RF-30 | Exportação para o sistema legado: `.xlsx` (transição) e JSON/CSV via API. |
| RF-31 | Toda operação disponível como endpoint antes de existir como tela. |

### Configuração e auditoria

| ID | Requisito |
|---|---|
| RF-32 | Peso, limiar de indivisibilidade, limiar de confiança e critério de desempate configuráveis por categoria, com vigência, sem deploy. |
| RF-33 | `LogAuditoria` append-only: entidade, ação, antes, depois, usuário, timestamp. |

## 2. Requisitos não-funcionais

| ID | Requisito |
|---|---|
| RNF-01 | O motor é **função pura**: sem I/O, sem banco, sem UI. Testável isoladamente. |
| RNF-02 | Determinismo: mesma entrada → mesma saída, sempre. Nenhuma aleatoriedade na decisão. |
| RNF-03 | Versionamento do algoritmo. Rodadas antigas reproduzem com a versão que as gerou. |
| RNF-04 | Mobile-first. Cards no lugar de tabelas em tela pequena — *Minha Fila* será consultada no celular. |
| RNF-05 | Componentes reutilizáveis definidos uma vez, validados no Storybook antes de espalhar instâncias. |
| RNF-06 | Segredos fora do código-fonte. Validação de input em toda borda. |
| RNF-07 | Distribuição diária em ≤ 5 min. Hoje: 30–45 min. |

## 3. Invariantes

Constraints e testes, não boa intenção.

1. `Σ(atribuições da rodada) == quantidade de entrada` — sempre.
2. Toda atribuição é **inteira e não-negativa**.
3. Todo item tem exatamente **um** responsável ativo.
4. `|credito_acumulado| < 1 unidade ponderada` por colaborador × categoria, **a todo momento**, em rodadas divisíveis. Em lotes indivisíveis (`Q <= limiar`) o teto é o tamanho do lote, e o crédito volta a zero na rodada seguinte da mesma categoria.
5. A soma dos créditos de uma categoria é **sempre zero**. Nenhum trabalho é criado nem destruído no livro-razão.
6. Nenhuma métrica de painel é digitável.
7. Toda decisão automática é reproduzível a partir do log.

> O invariante 4 substitui o critério original *"desvio de carga acumulada ≤ 1 unidade ao fim da semana"*, que é inalcançável quando a escala varia — quem não está de plantão tem desvio bruto grande e correto. Ver `DECISOES.md` § C2.
>
> O invariante 5 nasceu de um teste que falhou. Ver `DECISOES.md` § C9.

## 4. Histórias de usuário

**Operador**
- Chego às 8h e vejo os e-mails da noite já classificados por categoria, com badge de confiança.
- Resolvo só as exceções — os itens que a IA não teve certeza.
- Marco quem está de plantão, vejo a prévia da divisão e confirmo. Não digito nenhum número.

**Colaborador**
- Abro *Minha Fila* no celular e vejo meus e-mails reais, não um número.
- Concluo item a item. O que não terminei continua meu amanhã, sem ninguém redigitar nada.

**Gestor**
- Abro o painel e o número está certo porque ninguém pode digitá-lo.
- Pergunto "por que Ana recebeu 24?" e o sistema mostra a rodada inteira: entrada, elegíveis, créditos antes e depois, ordem aplicada.

## 5. Critérios de aceitação

| # | Critério | Base atual |
|---|---|---|
| 1 | Em 30 dias simulados, `Σ distribuído == Σ entrada` em **100%** dos dias | 71% |
| 2 | Nenhum número de painel é digitável | — |
| 3 | Toda distribuição é reconstruível a partir do log | impossível hoje |
| 4 | `\|credito_acumulado\|` < 1 unidade ponderada em qualquer momento | inexistente |
| 5 | Classificação automática aceita sem correção ≥ 80% após 2 semanas | — |
| 6 | Distribuição diária ≤ 5 min | 30–45 min |
| 7 | Reproduz os casos canônicos da planilha: `47÷2 → 23+24`; `15÷2 → 8+7`; `FICHA=3, J=2 → 3+0` | — |

## 6. Fora do escopo da V1

Estrutura modelada, ativação depois.

- Peso por esforço — campo existe, `peso = 1`
- Afinidade por liga e teto de fila
- SLA e alertas de atraso
- Frente `TÍTULOS` completa
- Cadastro completo de Ligas/Ligantes — V1 guarda o texto extraído
- Migração de Jan–Ago — importar como agregado somente-leitura
- Resposta automática ao remetente
- App mobile nativo — web responsiva atende
- Integração online com o sistema legado — V1 entrega exportação; o adapter fica pronto
