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
npm run demo
```

`npm run demo` executa o fluxo inteiro de verdade, sem nenhuma tela: ingestão, classificação por IA, fila de revisão, distribuição, execução, painel e conferência de conservação.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + toda a suíte de testes |
| `npm test` | Testes (unitários + integração) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run demo` | Fluxo completo ponta a ponta |
| `npm run db:seed` | Cadastro base sintético |
| `npm run db:limpar` | Apaga dados transacionais, preserva o cadastro |
| `npm run db:migrate` | Cria e aplica migração |
| `npm run db:studio` | Inspeciona o banco |

## Arquitetura

```
app/          telas (a construir)
api/          endpoints REST — toda operação existe aqui primeiro
servicos/     transações, Prisma, orquestração          -> depende de core
core/         domínio puro: motor, esquemas, segurança  -> NÃO depende de nada
ports/        contratos: AiPort, IngestaoPort
adapters/     mock | anthropic | imap | xlsx
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
- **Anexos:** allowlist de extensão, travessia de diretório removida do nome, teto de tamanho. O MIME type declarado pelo remetente é ignorado.
- **Idempotência:** `Email.messageId` é único. Reprocessar nunca duplica carga.
- **Responsável único:** garantido por índice do banco, não por código.
- **Segredos:** só via ambiente, validados na inicialização. `.env` fora do repositório.
- **Dados de teste:** 100% sintéticos. Nenhum nome, CPF, liga ou e-mail real entra no repositório.

## Documentação

| Documento | Responde |
|---|---|
| [Briefing](docs/01-BRIEFING.md) | por quê — problema medido, objetivos, contexto |
| [PRD](docs/02-PRD.md) | o quê — requisitos, invariantes, aceitação |
| [Spec](docs/03-SPEC.md) | como — camadas, dados, motor, API, telas |
| [Decisões](docs/DECISOES.md) | correções aos documentos de origem, hipóteses, pendências |

`DECISOES.md` é a fonte da verdade sobre o que foi **assumido** e o que foi **confirmado**. Nenhuma hipótese vira regra silenciosamente.

## Estado atual

Feito: motor puro com testes · modelo de dados com constraints · ingestão idempotente · IA mock determinística · fila de revisão · distribuição transacional com conservação garantida · fila individual · painel derivado · auditoria e observabilidade.

A seguir: API REST · telas (Next.js + shadcn/ui) · adapter Anthropic real · exportação para o sistema legado.
