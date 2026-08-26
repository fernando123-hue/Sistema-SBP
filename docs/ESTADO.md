# Estado do projeto — retomada

> **Para continuar em outra máquina:** clone o repositório, siga o *Preparar o ambiente* abaixo e leia a seção *Onde parei*. Este arquivo é o ponto de entrada; ele diz o que já está pronto, o que ficou aberto e qual é o próximo passo.

Última atualização: **26/08/2026, à noite** — auditoria completa com oito agentes, mais uma rodada de higiene de CI.

---

## Preparar o ambiente

```bash
npm install
cp .env.example .env
```

Edite o `.env` e gere um segredo de sessão (mínimo 16 caracteres):

```bash
node -e "console.log(crypto.randomUUID())"
```

Cole o valor em `SESSAO_SECRET`. Depois:

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run verificar    # typecheck + 96 testes
npm run dev          # http://localhost:3000
```

Na tela de entrada, escolha **Ana Ribeiro Salgado** (operadora). Em Distribuição: *Buscar e-mails* → marcar plantão → *Calcular prévia* → *Confirmar*.

`npm run demo` roda o fluxo inteiro pelo terminal, sem tela.

---

## O que está pronto e funcionando

| Camada | Estado |
|---|---|
| Motor de distribuição | Função pura, determinística, versionada. Conservação garantida por transação |
| Modelo de dados | 18 modelos, constraints reais, 2 migrações |
| Ingestão | Idempotente por `message-id`, IA mock determinística atrás de port |
| Revisão humana | Fila de exceções com sugestão da IA e campos editáveis |
| Distribuição | Transacional, com trava por dia, crédito histórico, auditoria completa |
| Fila individual | Concluir, transferir, devolver ao pool |
| Painel | Agregação pura, zero campo digitável |
| API REST | 16 rotas, envelope único, limite de taxa, papéis |
| Telas | 5 telas + entrada, mobile-first, tema claro e escuro |
| Testes | **96 passando** (motor, propriedade, segurança, sessão, pipeline de integração) |
| CI | Typecheck, testes, sincronia schema↔migrações, gitleaks, npm audit — verde |

---

## Onde parei

Terminei uma **auditoria completa com oito agentes** (arquitetura, segurança, banco, performance, qualidade de código, testes, regras de negócio, telas) e apliquei as correções classificadas como *CORRIGIR AGORA*. Estão todas em `DECISOES.md § H`.

As mais graves que foram corrigidas:

1. **Fuso horário** — a chave temporal do sistema era UTC. Depois das 21h em Brasília o sistema achava que já era o dia seguinte. Corrigido em `src/core/util/datas.ts`.
2. **Conservação com falso positivo** — o contador incluía atribuições encerradas, então qualquer transferência marcava a rodada como divergente. O indicador que prova o valor do sistema acusava erro justamente quando ele funcionava.
3. **Pendência negativa** — o painel subtraía universos diferentes; era o defeito `E.9` da planilha reconstruído dentro do substituto.
4. **A IA decidia quantidade sem revisão** — desdobramento de 1 e-mail em N itens entrava aprovado sem ninguém ver. Agora sempre passa por humano.
5. **Aprovar revisão apagava os campos extraídos** — o dataset de melhoria nascia vazio.
6. **Concorrência na distribuição** — duas confirmações do mesmo dia decidiam desempate com crédito obsoleto. Resolvido com `TravaDeDistribuicao`.
7. **Vazamento em erro 500** — `ConservacaoVioladaError` devolvia a alocação inteira ao cliente.
8. **Limite de taxa global no login** — 21 requisições de qualquer pessoa travavam a entrada da equipe inteira.
9. **Contraste ilegível no tema escuro** — o botão mais usado do sistema media 2,43:1.

---

## Situação do CI e das dependências

Três coisas que valem saber antes de abrir o repositório:

**GitHub Actions está com a fila travada.** A execução do commit da auditoria ficou `queued` por mais de 6 horas e entrou num estado inconsistente — a API relata `queued`, o cancelamento responde `completed`. A causa provável é a cota de minutos do Actions em repositório privado no plano free. **A verificação local é a fonte da verdade** enquanto isso: `npm run verificar`.

**Cinco PRs do Dependabot abertos** (#1, #2, #4, #5, #9). O #9 falhava no CI, e a investigação achou dois problemas reais — ambos corrigidos:

- `TS5102: Option 'baseUrl' has been removed`. O `tsconfig.json` usava `baseUrl` junto com `paths`, e a versão nova do TypeScript removeu a opção. Isso travaria **qualquer** upgrade de TypeScript. `baseUrl` saiu; `paths` continua funcionando porque resolve relativo ao próprio `tsconfig.json`.
- O job do gitleaks falhava com `Resource not accessible by integration` em todo PR do Dependabot, porque esses PRs recebem token somente-leitura. Era vermelho que não é defeito — o tipo que ensina a equipe a ignorar vermelho. O job agora pula quando o autor é o Dependabot.

Com isso, os PRs de dependência devem passar. O merge continua sendo decisão sua.

**A suíte estava perto de estourar o tempo limite.** Depois que o desdobramento passou a exigir revisão humana, a simulação de 30 dias gera centenas de pendências, e o helper de teste as aprovava uma a uma. Trocado por operação em lote: o arquivo caiu de 140s para ~50s. O `testTimeout` também subiu para 90s, para dar margem em máquina mais lenta.

---

## Próximo passo sugerido

Na ordem em que eu retomaria:

1. **Tela de Revisão: ajustar o desdobramento.** Hoje o operador vê o motivo `desdobramento` mas ainda não consegue mudar o N nem editar os campos extraídos. `ResolucaoRevisaoSchema` precisa aceitar os itens revisados. É a lacuna que sobrou da correção nº 4 e nº 5 acima.
2. **Autenticação real com senha** (`DECISOES.md § AT-08`). Bloqueia a entrada de qualquer dado real de associado.
3. **Adapter Anthropic** atrás do `AiPort`, usando `criarAiPort()` em `src/adapters/fabrica.ts` — o caminho já existe e falha alto se pedirem um adapter não implementado.
4. Itens de `DECISOES.md § H` classificados como *ANTES DA PRÓXIMA ETAPA*.

---

## Quatro decisões que dependem do dono do negócio

Estão registradas em `DECISOES.md § H`, sem resposta inventada:

1. **Dono único** — quando uma categoria tem dono fixo (o caso `E-MAIL LIGA`), a intenção é *sempre a mesma pessoa*, ou apenas que o lote não seja fragmentado no mesmo dia?
2. **Etapa 6 da operação** — depois que o sistema distribui, o colaborador trabalha pela tela ou continua pela pasta de e-mail dele? Se for pela pasta, o `IngestaoPort` precisa deixar de ser somente-leitura.
3. **Itens mais antigos** — devem ir para quem está mais credor, ou ser espalhados?
4. **"Período" do desempate** — hoje é o mês corrente, o que reintroduz a fronteira mensal que `RN-11` manda eliminar. Deve ser janela deslizante?

---

## Mapa do repositório

```
docs/
  01-BRIEFING.md    por quê — problema medido, objetivos
  02-PRD.md         o quê — requisitos, invariantes, aceitação
  03-SPEC.md        como — camadas, dados, motor, API, telas
  DECISOES.md       decisões, correções, hipóteses, achados da auditoria
  ESTADO.md         este arquivo

src/
  core/             domínio puro — não importa Prisma, React nem Next
    distribuicao/   o motor e a ordenação (núcleo de valor)
    seguranca/      defesa contra prompt injection e anexos
  ports/            AiPort, IngestaoPort
  adapters/         mock + fábrica escolhida por ambiente
  servicos/         transações, orquestração
  servidor/         prisma, ambiente, ator, sessão, http, observabilidade
  app/              rotas de API e telas
  componentes/      design system (matrizes) e cliente de API
```

**Regra de dependência:** as setas apontam só para dentro — `app → servicos → core`. `core/` não importa infraestrutura. É isso que mantém o motor testável em milissegundos e auditável para sempre.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + 96 testes |
| `npm run dev` | Aplicação em http://localhost:3000 |
| `npm run demo` | Fluxo completo pelo terminal |
| `npm run db:seed` | Cadastro base sintético |
| `npm run db:limpar` | Apaga dados transacionais, preserva cadastro |
| `npm run db:studio` | Inspeciona o banco |

Dados são 100% sintéticos. Nenhum nome, CPF ou e-mail real entra no repositório.
