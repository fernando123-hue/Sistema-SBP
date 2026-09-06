# Estado do projeto — retomada

Última atualização: **06/09/2026** — sessão de manutenção: um defeito real e ativo na suíte de testes (não no produto), `node_modules` fora de sincronia com o lockfile, duas dependências atualizadas, repositório sem PR aberto. Detalhe em `DECISOES.md`, seção *Manutenção de sessão — 06/09/2026*.

> **Um teste que passava por coincidência de calendário parou de passar.** `DATA_BASE` era uma string fixa no passado (`'2026-09-01'`); itens criados por teste nascem com `criadoEm` do relógio real; o corte temporal do motor (correto, deliberado) descartava esses itens assim que o relógio real passasse da data fixa — o que aconteceu entre a última sessão e esta. Dois testes ficaram vermelhos sem nenhuma mudança de código ter acontecido no meio. Corrigido ancorando `DATA_BASE` em `hojeIso()`. Não é o primeiro defeito deste projeto que só aparece com o tempo passando; é o primeiro que aparece **no arnês de teste** em vez do produto.

---

## Continuando em outra máquina

Tudo está na **`main`**. O [PR #12](https://github.com/fernando123-hue/Sistema-SBP/pull/12) foi mesclado em 31/08/2026, e com ele o aviso que esta seção carregava deixou de ter função.

```bash
git clone https://github.com/fernando123-hue/Sistema-SBP.git
cd Sistema-SBP
```

Não há branch para trocar, nem etapa escondida.

> **A lição fica, mesmo com o aviso removido.** Duas vezes trabalho terminado ficou fora da `main` enquanto este arquivo dizia o contrário: o #12 por dois dias, e as decisões A4–A12 por cinco — essas últimas ninguém tinha notado. Antes de escrever aqui que "tudo está na `main`", confira a lista de branches do repositório, não a memória da sessão.

Este arquivo é o ponto de entrada: ele diz o que está pronto, o que ficou aberto e qual é o próximo passo.

### O que NÃO vem no clone, e por quê

| O quê | Por que não está no git | Como recriar |
|---|---|---|
| `.env` | Contém segredos | `cp .env.example .env` e preencher |
| `dev.db` | Banco local, dado de trabalho | `npx prisma migrate deploy` + `npm run db:seed` |
| `src/generated/` | Gerado pelo Prisma a partir do schema | `npx prisma generate` |
| `node_modules/` | Dependências | `npm install` |
| `armazenamento/` | Anexos; são documentos, não código | Criado sozinho no primeiro anexo |

**A chave da Anthropic não está em lugar nenhum do repositório, e é assim que tem de ser.** Na máquina nova ela precisa ser colada de novo em `ANTHROPIC_API_KEY`, dentro do `.env`.

---

## Preparar o ambiente

Testado num ambiente limpo da `main` em 31/08/2026, já com o PR #12 mesclado: `npm install`, `.env`, `migrate deploy`, `generate` e `npm run verificar` levam de zero a **271 testes verdes**, sem nenhuma etapa extra. O caminho abaixo é exatamente o que foi executado.

```bash
npm install
cp .env.example .env
```

Edite o `.env`. Dois campos precisam de atenção:

- **`SESSAO_SECRET`** — obrigatório, mínimo 16 caracteres. Gere com:
  ```bash
  node -e "console.log(crypto.randomUUID())"
  ```
- **`ANTHROPIC_API_KEY`** — só se for usar o modelo real. Com `IA_ADAPTER="mock"` (o padrão) o sistema roda inteiro sem ela.

Os outros vêm prontos do `.env.example`. `PROXIES_CONFIAVEIS="0"` é o correto para rede local; só muda ao publicar atrás de nginx ou balanceador — e aí confira o resultado em `/api/diagnostico/origem`, que existe justamente para isso.

Depois:

```bash
npx prisma migrate deploy   # cria o banco e aplica as 10 migrações
npx prisma generate         # gera o cliente Prisma em src/generated/
npm run db:seed             # cadastro sintético + senhas provisórias
npm run verificar           # typecheck + 358 testes
npm run dev                 # http://localhost:3000
```

**O `db:seed` imprime uma senha provisória por pessoa, uma única vez.** Elas não ficam gravadas em lugar nenhum — copie as do terminal. Rodar o seed de novo não mexe em quem já trocou a senha.

Entre com **ana.operadora@exemplo.test** (operadora) e a senha provisória dela. O sistema exige a troca antes de liberar qualquer tela. Depois, em Distribuição: *Buscar e-mails* → marcar plantão → *Calcular prévia* → *Confirmar*.

`npm run demo` roda o fluxo inteiro pelo terminal, sem tela — é a forma mais rápida de conferir que a máquina nova está inteira.

### Uma surpresa conhecida

Ao rodar `npm run dev`, o Next.js **escreve sozinho um bloco dentro do `CLAUDE.md`**, que é o arquivo de instruções do projeto. Ele reaparece a cada execução. A decisão de aceitar ou desligar essa geração ainda é sua — até lá, é esperado ver esse arquivo modificado sem você ter mexido nele.

---

## O que está pronto e funcionando

| Camada | Estado |
|---|---|
| Motor de distribuição | Função pura, determinística, versionada. Conservação garantida por transação |
| Modelo de dados | 21 modelos, constraints reais, 10 migrações |
| Retenção | Conteúdo do e-mail e bytes de anexo em linhas próprias, expurgáveis sem tocar no histórico operacional |
| Ingestão | Idempotente por `message-id`, IA atrás de port, tipo real do anexo conferido pelos bytes |
| Armazenamento | Arquivos fora do banco, atrás de port. Disco local hoje, nuvem trocando o adapter |
| Adapters de IA | `mock` determinístico e `anthropic` real (este ainda **não** exercitado contra a API) |
| Revisão humana | Fila de exceções com sugestão da IA e campos editáveis |
| Distribuição | Transacional, com trava por dia, crédito histórico, auditoria completa |
| Fila individual | Concluir, transferir, devolver ao pool |
| Registro manual | O que não chega por e-mail entra pela Caixa: balcão, telefone, e as categorias de exceção `INADIMP.`/`ISENTO` |
| Memória consultável | A trilha de auditoria deixa de ser write-only: `GET /api/memoria` responde por ciclo (`?correlacao=`) e por registro (`?entidade=&id=`). Toda linha nasce com `dominio` |
| Painel | Agregação pura, zero campo digitável. Recorte por período, colunas mapeadas uma a uma para as da planilha |
| Qualidade da IA | Taxa de aceitação, cobertura e calibração da confiança. Critério de aceitação nº 5 passa a ser verificável |
| Cadastro de equipe | Gestor cadastra pessoa e define o que ela pode receber, pela tela. Quem fica sem categoria aparece em destaque |
| API REST | 27 caminhos, 33 operações, envelope único, limite de taxa, papéis |
| Autenticação | E-mail e senha (scrypt), senha provisória do gestor com troca obrigatória, bloqueio progressivo |
| Telas | 9: distribuição, revisão, caixa, fila, painel, acesso, entrada, troca de senha, raiz. Mobile-first, tema claro e escuro |
| Testes | **358 passando** (motor, propriedade, segurança, pureza do núcleo, sessão, autenticação, memória, pipeline de integração) |
| CI | Typecheck, testes, sincronia schema↔migrações, gitleaks, npm audit — verde |

---

## Onde parei

**Entrou o A13 — quem pode ver o motivo de uma ausência.** Era a última pergunta aberta desta sessão, e você respondeu em 06/09/2026. Detalhe em `DECISOES.md § A13`.

**Todo mundo vê que a pessoa está fora; só o gestor vê por quê.** Para colaborador e operador, a ausência aparece como *"de férias"* ou *"indisponível"*. Para gestor, uma ficha com o motivo real e a observação livre — onde cabe "motivos pessoais".

Duas razões separam os níveis: a operação **precisa** saber quem não vai receber trabalho hoje, senão a tela promete uma equipe que não existe; e o motivo médico não é assunto de quem divide fila.

Três detalhes que não são acidente:

- **`férias` atravessa** porque é agenda, não saúde. Esconder produziria a pergunta *"por que fulano está indisponível?"* — a conversa que a redação existe para evitar.
- **Todos os motivos sensíveis viram o MESMO rótulo.** Se `atestado` tivesse rótulo próprio e os outros não, a ausência do rótulo já denunciaria o motivo.
- **A redação acontece no servidor**, nunca no componente. Mandar o tipo real e esconder na tela deixaria o dado numa resposta HTTP que qualquer pessoa autenticada lê — a tela é vitrine, não fechadura. Há teste que prova que `atestado` não sai do servidor para operador.

Com isso o Painel ganhou a linha *"Fora hoje"*, que era a metade do `A10` que faltava.

Testes: 337 → **358**.

---

### Antes disso, na mesma data — A4

**Entrou o A4 — agrupamento por liga. Era a última decisão do dono pendente.** Detalhe em `DECISOES.md` § A4/A4.1, `§ AT-10` e `§ C2`; contrato do motor em `03-SPEC.md` § 5.

**A liga é a unidade que não se separa; o e-mail não é.** Você respondeu a pergunta que faltava em 06/09 (`A4.1`): a unidade é `(liga, DIA)`, não `(liga, e-mail)`. Dois e-mails da mesma liga no mesmo dia vão para a mesma pessoa; entre dias, ela não fica presa a ninguém.

**O A4 era maior do que a documentação dizia.** Estava escrito como "mudança no contrato do motor". É — mas faltava a metade de baixo: **`Item.ligaId` nunca era preenchido por ninguém.** As tabelas `Liga` e `Ligante` existiam desde a fundação, vazias, sem um único escritor. O que existia era `ligaMencionada`, texto livre que a IA extrai. Sem transformar esse texto em identidade, o motor não teria o que agrupar.

**A identidade é por nome normalizado, e a comparação é exata — nunca aproximada** (`AT-10`). Separar uma liga em duas é erro que o operador vê e corrige; unir duas ligas diferentes entrega o trabalho de uma como se fosse da outra, e ninguém descobre. Os dois erros não custam a mesma coisa.

**Dois testes do critério de aceitação nº 1 ficaram vermelhos, e não eram defeito.** O crédito chegou a `15,33` onde se exigia `< 1`. O invariante forte pressupõe que a menor coisa entregável é um item; o `A4` diz que é uma liga inteira, e uma liga de 30 numa equipe de 3 desloca o crédito em 20 de uma vez — o próprio texto do `A4` já assumia isso.

**Mas afrouxar o teste até passar seria trocar uma garantia por nada.** "Equilíbrio na semana" só vale se o crédito **voltar**; se crescesse todo dia, a mesma pessoa acumularia dívida para sempre, devagar e em silêncio. Ninguém tinha provado essa parte. Entrou o teste que faltava: 24 dias simulados, medindo se o pior crédito da segunda metade é sistematicamente maior que o da primeira. **Não é** — o crédito oscila e volta, e a soma por categoria continua zero.

Testes: 312 → **337**.

---

### Antes disso, na mesma data — A10

**Entrou o A10 — afastamento como entidade.** Detalhe em `DECISOES.md`, seção *Afastamento (A10)*.

Férias, atestado, falta e licença deixam de ser catorze marcações de escala feitas na mão. **Escala e afastamento respondem perguntas diferentes** — quem está de plantão hoje (decisão diária do operador) contra quem está fora num período (fato, declarado uma vez pelo gestor) — e `carregarElegiveis` exige as duas. É por isso que o afastamento funciona mesmo com a escala marcada, que é exatamente o caso de esquecer de desmarcar.

**O crédito congela sozinho, e não foi escrita uma linha para isso.** Crédito só muda para quem entra numa rodada, e quem está afastado não entra. Escrevi o teste que prova a propriedade em vez do código que já existia de graça — um "congelador" criaria um segundo lugar onde o crédito é manipulado, e um segundo lugar para errar.

**Verificado por HTTP com A/B, e a primeira tentativa não provava nada:** pus alguém de férias e ela não recebeu — mas ela não estava escalada naquele dia de qualquer forma. Refeito com quem **estava** de plantão e recebendo: Dora sai, a carga é absorvida pelos outros, a conservação fecha, e a narrativa do `A6` acompanha sozinha ("com 1 pessoa de plantão" no lugar de 2).

**Um obstáculo de ambiente ficou registrado:** a CSP quebra a verificação de tela em desenvolvimento (`eval() is not supported`, HMR caindo), e a hidratação do React fica intermitente. Não é defeito do produto — em produção o React não usa `eval` — mas torna o `npm run dev` pouco confiável para conferir tela, e esta entrega teve de ser verificada por HTTP. Não corrigido de propósito: afrouxar a CSP em desenvolvimento é decisão própria, não carona.

Testes: 295 → **309**.

---

### Antes disso, na mesma data — A7 e A6

**Entraram A7 e A6 — prioridade por idade e relatório da rodada.** Detalhe em `DECISOES.md`, seção *Prioridade por idade e relatório da rodada*.

**A fila ordenava pela idade errada.** Era `atribuidoEm` — a idade da *atribuição*, não a do trabalho. As duas divergem exatamente no caso que importa: item de três semanas devolvido ao pool e redistribuído hoje aparecia no **fim** da fila, como se fosse novo. Agora ordena por `item.criadoEm`, a mesma definição que a distribuição já usava.

**O painel ganhou a coluna "Mais antigo (hoje)"**, com há quantos dias está parado o item aberto mais velho de cada categoria. **Sem faixa de alerta, de propósito:** o `A7` diz que o setor não trabalha com prazo, e colorir a partir de N dias inventaria um SLA que ninguém definiu.

**A narrativa da rodada descreve, nunca recalcula.** `core/distribuicao/narrativa.ts` é função pura sobre o snapshot que o motor já gravou. Sem IA — o `A6` permite que ela redija a frase, mas o texto determinístico não custa crédito, não falha por rede e não pode alucinar um número. Verificado na tela: a narrativa apareceu acima dos números crus da mesma rodada, e os dois batem.

**A verificação no navegador achou um defeito que não era o objetivo.** O seed criava uma habilitação **nova a cada dia**, porque a chave do upsert incluía `DATA_INICIAL` (`hoje − 7`), que anda. Medido: 80 linhas para 20 pares reais. A tela de plantão repetia o mesmo selo quatro vezes e o React acusava chave duplicada — que ele trata como podendo *omitir* elementos. A distribuição não foi afetada, mas por sorte de implementação. Corrigido e provado: seed rodou três vezes seguidas, 20/20/20.

Testes: 278 → **295**.

---

### Antes disso, na mesma data — A11 e A12

**Entraram A11 e A12 — peso e limiar de confiança por categoria.** Detalhe em `DECISOES.md`, seção *Peso e limiar por categoria*.

`DOC = 4` e `FICHA = 1,75` no peso; `0,95` e `0,90` no limiar; resto na base (`1` e `0,85`). As duas vieram da mesma frase do cliente e entraram juntas: uma trata do esforço (equilíbrio entre categorias), a outra do cuidado (quanto vai para a revisão humana).

**O custo estava superestimado aqui, e a correção importa para as próximas estimativas.** Este arquivo dizia que A11 mexeria no motor. Não mexeu: `motor.ts` já multiplicava por `categoria.peso`, e `ingestao.ts` já lia `categoria.limiarConfianca`. As duas decisões eram **valor de dado**, não lógica ausente.

**O risco real estava em outro lugar — na unidade.** Dois testes do critério de aceitação nº 1 falharam com `2,667 < 1` e `3,5 <= 3`. Nenhum era regressão: `2,667 = 0,667 × 4`. O crédito é um livro-razão em unidades **ponderadas**, e o teto estava escrito como a constante `1`; enquanto todo peso era `1`, "um item" e "1 unidade" eram o mesmo número. Manter `1` teria exigido de documento um equilíbrio quatro vezes mais apertado que o de e-mail — regra que ninguém decidiu. Os testes passaram a comparar contra o peso da própria categoria.

**Duas consequências que ficam registradas:** o histórico anterior a 06/09/2026 foi calculado com peso `1` e **não** foi recomputado (o invariante 11 proíbe reescrever o passado), então há descontinuidade de unidade nesta data e a comparação lado a lado precisa ser refeita a partir daqui. E o A12 significa **mais** documento e ficha na fila de revisão humana — é o efeito desejado, mas é fila de gente; se incomodar, o número é configurável sem deploy.

**Estes valores ainda não foram relidos com o dono do negócio.** Foram decididos em 26/08 e implementados a pedido explícito de 06/09, com o aviso registrado. `1,75` já nasceu negociável.

Testes: 271 → **278**.

---

### Antes disso, na mesma data — sessão de manutenção

**Sessão de manutenção, zero regra nova.** Conferência do repositório de ponta a ponta — código, dependências, branches, segurança — e correção do que estava quebrado ou defasado. Nenhuma decisão de negócio nova foi tomada; nenhum comportamento do produto mudou. Detalhe completo em `DECISOES.md`, seção *Manutenção de sessão — 06/09/2026*.

**O achado que importa: um teste que dependia do calendário.** `src/testes/apoio.ts` fixava `DATA_BASE = '2026-09-01'`. Item criado por teste recebe `criadoEm` do relógio real (`@default(now())` do Prisma — por design, não dá para um teste fingir que criou algo no passado). O corte temporal do motor (`criadoEm <= fimDoDia(data)`, deliberado e correto) passou a descartar esses itens assim que o relógio real avançou além de 1º/09 — o que já tinha acontecido quando esta sessão começou. Dois testes vermelhos (`itens.test.ts`, `pipeline.test.ts`), sem ninguém ter tocado em código de produção no meio do caminho. Corrigido ancorando `DATA_BASE` em `hojeIso()`.

**`node_modules` estava desalinhado do lockfile.** `typescript` instalado era `5.9.3`; o projeto pede `7.0.2`. `@types/node` instalado era `22.20.1`; o projeto pede `26.3.0`. O typecheck rodava com compilador dois majors atrás, sem aviso nenhum. `npm ci` corrigiu — a primeira tentativa corrompeu a instalação (`node_modules/.bin` sumiu), reinstalação limpa resolveu.

**Dependências e GitHub em dia.** Os dois PRs do Dependabot que estavam abertos e verdes (`#13`, `#14`) foram mesclados — zero PR aberto agora. Dois branches locais órfãos apagados; os sete branches remotos obsoletos já não existiam de verdade (o repositório apaga branch ao mesclar; só o cache local (`git fetch --prune`) estava desatualizado).

**O CI estava vermelho e a documentação dizia que estava verde.** O job `Auditoria de dependências` (`npm audit --audit-level=high`) falhava por duas vulnerabilidades em `mysql2` — uma alta —, enquanto este arquivo afirmava "npm audit acusa zero vulnerabilidades". `mysql2` é dependência do **CLI do Prisma** (que empacota suporte a MySQL sempre), nunca importado por este projeto, que usa SQLite; mas vermelho permanente ensina a equipe a ignorar vermelho, e isso o projeto já tinha registrado como inaceitável. Como o Prisma fixa `mysql2` em versão **exata**, subir o Prisma não resolveria e `--force` o rebaixaria dois majors. Corrigido com `overrides` no `package.json` — padrão que o projeto já usava para `deepmerge-ts` —, subindo `mysql2` para a versão corrigida `3.24.3`. `npm audit`: **0 vulnerabilidades**.

`npm run verificar`: **271 testes verdes**, typecheck limpo, `npx prisma generate` funcionando.

---

### 31/08/2026 — consolidação: `PR #12` e as decisões A4–A12

**Duas consolidações, nenhuma linha de regra nova.** Aquela sessão não construiu funcionalidade: fechou duas divergências entre o que o repositório fazia e o que a documentação dizia que ele fazia.

#### 1. O `PR #12` entrou na `main`

Estava aberto, verde e mesclável desde 28/08 — 6 commits, +2.971/−95 em 24 arquivos, os três checks passando. Enquanto ele esperava, a `main` não tinha o registro manual (`H-D4`), a fundação do cérebro operacional, nem as duas correções de segurança que a revisão adversarial daquela branch achou. Mesclado, e a `main` verificada num ambiente limpo: `npm install`, `.env`, `migrate deploy`, `generate` e **271 testes verdes**, sem etapa extra.

#### 2. As decisões A4–A12 voltaram para a `main`

**Este é o achado que importa.** Nove decisões do dono do negócio, tomadas em 26/08, viviam só no branch `claude/prototipo-em-progresso-unesv2`. A `main` seguiu dois dias de construção sem saber delas.

O sintoma era visível e ninguém tinha olhado: este arquivo listava **três perguntas como "aguardando o dono do negócio"** — etapa 6, itens mais antigos, dono único — e as três já tinham resposta escrita, com data, a cinco dias dali. A documentação não estava desatualizada por descuido de alguém; ela ficou errada sozinha, porque o trabalho foi para um lugar e o índice ficou em outro.

O que entrou: agrupamento por liga (A4), etapa 6 e conclusão pelo app (A5), relatório da rodada (A6), prioridade por idade (A7), lembrete semanal (A8), janela do desempate (A9), cadastro de afastamento (A10), peso por categoria (A11) e limiar por categoria (A12).

**Um conflito real apareceu, e ele é de número.** O A9 (26/08) decidiu janela de **15 dias**; o *Complemento arquitetural* (27/08), também diretriz do dono, decidiu **30 dias** — que é o implementado. Concordam no essencial (janela deslizante no lugar do mês corrente, como a `RN-11` exige) e divergem só no tamanho. **Resolvido pela data:** 27/08 é posterior, então 30 vigora e o código não foi tocado. As duas ficam registradas, para a revisão ser visível em vez de o número menor sumir sem rastro. Se 15 era o certo, a troca é decisão do dono — mexe no crédito acumulado de todo mundo de uma vez.

**O que foi registrado e NÃO foi implementado, de propósito:** A4, A10, A11 e A12 pedem código que não existe. A11 (peso `DOC = 4`, `FICHA = 1,75`) parece troca de constante e não é — o peso entra na cota justa em `motor.ts`, então mudá-lo muda toda a divisão entre categorias e a suíte de distribuição junto. Está na tabela *O que destas decisões ainda não existe em código*, em `DECISOES.md § A`, e virou item do próximo passo. Registrar não é implementar, e a distância entre as duas coisas precisa ficar escrita.

---

#### 3. Revisão geral e limpeza

Varredura do repositório inteiro atrás do que não serve mais. O que saiu:

**Quatro dependências de produção que nunca foram importadas** — `class-variance-authority`, `clsx`, `tailwind-merge` e `lucide-react`. Sobra do plano shadcn/ui, abandonado ainda no começo. `matrizes.tsx` importa **só `react`** e resolve composição de classe com a própria função `juntar()`, de duas linhas.

O incômodo não era o peso: a `03-SPEC.md` **afirmava** que o design system era construído sobre os quatro. Documentação descrevendo um sistema que não é este — e ninguém descobre até ir procurar o uso e não achar. Corrigido no SPEC, com o motivo. De quebra, o [PR #15](https://github.com/fernando123-hue/Sistema-SBP/pull/15) do Dependabot (`lucide-react` 1.34 → 1.35) ficou sem objeto: era manutenção sobre pacote que ninguém usava.

**Cinco símbolos exportados e inalcançáveis:**

| Símbolo | Por que saiu |
|---|---|
| `LIMIAR_CONFIANCA_PADRAO` | Duplicava o `@default(0.85)` do schema, que é de onde o limiar sai de verdade (`ingestao.ts` lê `categoria.limiarConfianca`). O tipo `Categoria` do core nem carrega o campo |
| `categoriaPorCodigo` | Função sem nenhum chamador |
| `inicioDaSemana` | Sem chamador — **e o comentário dizia "usado só na leitura do painel"**, uso que não existia |
| `dataDoEmail` | Invólucro de uma linha sobre `paraDataIso`, nunca chamado. Apagá-lo deixou o import órfão, e o typecheck pegou |
| `FrenteSchema` / `GrupoSchema` | Duplicavam as uniões `Frente` e `Grupo` de `tipos.ts`, sem leitor |

Mais **sete aliases de tipo** em `esquemas.ts` (`CategoriaCodigo`, `StatusItem`, `MotivoAtribuicao`, `Anexo`, `ItemDividido`, `RegistroManual`, `PayloadDoItem`) sem nenhum consumidor — nem em outro arquivo, nem no próprio. Não é convenção do arquivo: 17 dos 31 esquemas têm tipo pareado, ou seja, o tipo é criado quando alguém precisa. Agora todo símbolo exportado de `esquemas.ts` tem consumidor, o que é uma propriedade conferível.

**Um caso não era código morto e não foi apagado.** `SituacaoEventoSchema` parecia sobra, mas a lista `'iniciado' | 'sucesso' | 'falha' | 'reprocessavel'` estava escrita **duas vezes** — como enum Zod em `esquemas.ts` e como união TypeScript em `observabilidade.ts`. Duas fontes para o mesmo vocabulário fechado é exatamente o que o PR #12 corrigiu para `acao` e `operacao`. Em vez de apagar, `observabilidade.ts` passou a derivar o tipo do esquema. Sobrou uma fonte.

**A maior duplicação que sobrou já tem nome: `H-D7`.** As telas redigitam à mão os tipos que os serviços já declaram — `caixa/page.tsx` × `servicos/caixa.ts`, `fila` × `fila`, `painel` × `painel`, `revisao` × `revisao`, `distribuicao` × `resumo.ts`. **Não mexi:** é dívida registrada, com abordagem já escolhida (derivar dos esquemas Zod), e o conserto é refatoração que atravessa a fronteira servidor/cliente — não é apagar coisa morta. Ela já cobrou uma vez (`emAndamento` sumiu; `Date` contra string). Continua no *Próximo passo*.

**Três casos pareceram duplicação e não eram, conferidos um a um:** `conferirAssinatura` existe duas vezes com significados diferentes (HMAC do cookie de sessão × bytes mágicos de anexo); `linhaDe` são dois auxiliares de teste sem relação; `mensagemDoErro` tem versão de servidor e de cliente, e a do cliente acrescenta o identificador de correlação — mesma assinatura, responsabilidades distintas nos dois lados do fio.

**A varredura do schema deu falso positivo e nada foi tocado lá.** Oito colunas apareceram como "nunca referenciadas", e nenhuma era morta: `revisoesFeitas` e os `ligaId` são **relações**, `atualizadoEm` é `@updatedAt` gerido pelo Prisma, e `Item.ligaId` é justamente o que o `A4` vai precisar. Apagar coluna exige migração e esbarra no invariante 11 — o custo de errar é alto e o ganho era zero.

**O que foi conferido e está limpo:** nenhum arquivo órfão em `src/` (todos os cinco sem import são entradas legítimas — `npm scripts` e o `globalSetup` do vitest); zero `TODO`, `FIXME` ou `@deprecated`; zero bloco de código comentado; zero `console.log` solto. Os números que a documentação afirma foram medidos de novo e batem: 7 migrações, 20 modelos, 9 telas, 24 arquivos de rota, 13 invariantes, 271 testes.

**O que NÃO foi apagado, de propósito:** os comentários que registram o defeito que cada linha previne (são memória cara, e o `CLAUDE.md` manda preservá-los) · o histórico deste arquivo e do `DECISOES.md` · `CONTEXTO.md` e `ENGENHARIA_REVERSA` (documentos de origem) · o workflow do CodeQL, desarmado de propósito e com plano de religar · `AdapterIndisponivelError`, que parece sem uso porque é lançado e capturado genericamente.

`npm run verificar`: **271 testes verdes**, antes e depois. Nenhum comportamento mudou — nada aqui era alcançável.

---

## O que veio antes

**Entrou a fundação do cérebro operacional.** Detalhe em `DECISOES.md`, seção *Fundação do cérebro operacional*.

A diretriz era grande — memória, eventos, capacidades, contexto, isolamento de domínio, ecossistema futuro — e a análise com agentes especializados devolveu a resposta que interessava: **a maior parte já estava atendida**. O gateway de IA está limpo desde 26/08, a memória de feedback (`sugestaoIa` × `valorFinal`) existe e já é lida por `qualidade-ia.ts`, o histórico é reproduzível, e conteúdo já está separado de histórico operacional.

**O buraco real era outro: memória que ninguém conseguia ler.** `LogAuditoria` e `EventoProcessamento` eram gravados em 27 pontos do código e não tinham **um único leitor em produção** — nenhuma rota, nenhuma tela. A trilha de um sistema que existe para acabar com erro silencioso só era alcançável por `prisma studio`.

**O caso mais concreto estava na mensagem de erro.** Num 500, o sistema sorteia um identificador, entrega ao usuário dizendo que ele *"permite rastrear a falha no log"*, e gravava **só em stdout**. Quem da secretaria dissesse "deu erro, o código é `a3f…`" só podia ser atendido por alguém com o terminal do servidor à mão. Agora o 500 grava evento, e `GET /api/memoria?correlacao=<id>` resolve — com teste que estoura uma rota de verdade e prova a ponta a ponta.

**Três peças entraram, e só três:**

- **`dominio` em `LogAuditoria` e `EventoProcessamento`.** É o que fica mais caro a cada dia: a trilha é append-only, então acrescentar a coluna depois preencheria as linhas antigas por `UPDATE` — a única escrita que o projeto promete nunca fazer. Mesmo raciocínio do `escopo` que você aceitou em 27/08.
- **Vocabulário fechado.** 41 literais de `acao` e de operação eram `string` livre; um `concluido` digitado `concluído` entrava calado numa tabela que ninguém pode corrigir. O compilador casou com as 19 chamadas de produção de primeira.
- **Interface de consulta.** Por ciclo e por registro. **Sem listagem geral, de propósito** — a trilha diz quem fez o quê sobre a operação inteira, e despejá-la em página transformaria auditoria em vigilância.

**E o teste que faltava havia meses.** A regra mais citada do projeto — `app → servicos → core` — era sustentada **só por disciplina**: nenhum teste, nenhuma checagem no CI. Agora `src/core/pureza.test.ts` varre o núcleo resolvendo cada import por caminho, e falha nomeando arquivo, linha e regra. Provado com um violador temporário de 8 casos. Nenhuma violação real no código atual.

**O que eu recusei construir, e é o que mais parecia central na diretriz:** montagem de contexto para a IA com "casos parecidos corrigidos por humano". Devolver ao modelo texto que veio de e-mail transforma injeção de prompt — hoje limitada a uma mensagem — em ataque persistente. E selecionar correções humanas para injetar no prompt é aprendizado em contexto: treinar com dado real da associação a cada requisição, sem decisão sua. Também fora: tabela de memória genérica (`Categoria` já é a memória de domínio), `MemoriaPort` (sem segunda implementação, seria outro `RegraDistribuicao`) e barramento de eventos (nada precisa reagir).

**Dois invariantes novos** no `CLAUDE.md`, custo zero: memória é lida, nunca soprada de volta ao modelo (12); toda linha de memória nasce sabendo de que domínio é, e evento vai na mesma transação do fato (13).

**Duas perguntas novas para você**, em `DECISOES.md § H.4`: um agente é ator de quê (hoje `ATOR_SISTEMA` tem papel `operador` e confirmaria distribuição), e de que lado da retenção a memória cai.

Testes: 248 → **271**.

**A revisão desta entrega achou quatro defeitos meus, dois graves.** O pior: a rota reintroduzia, uma requisição depois, o vazamento que `http.ts` proíbe três linhas acima — `ConservacaoVioladaError` carrega o id de cada colega da rodada, e eu gravava a mensagem crua no evento. O ramo especial tinha sido tirado da resposta e recolocado como recurso consultável. O segundo: `entidade` era texto livre, então `?entidade=Colaborador` dava a `operador` o e-mail e o histórico de senha de uma colega — o que `GET /api/colaboradores` exige `gestor` para ver. Ambos corrigidos, com teste. Detalhe em `DECISOES.md`, *Revisão do próprio trabalho*.

**E preciso corrigir uma afirmação minha.** Eu disse que o identificador do erro 500 passa a resolver o ciclo. Resolve pela metade: `http.ts` sorteia uma correlação NOVA, sem relação com a que o serviço gerou por dentro, então a consulta devolve uma linha — "às 14:32 a rota X falhou com erro do tipo Y" — e não a história. É mais do que o stdout dava, e menos do que eu afirmei. Costurar de verdade exige propagar a correlação de dentro para fora, o que toca todos os serviços; ficou registrado como trabalho próprio, não como fundação.

---

**Entrou o registro manual de item** (`H-D4`). Detalhe em `DECISOES.md`, seção *Registro manual de item*.

`INADIMP.` e `ISENTO` estavam num beco sem saída: semeadas em `config.ts`, marcadas fora do rateio, proibidas à IA — e sem nenhuma rota que as criasse. Existiam no cadastro e eram inalcançáveis. Duas linhas da planilha (`CAD-MAIO`, 35–36) sem correspondente nenhum aqui dentro. Na rodada de comparação lado a lado, essas linhas apareceriam zeradas do lado do substituto, e não haveria explicação boa para dar.

O sintoma estava escrito no próprio código, meses antes: `CategoriaForaDoRateioError` termina com *"Registre manualmente"*, apontando para um caminho que não existia.

**A regra do responsável é assimétrica, e é isso que protege o motor.** Categoria fora do rateio **exige** quem atendeu; categoria do rateio **recusa**. Dentro do rateio quem escolhe a pessoa é o motor — aceitar um responsável ali abriria a porta lateral que este sistema substitui. Fora do rateio o motor nunca passa perto: sem responsável, o item nasceria `aprovado` e ficaria assim para sempre, porque `concluir` exige atribuição ativa. A pendência do painel cresceria sozinha, todo dia, sem ninguém ter errado nada — o defeito da planilha entrando pela porta da funcionalidade que veio consertar outra coisa.

**Um lançamento pode valer N itens.** A planilha digita `Mov.Extra = 11` numa célula; exigir onze operações aqui devolveria a equipe à planilha na primeira semana. `quantidade` cria 11 itens **rastreáveis** — a facilidade da planilha, sem a contagem anônima dela. Teto em 50, para que `111` no lugar de `11` vire recusa visível.

**O item não nasce concluído**, ainda que a planilha lance `Aberto` e `Realizado` no mesmo dia. Isso seria o operador declarando a conclusão do trabalho de outra pessoa, que é exatamente o que `concluir` recusa. Nasce `distribuido` na fila do responsável; fechar continua sendo ato dele.

**A verificação na tela achou um defeito meu.** O item manual aparecia com **Confiança 100%** — número de aparência ótima sobre uma classificação que modelo nenhum fez. Mesma família do `SUBTOTAL(109)`: o valor está lá, parece resultado, e não significa o que quem lê acha que significa. Agora a coluna mostra o selo `manual`, pelo mesmo critério (`modeloIa`) que a taxa de acerto usa para montar o denominador.

**Uma decisão ficou provisória e é sua.** Carga de categoria fora do rateio **não** entra no crédito (`§ AT-09`): contá-la faria uma categoria de exceção inclinar a cota justa de categorias das quais ela não participa. Escolhi o lado reversível — começar a contar depois é decisão; despoluir um razão já acumulado exige recomputar histórico. A pergunta objetiva está em `DECISOES.md § H.4`, item 6.

Testes: 229 → **248**.

**Os PRs [#1](https://github.com/fernando123-hue/Sistema-SBP/pull/1) e [#2](https://github.com/fernando123-hue/Sistema-SBP/pull/2) foram mesclados.** `actions/checkout` e `actions/setup-node` agora em `v7` nos três jobs e no CodeQL. O prazo de 16/09, quando o Node 20 sai dos runners do GitHub, está resolvido.

**Entrou o recorte de período no painel** (`H-D5`). Detalhe em `DECISOES.md`, seção *Painel com recorte de período*.

O painel contava desde a fundação e chamava isso de "pendente". A planilha tem uma aba por mês. Na rodada de comparação lado a lado — que é como este sistema se prova — os dois nunca bateriam, e a conclusão natural de quem olha seria que o substituto está errado.

**Cada coluna agora tem correspondente na planilha**, e a tela diz isso no rodapé: `Saldo` · `Entrou` (Mov. do Dia) · `Aberto` (ABERTO) · `Concluído` (Realizado) · `Pendente` (Pend.). Sem esse mapeamento a conferência vira discussão sobre o que cada palavra significa.

**O carry-over deixou de ser digitado.** A planilha faz `Saldo(d) = Pend.(d−1)` à mão, sem fórmula, e por isso erra em ~10% dos dias. Verificado com histórico atravessando a virada do mês: julho fechou com pendência 2, e agosto abriu com saldo 2 — sem ninguém digitar.

**Uma divergência é deliberada e vai aparecer.** A planilha grampeia `Pend.` em zero, e quem limpa backlog antigo tem o excedente descartado (`RN-09`). Aqui não há grampo e nem precisa: só entra em "concluído" o que estava em "aberto". Quando os números divergirem num dia de limpeza de backlog, **o certo é o do sistema** — registrado para não virar discussão na hora.

`Item.canceladoEm` é coluna nova. Sem ela, cancelar hoje mudaria retroativamente a pendência do mês passado, e o painel mudaria de número sozinho entre duas consultas. Conclusão não precisou de equivalente: já vive em `Execucao.concluidoEm`, e item concluído nunca reabre.

E o painel ganhou o invariante que faltava: `pendente` sai de uma subtração, `conferirPendencia` conta direto, e os dois têm de bater. Mesmo espírito de `conferirConservacao` — número que só existe de uma forma não tem como se provar errado.

Testes: 215 → **226**. A revisão desta entrega achou pendência NEGATIVA na fronteira exata do período — o defeito `E.9` reconstruído — e foi o próprio invariante das duas contagens que pegou.

**Entrou o tratamento de proxy confiável** (`H-D16`), da lista de *obrigatório antes de expor fora da rede local*. Detalhe em `DECISOES.md`, seção *Origem da requisição e proxy confiável*.

**O item saiu na frente do `H-D18` porque a justificativa do `H-D18` não se sustenta mais.** Ele existia para garantir que métrica sobrevivesse a um expurgo — mas depois da separação entre conteúdo e histórico, o que a retenção pode apagar é `EmailConteudo` e bytes de anexo, e nenhuma métrica lê essas linhas. Painel, conservação e acerto da IA saem todos de `Item`, `Atribuicao`, `SaldoCarga` e `Revisao`, que o invariante 11 proíbe apagar. `H-D18` continua valendo por recorte histórico barato, mas deixou de bloquear a retenção. Reclassificado.

**E o `H-D16`, medido, era pior do que estava escrito.** Subi o servidor e li os cabeçalhos reais: sem `x-forwarded-for` o Next preenche com o endereço do socket; **com** o cabeçalho, ele repassa o valor do cliente inteiro. E `origemDaRequisicao` lia a *primeira* entrada — exatamente o pedaço que o atacante escolhe. Variar um cabeçalho dava um balde de limite de taxa novo por requisição: o limite por origem não existia.

O erro de ler a primeira entrada é independente da configuração — mesmo **com** proxy confiável, a primeira entrada é a que o cliente mandou; o proxy acrescenta a verdadeira no fim.

Agora `PROXIES_CONFIAVEIS` declara quantos saltos confiáveis existem. Com `0` (padrão), o código **admite que não sabe a origem** em vez de fingir, e o teto sobe para o balde compartilhado não virar um DoS de graça contra a própria equipe. Com `N > 0`, lê a entrada certa da cadeia.

Provado na aplicação rodando: 25 pedidos forjando a primeira entrada com a última fixa deram 20 aceitos e depois `429` (mesmo balde); 25 pedidos com últimas entradas distintas passaram todos (clientes reais continuam separados, sem `429` falso).

**A revisão desta entrega achou um buraco pior que o defeito original.** A leitura por posição na cadeia assume que o proxy acrescentou alguma coisa — e nem todo proxy acrescenta. Na configuração comuníssima do nginx que manda `X-Real-IP` **sem** mexer em `X-Forwarded-For`, o Next preenche a cadeia com o endereço do próprio proxy. Medido com 25 clientes distintos: todos num balde só, e o limite **apertado** disparando no 21º pedido. A correção tinha trocado um defeito de segurança por um de disponibilidade — pior, porque derruba a operação num dia normal, sem atacante nenhum.

Corrigido: a cadeia manda quando ela realmente cresceu além dos saltos confiáveis; com um salto, `x-real-ip` desfaz o empate. Depois disso, 25 clientes distintos passam todos, e o mesmo cliente 25 vezes continua sendo travado no 21º.

**A ambiguidade que sobrou não dá para resolver sozinha, então virou visível.** `GET /api/diagnostico/origem` (só gestor) devolve o que o servidor entendeu como origem daquela requisição, com os cabeçalhos crus. Abrir de dois dispositivos e comparar `chave` responde em dez segundos se o proxy está configurado certo. Sem isso, o jeito de descobrir era a equipe parar de conseguir entrar.

A revisão também desmentiu uma afirmação minha: eu tinha escrito que o teto global afrouxado protege CPU e contém laço automatizado. Fui medir — 900 requisições em 30 processos paralelos **não** o alcançaram, e uma entrada legítima no meio passou. O `scrypt` satura a vazão antes do teto. Comentário corrigido para dizer o que foi medido.

Testes: 204 → **215**.

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

**O CI roda e passa em três jobs:** `verificar` (typecheck, testes e sincronia entre schema e migrações — a sincronia é um passo dentro dele, não um job próprio), `segredos` (gitleaks) e `dependencias`. `npm audit` acusa **zero vulnerabilidades** — voltou a zero em 06/09/2026, com o `override` de `mysql2`; entre 31/08 e essa data o job `dependencias` estava vermelho e este arquivo dizia o contrário. Antes de repetir a frase "o CI está verde" aqui, olhe o CI, não a memória da sessão — é a mesma lição que os branches órfãos já tinham dado.

O segundo arquivo de workflow, o do CodeQL, está **desarmado de propósito** (`workflow_dispatch` apenas). A análise funciona, mas o upload do resultado exige "code scanning", que o GitHub só oferece em repositório público ou com Advanced Security — e workflow eternamente vermelho ensina a equipe a ignorar vermelho. Reativar é descomentar os gatilhos quando o plano permitir.

### O que foi mesclado em 28/08/2026

| PR | O quê | Estado |
|---|---|---|
| [#11](https://github.com/fernando123-hue/Sistema-SBP/pull/11) | Toda a fundação do domínio — 20 commits | ✅ mesclado |
| [#5](https://github.com/fernando123-hue/Sistema-SBP/pull/5) | `gitleaks-action` v2 → v3 | ✅ mesclado |
| [#9](https://github.com/fernando123-hue/Sistema-SBP/pull/9) | `@types/node` e `typescript` (dev) | ✅ mesclado |
| [#2](https://github.com/fernando123-hue/Sistema-SBP/pull/2) | `actions/checkout` v4 → v7 | ✅ mesclado |
| [#1](https://github.com/fernando123-hue/Sistema-SBP/pull/1) | `actions/setup-node` v4 → v7 | ✅ mesclado |

**O prazo do Node 20 está resolvido.** #1 e #2 tinham data marcada: em **16 de setembro de 2026** o GitHub remove o Node 20 dos runners, e o log do CI já avisava —

```
Node.js 20 is deprecated. The following actions target Node.js 20 but are
being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4
```

Os dois estavam parados por limitação de permissão (alteram arquivo de workflow), não por defeito. Foram mesclados por API em 28/08/2026, e `checkout` e `setup-node` estão em `v7` nos três jobs do CI e no workflow do CodeQL. Nenhuma ação continua apontando para o Node 20.

### PRs — nenhum aberto

**Zero PRs abertos em 06/09/2026.** Histórico: [#12](https://github.com/fernando123-hue/Sistema-SBP/pull/12) mesclado em 31/08; [#15](https://github.com/fernando123-hue/Sistema-SBP/pull/15) (`lucide-react`) fechado sem merge — ficou sem objeto quando a dependência foi removida do projeto por não ter uso (seção *Revisão geral e limpeza*, 31/08); [#4](https://github.com/fernando123-hue/Sistema-SBP/pull/4) (`codeql-action` v3 → v4) fechado sem merge em 28/08 — inócuo, o workflow do CodeQL está desarmado; [#13](https://github.com/fernando123-hue/Sistema-SBP/pull/13) (`@types/node` 26.3.0 → 26.4.0) e [#14](https://github.com/fernando123-hue/Sistema-SBP/pull/14) (`@anthropic-ai/sdk` 0.121.0 → 0.122.0) mesclados em 06/09/2026, rotina, verdes.

### Branches — limpos

`claude/prototipo-em-progresso-unesv2` (órfão de onde A4–A12 foram resgatadas em 31/08) e os seis branches do Dependabot de PRs já mesclados/fechados **não existem mais no remoto** — o repositório apaga o branch de origem ao mesclar/fechar um PR, e isso já tinha acontecido; só o cache local (`git branch -r`) mostrava fantasma até um `git fetch --prune` em 06/09/2026. Os locais órfãos `feat/fundacao-dominio` e `pr5` também foram apagados — mesmo conteúdo já estava na `main`.

### Histórico que vale saber

O CI já produziu **vermelho que não era defeito**, duas vezes, e as duas foram corrigidas:

- O job do gitleaks falhava com `Resource not accessible by integration` em PR comum, porque o `permissions` global é `contents: read` e ele precisa de `pull-requests: read` para listar os commits. Falhava **sem ter encontrado segredo nenhum**.
- O mesmo job falhava em todo PR do Dependabot, que recebe token somente-leitura. Hoje ele pula quando o autor é o Dependabot — Dependabot só mexe em manifesto de dependência, e segredo novo não entra por aí.

E um defeito real que o CI pegou: `TS5102: Option 'baseUrl' has been removed`. O `tsconfig.json` usava `baseUrl` junto com `paths`, e a versão nova do TypeScript removeu a opção — isso travaria **qualquer** upgrade de TypeScript.

**A suíte já esteve perto de estourar o tempo limite.** Depois que o desdobramento passou a exigir revisão humana, a simulação de 30 dias passou a gerar centenas de pendências, e o helper de teste as aprovava uma a uma. Trocado por operação em lote: o arquivo caiu de 140s para ~50s. O `testTimeout` subiu para 90s, para dar margem em máquina mais lenta.

---

## Próximo passo sugerido

**Isto mudou em 31/08/2026.** Até aqui a frase era *"nada de código está bloqueando"* — e ela valia, porque as decisões que pedem código estavam invisíveis num branch órfão. Com A4–A12 de volta, **há trabalho de código decidido e não feito**, e ele passa na frente do que era o topo da lista.

### Zero — o que foi decidido em 26/08 e ainda não construído

~~**A11 e A12 — peso e limiar por categoria.**~~ **Entraram em 06/09/2026.** Ver *Onde parei* e `DECISOES.md` → *Peso e limiar por categoria*. **Os valores continuam sem ter sido relidos com o dono do negócio** — `1,75` nasceu negociável, e trocar qualquer um deles é uma linha de migração.

~~**A10 — entidade `Afastamento`.**~~ **Entrou em 06/09/2026.** Entidade, migração, exclusão automática do rateio e tela no Acesso.

~~**A4 — agrupamento por liga.**~~ **Entrou em 06/09/2026**, com a SPEC escrita antes do código, como manda a regra da casa.

**Nenhuma decisão do dono está pendente de código.** As nove (A4 a A12) estão implementadas, exceto os pedaços registrados abaixo: a leitura narrada do histórico (`A6`), a exibição de afastamento no Painel (que virou pergunta de privacidade, § H.4 item 9) e o `A8`, que depende de capacidade de envio de e-mail — adiada pelo próprio `A5`.

~~Além dessas, duas parciais: **A6** e **A7**.~~ **As duas entraram em 06/09/2026.** O `A7` está completo. Do `A6` falta só a leitura **narrada do histórico**: a rodada do dia é narrada na tela, mas reler em português uma rodada de três semanas atrás ainda exige `GET /api/rodadas/[id]`, que devolve dados crus. Como a narrativa é função pura sobre o snapshot, aplicá-la ao histórico é trabalho de rota e tela, não de regra.

> **Uma lição do A11, para as próximas estimativas.** Este arquivo dizia que A11 mexeria no motor. Não mexia — `motor.ts` já multiplicava por `categoria.peso`. O custo real estava num lugar que ninguém tinha previsto: a mudança de **unidade** do livro-razão, que quebrou dois testes de invariante escritos quando "um item" e "1 unidade" eram o mesmo número. Antes de estimar pelo que está escrito aqui, abra o código.

**O que segue valendo:** o sistema ainda não trocou uma palavra com o modelo real, e continua sendo a única parte nunca provada.

### Primeiro — a única parte nunca provada

1. **Rodar o adapter Anthropic contra a API real.** Com a chave em `ANTHROPIC_API_KEY` no `.env`:
   ```bash
   IA_ADAPTER=anthropic npm run ia:experimentar
   ```
   Ele mostra quatro casos — comum, desdobramento em N itens, campo faltando e tentativa de injeção — e não toca no banco. Compare com a saída do mock, principalmente no caso de injeção. É a **única** parte do sistema que nunca trocou uma palavra com o modelo; tudo mais tem teste ou foi conferido na tela.

2. **Depois de rodar, olhar a seção *Acerto da IA* no Painel.** Ela responde o critério de aceitação nº 5 e diz se a confiança que o modelo reporta separa acerto de erro. Contra o mock as duas médias saem coladas (0,91 e 0,90) e a tela avisa. Com o modelo real esse número muda — e é ele que autoriza, ou proíbe, afrouxar o limiar de confiança.

   **Isto virou pré-requisito de outra coisa em 28/08.** A diretriz do cérebro pede montagem de contexto para a IA, e eu recusei construí-la agora em parte por este motivo: sem linha de base medida contra o modelo real, acrescentar contexto compra a maior superfície de risco do sistema em troca de uma melhoria que ninguém consegue falsificar. Este passo destrava aquele.

### Depois — o que tem gatilho real

3. **`H-D19` — cifrar os bytes de anexo em repouso.** Obrigatório antes de documento real de associado entrar. Depende da aprovação formal da associação, que ainda não veio.

> Os PRs #1 e #2, que estavam aqui com prazo em 16/09, foram mesclados em 28/08/2026. Ver *Situação do CI e das dependências*.

### Depois disso, por valor decrescente

4. **`H-D7`** — os contratos de API redigitados à mão nas telas. Já divergiram uma vez (`emAndamento` sumiu; `Date` vs. string), e cada tela nova aumenta a superfície. Derivar os tipos dos esquemas Zod mata a família inteira de divergência silenciosa entre API e tela — e o legado do cliente vai consumir essas rotas.

5. **`H-D18`** — agregados de métrica materializados. Reclassificado: nenhuma métrica lê linha expurgável, então **não bloqueia mais a política de retenção**. Continua valendo por recorte histórico barato.

6. **`H-D8`** — as consultas N+1 do painel e da distribuição. Irrelevantes com 4-7 pessoas em SQLite local (medido: ~29 consultas por carregamento do painel, ~14 por categoria na distribuição). Viram problema de verdade na migração para PostgreSQL, e pior por acontecerem dentro da transação que segura a trava do dia.

7. **Demais itens de `DECISOES.md § H.2`.** Onze dívidas continuam abertas no total; tirando as quatro já nomeadas acima, sobram **sete**. Nenhuma com prazo, nenhuma travando uso.

---

## Cinco decisões que dependem do dono do negócio

Estão registradas em `DECISOES.md § H.4`, sem resposta inventada:

0. **Quem pode ver que alguém está de atestado?** *(levantada em 06/09/2026, com o `A10`)* O `A10` pede "exibição no painel de quem está fora". Foi feita **onde a ausência muda a operação** — a tela de plantão marca quem está afastado e recusa a marcação. **Não foi levada ao Painel**, e a diferença não é de esforço: o Painel é visível a `colaborador`, e `atestado`/`licença` são **informação de saúde**. Publicar isso para os colegas é decisão de privacidade. Opções: não mostrar · mostrar só "fora hoje", sem o tipo · mostrar completo só para gestor. **Nada implementado** até você escolher.

1. **Quem vê a caixa de entrada inteira?** *(levantada na auditoria de 28/08/2026)* Hoje `GET /api/itens` exige sessão mas não exige papel, e a navegação oferece a tela a `colaborador` — então qualquer pessoa autenticada vê remetente e assunto de TODOS os e-mails. O `RF-23` diz que colaborador vê *os seus*. **Não foi alterado de propósito:** a equipe já trabalha de uma caixa compartilhada, então restringir mudaria a operação em vez de corrigir defeito.
2. **Carga de exceção conta para o balanceamento?** *(levantada em 28/08/2026, com o registro manual)* Quem atende 30 inadimplentes num dia fez trabalho real, e hoje esse trabalho **não** entra no crédito — a pessoa continua recebendo cota cheia das categorias do rateio. Contar resolveria a justiça de carga, mas faria uma categoria de exceção mexer na cota justa de categorias das quais ela não participa. Escolhi o lado reversível (`§ AT-09`) porque despoluir um razão já acumulado exige recomputar histórico; começar a contar depois, não.
3. **Um agente é ator de quê?** *(levantada em 28/08/2026, com a fundação do cérebro)* Hoje `ATOR_SISTEMA` tem papel **`operador`** — e com esse papel passam `confirmar distribuição` e `aprovar revisões em massa`. Um agente futuro empunhando essa identidade decidiria distribuição, e a trilha registraria `sistema`, indistinguível do cron de ingestão. Pior: `'sistema'` não é `Colaborador`, então não pode ser desativado, expirado nem travado. Isto é verdade **antes** do cérebro; o cérebro só torna o caminho alcançável. Tem consequência de schema.
4. **Memória cai de que lado da retenção?** *(levantada em 28/08/2026)* `LogAuditoria` guarda `Item.titulo`, que a IA extraiu do corpo do e-mail e pode carregar nome de associado. Se a retenção expurgar `EmailConteudo`, o título **sobrevive** na trilha — que o invariante 11 proíbe apagar. Decisão de DPO, não de engenharia.

> **Eram sete até 31/08/2026.** Três saíram da lista sem ninguém decidir nada de novo: *dono único*, *etapa 6* e *itens mais antigos* já tinham sido respondidas em 26/08 (A4, A5 e A7), numa sessão cujo trabalho ficou num branch órfão. A lista aqui continuou pedindo resposta para pergunta já respondida por cinco dias. Ver `DECISOES.md`, seção *Reconciliação: A4–A12*.
>
> Uma oitava — **"período" do desempate** — foi respondida em 27/08/2026: janela deslizante de 30 dias, já implementada. O resgate mostrou que ela tinha sido respondida **duas** vezes, com números diferentes (15 em 26/08, 30 em 27/08); vale a mais recente.

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
| mudar as colunas do painel | `porCategoria` em `src/servicos/painel.ts` — mantenha `conferirPendencia` batendo |
| mudar o critério de acerto da IA | `src/core/qualidade-ia.ts` (puro) — o serviço só lê o banco |
| mexer em cadastro de pessoa ou habilitação | `src/servicos/colaboradores.ts` e a tela `/acesso` |
| registrar trabalho que não veio por e-mail | `src/servicos/itens.ts` e o formulário em `/caixa` |
| investigar "o que aconteceu com este item / neste erro" | `GET /api/memoria` e `src/servicos/memoria.ts` |
| acrescentar uma ação de auditoria ou uma operação com papel | `AcaoAuditavelSchema` / `OperacaoSchema` em `src/core/esquemas.ts` — são uniões fechadas |
| ajustar confiança em proxy | `PROXIES_CONFIAVEIS` no `.env`; confira em `/api/diagnostico/origem` |
| implementar retenção | apagar `EmailConteudo` e bytes; **nunca** `Item`, `Atribuicao`, `SaldoCarga`, `LogAuditoria` |
| trocar disco por nuvem | novo adapter de `ArmazenamentoPort` + `criarArmazenamentoPort()` |

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + 358 testes |
| `npm run dev` | Aplicação em http://localhost:3000 |
| `npm run demo` | Fluxo completo pelo terminal |
| `npm run ia:experimentar` | Compara mock e modelo real. **Único** comando que gasta crédito |
| `npm run db:seed` | Cadastro base sintético + senhas provisórias |
| `npm run db:limpar` | Apaga dados transacionais, preserva cadastro |
| `npm run db:studio` | Inspeciona o banco |
| `npx prisma migrate deploy` | Aplica as migrações num banco novo |
| `npx prisma generate` | Regenera o cliente Prisma em `src/generated/` |

Dados são 100% sintéticos. Nenhum nome, CPF ou e-mail real entra no repositório.

---

## Se algo parecer quebrado ao retomar

- **`npm run db:seed` não mostra senha de alguém:** é o comportamento correto — quem já trocou a senha não é tocado. Para recomeçar do zero, limpe o banco e rode as migrações de novo.
- **Erro de typecheck vindo de `.next/`:** artefato do dev server, não do código. `rm -rf .next` e rode de novo.
- **`AdapterIndisponivelError`:** `IA_ADAPTER` ou `INGESTAO_ADAPTER` aponta para um adapter não implementado. É proposital — o sistema recusa subir em vez de cair no mock em silêncio.
- **`SESSAO_SECRET ausente ou curto demais`:** gere um com `node -e "console.log(crypto.randomUUID())"` e cole no `.env`.
- **Login recusado com a senha certa:** confira se a conta não está desativada ou travada por tentativas. A mensagem é genérica de propósito — ela não revela qual dos casos é. Use a tela `/acesso` como gestor.
- **`Cannot find module ... src/generated/prisma`:** o cliente do Prisma não é versionado. Rode `npx prisma generate`.
- **O `CLAUDE.md` aparece modificado sem você ter mexido:** é o `next dev` escrevendo um bloco sozinho a cada execução. Esperado até a decisão de aceitar ou desligar.
- **Clonou e falta código (sem `src/servicos/memoria.ts`, sem registro manual, 6 migrações em vez de 7):** era o sintoma de o PR #12 estar aberto, e ele foi mesclado em 31/08/2026. Se você vê isso hoje, seu clone é anterior a essa data: `git pull origin main`. A `main` atual tem 8 migrações e 278 testes.
- **`migration ... was modified after it was applied` ao rodar `prisma migrate deploy`:** acontece se você aplicou as migrações num commit intermediário da antiga branch do PR #12 e depois pulou para outro — só alcançável em clone antigo, já que o #12 foi mesclado. A migração `20260828185851_identidade_de_dominio_na_memoria` foi **editada depois de aplicada**, em 28/08/2026, para colapsar duas migrações numa só — ela criava dois índices que saíram na mesma tarde, e duas migrações onde uma bastava seria ruído permanente no histórico. Como ela nunca saiu da branch nem tocou banco de produção, editar era seguro; o preço é este aviso. **Conserto:** apague o banco local e reconstrua — `rm -f dev.db && npx prisma migrate deploy && npm run db:seed`. O banco de teste se recria sozinho a cada suíte. Clonando a `main` de hoje, nada disso acontece.

- **Testes lentos ou estourando tempo:** a simulação de 30 dias roda contra SQLite de verdade. `testTimeout` está em 90s para dar margem em máquina mais lenta; o arquivo pesado leva ~50s.
