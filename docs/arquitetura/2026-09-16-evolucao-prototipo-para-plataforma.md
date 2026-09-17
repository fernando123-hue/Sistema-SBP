# Evolução do protótipo para plataforma — roteiro do dono e confronto com o que existe

Em 16/09/2026, à noite, o dono entregou dois roteiros: o de **auditoria de segurança** (gravado em `docs/auditoria/roteiro-da-auditoria-de-seguranca.md`) e este, de **arquitetura evolutiva**. Este arquivo guarda o segundo em forma de lista e o confronta com o código e com a avaliação de 14/09/2026 (`2026-09-14-avaliacao-arquitetura-cognitiva.md`), que já tratou boa parte dele.

**Nada aqui é implementação.** É direção e pergunta. Hipótese não vira regra em silêncio.

## 1. O roteiro, em lista

- **Papel:** arquiteto principal, engenheiro de sistemas, arquiteto de IA, especialista em *harness*. Guardião de coerência + segurança + modularidade + observabilidade + evolução + simplicidade. Entre duas soluções equivalentes: menos acoplada, mais testável, mais segura, mais observável, mais fácil de trocar, menos operação.
- **"Micro hoje, plataforma amanhã."** Nem código descartável (lógica espalhada, acoplamento, regra na tela, banco acessado de qualquer lugar), nem excesso (microsserviços, camadas artificiais, infraestrutura de escala, tecnologia por moda).
- **Trajetória:** protótipo → sistema de um processo → vários processos → plataforma → camada inteligente de automação da organização (pessoas, e-mails, documentos, bancos, sistemas, APIs, workflows, regras, agentes, serviços, local e nuvem).
- **Ciclo:** receber → interpretar → validar → decidir → executar → registrar → verificar → aprender com os resultados → encaminhar exceções. Na dúvida: **parar → explicar → encaminhar** (outro agente ou humano). Nunca improvisar.
- **Harness:** o sistema limita a IA independentemente da vontade dela — contexto, ferramentas, permissões, schemas, limites, memória, estado, observabilidade, validações, critérios de sucesso e falha, escalonamento, aprovação humana.
- **Grafos:** processo de várias etapas vira grafo; cada nó com entrada, saída, pré e pós-condições, ferramentas, permissões, timeout, limite de custo, erro, retry, fallback. Nenhuma IA controla todas as etapas.
- **Várias IAs:** trocar modelo, servidor, runtime, quantização, hardware, fornecedor e endpoint sem tocar regra de negócio. `Provedor → Router → Tarefa`, nunca `Sistema → modelo`.
- **IA local:** prevista, modelo **não definido**; priorizada para tarefas adequadas (classificação, extração, normalização, triagem, resumo interno, campos). Local **não é automaticamente seguro** — auditar arquivos, memória, logs, ferramentas, rede, credenciais, containers.
- **Anthropic:** capacidade avançada e controlada, **não padrão indiscriminado**. Minimizar o que sai: processar local → reduzir → enviar só o necessário → validar → continuar local.
- **Router:** decide entre código, IA local, local mais capaz, Anthropic e humano por tipo de tarefa, complexidade, sensibilidade, consequência, ferramentas, confiança e custo — não por "qual é mais inteligente".
- **Escalonamento por critério objetivo**, não pela declaração do modelo: schema inválido, baixa confiança, conflito de fontes, regra desconhecida, contexto insuficiente, ferramenta indisponível, complexidade, volume, alto impacto, ação fora da permissão.
- **Menor privilégio para IA:** só as ferramentas, dados, contexto, permissões e tempo necessários. **Inteligência não é autoridade.** Nunca `execute_anything()`. Ferramentas declaradas por agente.
- **IA não é autoridade final:** interpretação ≠ autorização ≠ decisão crítica ≠ execução. Regra que pode ser código, é código.
- **Memória controlada:** separar operacional, temporária, conhecimento, dado do usuário, instrução do sistema, dado externo; quem lê, quem escreve, validade, origem, confiança, retenção, envenenamento, isolamento.
- **Observabilidade de IA:** agente, modelo, versão, tarefa, ferramentas, resultado, motivo de escalonamento, custo, latência, falhas, validações, versão do workflow — sem segredo nem dado sensível. Responder *"por que este resultado aconteceu?"*.
- **Custo é arquitetura:** limites, timeouts, retries, circuit breakers, quotas, orçamento, profundidade de grafo, execuções por tarefa.
- **Minimização de dados** antes de qualquer modelo externo: o que é necessário, remover o resto, pseudonimizar, restringir contexto, registrar a decisão sem o conteúdo.
- **Nuvem ≠ inseguro; local ≠ seguro.** Híbrido permitido; dados críticos podem ficar dentro.
- **MySQL é o banco.** Outro banco só com justificativa. `domínio → serviços → adapters → banco`.
- **Contratos e schemas** em IA ↔ sistema, API ↔ backend, backend ↔ MySQL, sistema ↔ externos.
- **Testes de evolução:** invariantes, contratos, autorização, idempotência, concorrência, workflows, escalonamento, fallback, modelo falhando, troca de modelo, externo fora do ar. Funcionar com IA local fora, API fora, saída inválida, ferramenta falhando, banco recusando, etapa falhando.
- **Tecnologia nova responde:** que problema, por que agora, custo de manutenção, impacto de segurança, alternativa mais simples, acoplamento, substituição futura.
- **Estágios:** AGORA (microescala: estabilidade, segurança, regra certa, observabilidade, modularidade, baixo custo, simplicidade) · PRÓXIMO (integrações, filas, automações, IA local, workflows — só com necessidade real) · FUTURO (vários processos, departamentos, agentes, grafos, distribuição, alta disponibilidade, governança).
- **Contra prematuridade:** cada decisão é **IMPLEMENTAR AGORA** (segurança, integridade, evolução imediata), **PREPARAR CONTRATO AGORA** ou **ADIAR**.
- **Entrega esperada:** estado atual, visão futura, dívida arquitetural, evolução (agora/próximo/futuro), IA (o que é código, local, avançado, humano; como o Router decide; ferramentas por agente), harness, grafo, e decisões no formato **problema → alternativas → decisão → justificativa → impacto futuro**.
- **Princípio final:** nenhum modelo é "o cérebro absoluto". Código + IA local + modelos avançados + workflows + grafos + ferramentas + supervisão humana. A IA diz, por critério verificável, *"está na minha capacidade"* ou *"deve ser encaminhada"*, e o sistema sabe para onde: **código → IA local → local mais capaz → externo → humano**.

## 2. Onde o SBP já está, com evidência

| Pedido do roteiro | No código hoje |
|---|---|
| `Provedor → Tarefa`, troca sem tocar negócio | `AiPort` + `criarAiPort()`; cada fornecedor é `ia-<nome>.ts` com `PerfilDoFornecedor`; política comum em `ia-estruturada.ts` (invariante 2, `A15`). O Gemini entrou tocando só `adapters/`. |
| IA interpreta, código decide | Saída passa por Zod (`InterpretacaoSchema`); divisão, escolha de pessoa e resto são de `core/distribuicao` (invariante 2). |
| Conteúdo externo é dado | Três camadas: truncar → detectar → delimitar (invariante 6). |
| Parar → explicar → encaminhar | Falha, suspeita ou schema inválido vão para a **Revisão** humana (invariante 7). Visto hoje: sete `503` do Google, sete e-mails que iriam para a revisão, nada inventado. |
| Inteligência não é autoridade | O assistente devolve texto e, no máximo, nome de tela; **não tem campo de ação** (invariante 13). |
| Memória controlada | Trilha append-only, lida por humano, **nunca devolvida ao modelo** (invariante 12); conteúdo com retenção, histórico sem (invariante 11); domínio em toda linha (invariante 14). |
| MySQL e camadas | `app → servicos → core`; `core/` não importa Prisma (invariante 1); MySQL desde `A42`. |
| Integridade | Conservação verificada na transação (invariante 3). |

## 3. Onde o roteiro pede mais do que existe (dívida e lacuna)

Os itens 1 a 3 já estavam no "implementar agora" de 14/09 e **não foram feitos** — conferido por busca no código em 16/09.

1. **Custo e disjuntor.** Não há registro de uso por chamada, teto diário, nem corte depois de falhas seguidas. **Evidência de hoje:** com o Google fora, o sistema tentou e-mail por e-mail. Em volume, uma queda vira centenas de chamadas inúteis — o roteiro chama isso de falha de engenharia. **IMPLEMENTAR AGORA**, antes da chave paga (`A49`).
2. **Avaliação com gabarito.** A rotina de 16/09 (`A50`) roda os quatro casos, mas a nota é lida por um agente, não calculada contra resposta esperada. Sem gabarito não existe "critério objetivo" para o Router nem para o escalonamento. **IMPLEMENTAR AGORA** (pequeno: casos sintéticos + resposta esperada + nota).
3. **Observabilidade de IA** incompleta: modelo, prompt e latência aparecem no experimento; custo, tokens e motivo de escalonamento não são guardados. Entra junto com o item 1.
4. **Tarefa e classe do dado não existem como conceito.** Hoje há uma tarefa de IA (interpretar e-mail) e um assistente. Para um Router futuro, cada chamada precisa dizer *qual tarefa* e *qual classe de dado* leva. **PREPARAR CONTRATO AGORA** — um campo, sem roteador.
5. **Minimização antes do externo.** Hoje o corpo do e-mail vai inteiro (truncado) ao modelo, CPF incluído. Alternativa concreta: achar o CPF por código (é padrão fixo, com dígito verificador), trocar por marcador antes de enviar, e recolocar depois. **Decisão do dono** — muda o que sai da associação e pode mudar o acerto; medir com o gabarito antes.
6. **Menor privilégio no banco** (vem do roteiro de segurança): a aplicação conecta como `root`. Para a empresa: usuário próprio, sem `UPDATE`/`DELETE` nas tabelas de trilha. **IMPLEMENTAR** junto com a implantação (`A46`).

## 4. Pontos do roteiro que colidem com regra já decidida

Não são erros do roteiro; são leituras que precisam ser fixadas antes de alguém implementar ao pé da letra.

- **"Aprender com os resultados."** Os invariantes 9 e 12 proíbem treinar com dado real e devolver memória ao modelo sem decisão do dono. Leitura compatível: **aprender = medir e propor mudança de regra, com aprovação humana** (escada de `A30`). Se a intenção for outra, é decisão nova.
- **Exemplo "Agente Operacional: `create_assignment`".** Pelo invariante 2, **nenhuma IA escolhe quem recebe**. Leitura compatível: um agente poderia, no futuro, *pedir* que o motor determinístico rode — nunca indicar a pessoa. Ferramenta que grava atribuição escolhida por modelo não entra.
- **"Baixa confiança" como critério de escalonamento.** A avaliação de 14/09 recusou escalar pela confiança **declarada** pelo modelo (ela não é calibrada). O próprio roteiro pede critério que "não dependa só da declaração do modelo". Leitura compatível: confiança só vale depois de **calibrada contra o gabarito**; até lá, escalar só por sinal determinístico.
- **"Modelos locais devem ser priorizados."** Em 14/09 a conclusão foi: no volume atual, **custo não justifica** o local; **privacidade pode justificar**. E `A49` escolheu a Anthropic para o protótipo. Não é conflito se "priorizar" vale **quando houver máquina e o modelo local passar no gabarito** — hoje não há máquina (`A46`). Pergunta abaixo.

## 5. Agora, próximo, futuro

| Estágio | O quê | Classe |
|---|---|---|
| **Agora** | Registro de uso por chamada, teto diário, disjuntor por falhas seguidas, timeout conferido em toda chamada externa | IMPLEMENTAR |
| **Agora** | Gabarito dos casos sintéticos com nota automática; a rotina `A50` passa a usá-lo | IMPLEMENTAR |
| **Agora** | Campo "tarefa" e "classe do dado" em cada chamada de IA | PREPARAR CONTRATO |
| **Agora** | Achados da auditoria de segurança (`A49`) | IMPLEMENTAR |
| **Próximo** | Usuário MySQL de menor privilégio; gestor de segredos; implantação | com `A46` |
| **Próximo** | Pseudonimizar CPF antes do externo, medido pelo gabarito | decisão do dono |
| **Próximo** | Modelo local como mais um `ia-<nome>.ts`, **só em experimento**, se houver máquina | ADIAR até máquina |
| **Futuro** | Router com dois ou mais modelos aprovados no gabarito; grafos; agentes com ferramentas declaradas; vários processos | ADIAR |

**Não fazer agora**, em linha com 14/09: framework de agentes ou de grafos, roteador dinâmico, IA local em produção, memória no prompt, filas, barramento, busca vetorial.

## 6. Grafo do processo que existe hoje

```text
E-MAIL (Outlook, só leitura)
  ↓
CONTEÚDO NÃO CONFIÁVEL — truncar → detectar → delimitar
  ↓
INTERPRETAÇÃO — IA (fornecedor por IA_ADAPTER)
  ├── falha, schema inválido, suspeita → REVISÃO HUMANA
  ↓
VALIDAÇÃO — Zod + regras
  ↓
DISTRIBUIÇÃO — código determinístico (core/distribuicao)
  ↓
TRANSAÇÃO — conservação verificada, trilha gravada junto
  ↓
FILA DE CADA PESSOA → conclusão / transferência / devolução
```

O Router do roteiro entraria **só** no nó INTERPRETAÇÃO. Nenhum outro nó usa IA, e nenhum deveria passar a usar para decidir.

## 7. Perguntas ao dono — respondidas em 16/09/2026 (`DECISOES.md § A51` a `A54`)

1. **IA local:** "priorizar local" vale a partir de quando? Recomendação: só quando houver máquina e o modelo local passar no mesmo gabarito; até lá, Anthropic no protótipo (`A49`).
2. **CPF antes do envio externo:** trocar o CPF por um marcador antes de mandar o e-mail ao modelo? Recomendação: sim, **depois** de medir no gabarito que o acerto não cai.
3. **"Aprender com os resultados"** significa medir e propor regra com aprovação (compatível com os invariantes 9 e 12), ou algo além?
4. **Ordem do trabalho:** primeiro a auditoria de segurança e as correções, depois custo/disjuntor e gabarito? Recomendação: custo e disjuntor entram **na** rodada de segurança (consumo sem limite é item do roteiro de segurança, seção 4), e o gabarito logo depois.
