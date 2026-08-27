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

Requisitos: **Node 22+** e npm. Nenhum banco externo — o protótipo usa SQLite.

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run dev
```

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

## Scripts

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + toda a suíte de testes |
| `npm test` | Testes (unitários + integração) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo` | Fluxo completo ponta a ponta |
| `npm run ia:experimentar` | Compara mock e modelo real em 4 casos. Único caminho que gasta crédito |
| `npm run db:seed` | Cadastro base sintético |
| `npm run db:limpar` | Apaga dados transacionais, preserva o cadastro |
| `npm run db:migrate` | Cria e aplica migração |
| `npm run db:studio` | Inspeciona o banco |

## Arquitetura

```
app/          telas
api/          endpoints REST — toda operação existe aqui primeiro
servicos/     transações, Prisma, orquestração          -> depende de core
core/         domínio puro: motor, esquemas, segurança  -> NÃO depende de nada
ports/        contratos: AiPort, IngestaoPort, ArmazenamentoPort
adapters/     mock | anthropic | disco | imap | xlsx
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
- **Retenção:** conteúdo do e-mail e bytes de anexo vivem em linhas próprias, expurgáveis sem derrubar item, carga, conservação ou auditoria. Nenhuma política de prazo foi implementada — a estrutura permite, a decisão é do dono.
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

Feito: motor puro com testes · modelo de dados com constraints · ingestão idempotente · adapters de IA (mock e Anthropic) · fila de revisão com divisão manual · distribuição transacional com conservação garantida · fila individual com devolução ao pool · painel derivado · auditoria e observabilidade · 19 rotas REST · 9 telas · **autenticação por e-mail e senha** com troca obrigatória da provisória, bloqueio progressivo e revogação de sessão · tela de administração de acesso · **conteúdo separado do histórico operacional**, com anexos guardados fora do banco e tipo real conferido pelos bytes · **auditoria completa com 24 correções aplicadas** (`DECISOES.md § H`).

**159 testes passando.**

O adapter Anthropic está escrito e coberto por testes, mas **ainda não foi exercitado contra a API real** — rode `IA_ADAPTER=anthropic npm run ia:experimentar` com a chave configurada antes de confiar nele.

A seguir, em ordem: validar o adapter contra a API · tela de administração de acesso · medir a taxa de acerto da IA · exportação para o sistema legado.

Retomando o trabalho em outra máquina? Leia [docs/ESTADO.md](docs/ESTADO.md).
