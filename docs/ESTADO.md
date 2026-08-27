# Estado do projeto — retomada

> **Para continuar em outra máquina:** clone o repositório, siga o *Preparar o ambiente* abaixo e leia a seção *Onde parei*. Este arquivo é o ponto de entrada; ele diz o que já está pronto, o que ficou aberto e qual é o próximo passo.

Última atualização: **27/08/2026** — origem da requisição e proxy confiável (`H-D16`), precedido pelo cadastro de pessoa, pela taxa de acerto da IA e pela revisão do adapter e da ingestão.

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
npm run verificar    # typecheck + 211 testes
npm run dev          # http://localhost:3000
```

**O `db:seed` imprime uma senha provisória por pessoa, uma única vez.** Elas não ficam gravadas em lugar nenhum — copie as do terminal. Rodar o seed de novo não mexe em quem já trocou a senha.

Entre com **ana.operadora@exemplo.test** (operadora) e a senha provisória dela. O sistema exige a troca antes de liberar qualquer tela. Depois, em Distribuição: *Buscar e-mails* → marcar plantão → *Calcular prévia* → *Confirmar*.

`npm run demo` roda o fluxo inteiro pelo terminal, sem tela.

---

## O que está pronto e funcionando

| Camada | Estado |
|---|---|
| Motor de distribuição | Função pura, determinística, versionada. Conservação garantida por transação |
| Modelo de dados | 20 modelos, constraints reais, 4 migrações |
| Retenção | Conteúdo do e-mail e bytes de anexo em linhas próprias, expurgáveis sem tocar no histórico operacional |
| Ingestão | Idempotente por `message-id`, IA atrás de port, tipo real do anexo conferido pelos bytes |
| Armazenamento | Arquivos fora do banco, atrás de port. Disco local hoje, nuvem trocando o adapter |
| Adapters de IA | `mock` determinístico e `anthropic` real (este ainda **não** exercitado contra a API) |
| Revisão humana | Fila de exceções com sugestão da IA e campos editáveis |
| Distribuição | Transacional, com trava por dia, crédito histórico, auditoria completa |
| Fila individual | Concluir, transferir, devolver ao pool |
| Painel | Agregação pura, zero campo digitável |
| Qualidade da IA | Taxa de aceitação, cobertura e calibração da confiança. Critério de aceitação nº 5 passa a ser verificável |
| Cadastro de equipe | Gestor cadastra pessoa e define o que ela pode receber, pela tela. Quem fica sem categoria aparece em destaque |
| API REST | 23 rotas, envelope único, limite de taxa, papéis |
| Autenticação | E-mail e senha (scrypt), senha provisória do gestor com troca obrigatória, bloqueio progressivo |
| Telas | 9: distribuição, revisão, caixa, fila, painel, acesso, entrada, troca de senha, raiz. Mobile-first, tema claro e escuro |
| Testes | **211 passando** (motor, propriedade, segurança, sessão, autenticação, pipeline de integração) |
| CI | Typecheck, testes, sincronia schema↔migrações, gitleaks, npm audit — verde |

---

## Onde parei

**Entrou o tratamento de proxy confiável** (`H-D16`), da lista de *obrigatório antes de expor fora da rede local*. Detalhe em `DECISOES.md`, seção *Origem da requisição e proxy confiável*.

**O item saiu na frente do `H-D18` porque a justificativa do `H-D18` não se sustenta mais.** Ele existia para garantir que métrica sobrevivesse a um expurgo — mas depois da separação entre conteúdo e histórico, o que a retenção pode apagar é `EmailConteudo` e bytes de anexo, e nenhuma métrica lê essas linhas. Painel, conservação e acerto da IA saem todos de `Item`, `Atribuicao`, `SaldoCarga` e `Revisao`, que o invariante 11 proíbe apagar. `H-D18` continua valendo por recorte histórico barato, mas deixou de bloquear a retenção. Reclassificado.

**E o `H-D16`, medido, era pior do que estava escrito.** Subi o servidor e li os cabeçalhos reais: sem `x-forwarded-for` o Next preenche com o endereço do socket; **com** o cabeçalho, ele repassa o valor do cliente inteiro. E `origemDaRequisicao` lia a *primeira* entrada — exatamente o pedaço que o atacante escolhe. Variar um cabeçalho dava um balde de limite de taxa novo por requisição: o limite por origem não existia.

O erro de ler a primeira entrada é independente da configuração — mesmo **com** proxy confiável, a primeira entrada é a que o cliente mandou; o proxy acrescenta a verdadeira no fim.

Agora `PROXIES_CONFIAVEIS` declara quantos saltos confiáveis existem. Com `0` (padrão), o código **admite que não sabe a origem** em vez de fingir, e o teto sobe para o balde compartilhado não virar um DoS de graça contra a própria equipe. Com `N > 0`, lê a entrada certa da cadeia.

Provado na aplicação rodando: 25 pedidos forjando a primeira entrada com a última fixa deram 20 aceitos e depois `429` (mesmo balde); 25 pedidos com últimas entradas distintas passaram todos (clientes reais continuam separados, sem `429` falso).

Testes: 204 → **211**.

---

## O que veio antes
**Entrou o cadastro de pessoa pela tela** (`H-D17`), junto com a habilitação. Detalhe em `DECISOES.md`, seção *Cadastro de pessoa e habilitação*.

Até aqui só o seed criava colaborador — montar a equipe exigia terminal e banco, o que na prática significa que o gestor não montava equipe nenhuma.

**As duas coisas entraram juntas porque separá-las produz gente invisível.** `obterEscala` filtra por quem tem habilitação, então alguém criado sem categoria não aparece na tela de plantão: existe, tem senha, entra no sistema, e nunca recebe trabalho. Sem erro, sem aviso, sem onde olhar.

Cadastrar sem categoria continua possível — gestor administra e não recebe rateio —, mas deixou de ser silencioso: o formulário avisa na hora, e a lista marca quem está nesse estado com um selo vermelho *"sem categoria · não recebe nada"*.

Tirar uma categoria **desliga a linha, nunca apaga** — o histórico de carga se apoia nela. E desliga com efeito imediato, não a partir de amanhã: o gestor tira a categoria justamente antes da distribuição do dia, e uma revogação que só valesse amanhã chegaria tarde no único momento em que importa.

Verificado na tela ponta a ponta: cadastrei uma pessoa pela interface, o aviso de "sem categoria" apareceu e sumiu ao marcar `Ligante`, a senha provisória apareceu uma vez, **a pessoa entrou no sistema com essa senha** e caiu na troca obrigatória, apareceu no plantão com a categoria certa, e sumiu do plantão na hora em que tirei a categoria.

**A revisão desta entrega achou dois defeitos meus, os dois na fronteira de entrada.** O primeiro: `.trim()` vinha DEPOIS de `.min(1)` no esquema, e em Zod a validação roda na ordem da cadeia — `"   "` tem comprimento 3, passa, e só então vira `""`. Rodando o cadastro real, a resposta voltou com `"email": ""`: uma conta que existe, tem senha, e **nunca abre**.

O segundo: não havia validação de formato de e-mail em lugar nenhum. E o `type="email"` que eu tinha posto no campo não valida nada — o input não está dentro de um `<form>` e o botão é `onClick`, não `submit`. O campo parecia conferido e não era. E-mail sem domínio cria uma conta que a pessoa nunca encontra, o gestor cadastra de novo com o endereço certo, e passam a existir duas pessoas que são a mesma, com o histórico de carga partido — o dano que a regra de "reative em vez de duplicar" existe para impedir, entrando pela porta da frente.

Corrigidos os dois no esquema, que é o servidor. A tela passou a conferir com o **mesmo** esquema antes de enviar — não substitui a validação de lá, evita a ida inútil.

Testes: 187 → **204**.

**Entrou a taxa de acerto da IA** (`H-D3`) — o item 2 do roteiro, e o que destrava os outros. Detalhe em `DECISOES.md`, seção *Taxa de acerto da IA*.

O critério de aceitação nº 5 pede "aceita sem correção ≥ 80%". Esse número não existia em lugar nenhum, e sem ele mexer no limiar de confiança era palpite. Nenhum dado novo precisou ser coletado: `Revisao` guarda `sugestaoIa` ao lado de `valorFinal` desde sempre — faltava a conta.

**A decisão de projeto foi o denominador.** Se o universo fosse todos os itens, os que nunca foram à revisão contariam como acerto, e bastaria subir o limiar até ninguém revisar nada para a taxa ir a 100% — o indicador subindo justamente enquanto a conferência humana sumia. Então o universo é só o que passou por humano: número pessimista por construção, e o único que não se infla mexendo em parâmetro. A **cobertura** aparece sempre ao lado, porque 95% de acerto sobre 2% de cobertura é ruído com cara de resultado.

A tela mostra também a **confiança média quando acerta ao lado da confiança média quando erra**. Se as duas estiverem coladas, o número que o modelo reporta não separa acerto de erro e mexer no limiar é regular ruído. Rodando contra o mock, saíram 0,91 e 0,90 — o aviso dispara. Com o modelo real, é isso que a medição vai dizer.

Verificado na tela com dado real do fluxo: 27 revisões resolvidas, 48% aceitas sem correção, cobertura 82%, e a repartição do que o humano mudou (6 categoria trocada, 5 título editado, 3 recusadas).

**Revisei a própria implementação antes de dar por pronta, e ela tinha dois defeitos.** O primeiro: a cobertura dividia universos diferentes — itens contados por data de criação, revisões contadas por data de resolução. Fila acumulada (item velho, decisão nova) fazia a fração passar de 100%. E o `Math.min` que eu tinha posto para limitá-la não corrigia, **escondia** — devolvia 100% redondo e falso. É o mesmo padrão que a revisão do adapter tinha acabado de condenar. Corrigido ancorando as três consultas na mesma data.

O segundo: o painel pedia `?dias=tudo`, carregando todas as revisões desde a fundação na tela mais visitada do sistema — a proibição que `conferirConservacao` documenta no arquivo ao lado. Agora usa a janela de 30 dias, e a tela diz qual período está mostrando.

Testes: 159 → **187**. Dezenove sobre o critério, puros; nove sobre a leitura contra banco real — um erro de leitura produziria um número plausível e falso, que é o pior resultado possível aqui.

**Uma revisão dirigida ao código ainda não mesclado encontrou quatro defeitos** — dois deles da categoria que este sistema existe para eliminar. Detalhe completo em `DECISOES.md`, seção *Revisão do adapter e da ingestão*.

Os dois graves eram **perda silenciosa de trabalho**, o defeito `E.9` da planilha reconstruído dentro do substituto:

1. **E-mail sem item nenhum sumia.** O schema aceitava lista vazia. O e-mail era gravado como processado, zero item criado, e a idempotência por `messageId` garantia que ele nunca mais voltasse. Sem erro, sem log, sem contador, sem fila.
2. **Item com categoria ausente do banco era descartado** por um `continue` — e o e-mail seguia marcado como processado do mesmo jeito.

A correção dos dois é deliberadamente **diferente**, porque as situações são diferentes. Zero item é resultado legítimo (resposta automática, aviso de entrega): o e-mail é processado, contado em `emailsSemItem` e registrado como evento — recusá-lo criaria repetição infinita gastando crédito. Categoria ausente é sistema mal configurado: aborta a transação inteira, o e-mail fica reprocessável e volta quando o cadastro for corrigido.

Corrigir o primeiro expôs um problema maior: **a tela de distribuição descartava o resumo inteiro da sincronização.** Nenhum número chegava ao operador — cinco e-mails podiam falhar sem que ninguém visse. Um contador que ninguém lê não é visibilidade. A tela agora mostra o resumo depois da busca.

Os outros dois: o adapter tratava **erro de rede como erro de validação** (o log dizia "recusada pela validação" com causa `timeout`, e a segunda tentativa pedia ao modelo que consertasse a rede), e este arquivo descrevia um caminho de falha que o código não percorre.

**Chave recusada agora para o lote inteiro** na primeira ocorrência, via `InterpretacaoIndisponivelError`. Antes, virava falha por e-mail: mil chamadas condenadas e a causa real — uma variável de ambiente errada — diluída em mil linhas iguais.

Testes: 155 → **159**. Cada defeito tem teste que o provou antes da correção.

**Entrou o complemento arquitetural sobre histórico e retenção** (`DECISOES.md`, seção *Complemento arquitetural*). A avaliação mostrou que a maior parte da evolução pedida já estava preservada — tempo por tarefa, devolução com motivo, carga acumulada e reconstrução de decisão já eram calculáveis. Mas havia **um conflito real**: conteúdo de e-mail e metadado operacional viviam na mesma linha, então ou se guardava dado pessoal para sempre, ou se perdia o histórico junto com ele.

Resolvido: `EmailConteudo` é linha separada e expurgável; `Email` guarda o metadado que sobrevive. Há teste que apaga **todo** o conteúdo e verifica que item, atribuição, carga e conservação continuam de pé. Nenhuma política de retenção foi implementada — a estrutura permite, o prazo é decisão sua.

Outras quatro mudanças estruturais, todas baratas agora e caras depois: janela deslizante de 30 dias no desempate (sai a fronteira mensal que a `RN-11` manda eliminar), carga ponderada gravada ao lado da contagem, escopo por frente no livro-razão global, e anexos como entidade com os arquivos fora do banco. Junto veio a **verificação do tipo real do arquivo** — um executável chamado `laudo.pdf` passava pela allowlist de extensão inteiro.

Três invariantes novos em `CLAUDE.md`: guardar histórico não é treinar modelo · métrica por pessoa é observabilidade, não avaliação · conteúdo tem retenção, histórico operacional não.

**Entrou o adapter Anthropic.** `IA_ADAPTER=anthropic` passa a usar o modelo real; nenhum serviço mudou, porque nenhum serviço sabe qual adapter está atrás do `AiPort`. A saída do modelo é gerada a partir do próprio schema Zod, então o formato pedido e o formato validado não podem divergir. Resposta que não valida volta ao modelo uma vez, com o erro junto; falhando de novo, o e-mail é contado como falha da rodada, registrado como reprocessável e **volta inteiro na próxima sincronização** — ele não entra em fila de revisão nenhuma, porque sem item não há o que revisar.

Repetir só acontece quando o problema é o **formato** da resposta. Timeout, 429 e erro de servidor não repetem — reescrever o prompt não conserta rede, e o SDK já tentou por conta própria antes de erguer o erro. Chave recusada não vira falha de e-mail: ela para o lote inteiro na primeira ocorrência, para a causa real não ficar diluída em centenas de linhas idênticas.

A detecção de injeção continua sendo **nossa**, por regex, antes de o texto chegar ao modelo — o sinal do modelo entra como reforço, nunca como substituto. Perguntar ao modelo atacado se houve ataque é pedir ao réu que se julgue.

> **Atenção, e é a parte importante:** o adapter **nunca rodou contra a API real** — não há credencial nesta máquina e gastar crédito não é decisão minha. Os 12 testes cobrem tudo que é nossa responsabilidade (delimitação, retentativa só quando cabe, falha alta, parada do lote por credencial recusada, recusa de categoria inventada e de confiança inflada) com a rede substituída por um duble. Antes de confiar nele em qualquer volume, rode com a chave configurada:
>
> ```bash
> IA_ADAPTER=anthropic npm run ia:experimentar
> ```
>
> O script mostra quatro casos — comum, desdobramento em N itens, campo faltando e tentativa de injeção — e não toca no banco.

**Entrou também a autenticação real com senha** — era o item que bloqueava qualquer dado de associado. A entrada agora é por e-mail e senha; o gestor cadastra a pessoa com uma senha provisória e a entrega, e o sistema não libera tela nenhuma nem rota nenhuma até ela definir a própria senha. Quem erra a senha cinco vezes seguidas trava por alguns minutos e destrava sozinho.

Sumiu junto a pior brecha que existia: a tela antiga **listava a equipe inteira** e deixava assumir qualquer identidade sem senha, inclusive a de gestor. A lista de colaboradores agora exige papel `gestor`.

**Passei uma auditoria em cima do meu próprio trabalho antes de dar por pronto**, e ela achou cinco defeitos reais — todos corrigidos e com teste. O mais grave: o contador de tentativas era lido e regravado, então dez tentativas *simultâneas* contavam como uma e o bloqueio nunca disparava; provei o furo com um teste antes de consertar. O mais traiçoeiro: trocar a senha **não** derrubava as sessões antigas — ou seja, a reação natural de quem desconfia de um acesso indevido não expulsava ninguém. Agora expulsa, e redefinir a senha de alguém virou a ferramenta do gestor para cortar uma sessão na hora.

O raciocínio de cada escolha (por que `scrypt` do Node em vez de `bcrypt`, por que mensagem única de erro, por que o bloqueio nunca é permanente) e a lista completa dos defeitos encontrados estão em `DECISOES.md`, seção *Autenticação com senha*. Testes: 98 → 120.

Antes disso, a tela de Revisão passou a deixar o operador **editar os campos que a IA extraiu** e **ajustar o N do desdobramento pra cima**. Detalhe em `DECISOES.md`, seção *Divisão manual da revisão*.

Antes disso, tinha terminado uma **auditoria completa com oito agentes** (arquitetura, segurança, banco, performance, qualidade de código, testes, regras de negócio, telas) e aplicado as correções classificadas como *CORRIGIR AGORA*. Estão todas em `DECISOES.md § H`.

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

**GitHub Actions voltou a funcionar** (27/08/2026). A fila estava travada — execuções ficavam `queued` por horas, e o cancelamento respondia `completed` — mas destravou sozinha, provavelmente renovação da cota de minutos do plano free. Os três jobs rodam e passam no PR #11 em menos de um minuto.

Ao rodar, o CI achou um problema real: o job do gitleaks falhava com `Resource not accessible by integration` em **PR comum**, não só nos do Dependabot. O `permissions` global do workflow é `contents: read`, e o gitleaks precisa de `pull-requests: read` para listar os commits do PR. Falhava **sem ter encontrado segredo nenhum** — o vermelho que ensina a equipe a ignorar vermelho. Corrigido com a permissão mínima no job.

**Cinco PRs do Dependabot abertos** (#1, #2, #4, #5, #9). O #9 falhava no CI, e a investigação achou dois problemas reais — ambos corrigidos:

- `TS5102: Option 'baseUrl' has been removed`. O `tsconfig.json` usava `baseUrl` junto com `paths`, e a versão nova do TypeScript removeu a opção. Isso travaria **qualquer** upgrade de TypeScript. `baseUrl` saiu; `paths` continua funcionando porque resolve relativo ao próprio `tsconfig.json`.
- O job do gitleaks falhava com `Resource not accessible by integration` em todo PR do Dependabot, porque esses PRs recebem token somente-leitura. Era vermelho que não é defeito — o tipo que ensina a equipe a ignorar vermelho. O job agora pula quando o autor é o Dependabot.

Com isso, os PRs de dependência devem passar. O merge continua sendo decisão sua.

**PR aberto com o trabalho desta rodada:** [#11](https://github.com/fernando123-hue/Sistema-SBP/pull/11) — autenticação, adapter Anthropic, divisão manual da revisão e separação de conteúdo do histórico. Três checks verdes. Merge é decisão sua.

Vale notar que o PR **#5 sobe o gitleaks-action de v2 para v3**. A permissão `pull-requests: read` que acabou de ser adicionada ao job de segredos vale para as duas versões, mas confira o comportamento ao fazer o merge — foi exatamente esse job que produziu vermelho falso duas vezes.

**A suíte estava perto de estourar o tempo limite.** Depois que o desdobramento passou a exigir revisão humana, a simulação de 30 dias gera centenas de pendências, e o helper de teste as aprovava uma a uma. Trocado por operação em lote: o arquivo caiu de 140s para ~50s. O `testTimeout` também subiu para 90s, para dar margem em máquina mais lenta.

---

## Próximo passo sugerido

Na ordem em que eu retomaria:

1. **Rodar o adapter Anthropic contra a API real.** Com a chave no `.env`: `IA_ADAPTER=anthropic npm run ia:experimentar`. É a **única** parte do sistema que nunca foi exercitada de verdade — o resto tem teste ou foi conferido na tela. Compare a saída com a do mock, especialmente no caso de injeção.
2. ~~**Taxa de acerto da IA** (`H-D3`)~~ — **feito em 27/08/2026.** A seção *Acerto da IA* no Painel responde o critério nº 5. Com o adapter real rodando, é o primeiro lugar para olhar: ela diz se a confiança do modelo separa acerto de erro, e portanto se faz sentido mexer no limiar.
3. **Camada de agregados de métrica** (`H-D18`) — **reclassificado**: nenhuma métrica lê linha expurgável, então isto não bloqueia mais a política de retenção. Continua valendo por recorte histórico barato e por segurança contra uma retenção futura mais ampla.
4. ~~**Cadastro de colaborador pela tela** (`H-D17`)~~ — **feito em 27/08/2026.** Cadastro e habilitação estão na tela de Acesso.
5. Demais itens de `DECISOES.md § H.2` (H-D2 a H-D19). O gatilho que resta: **H-D19** (bytes de anexo sem criptografia em repouso) é obrigatório antes de documento real de associado entrar. **H-D5** (painel sem recorte de data, com definição própria de "pendente") tende a divergir da planilha na rodada paralela — vale antes da comparação lado a lado.

---

## Três decisões que dependem do dono do negócio

Estão registradas em `DECISOES.md § H.4`, sem resposta inventada:

1. **Dono único** — quando uma categoria tem dono fixo (o caso `E-MAIL LIGA`), a intenção é *sempre a mesma pessoa*, ou apenas que o lote não seja fragmentado no mesmo dia? Hoje o código entrega 100% a quem estiver mais credor, o que é rodízio, não dono fixo.
2. **Etapa 6 da operação** — depois que o sistema distribui, o colaborador trabalha pela tela ou continua pela pasta de e-mail dele? Se for pela pasta, o `IngestaoPort` precisa deixar de ser somente-leitura.
3. **Itens mais antigos** — devem ir para quem está mais credor, ou ser espalhados? Tem consequência de prazo.

> A quarta pergunta — **"período" do desempate** — foi respondida em 27/08/2026: janela deslizante de 30 dias, já implementada.

---

## Pendências que aguardam decisão, não código

- **Retenção:** a estrutura separa conteúdo de histórico e permite expurgo, mas **nenhum prazo foi definido** e nada é apagado hoje. Definir prazo é decisão de negócio e de DPO, não de engenharia.
- **Dado real para a API da Anthropic:** bloqueado por decisão de 27/08/2026 — só dados sintéticos até aprovação formal da associação.

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
    seguranca/      injeção de prompt, validação e tipo real de anexo
    autenticacao.ts política de bloqueio (pura, sem I/O)
  ports/            AiPort, IngestaoPort, ArmazenamentoPort
  adapters/         mock, anthropic, disco + fábrica escolhida por ambiente
  servicos/         transações, orquestração
  servidor/         prisma, ambiente, ator, sessão, credenciais, http
  app/              rotas de API e telas (inclui /acesso e /senha)
  componentes/      design system (matrizes) e cliente de API
```

**Regra de dependência:** as setas apontam só para dentro — `app → servicos → core`. `core/` não importa infraestrutura. É isso que mantém o motor testável em milissegundos e auditável para sempre.

**Onde mexer para cada coisa:**

| Quero… | Vou em |
|---|---|
| mudar como o trabalho é repartido | `src/core/distribuicao/motor.ts` (puro) e `ordenacao.ts` |
| mudar o que a IA extrai | `src/adapters/ia-anthropic.ts` (prompt) e `src/core/esquemas.ts` (contrato) |
| mudar a janela do desempate | `DIAS_DA_JANELA` em `src/servicos/distribuicao.ts` |
| implementar retenção | apagar `EmailConteudo` e bytes; **nunca** `Item`, `Atribuicao`, `SaldoCarga`, `LogAuditoria` |
| trocar disco por nuvem | novo adapter de `ArmazenamentoPort` + `criarArmazenamentoPort()` |

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + 211 testes |
| `npm run dev` | Aplicação em http://localhost:3000 |
| `npm run demo` | Fluxo completo pelo terminal |
| `npm run ia:experimentar` | Compara mock e modelo real. **Único** comando que gasta crédito |
| `npm run db:seed` | Cadastro base sintético + senhas provisórias |
| `npm run db:limpar` | Apaga dados transacionais, preserva cadastro |
| `npm run db:studio` | Inspeciona o banco |

Dados são 100% sintéticos. Nenhum nome, CPF ou e-mail real entra no repositório.

---

## Se algo parecer quebrado ao retomar

- **`npm run db:seed` não mostra senha de alguém:** é o comportamento correto — quem já trocou a senha não é tocado. Para recomeçar do zero, limpe o banco e rode as migrações de novo.
- **Erro de typecheck vindo de `.next/`:** artefato do dev server, não do código. `rm -rf .next` e rode de novo.
- **`AdapterIndisponivelError`:** `IA_ADAPTER` ou `INGESTAO_ADAPTER` aponta para um adapter não implementado. É proposital — o sistema recusa subir em vez de cair no mock em silêncio.
- **`SESSAO_SECRET ausente ou curto demais`:** gere um com `node -e "console.log(crypto.randomUUID())"` e cole no `.env`.
- **Login recusado com a senha certa:** confira se a conta não está desativada ou travada por tentativas. A mensagem é genérica de propósito — ela não revela qual dos casos é. Use a tela `/acesso` como gestor.
