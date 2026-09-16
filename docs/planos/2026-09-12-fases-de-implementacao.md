# Implementação das decisões A17–A38 — plano em 5 fases

*Escrito em 12/09/2026, no fim da rodada de dúvidas com o dono, para a sessão que vai implementar.*

As decisões estão em `docs/DECISOES.md § A`, de **A17 a A38**. Este arquivo não as repete: diz **em que ordem** viram código, **o que cada fase entrega** e **o que ainda precisa ser confirmado com o dono** durante a implementação.

---

## Antes de escrever a primeira linha

1. **Leia** `CLAUDE.md`, `docs/ESTADO.md`, este plano, `docs/DECISOES.md § A17–A38` e `§ AT-17`.
2. **#40 e #41 foram mesclados na `main` em 12/09/2026** (`44fa73d` e `276aac1`). A versão original deste item dizia que estavam abertos.
3. **Andamento, conferido em 15/09/2026:** **fase 1 inteira feita e mesclada na `main`** (`A17`, `A20`, `A23`), pelo PR #44, por squash, commit `2c4acdb`, com o CI verde. O plano do `A23` (`docs/planos/2026-09-12-fase-1-a23.md`) registra o que foi feito em cada parte e os desvios. As outras fases não começaram.

## Como cada fase é feita

- Branch própria a partir da `main` atualizada (`fase-1/privacidade-e-prazos`, e assim por diante). PR por fase; o dono mescla.
- **Teste visto falhando contra o defeito ou contra a sabotagem da trava**, e a sabotagem desfeita (`memória: teste-verde-nao-prova-nada`).
- `npm run verificar` inteiro e `npm run build`, em sequência, nunca junto com o servidor de desenvolvimento aberto (os dois usam `.next`).
- Revisão por agente **só de leitura** antes do commit — de segurança nas fases 1, 2 e 3.
- **Telas conferidas rodando:** `preview_start {name: "sbp-local"}` → `/entrar` → clicar numa conta `@exemplo.test`. Nunca digitar senha. Screenshot pode estourar tempo com a janela atrás de outra; `find`/`get_page_text` confirmam.
- Detalhe de desenho que o dono não decidiu vira hipótese em `DECISOES.md § C` **e pergunta a ele**, com exemplo concreto do começo ao fim — explicação abstrata não funcionou nesta rodada.
- Exemplos com **nomes fictícios**: os documentos de origem têm nomes reais da equipe.

---

## Fase 1 — Privacidade e prazos

**Por que primeiro:** precisa existir **antes de qualquer dado real** entrar.

**Decisões:** `A17`, `A20`, `A23`.

| Entrega | Decisão | Onde mexe (ponto de partida, conferir) |
|---|---|---|
| Prazos de retenção editáveis pelo gestor, com trilha (quem, de quanto para quanto) e confirmação antes de encurtar | A17, A20 | modelo novo de configuração; tela em `/acesso` |
| Rotina que roda sozinha uma vez por dia | A17, A20 | hoje não há agendador — decidir o gatilho e registrar em `§ C` |
| Afastamento: 7 dias depois da volta, observação apagada e tipo reduzido a `férias` ou `ausente` | A17 | `servicos/expurgo-lgpd.ts` (hoje 90 dias, só observação), `core/afastamento-visivel.ts`, enum de tipo |
| Aviso à gestora ao entrar: quem está fora hoje e por quê, quem volta, que motivos expiram — **montado no servidor, sem IA** | A17 | painel do assistente; filtrado por papel no servidor |
| Conteúdo do e-mail e bytes do anexo excluídos 7 dias depois da conclusão do último item; aviso com data e hora de chegada apontando para o Outlook | A20 | `Email.conteudoExpurgadoEm`, `Anexo.bytesExpurgadosEm` já existem |
| Relógio: sem item conta da chegada; cancelado conta do cancelamento; item aberto não corre | A20 | — |
| Campos extraídos, título e valores da revisão saem no mesmo relógio; título neutro (categoria · liga · posição) | A23 | `Item.titulo`, `Item.payload`, `Revisao.sugestaoIa/valorFinal` |
| Chave de busca sem data: matrícula, ou CPF protegido (código com segredo do servidor) | A23 | segredo novo — cuidado de rotação igual a `AT-13` |
| Acerto da IA **gravado na revisão**, por campo, antes de os valores saírem | A23(c) | `servicos/qualidade.ts` hoje compara valores sob demanda |
| Trilha sem título nem valor pessoal — só quem, o quê, quando e **quais** campos mudaram | A23(d) | `servicos/revisao.ts` (linhas com `depois: { titulo … }`), `itens.ts`, demais `auditar` |

**Riscos:** expurgo é `UPDATE`/remoção sem volta — teste com sabotagem de cada limite de data; invariante 11 (histórico operacional nunca sai); conservação intacta.

**Confirmar com o dono durante:** a matrícula costuma vir no e-mail?; texto do aviso de conteúdo removido; nome e guarda do segredo do CPF protegido.

## Fase 2 — Quem vê o quê

**Decisões:** `A24`, `A32` (papel `dono`).

- `GET /api/itens`: colaborador vê só os próprios itens (a "ajuda" chega na fase 3).
- `GET /api/painel`: colaborador vê só os próprios números; operador e gestor, os de todos.
- Conferir **toda** rota que um colaborador alcança, não só estas duas (`src/app/api/autorizacao-de-rotas.test.ts`).
- Papel `dono`: `PapelSchema`, `core/telas.ts`, operações de leitura; **não opera** (não distribui, não revisa, não mexe em acesso).

## Fase 3 — O dia a dia do item

**Decisões:** `A27`, `A35`, `A18`, `A29`.

- **Carga que acompanha o trabalho** (transferência A18, cancelamento A27, devolução A35): **um desenho só**, por lançamento de compensação no razão, sem reescrever o registro original (`H-D10`). É o maior risco técnico da etapa: crédito por categoria e global, propagação aos dias seguintes (`atualizarSaldos` já propaga), conservação.
- Cancelar: colaborador pede, operador ou gestor confirma; motivo obrigatório.
- Transferir para quem está fora: aviso chamativo e confirmar travado ~5 s, com contagem visível.
- Pedir ajuda sem passar o item (modelo novo). **Confirmar com o dono:** quantos ajudantes, quem encerra a ajuda, se ajuda conta na carga.
- Baixar anexo: responsável, quem ajuda, operador e gestor; download na trilha; anexo recusado nunca servido.
- Afastamento registrado com itens abertos: aviso e oferta de devolver.
- Em andamento (`A29`): automático ao abrir item ou anexo; botão **Comecei**; **Pausar** com motivos prontos (almoço ou intervalo; fim do expediente; reunião; aguardando retorno do associado; aguardando outro setor; outro com texto) e retomar; um item em andamento por pessoa (abrir outro pausa o anterior); tempo ativo calculado sem reescrever o registro; pausa esquecida detectada de forma conservadora, sem perguntar; motivos pessoais aparecem à coordenação só como "pausa"; status `novo` sai.

## Fase 4 — Entrada mais inteligente

**Decisões:** `A28`, `A31`, `A34`.

- Reenvio do mesmo associado: mesmo CPF (protegido), nome parecido com CPF quase igual, mesmo remetente → Revisão com os dois lado a lado e três botões (substitui, complementa, separa); vai para quem tinha o original; original concluído vira item de correção. Regra no servidor, não decisão da IA.
- Ligas: sugestão de nome parecido; gestor junta; abertos e notas passam para a que fica.
- E-mail suspeito sem item: lista na Revisão (operador e gestor) — a `Revisao` hoje exige item, então é estrutura nova; relógio de `A20` só depois da decisão.

## Fase 5 — O ciclo de melhoria

**Decisões:** `A21`, `A30`, `A32`, `A36`.

- Feedback em toda tela, com contexto anexado sozinho, aviso quando parece falar de colega, repetidos agrupados, e a situação visível para quem escreveu.
- Escada de efeitos: ajustes do degrau 3 auditados e reversíveis.
- Relatório semanal dentro do sistema, sem IA externa e sem dado pessoal.
- Mistura de trabalho por pessoa: medida pelo sistema, só leitura para a coordenação.

---

## Fora destas fases, em aberto sem pressa

`§ H.4` itens 7 e 19 (agente), 20 (perceber dificuldade), 21 (feedback entre colegas); o uso C de `A37`; medição da IA com a bateria sintética (`A38`, liberada); divergências históricas de `§ E`; conferir rodando as telas mudadas em 10 e 11/09 (lista em `ESTADO.md`).
