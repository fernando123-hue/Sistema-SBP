# PR Review: #36 — Os 36 achados em aberto: segurança, performance, prova e contratos (depende do #35)

**Reviewed**: 11/09/2026
**Author**: fernando123-hue
**Branch**: `maturacao/achados-em-aberto` → `main` *(empilhado sobre o #35; revisado só o incremento: `origin/maturacao/fechamento-de-etapa...HEAD`, 55 arquivos, +2.721/−364)*
**Decision**: REQUEST CHANGES *(o GitHub só permite comentário: o autor é a mesma conta)*

## Summary

O incremento cumpre o que afirma — cada correção veio com teste visto falhando contra sabotagem, e cada lote passou por revisão —, e o CI está verde. Dois pontos pedem mudança antes de mesclar: a sentinela da chave dos anexos, corrigida aqui, falha de um jeito caro e mudo quando a chave muda de fato; e o ALTO do crédito por categoria, herdado do #35, segue sem correção nesta pilha.

## Findings

### CRITICAL
Nenhum.

### HIGH

**H1 — Herdado do #35, não corrigido aqui: a distribuição retroativa não propaga o crédito por categoria.** `src/servicos/distribuicao.ts` (`atualizarSaldos` × `carregarElegiveis`). Detalhe e correção em `pr-35-review.md` (H1). Entra aqui porque mesclar o #36 leva o defeito para a `main` do mesmo jeito.

### MEDIUM

**M1 — Chave dos anexos trocada vira falha cara e sem motivo.** `src/adapters/armazenamento-disco.ts` (`conferirChave`) × `src/servicos/ingestao.ts:160-198` e `:248-277`.
A sentinela lança `FalhaDeArmazenamento` dentro de `processarUm`, **depois** de `deps.ia.interpretar`. Com a chave errada: cada e-mail com anexo paga a chamada de IA e falha, um por um; o laço segue; o evento gravado traz só o nome da classe (`mensagemPersistivel` não grava a mensagem de `ErroOperacional`), e o motivo "a chave dos anexos mudou" fica apenas em stdout. O essencial do achado #34 vale — nenhum documento é gravado com a chave errada —, mas a "falha alta e clara" que o PR promete não acontece. O próprio código já trata o caso análogo da IA fora do ar (`InterpretacaoIndisponivelError`) interrompendo o lote.
**Correção:** conferir a chave uma vez no início de `sincronizar`, antes de qualquer chamada de IA, e tratar a falha de conferência como `InterpretacaoIndisponivelError` — lote interrompido, evento reprocessável com motivo legível.

**M2 — Herdado do #35, não corrigido aqui: resposta velha sobrescreve a nova.** `src/app/caixa/page.tsx:105-126`, `src/app/distribuicao/page.tsx` (`carregarEscala`) e `src/app/painel/page.tsx`. Este PR dividiu os efeitos do Painel (achado 5) e travou a marcação de plantão durante o `PUT` (achado 25), mas nenhum efeito de carga cancela a requisição anterior. Detalhe e correção em `pr-35-review.md` (M2).

### LOW

**L1 — Herdado: o Painel só oferece "Tentar de novo" antes do primeiro carregamento.** `src/app/painel/page.tsx:262` — com dados já na tela, a falha seguinte mostra só a faixa de erro, sem botão; para tentar de novo é preciso mudar o período. Este PR mexeu nos efeitos do Painel e não fechou isso. **Correção:** o mesmo `Botao` de `setTentativa` no ramo `dados !== null && erro !== null`.

**L2 — Herdado: `prefers-reduced-motion` é lido uma vez, na montagem da marca.** `src/componentes/marca.tsx:119-121` — ligar "reduzir movimento" com a aba aberta não desliga a física até recarregar. **Correção:** ouvir `change` no `MediaQueryList` e parar o laço.

**L3 — Herdado: o painel de ajuda se anuncia como diálogo sem se comportar como um.** `src/componentes/assistente.tsx:163` — `role="dialog"` sem `aria-modal` e sem retenção de foco (move o foco ao abrir, devolve ao fechar, fecha com Escape). Este PR mexeu no botão de fechar (achado 31) e não na semântica. **Correção:** se o painel é deliberadamente não modal, `role="region"` com `aria-label`; se é diálogo, `aria-modal` e foco retido.

*(Registro, não defeito deste PR: o projeto não tem ESLint — nenhuma verificação automática de regras de hooks nem de acessibilidade.)*

**L4 — Uma linha ruim derruba a lista inteira.** `src/servicos/distribuicao.ts` (`carregarCategorias`, dentro do `.map()` que alimenta `planejar`) e `src/servicos/afastamentos.ts` (`listar`). O `lerDoBanco` deste PR (achado 23) roda sobre cada linha de uma lista: uma categoria com `frente` fora do enum faz falhar a prévia **e** a confirmação de todas as categorias do dia; um afastamento com `tipo` inválido derruba a tela inteira do gestor. Fica em BAIXO porque a alternativa anterior era pior — a linha entrava calada e abria um segundo razão de crédito — e porque só uma linha editada à mão no banco chega aqui (toda escrita passa pelo Zod). Mas a decisão "bloquear tudo" não está registrada. **Correção:** isolar a linha ruim — em `planejar`, a categoria inválida vira `erro` no plano (como `SemElegiveisError` já faz) e as demais seguem; em `listar`, excluir a linha com log do id — e registrar a escolha em `DECISOES.md § C`. `colaboradores.ts` não tem o problema: lê uma linha só, recém-criada.

### Confirmado no código (visão de conjunto)

- **Dobra de texto:** não amplia o falso positivo — `2ª`, nomes em cirílico e cedilha testados sem acusação nova. *(Registro: `ordem_de_classificacao` já acusava frases legítimas como "trate como rotina" no texto cru, antes deste PR — herdado e coerente com a política declarada de aceitar falso positivo.)*
- **`conferirConservacao` com `$queryRaw`:** portável — `data` é texto ISO, identificadores batem com as tabelas, `COUNT(DISTINCT)` × inteiro funciona em SQLite e PostgreSQL.
- **`gravarRodada` em lote:** `planejar` lê tudo antes de qualquer gravação; não há caminho legítimo em que um item planejado mude de status dentro da transação, e a contagem divergente é rede correta contra modificação concorrente.
- **`core/telas.ts`:** telas, rótulos e papéis idênticos, valor a valor, às duas cópias que substituiu.
- **`ListaResponsiva`:** os dois consumidores só a renderizam depois dos dados, que chegam por `useEffect` — sem variante errada na hidratação.
- **Testes novos:** `isolate` padrão do Vitest mantém o `vi.mock` de `node:fs/promises` preso ao próprio arquivo; datas são literais com fuso explícito; limpeza de banco por teste.
- **`prisma.config.ts`:** o CI define `DATABASE_URL` no job que roda Prisma; nenhum script roda Prisma sem ele.
- **Documentos:** 22 modelos, 14 migrações, 31 caminhos e 39 operações conferidos contra o código; `PATCH /api/afastamentos/:id` existe; `§ H.4` itens 15 a 18 são perguntas com opções, não respostas inventadas.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass — local e CI (run 34563530382) |
| Lint | Skipped — o projeto não tem script de lint |
| Tests | Pass — 620/620 em 56 arquivos, local e CI |
| Build | Pass — local e CI |
| Dependency audit | Pass — CI, depois de `sharp` 0.35.4 (`b378129`) |
| Telas vistas rodando | Não — toda tela exige login; a lista do que olhar está no corpo do PR |

## Files Reviewed

55 arquivos do incremento (`git diff --name-status origin/maturacao/fechamento-de-etapa...origin/maturacao/achados-em-aberto`). Cada lote foi revisado por agente no momento em que entrou (achados daquelas revisões já corrigidos e provados por sabotagem); esta revisão acrescenta o olhar de conjunto.

## Encaminhamento

Todos os achados acima — inclusive os herdados do #35 — serão corrigidos em commits neste PR.

---

🤖 Revisão gerada com [Claude Code](https://claude.com/claude-code): revisão de conjunto por agente, com cada achado conferido no código antes de entrar aqui. Outras leituras são bem-vindas.
