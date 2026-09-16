# Sistema de Distribuição de Demandas

Substituto da planilha `PRODUTIVIDADE_-_2026.xlsx`, usada pela Secretaria de Atendimento ao Associado para repartir trabalho diário entre a equipe.

Não é uma planilha melhor. É a troca da unidade de trabalho: sai a **contagem anônima**, entra o **item rastreável**.

| | Planilha hoje | Sistema |
|---|---|---|
| Unidade de trabalho | contagem anônima | item rastreável |
| Quem recebe | codificado em fórmula | dado (habilitação + escala) |
| Tratamento do resto | 406 correções manuais/ano | algoritmo determinístico |
| Balanceamento histórico | memória de uma pessoa | `credito_acumulado` no banco |
| Conservação da soma | falha em 29% dos dias | invariante de transação |
| Auditoria | impossível | completa |
| Digitação | ~7.000 lançamentos/ano | ~0 |

## Começando

Requisitos: **Node 22+**, npm e **MySQL 8** (decisão `A42`).

```bash
npm install
cp .env.example .env

# SESSAO_SECRET é OBRIGATÓRIO e o sistema recusa subir sem ele.
# Gere um e escreva no .env:
node -e "console.log(crypto.randomUUID())"

# A BASE PRECISA DA COLAÇÃO CERTA — ver o aviso logo abaixo.
mysql -u root -e "CREATE DATABASE sbp CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;"
# Escreva a URL no .env: mysql://usuario:senha@127.0.0.1:3306/sbp

npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run dev
```

> **A colação não é detalhe.** Com o padrão do MySQL 8 (`utf8mb4_0900_ai_ci`), que ignora maiúsculas e acentos, *"Liga de Neonatologia"* e *"liga de neonatologia"* colidem no índice único de `Liga` e viram a **mesma** liga — o contrário do que o sistema garante (`AT-10`), e sem erro nenhum que denuncie. Criar a base pelo padrão é o jeito errado que funciona até o dia em que as duas grafias aparecerem.

O `db:seed` imprime **uma senha provisória por pessoa, uma única vez** — copie-as do terminal, elas não ficam gravadas em lugar nenhum.

Abra `http://localhost:3000` e entre como **ana.operadora@exemplo.test** com a senha provisória dela; o sistema pede a troca antes de liberar qualquer tela. Depois, clique em **Buscar e-mails**, marque o plantão e calcule a prévia.

`npm run demo` roda o mesmo fluxo pelo terminal, sem tela: ingestão, classificação por IA, fila de revisão, distribuição, execução, painel e conferência de conservação.

## Telas

| Rota | O que faz |
|---|---|
| `/distribuicao` | Marca o plantão, mostra a prévia com crédito antes/depois, confirma a rodada |
| `/revisao` | Fila das exceções da IA: sugestão + campos editáveis + aprovar ou descartar |
| `/caixa` | Todos os itens com remetente, assunto, confiança e responsável |
| `/fila` | Fila individual, mobile-first. Concluir item a item |
| `/painel` | Recebido/distribuído/concluído/pendente. Zero campo digitável |
| `/acesso` | Só gestor: estado de acesso da equipe, senha provisória, destravar, ligar/desligar |
| `/senha` | Troca da própria senha. Obrigatória enquanto a provisória valer |
| `/entrar` | E-mail e senha. Única porta de entrada |
| `/` | Raiz: manda para a tela certa conforme o papel |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + toda a suíte de testes |
| `npm test` | Testes (unitários + integração) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo` | Fluxo completo ponta a ponta |
| `npm run ia:experimentar` | Compara mock e modelo real em 4 casos. Único caminho que gasta crédito |
| `npm run db:seed` | Cadastro base sintético |
| `PERMITIR_LIMPEZA=sim npm run db:limpar` | Apaga dados transacionais, preserva o cadastro. Exige o opt-in explícito: sem ele, recusa — a trava anterior deduzia segurança da ausência de `NODE_ENV` |
| `npm run db:expurgar` | Roda agora a limpeza diária que o servidor já roda sozinho: apaga o motivo das ausências cujo prazo venceu (`A17`). **Irreversível**; uma execução por dia — se o servidor já rodou hoje, não faz nada. O prazo é o da tela de acesso, não de variável de ambiente |
| `npm run anexos:conferir` | Diz quantos anexos ainda estão em texto puro no disco |
| `npm run anexos:recifrar` | Cifra os que faltam, conferindo cada um pela leitura antes de trocar |
| `npm run db:migrate` | Cria e aplica migração |
| `npm run db:studio` | Inspeciona o banco |

## Arquitetura

```
app/          telas
api/          endpoints REST — toda operação existe aqui primeiro
servicos/     transações, Prisma, orquestração          -> depende de core
core/         domínio puro: motor, esquemas, segurança  -> NÃO depende de nada
ports/        contratos: AiPort, IngestaoPort, ArmazenamentoPort
adapters/     mock | anthropic | gemini | disco cifrado   (imap, gmail, nuvem: previstos)
```

**Regra de dependência:** as setas apontam só para dentro. `core/` não importa Prisma, React, Next nem `fetch`. É isso que torna o motor testável em milissegundos e auditável para sempre.

### O motor de distribuição

Função pura em [`src/core/distribuicao/motor.ts`](src/core/distribuicao/motor.ts). Sem I/O, sem relógio, sem aleatoriedade. Mesma entrada produz a mesma saída hoje e daqui a três anos.

```
1. valida entrada                     -> erro explícito, nunca degradação
2. ordena elegíveis por crédito        -> formaliza a alternância que hoje é memória humana
3. Q <= limiar  -> lote inteiro para um só
   senão       -> piso para todos + resto inteiro para o topo da ordem
4. VERIFICA soma == Q                  -> falhou, aborta a transação inteira
5. atualiza o crédito em unidades ponderadas
```

A prévia da tela e a gravação chamam **a mesma função**. O que o operador vê é literalmente o que será gravado.

### Papel da IA

> IA para interpretar. Algoritmo para decidir. Banco para lembrar. Regra explícita para governar.

| Usa IA | Nunca IA |
|---|---|
| classificar categoria do e-mail | calcular a divisão |
| extrair campos e ler documentos | escolher quem recebe |
| desdobrar 1 e-mail em N itens | tratar o resto |
| detectar campo ausente e duplicata | somar, agregar, calcular % |

Toda saída de IA passa por `InterpretacaoSchema` (Zod). Uma resposta que não valida é falha de interpretação — o e-mail vai para revisão humana, nunca para o motor.

## Segurança

- **Conteúdo externo é dado, nunca instrução.** Corpo de e-mail, assunto e nome de anexo passam por truncar → detectar → delimitar ([`conteudo-nao-confiavel.ts`](src/core/seguranca/conteudo-nao-confiavel.ts)). A defesa real não é a regex: é a arquitetura — a IA não decide quem recebe nem quanto, então uma injeção bem-sucedida no máximo classifica errado, e a revisão pega.
- **Anexos:** allowlist de extensão, travessia de diretório removida do nome, teto de tamanho e **conferência do tipo real pelos bytes** ([`assinatura-de-arquivo.ts`](src/core/seguranca/assinatura-de-arquivo.ts)) — um executável chamado `laudo.pdf` passa pela allowlist inteiro e só a assinatura o denuncia. O MIME type declarado pelo remetente é ignorado. Arquivo recusado não vai para o disco.
- **Retenção:** conteúdo do e-mail e bytes de anexo vivem em linhas próprias, expurgáveis sem derrubar item, carga, conservação ou auditoria. A **limpeza diária** roda sozinha dentro do servidor (`src/instrumentation.ts`) e, hoje, alcança o **motivo de afastamento**: 7 dias depois da volta, a observação sai e o tipo vira `férias` ou `ausente` (`docs/DECISOES.md § A17`); o gestor edita o prazo na tela de acesso, com trilha e confirmação antes de encurtar. A mesma limpeza apaga o **texto dos e-mails e os bytes dos anexos** no dia da conclusão do último item mais o prazo (padrão 7 dias, `A20`); a Caixa mostra, no lugar, quando o original chegou para achá-lo no Outlook. Os **campos extraídos pela IA** (`A23`) **ainda não têm rotina**.
- **Idempotência:** `Email.messageId` é único. Reprocessar nunca duplica carga.
- **Responsável único:** garantido por índice do banco, não por código.
- **Segredos:** só via ambiente, validados na inicialização. `.env` fora do repositório.
- **Dados de teste:** 100% sintéticos. Nenhum nome, CPF, liga ou e-mail real entra no repositório.

## Documentação

| Documento | Responde |
|---|---|
| **[Estado](docs/ESTADO.md)** | **comece por aqui** — o que está pronto, onde parei, próximo passo |
| [Briefing](docs/01-BRIEFING.md) | por quê — problema medido, objetivos, contexto |
| [PRD](docs/02-PRD.md) | o quê — requisitos, invariantes, aceitação |
| [Spec](docs/03-SPEC.md) | como — camadas, dados, motor, API, telas |
| [Decisões](docs/DECISOES.md) | correções, hipóteses, pendências e a auditoria completa (§ H) |

`DECISOES.md` é a fonte da verdade sobre o que foi **assumido** e o que foi **confirmado**. Nenhuma hipótese vira regra silenciosamente.

## Estado atual

Feito: motor puro com testes · modelo de dados com constraints · ingestão idempotente · adapters de IA (mock e Anthropic) · fila de revisão com divisão manual · distribuição transacional com conservação garantida · fila individual com devolução ao pool · painel derivado com recorte de período · **registro manual do que não chega por e-mail** (balcão, telefone, `INADIMP.`/`ISENTO`) · qualidade da IA medida · auditoria e observabilidade · **memória operacional consultável** (a trilha de auditoria deixa de ser write-only) · 31 caminhos REST em 38 operações · 9 telas · **autenticação por e-mail e senha** com troca obrigatória da provisória, bloqueio progressivo e revogação de sessão · tela de administração de acesso · **conteúdo separado do histórico operacional**, com anexos guardados fora do banco e tipo real conferido pelos bytes · **auditoria completa com 24 correções aplicadas** (`DECISOES.md § H`).

**A suíte inteira verde** (`npm run verificar`). Um número fixo aqui envelhece: este arquivo já disse 271 quando eram mais de 500.

O adapter Anthropic está escrito e coberto por testes, mas **ainda não foi exercitado contra a API real** — rode `IA_ADAPTER=anthropic npm run ia:experimentar` com a chave configurada antes de confiar nele.

A seguir, em ordem: **rodar `npm run anexos:recifrar`** (a cifragem em repouso existe e vale só para arquivo novo — os antigos seguem em texto puro) · levar à chefia as perguntas de retenção · validar o adapter contra a API real · validar no cliente a resposta das rotas contra o mesmo Zod, que é o resto da `H-D7` · exportação para o sistema legado.

Retomando o trabalho em outra máquina? Leia [docs/ESTADO.md](docs/ESTADO.md).
