# Processo de desenvolvimento e verificação

Pedido do dono em 16/09/2026: auditar o processo real de verificação de código, compará-lo com o fluxo abaixo e adaptá-lo **na proporção do protótipo**. Decisão registrada em `DECISOES.md § A55`.

```text
ESPECIFICAÇÃO → IMPLEMENTAÇÃO → VERIFICAÇÃO COMPORTAMENTAL → VERIFICAÇÃO TÉCNICA
→ VERIFICAÇÃO DE SEGURANÇA → TESTES DETERMINÍSTICOS → REGRESSÃO → ACEITAÇÃO

Problema em qualquer etapa:
PROBLEMA → CAUSA → CORREÇÃO → NOVA VERIFICAÇÃO → TESTES → REGRESSÃO
```

**Nenhum agente é o único juiz do próprio trabalho. Compilar não é estar correto. Aprovar exige evidência.**

## 1. Como era até 16/09/2026 — as 12 perguntas

Respostas conferidas no repositório, no CI e no histórico de PRs em 16/09/2026.

| # | Pergunta | Resposta, com evidência |
|---|---|---|
| 1 | Quem escreve o código? | Um agente de IA (Claude Code), na conversa com o dono. O dono não escreve código nem o lê linha a linha. |
| 2 | Quem verifica se o comportamento corresponde ao requisito? | **O mesmo agente que escreveu**, por testes que ele escreve antes (teste visto vermelho) e pela tela vista rodando. Existe prova matemática para o motor: `src/core/distribuicao/simulacao.test.ts` confere a conservação em milhares de sorteios. **Não há verificador comportamental independente.** |
| 3 | Quem verifica qualidade técnica? | O compilador (`tsc`, no CI) e um **agente revisor** (outra instância, mesmo modelo), com a revisão publicada no PR — os PRs #50 a #54 têm esse comentário; o #49 não tem. **Não há lint.** |
| 4 | Quem verifica segurança? | No CI: `gitleaks` e `npm audit --audit-level=high`, a cada push e PR; Dependabot. CodeQL está escrito, mas desarmado (o plano do GitHub não aceita o envio). Agente de segurança: em revisões pontuais (15/09, fase 1), **não em todo PR que toca área sensível**. |
| 5 | O que é automático? | Typecheck; 877 testes contra MySQL real; sincronia entre schema e migrações; build de produção; `gitleaks`; `npm audit`; Dependabot. Testes de fronteira de arquitetura: `src/core/pureza.test.ts` (o núcleo não importa Prisma/React/Next) e `src/adapters/fronteira-do-fornecedor.test.ts`. |
| 6 | O que depende de agente de IA? | Revisão de código, revisão de segurança, comparação com o requisito, conferência de documentos contra o código, verificação na tela. |
| 7 | Existem testes determinísticos? | Sim: 82 arquivos, incluindo propriedade (simulação), concorrência (`conservacao-na-escrita.test.ts`, `autenticacao.test.ts`, `contagem-de-buscas.test.ts`) e contratos Zod. Cobertura: 95,6% das linhas. |
| 8 | Existe verificação de regressão? | Sim: a suíte inteira roda em todo push e PR. **Mas nada impede mesclar com o CI vermelho**: proteção de branch exige plano pago em repositório privado. Quem lê os checks é o agente, um a um. |
| 9 | Algo impede o autor de ser o único a aprovar? | **Parcialmente, e fraco.** O revisor é outra instância de agente, e o classificador de permissões desta máquina recusa mesclar sem revisão publicada. Mas o mesmo agente escreve, abre o PR, publica a revisão que pediu e mescla; o `CODEOWNERS` não vale sem proteção de branch; e todos agem com a mesma conta do GitHub. |
| 10 | Falhou, corrige e verifica de novo? | Sim, por prática registrada (`ESTADO.md`, "Como o dono prefere trabalhar"). **Não por trava.** |
| 11 | A profundidade muda com o risco? | **Não, de forma declarada.** O modelo de PR tinha caixas por tipo de impacto, mas nenhuma regra dizia que verificação cada tipo exige. Cada PR recebia a profundidade que o agente achava certa. |
| 12 | Há Harness/Router controlando o processo? | **Não.** Existe `criarAiPort()` escolhendo o fornecedor de IA **do produto**; para o processo de desenvolvimento não havia nada. |

## 2. Diferenças para o fluxo pedido

| Etapa | Situação em 16/09 | Depois desta adaptação |
|---|---|---|
| Especificação | PARCIAL — decisões e regras existem (`DECISOES.md`, `RN-xx`), mas o PR não era obrigado a citá-las | Seção obrigatória no PR, conferida pelo CI |
| Implementação por agente, sem autoaprovação | PARCIAL — ver pergunta 9 | Revisão obrigatória por agente **diferente**, com **link** do comentário publicado, conferido pelo CI a partir do nível 2 |
| Verificação comportamental | PARCIAL — forte no motor, ausente como etapa declarada | Seção obrigatória a partir do nível 2: propriedade, conta, casos extremos |
| Verificação técnica | PARCIAL — `tsc` + revisor, sem lint | Revisão técnica obrigatória a partir do nível 2. **Lint: adiado** (seção 5) |
| Verificação de segurança | PARCIAL — scanners em todo PR; agente só às vezes | Agente de segurança **obrigatório** no nível 3, com link |
| Testes determinísticos | IMPLEMENTADO | Mantido; teste visto vermelho vira evidência declarada a partir do nível 2 |
| Regressão | IMPLEMENTADO, sem trava de merge | Declarada a partir do nível 1; a trava de merge continua dependendo do plano do GitHub |
| Profundidade por risco | NÃO IMPLEMENTADO | **Implementado**: `scripts/processo/nivel-de-risco.ts` classifica pelos arquivos alterados |
| Aceitação | PARCIAL — o agente mesclava depois de ler os checks | Aceitação = CI verde **incluindo o job "Processo"** + revisões linkadas; o dono pode vetar a qualquer momento |

## 3. Riscos que as diferenças deixavam abertos

- **Autoaprovação:** o mesmo raciocínio que errou o código aprova o código. Um defeito de desenho passa pelo autor e, se a revisão for pedida com a pergunta errada, pelo revisor também.
- **Profundidade decidida por quem escreveu:** uma mudança em `src/app/api` podia sair com a mesma verificação de um texto de tela. Não há registro de que isso tenha acontecido; também não havia nada que impedisse.
- **Revisão afirmada, não publicada:** "revisado, ok" sem o texto da revisão não pode ser conferido por ninguém depois.
- **Merge com CI vermelho:** depende só da atenção de quem mescla.

## 4. O fluxo que vale a partir de agora

### Nível de risco — decidido pelos arquivos, não pelo autor

`scripts/processo/nivel-de-risco.ts` — **vale o arquivo mais sensível**; caminho que ninguém classificou cai no nível 3.

| Nível | O que muda | Exemplos |
|---|---|---|
| **0 — documentação** | texto | `docs/`, `*.md` (menos `CLAUDE.md`) |
| **1 — tela** | páginas e componentes | `src/app/` (menos `api/`), `src/components/` |
| **2 — regra de negócio** | núcleo e serviços | `src/core/`, `src/servicos/` |
| **3 — sensível** | autenticação, autorização, banco, arquivos, e-mail, IA, integrações, CI, dependências, configuração, as regras dos agentes, o próprio portão | `src/app/api/`, `src/servidor/`, `src/adapters/`, `src/ports/`, `src/core/seguranca/`, `src/core/assistente/`, `src/core/esquemas.ts`, `src/middleware.ts`, `prisma/`, `scripts/`, `.github/`, `.claude/`, `package*.json`, `*.config.*`, `tsconfig.json`, `.env.example`, `.gitignore`, `CLAUDE.md` |

### Evidência exigida no PR, por nível

| Evidência (seção do PR) | 0 | 1 | 2 | 3 | Quem produz |
|---|---|---|---|---|---|
| Especificação | ✔ | ✔ | ✔ | ✔ | autor |
| Visto rodando | | ✔ | ✔ | ✔ | autor (`sbp-local`); "não se aplica" com motivo quando não há tela |
| Verificação comportamental | | | ✔ | ✔ | autor, **por teste**: propriedade, conta, casos extremos, determinismo, erro |
| Teste visto vermelho | | | ✔ | ✔ | autor: a correção revertida, o teste falhando |
| Revisão técnica — **link** | | | ✔ | ✔ | agente revisor **diferente do autor** (`code-reviewer`, `typescript-reviewer`, `database-reviewer`, `silent-failure-hunter`, conforme o que mudou) |
| Revisão de segurança — **link** | | | | ✔ | `security-reviewer` |
| Regressão | | ✔ | ✔ | ✔ | `npm run verificar` + checks do CI lidos um a um |

O job **Processo** (`.github/workflows/processo.yml`) calcula o nível e **falha** se faltar evidência. Ele roda de novo quando o corpo do PR é editado, então o caminho normal é: abrir o PR → publicar as revisões → colar os links no corpo → o job fica verde.

### Ordem de trabalho

```text
1. Especificação   — de onde vem o pedido (decisão, regra, achado). Dúvida de negócio vira pergunta ao dono.
2. Teste primeiro  — escrito antes e VISTO VERMELHO contra o defeito ou a ausência do recurso.
3. Implementação   — o mínimo que faz o teste passar, dentro das fronteiras (invariantes 1, 2, 5).
4. Comportamental  — propriedade/conta/casos extremos por teste; tela vista rodando se houver tela.
5. Técnica         — agente revisor diferente do autor; revisão publicada no PR.
6. Segurança       — nível 3: agente de segurança; revisão publicada no PR.
7. Determinístico  — `npm run verificar`; o CI roda typecheck, testes, migrações, build, gitleaks, npm audit.
8. Regressão       — suíte inteira verde, nenhum pulado; checks lidos um a um.
9. Aceitação       — todos os checks verdes, inclusive "Processo"; então mesclar (autorização do dono
                     em `ESTADO.md`). Apagar dado, trocar segredo e decisão de negócio continuam pedindo o ok dele.

Achado em qualquer etapa → causa → correção → volta ao passo 2 para aquele achado → 7 → 8.
Achado crítico ou alto sem correção no PR → destino escrito (outro PR, pergunta ao dono) antes de mesclar.
```

**Prefira o determinístico:** o que um teste, o compilador, o Zod, uma constraint do MySQL ou um scanner consegue provar, não se pergunta a um agente.

## 5. Limites, ditos como são

- **O job confere que a evidência foi declarada e que cada revisão citada é um comentário que existe neste PR** (link amarrado ao repositório e ao número do PR, e conferido na API do GitHub). **Não confere que o texto é verdadeiro**, nem que o comentário foi escrito por outro agente: todos agem com a mesma conta do GitHub, então o autor do comentário não distingue ninguém. É um portão contra esquecimento e atalho, não contra má-fé. Quem garante o resto é o dono poder abrir qualquer link.
- **Os revisores são o mesmo modelo que o autor**, em outra instância e com outra instrução. Isso pega muita coisa e deixa passar o ponto cego comum aos dois. A saída real é revisão humana antes de dado real de associado entrar — continua em aberto.
- **Sem proteção de branch** (plano do GitHub), um check vermelho não bloqueia o botão de mesclar. A trava é a disciplina de ler os checks, agora com um check a mais.
- **Lint adiado:** o `tsc` estrito já pega a maior parte do que um lint pegaria aqui; adicionar ESLint é dependência nova com configuração a manter. Reavaliar se a revisão técnica começar a repetir o mesmo tipo de achado.

## 6. Harness e Router do processo — o que existe e o que fica para depois

**Agora:** a tabela de níveis é o embrião do Router do processo — decide a profundidade por regra explícita e falha fechada no desconhecido. Está em `scripts/`, sem tocar `src/`.

**Depois (sem data):** o mesmo lugar decidir também qual agente revisa, com que modelo (IA local para revisão de nível 1, modelo mais capaz para nível 3 — `A51`), que ferramentas cada revisor pode usar (hoje todos são só leitura) e quando exigir o dono. Nada disso é construído antes de haver mais de um modelo em uso.
