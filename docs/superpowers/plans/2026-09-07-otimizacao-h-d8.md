# Otimização H-D8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir leituras N+1 no Painel e no planejamento de distribuição sem mudar resultados ou contratos.

**Architecture:** Os serviços continuam sendo a única camada que consulta Prisma. Cada serviço buscará linhas por conjunto de colaboradores e criará índices em memória, escolhendo explicitamente o saldo mais recente por data. Não há alteração de tabela, migração ou interface HTTP.

**Tech Stack:** TypeScript, Prisma 7, SQLite para testes e Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-07-otimizacao-h-d8-design.md`

## Global Constraints

- Não criar migração, mudar schema, expurgar ou alterar dados existentes.
- Não usar SQL cru ou particularidade de SQLite.
- Preservar assinaturas públicas, papéis e regras de distribuição.
- Validar ao fim com `npm run verificar`.

---

### Task 1: Leitura em lote por pessoa no Painel

**Files:**
- Modify: `src/servicos/painel.ts:317-368`
- Create: `src/servicos/painel-por-pessoa.test.ts`

**Interfaces:**
- Consumes: `porPessoa(banco: Banco): Promise<LinhaPorPessoa[]>`.
- Produces: A mesma assinatura e linhas ordenadas por nome, com contagens e saldo globais equivalentes.

- [ ] **Step 1: Escrever teste de equivalência**

Crie Ana e Bia com atribuições ativas, execuções concluídas e saldos globais diferentes. Para Ana, grave dois saldos em datas diferentes e exija o mais recente. Crie ainda uma pessoa inativa e exija que ela não apareça.

```ts
expect(await porPessoa(banco)).toEqual([
  { colaboradorId: ana.id, nome: 'Ana', atribuidos: 2, concluidos: 1, pendentes: 1, creditoGlobal: -0.5 },
  { colaboradorId: bia.id, nome: 'Bia', atribuidos: 1, concluidos: 0, pendentes: 1, creditoGlobal: 0.5 },
])
```

- [ ] **Step 2: Confirmar a linha de base**

Run: `npx vitest run src/servicos/painel-por-pessoa.test.ts`

Expected: PASS antes da troca de estratégia; o teste congela o contrato.

- [ ] **Step 3: Substituir consultas por pessoa por consultas em lote**

Use quatro consultas para todos os ids — três `groupBy` para atribuições, execuções e pendências, e um `findMany` de `SaldoCargaGlobal` ordenado por `colaboradorId` e `data desc`. Converta cada resposta em `Map<string, number>`; no saldo, guarde apenas a primeira linha por pessoa.

```ts
const ids = colaboradores.map((pessoa) => pessoa.id)
const atribuicoes = await banco.atribuicao.groupBy({
  by: ['colaboradorId'],
  where: { colaboradorId: { in: ids }, ativa: true },
  _count: { _all: true },
})
```

- [ ] **Step 4: Verificar e registrar**

Run: `npx vitest run src/servicos/painel-por-pessoa.test.ts src/servicos/painel-periodo.test.ts`

Expected: PASS.

Commit: `git add src/servicos/painel.ts src/servicos/painel-por-pessoa.test.ts && git commit -m "perf: elimina leituras por pessoa no painel"`

### Task 2: Leitura em lote de elegibilidade da distribuição

**Files:**
- Modify: `src/servicos/distribuicao.ts:707-823`
- Modify: `src/servicos/distribuicao-retroativa.test.ts`

**Interfaces:**
- Consumes: `planejarCategoria(banco, categoria, data, ajusteGlobal)` e `confirmar`.
- Produces: O mesmo conjunto de elegíveis usado pelo motor, com o mesmo crédito e recebimento por pessoa.

- [ ] **Step 1: Acrescentar regressões pelos caminhos públicos**

No cenário de distribuição, crie afastamento vigente para Bia e prove que recebe zero. Grave `SaldoCarga` em `data - 30`, `data - 29` e `data`; a prévia deve incluir apenas os dois últimos na janela de 30 dias. Execute ainda duas categorias na mesma prévia e confirme que `ajusteGlobal` altera apenas o crédito global da rodada em curso.

```ts
await banco.afastamento.create({ data: { colaboradorId: bia.id, tipo: 'ferias', inicio: dia, registradoPor: operador.colaboradorId } })
const relatorio = await previa(banco, { data: dia, categorias: [categoria.codigo] }, operador)
expect(relatorio.planos[0]!.resultado!.atribuicoes[bia.id] ?? 0).toBe(0)
```

- [ ] **Step 2: Confirmar a linha de base**

Run: `npx vitest run src/servicos/distribuicao-retroativa.test.ts src/servicos/distribuicao-falhas.test.ts`

Expected: PASS antes da refatoração.

- [ ] **Step 3: Buscar saldos de todos os candidatos por conjunto**

Após os filtros existentes de habilitação, escala e afastamento, faça quatro leituras para todos os colaboradores escalados: `SaldoCarga` até a data, `SaldoCargaGlobal` até a data, `groupBy` da soma de recebidos na janela e `SaldoCarga` do dia. Ordene os dois conjuntos históricos por pessoa e `data desc`, preservando só a primeira linha por pessoa em cada índice. Some `ajusteGlobal` exclusivamente ao crédito global retornado.

```ts
const recebidosJanela = await banco.saldoCarga.groupBy({
  by: ['colaboradorId'],
  where: { colaboradorId: { in: candidatos }, categoriaId, data: { gte: deslocarDias(data, -(DIAS_DA_JANELA - 1)), lte: data } },
  _sum: { recebido: true },
})
```

- [ ] **Step 4: Verificar e registrar**

Run: `npm run verificar`

Expected: typecheck e todos os testes PASS.

Commit: `git add src/servicos/distribuicao.ts src/servicos/distribuicao-retroativa.test.ts && git commit -m "perf: agrupa leituras de elegibilidade"`

### Task 3: Atualizar a retomada

**Files:**
- Modify: `docs/ESTADO.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: resultados validados das Tasks 1 e 2.
- Produces: documentação que não apresenta H-D8 como pendência nem lista H-D19 e H-D7 como trabalho futuro.

- [ ] **Step 1: Atualizar apenas alegações comprovadas**

Registre que as leituras encadeadas foram eliminadas dos dois caminhos. Preserve a nota de que a migração real para banco remoto é uma etapa de infraestrutura separada.

- [ ] **Step 2: Conferir coerência e registrar**

Run: `rg -n "H-D8|H-D19|H-D7" README.md docs/ESTADO.md docs/DECISOES.md`

Expected: referências históricas permanecem; listas de próximos passos refletem o estado final.

Commit: `git add docs/ESTADO.md README.md && git commit -m "docs: atualiza estado após otimização H-D8"`
