# PR Review: #35 — Fechamento e maturação: auditoria do projeto inteiro, 14 correções e o assistente de ajuda

**Reviewed**: 11/09/2026
**Author**: fernando123-hue
**Branch**: `maturacao/fechamento-de-etapa` → `main`
**Decision**: REQUEST CHANGES *(o GitHub só permite comentário: o autor é a mesma conta)*

## Summary

PR grande (35 commits, 104 arquivos, +9.271/−637) e, no que foi lido, sólido: as correções de segurança, sessão, domínio e dados que ele afirma estão no código, e o assistente cumpre o invariante 13. Mas a correção da distribuição retroativa ficou pela metade — propaga o crédito global e não o por categoria, que é o critério primário do desempate —, e o CI verde é de antes de um alerta de segurança no `sharp`.

Revisão feita em quatro áreas, cada uma lida por um agente revisor no worktree da cabeça do PR (`a582080`), com cada achado relevante conferido por mim no código antes de entrar aqui: segurança e sessão; domínio e dados; assistente e fornecedores de IA; telas e componentes. Achados que já constam de `docs/auditoria/2026-09-08-achados-em-aberto.md` não são repetidos como novos.

## Findings

### CRITICAL
Nenhum.

### HIGH

**H1 — A distribuição retroativa propaga só metade do crédito.** `src/servicos/distribuicao.ts:608-639` (`atualizarSaldos`) × `:799-803` (`carregarElegiveis`).
A correção deste PR para "distribuição retroativa apagando crédito" faz `saldoCargaGlobal.updateMany` com `data > entrada.data` (`:685-694`). O crédito por categoria (`SaldoCarga.creditoAcumulado`) tem exatamente a mesma forma de total corrido — é lido como a linha mais recente com `data <= data` — mas é gravado absoluto e **não é propagado**. Cenário: DOC_CADASTRO do dia 2 confirmado antes do dia 1 (sexta esquecida, feriado processado depois — o próprio comentário do código chama isso de operação legítima). A linha do dia 2 continua sem o efeito do dia 1, e todo desempate dali em diante ignora a rodada retroativa no **critério primário** (`Elegivel.creditoCategoria`). Nada acusa: `distribuicao-retroativa.test.ts` só confere `saldoCargaGlobal`.
**Correção:** propagar para `SaldoCarga` (mesmo colaborador e categoria, `data > entrada.data`) o delta `creditoCategoriaDepois − creditoCategoriaAntes`, e estender o teste retroativo para ler `SaldoCarga`.

### MEDIUM

**M1 — O CI verde é anterior a um alerta alto no `sharp`.** `package-lock.json` — `sharp@0.35.3` (dependência do `next`), GHSA-rgj7-g3m4-5g8c (libheif). Os três checks passaram em 08/09; a auditoria de dependências **cai** se o CI rodar hoje (confirmado pelo `npm audit` local e pela falha do #36, que tinha o mesmo lockfile). **Correção:** `npm audit fix` sem `--force` (feito no #36, `b378129`: só os pacotes do `sharp` mudam).

**M2 — Resposta velha sobrescreve a nova ao trocar filtro, data ou período.** `src/app/caixa/page.tsx:105-126` (`carregar`), e o mesmo padrão em `src/app/distribuicao/page.tsx` (`carregarEscala`) e `src/app/painel/page.tsx` (efeito do período). Nenhum desses efeitos cancela a requisição anterior nem ignora resposta obsoleta. Cenário: na Caixa, clicar na pastilha da categoria A e logo na B; se a resposta de A chegar depois, a lista mostra itens de A com o filtro marcado em B. No Painel, quem ajusta as duas pontas do período pode ler números de um período que não é o selecionado. Exige cliques rápidos e respostas fora de ordem — raro com servidor local, e é por isso que fica em MÉDIO e não em ALTO. **Correção:** `AbortController` abortado no cleanup do efeito (ou flag local de cancelamento) antes de cada `set`.

### LOW

**L1 — Trava do último gestor fora da transação** *(anterior a este PR, adjacente)*. `src/servicos/autenticacao.ts:383-393` conta os outros gestores fora da transação e desativa dentro dela (`:411`). Dois gestores desativando um ao outro ao mesmo tempo passam os dois, e a associação fica sem gestor. A trava já existia na `main`; este PR abriu a transação logo abaixo e deixou a contagem de fora. **Correção:** mover a contagem para dentro do `$transaction`.

**L2 — Caminho absoluto do disco na mensagem pública** *(latente)*. `src/ports/armazenamento.ts:33-35` + `src/core/erros.ts:73`: `FalhaDeArmazenamento` usa a `mensagemPublica` padrão (= `message`), que embute o `erro.message` do `fs` com o caminho absoluto. Hoje não chega ao cliente — a ingestão captura no laço e `mensagemPersistivel` grava só o nome da classe —, mas passa a chegar no dia em que existir rota de download de anexo (`DECISOES.md § H.4` item 15). **Correção:** sobrescrever `mensagemPublica`, como `AssistenteIndisponivelError` já faz.

**L3 — Arquivo gerado na variante de desenvolvimento.** `next-env.d.ts` foi commitado apontando para `.next/dev/types`; a `main` tinha a variante de build. Cada `dev`/`build` reescreve o arquivo e suja a árvore.

### Confirmado no código (afirmações do PR)

- **Segurança e sessão:** piso de tempo contra enumeração de contas; "sair" revoga (`sessoesInvalidasAntes` × `emitidoEm`); `SESSAO_SECRET` obrigatório e validado cedo; transferência para pessoa desativada recusada; CSP com nonce por requisição, sem `unsafe-inline` em `script-src`; `db:limpar` com opt-in explícito; `ARMAZENAMENTO_DIR` vazio recusado; expurgo de dado de saúde que preserva o histórico operacional.
- **Domínio e dados:** liga não se parte na gravação (`atribuicaoDeGrupos`); desdobramento herda a liga; anexo órfão desfeito; desempate por grupo com dado projetado; mock sem a liga "Prezados"; alarme de conservação por item distinto; `devolvido` entre os abertos; `transferir` recusa item concluído; encerrar afastamento; AES-256-GCM com IV aleatório e tag verificada, no mesmo formato no script de migração; índice de `Execucao` usado pelo painel; desativar colaborador devolve os itens abertos na mesma transação.
- **Assistente e IA:** retorno sem campo de ação; manual filtrado por papel em código antes do prompt; nada de e-mail, dado pessoal ou nota do setor no material; pergunta pelas três camadas; tela sugerida reconferida contra o papel; pergunta e resposta não persistidas; mock sem rede; política de interpretação compartilhada entre fornecedores; fronteira de fornecedor respeitada; vazamento na segunda tentativa corrigido e testado; timeout nos dois adapters; limite de 12 perguntas por minuto.
- **Configuração:** `CLAUDE.md` sem o bloco que o `npm run dev` escreve sozinho (só o invariante 13 novo e a renumeração); CSP movida de `next.config.ts` para `middleware.ts`.

### Já registrados e ainda abertos neste PR

`#9`, `#12`, `#14`, `#18`, `#20`, `#33`, `#34` (e os demais de `docs/auditoria/2026-09-08-achados-em-aberto.md`) — **todos tratados no #36**.

### Telas e componentes — achados baixos

**L4 — "Tentar de novo" só existe antes do primeiro carregamento do Painel.** `src/app/painel/page.tsx` — com dados já na tela, uma falha seguinte mostra só a faixa de erro, sem botão; para tentar de novo é preciso mudar o período. A promessa "mantém os campos de período com botão de nova tentativa" vale só para a primeira carga. **Correção:** o mesmo `Botao` de `setTentativa` também quando `dados !== null && erro !== null`.

**L5 — `prefers-reduced-motion` é lido uma vez.** `src/componentes/marca.tsx` — verificado só na montagem; ligar "reduzir movimento" com a aba aberta (o uso de expediente inteiro que o próprio comentário descreve) não desliga a física até recarregar. **Correção:** ouvir `change` no `MediaQueryList` e parar o laço.

**L6 — O painel de ajuda se anuncia como diálogo sem se comportar como um.** `src/componentes/assistente.tsx` — `role="dialog"` sem `aria-modal` e sem retenção de foco; move o foco ao abrir, devolve ao fechar e fecha com Escape, mas Tab sai do "diálogo" para a página. **Correção:** se o painel é deliberadamente não modal (o comentário do arquivo sugere que sim), `role="region"` com `aria-label`; se é diálogo, `aria-modal` e foco retido.

*(Registro, não defeito deste PR: o projeto não tem ESLint nem `eslint-plugin-react-hooks`/`jsx-a11y`; regra de hooks e acessibilidade dependem só de revisão manual.)*

**Confirmado no código (telas):** a Fila ganhou devolver e transferir com justificativa; 401 leva a `/entrar` com guarda contra laço; o contador de requisições em voo usa `try/finally` e não vaza; Caixa, Fila, Distribuição e Acesso não ficam mais em "Carregando…" eterno; `--color-tinta-fraca` escurecido no tema claro; nova senha provisória, cancelar afastamento e descartar item em revisão viraram dois passos; "sair" mostra a falha em vez de fingir; a marca anima só por `transform` fora do ciclo do React, para quando assenta, e `core/marca/` não importa React nem DOM.

Achados de interface já registrados e ainda abertos neste PR — `#3`, `#5`, `#24`, `#25`, `#30`, `#31` — foram tratados no #36.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass — CI de 08/09/2026 (run 34225220727); também passa na cabeça do #36, que contém este PR |
| Lint | Skipped — o projeto não tem script de lint |
| Tests | Pass — CI de 08/09/2026; a cabeça do #36 (superconjunto) passa 620/620 hoje |
| Build | Pass — CI de 08/09/2026; `npm run build` passa na cabeça do #36 hoje |
| Dependency audit | **Fail se rodar hoje** — `sharp@0.35.3` (M1) |
| Telas vistas rodando | Não — toda tela exige login |

## Files Reviewed

104 arquivos (`git diff --name-status origin/main...origin/maturacao/fechamento-de-etapa`). Código de produção lido por área; testes novos lidos junto com o código que guardam; documentação conferida de forma leve (`CLAUDE.md`, configuração).

## Encaminhamento

As correções destes achados entram no **#36**, que contém este PR inteiro — mesclar o #36 leva as duas coisas juntas. Este PR, sozinho, continua com H1 e M1.

---

🤖 Revisão gerada com [Claude Code](https://claude.com/claude-code): quatro agentes revisores por área, com cada achado relevante conferido no código antes de entrar aqui. Outras leituras são bem-vindas.
