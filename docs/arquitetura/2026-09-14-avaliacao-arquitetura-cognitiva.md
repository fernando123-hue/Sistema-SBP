# Avaliação da arquitetura cognitiva proposta para o SBP

*14/09/2026. Primeira análise, sem alteração de código. Responde ao documento "Prompt definitivo — arquitetura cognitiva do SBP", enviado pelo dono.*

**Base desta análise.** Li o código, e não só os documentos: `ports/`, `adapters/` (fábrica, fronteira do fornecedor, política comum de IA, Gemini, Anthropic, assistente), `core/` (motor, esquemas, qualidade da IA, teste de pureza), `servicos/` (ingestão, revisão, distribuição, memória), `servidor/` (ator, observabilidade, http), o `schema.prisma` inteiro, a SPEC, o PRD e as decisões `A1`–`A41`, `§ H.4` e as seções "Fundação do cérebro operacional" e "Memória operacional". Estado conferido hoje: a suíte inteira passa (838 testes em 78 arquivos, mais o typecheck), e o PR #44 está com o CI verde.

Cada afirmação sobre o código traz o arquivo. Onde algo **não** foi conferido, está escrito.

---

## 1. Resumo executivo

**A arquitetura faz sentido: como direção, é sólida. Como está desenhada, tem cinco problemas conceituais que precisam ser corrigidos antes de virar código.** Nenhum deles invalida a visão, mas cada um, se virasse código como está, criaria exatamente o risco que a própria visão quer evitar.

**O que está certo, e é o mais importante:** separar inteligência de autoridade; saída de IA ser proposta e não fato; verificar de forma determinística tudo o que for verificável; o feedback confrontar a decisão com o resultado; autonomia progressiva baseada em evidência; independência de fornecedor; custo como restrição de desenho. Todos esses princípios são tecnicamente corretos e correspondem ao que se considera boa prática em sistemas com modelos de linguagem em produção.

**A notícia boa, que precisa ficar clara para a empresa:** o SBP já implementa a maior parte desses princípios, na escala certa para um protótipo. `IA interpreta. Algoritmo decide. Banco lembra. Regra explícita governa.` é a versão pequena e já testada da visão inteira. Não é preciso reconstruir; é preciso nomear o que existe, fechar quatro ou cinco lacunas pequenas e **não** construir o resto antes da hora.

**Os cinco problemas conceituais:**

1. **"O Cérebro decide" contradiz "a realidade e as regras governam".** Na visão, o Cérebro percebe, decide, coordena e cria agentes. Se ele também controla o fluxo de execução, controla o próprio caminho até a validação. **Correção:** o fluxo de controle é código determinístico (o Harness); o modelo é chamado **dentro** dos passos, para as partes que exigem linguagem ou julgamento. O Cérebro **propõe**. Quem autoriza é política, quem calcula é algoritmo, e quem confirma é a realidade.

2. **No diagrama de referência (§ 38), a informação chega ao Cérebro sem passar pelo Harness.** O desenho faz `REALIDADE → STATE → CÉREBRO → HARNESS`. O ponto mais perigoso de um sistema com modelo é a **entrada**: é por ali que entram a injeção de prompt, o dado pessoal que não precisava ir e o contexto desatualizado. **Correção:** o Harness **envolve** o Cérebro dos dois lados. Monta o contexto mínimo na entrada e confere a proposta na saída. O SBP já faz isso: as três camadas contra injeção rodam **antes** de o modelo ver o e-mail (`adapters/ia-estruturada.ts`), e o material do assistente é filtrado por papel em código **antes** de o prompt existir (`core/assistente/conhecimento.ts`).

3. **"Grafo" está cobrindo duas coisas diferentes.** Um é o grafo de **relações do domínio** (liga → ligante → item → pessoa); o outro é o grafo de **execução** (passos, transições, chamadas). Misturar os dois produz o erro clássico: o sistema passa a "raciocinar" sobre o próprio fluxo de controle como se fosse dado. **Correção:** tratar os dois separadamente. As relações ficam no banco. A execução vira máquina de estados e fluxos versionados.

4. **O meta-grafo (a camada que evolui a própria inteligência) é a parte mais perigosa e a menos necessária agora.** Um sistema que altera os próprios agentes, rotas e laços em tempo de execução é um sistema que altera o próprio código sem revisão. **Correção:** a evolução continua sendo **mudança de configuração versionada, promovida por um processo com avaliação e aprovação humana**. O sistema pode **propor**, mas a promoção é sempre um ato humano sobre evidência. O dono já decidiu isso para as regras (`A30`, a escada de efeitos); vale igual para a inteligência.

5. **"Modelo local por padrão" é uma boa hipótese, não uma premissa.** No volume do SBP, o custo de API para interpretar e-mails é pequeno (estimativa na seção 12: dezenas a poucas centenas de reais por mês). O argumento forte para o modelo local é **privacidade** (o dado do associado não sai da associação), não custo. E um modelo local tem custo de máquina, de manutenção e, possivelmente, de qualidade. **Correção:** a regra de roteamento é "o modelo mais barato **que passou na avaliação desta tarefa**, dentro dos fornecedores **autorizados para esta classe de dado**". Sem conjunto de avaliação não existe roteamento, só palpite.

**E uma lacuna que destrava quase tudo o que a visão quer:** o SBP ainda não tem um **conjunto de avaliação com gabarito e nota automática**. Sem ele não dá para comparar modelos, promover um prompt, justificar um modelo local, calibrar a confiança nem dizer que a IA melhorou. Ele é o "sandbox" que importa neste momento, e é barato.

**O princípio da § 34 é sólido, e está incompleto.** A reescrita está na seção 18.

---

## 2. Onde o SBP já está alinhado

Isto é o que mostrar à empresa: a visão não é promessa, é extrapolação de algo que já funciona.

| Princípio da visão | Onde já existe no código |
|---|---|
| Modelo é intercambiável; o sistema não depende de fornecedor | `AiPort` (`ports/ia.ts`) fala só tipos do domínio. `ClienteDeModelo` e `PerfilDoFornecedor` (`adapters/fornecedor.ts`) isolam o fornecedor. Acrescentar o Gemini custou uma linha em `criarAiPort()` (`adapters/fabrica.ts`), com zero arquivos tocados em `servicos/`, `app/` ou `core/`. |
| A política vale para qualquer modelo (o embrião do Harness) | `InterpretadorEstruturado` (`adapters/ia-estruturada.ts`): trunca, detecta e delimita **antes** do modelo; repete **uma** vez e só se o erro for de formato; falha de transporte não repete; revalida a resposta com Zod mesmo quando o SDK diz que já validou; a mensagem do erro anterior volta ao prompt **resumida**, sem texto que o modelo escreveu. |
| Saída de IA não vira verdade | `InterpretacaoSchema` e `RespostaDoModeloSchema` em `core/esquemas.ts`. O modelo **não** declara a própria origem: `modelo` e `versaoPrompt` são preenchidos pelo sistema, justamente para a resposta não poder mentir sobre de onde veio. |
| IA propõe, algoritmo decide | `distribuir()` (`core/distribuicao/motor.ts`) é função pura, sem relógio nem aleatoriedade, e versionada (`ALGORITMO_VERSAO`). A prévia da tela e a gravação chamam **a mesma função**. |
| Invariante verificado, não prometido | `ConservacaoVioladaError`: `Σ atribuições == entrada` é conferido dentro da transação, e a transação aborta se não bater (`servicos/distribuicao.ts`). O comentário da linha 213 registra o dia em que essa trava estava sendo engolida. |
| Núcleo sem contaminação | `core/pureza.test.ts`: lista do que é **permitido** (só `zod`), não lista de proibidos. Um `import` do SDK de IA dentro de `core/` quebra a suíte. |
| Sinais determinísticos valem mais que confiança | `decidirRevisao()` (`servicos/ingestao.ts:613`): conteúdo suspeito, anexo recusado e desdobramento mandam para revisão **antes** de a confiança ser olhada. Desdobramento em N itens **sempre** passa por humano. |
| Humano no circuito, proporcional ao risco | Limiar de confiança **por categoria** (`A12`: documento 0,95; ficha 0,90; demais 0,85). Distribuição exige confirmação. Encurtar prazo de retenção exige confirmação **no servidor** (`A17`). |
| Checagem de evidência na saída do modelo | O assistente devolve os ids dos trechos do manual em que se baseou, e o servidor descarta citação de trecho que **não foi enviado** (`adapters/assistente-modelo.ts:102-115`). É grounding por referência, já implementado. |
| Contexto mínimo por necessidade | O material do assistente é filtrado por papel **em código, antes do prompt** (invariante 13). O modelo de interpretação recebe só o e-mail que está interpretando, sem memória, sem notas e sem histórico (invariante 12). |
| Inteligência sem capacidade de agir | O retorno do assistente **não tem campo de ação** (`core/assistente/esquemas.ts`); a ausência é o desenho. A IA de interpretação não tem ferramenta nenhuma. |
| Identidade não forjável; menor privilégio | `Ator` é um tipo marcado com fábricas explícitas (`servidor/ator.ts`); `exigirPapel` com vocabulário fechado de operações (`OperacaoSchema`). |
| Registro da decisão | `RodadaDistribuicao` **é** um objeto de decisão completo: entrada, elegíveis, ordem de desempate, critério, créditos antes e depois, versão do algoritmo, quem executou e `correlacaoId`. `Revisao` é o objeto de decisão da interpretação: sugestão da IA × valor final × desfecho. |
| Memória separada de estado e de conteúdo | `Email` × `EmailConteudo`; trilha append-only com `dominio`; notas arquiváveis; memória consultável **por caso**, nunca em massa (`servicos/memoria.ts`); invariantes 9, 11, 12 e 14. |
| Medir antes de afirmar | `core/qualidade-ia.ts`: taxa de acerto com denominador pessimista (só o que passou por humano, para não dar para inflar mexendo no limiar), cobertura e calibração, separadas **por modelo**. |
| Falhar alto; corte automático | `InterpretacaoIndisponivelError` para o lote inteiro na primeira credencial recusada. Pedir um adapter que não existe **falha** em vez de cair no mock em silêncio. Cada chamada tem teto de 120 s e 16 mil tokens. |
| Evolução controlada de regras | `A30` (nenhum feedback muda o sistema sozinho; escada de cinco degraus) e `A33` (regra incerta fica marcada como **observação**, não como confirmada) são, no nível das regras, o princípio da § 21. |
| Limite de uso | Assistente: 12 perguntas por minuto **por pessoa** (`app/api/assistente/route.ts`). Rotas de entrada limitadas por origem. |

**Leitura honesta desta tabela:** o SBP não tem Cérebro, agente, roteador nem meta-grafo, e **não deveria ter**. O que ele tem é a parte que, em outros sistemas, costuma faltar e custa caro de acrescentar depois: a separação entre propor e decidir, a verificação determinística, o registro da decisão e a independência de fornecedor.

---

## 3. Lacunas

Em ordem de importância para a visão, e não de tamanho.

1. **Não existe avaliação com gabarito.** `scripts/experimentar-ia.ts` roda uma bateria sintética pequena e mostra as saídas lado a lado "com os olhos na saída": não há resposta esperada nem nota calculada. Sem isso não dá para comparar modelos, promover prompt, justificar modelo local nem calibrar confiança.
2. **Não existe registro de uso nem orçamento.** Os adapters não gravam tokens, latência nem custo por chamada. Não há teto diário. Os limites que existem valem por chamada (tempo, tokens, uma repetição), não por dia nem por tarefa.
3. **A extração da IA não é conferida contra a fonte.** O prompt manda extrair "apenas o que estiver LITERALMENTE no texto" (`ia-estruturada.ts:94`), e **nada confere isso depois**. Um nome ou CPF que o modelo inventou passa, se a confiança estiver acima do limiar e não faltar campo.
4. **CPF que não confere não manda o item para revisão.** A regra do dígito verificador existe (`A40`, resposta 26: CPF com erro não vira chave de busca), mas é usada só para não criar a chave. O item com CPF inválido segue `aprovado` se a confiança for alta (`servicos/ingestao.ts:506-510`).
5. **A versão do prompt é uma string digitada à mão** (`'gemini-1.0.0'`, `'anthropic-1.0.0'`). Mudar as instruções sem mudar a string mistura duas populações na medida de acerto, sem aviso.
6. **O ator automático tem papel de operador** (`ATOR_SISTEMA`, `servidor/ator.ts:58`), com acesso a "confirmar distribuição" e "aprovar revisões em massa". Já registrado em `§ H.4` item 7 e ainda aberto. **Nenhum agente pode existir antes de isso ser resolvido.**
7. **O ciclo de vida do item não é uma máquina de estados explícita.** `Item.status` é texto; as transições permitidas estão espalhadas pelos serviços. A fase 3 (andamento, pausa, pedido de cancelamento) vai multiplicar essas transições.
8. **O identificador da falha 500 não costura o ciclo.** Registrado desde 28/08: `http.ts` sorteia uma correlação nova, sem relação com a do serviço. "Por que o sistema fez isso?" não se responde a partir do código que a pessoa vê na tela.
9. **O canal de feedback da equipe (`A21`) e o relatório (`A32`) estão decididos e não implementados.** São o "feedback do mundo real" da visão, do lado humano.
10. **A comparação entre previsão e realidade não é registrada** para mudanças de regra. `A33` marca a regra como observação, mas não grava "o que esperamos que aconteça, medido como, revisto quando".

---

## 4. Contradições com a arquitetura futura

Partes do código ou do desenho que entrariam em conflito com a visão se ninguém mexer.

| # | Onde | Conflito | Gravidade | O que fazer |
|---|---|---|---|---|
| C1 | `ATOR_SISTEMA` com papel `operador` | Menor privilégio e "agente não tem autoridade implícita". Um agente usando essa identidade distribuiria trabalho, e a trilha registraria `sistema`, igual à ingestão automática. | **Alta**, e bloqueia agentes | Papel próprio (`sistema`) sem as operações que decidem carga, ou identidade por agente. Decisão do dono (`§ H.4` item 7); a proposta está na seção 17. |
| C2 | Um único `IA_ADAPTER` para todas as tarefas (`fabrica.ts`) | Impede o roteamento por tarefa. **Mas é decisão de privacidade** ("qual empresa processa o texto que sai desta casa"), e não descuido. | Média | Não dividir a variável sem criar a política que ela protege: **fornecedores autorizados por classe de dado**. O roteamento nasce **dentro** dessa política, nunca por cima dela. |
| C3 | A confiança do modelo é a porta de aprovação automática do item limpo (`confianca < limiar`) | "Confiança do modelo nunca substitui evidência." A calibração nunca foi medida com dado real; contra o mock, acerto e erro saem com confianças quase iguais (0,91 contra 0,90, registrado em `DECISOES.md`). | Média hoje (só dado sintético); **alta** no piloto | Antes do piloto, somar sinais determinísticos (lacunas 3 e 4). No piloto, a autonomia sobe por categoria só com calibração medida (seção 15). |
| C4 | `versaoPrompt` digitada à mão | Proveniência que pode mentir sem ninguém perceber. | Baixa agora, cresce com cada modelo | Derivar por hash das instruções e do esquema. |
| C5 | `RegraDistribuicao` modelada e nunca lida | O PRD e `A11`/`A12` dizem "configurável sem deploy, com vigência"; o limiar e o peso reais moram em colunas de `Categoria`, sem histórico de mudança e sem rota de escrita. | Baixa | Não apagar agora (raio de alcance mínimo). Quando existir o primeiro parâmetro ajustável pelo gestor (degrau 3 de `A30`), **esta** tabela vira o registro versionado de parâmetros, ou sai. Decidir nesse momento. |
| C6 | Status do item como texto livre, sem tabela de transições | Um ciclo de vida explícito é o grafo que importa neste sistema; hoje ele é implícito. | Média, cresce na fase 3 | Tabela de transições pura em `core/`, antes da fase 3. |
| C7 | Correlação que não chega ao 500 | Observabilidade da § 30 ("por que o sistema fez isso?"). | Média | Propagar a correlação (`AsyncLocalStorage` ou parâmetro em `rota()`). |

**O que não é contradição, embora pareça:** o assistente não poder agir. Um agente futuro seria **outro** port, com ferramentas passando pelo gateway. Dar ação ao assistente atual seria o erro.

---

## 5. Riscos

| Tipo | Risco | Hoje | Com a visão implementada sem as correções |
|---|---|---|---|
| Alucinação | Campo inventado aprovado automaticamente | Real (lacuna 3) | Multiplicado: agente usando saída de outro agente como fato |
| Alucinação | Omissão: a IA não devolve o item, e o pedido some | Mitigado: e-mail sem item é registrado; o suspeito sem item fica guardado (`AT-24`) e vai virar lista (`A34`) | Agente que "resolve" não fazendo nada, com tudo verde |
| Segurança | Injeção persistente por memória | Bloqueada por desenho (invariante 12) | Alta, se o Cérebro montar contexto com trilha, notas ou e-mails antigos |
| Segurança | Exfiltração por ferramenta | Inexistente: IA sem ferramenta | Alta, se agente com acesso a rede ou e-mail não passar por gateway com lista de destinos |
| Segurança | Privilégio do ator automático | Latente (C1) | Agente confirmando distribuição |
| Custo | Laço de agente com contexto grande | Inexistente | O risco de custo real; tokens de interpretação são pequenos no volume atual |
| Custo | Tempo de manutenção de infraestrutura (modelo local, grafo, registro de agentes) | Inexistente | O maior custo mensal da apresentação já é a hora de quem mantém; cada camada nova soma aqui |
| Arquitetura | Cérebro controlando o fluxo de controle | — | Sistema não verificável: o verificado controla o caminho até a verificação |
| Arquitetura | Grafo de relações misturado com grafo de execução | — | Raciocínio sobre fluxo de controle como se fosse dado |
| Autonomia | Autoevolução sem avaliação fixa | — | O sistema melhora a métrica que ele mesmo escolheu, e piora o resultado |
| Loops | Agente chamando agente | — | Custo e latência sem limite; responsabilidade diluída |
| Acoplamento | Framework de agentes adotado cedo | — | A política passa a morar dentro de um fornecedor de framework, que é o mesmo acoplamento que a independência de modelo evita |
| Complexidade | Dez camadas num sistema de 4 a 7 usuários | — | Protótipo que não chega ao piloto; a prova de valor não acontece |
| Produto | Tentar provar a visão inteira em vez do valor medido | — | A empresa não aprova arquitetura, aprova resultado |

---

## 6. Definições precisas

Para não misturar os conceitos. Onde a palavra da visão não é a melhor, a alternativa está indicada.

| Termo | Definição arquitetural | O que **não** é | No SBP hoje |
|---|---|---|---|
| **Modelo** | Função probabilística de texto para texto, identificada por fornecedor, nome e versão. Sem estado entre chamadas, sem autoridade, sem memória própria. | Não é o Cérebro, nem o sistema. | `gemini-3.5-flash`, `claude-*`, atrás de `ClienteDeModelo` |
| **Cérebro** (sugestão: **camada cognitiva**) | O conjunto de **tarefas cognitivas** do sistema (interpretar, explicar, propor), cada uma com contrato de entrada, contrato de saída, prompt versionado e modelos autorizados. Toda a identidade, a memória e os objetivos moram em configuração versionada e no banco, nunca dentro do modelo. | Não é uma entidade com vontade, nem o dono do fluxo de execução, nem a fonte de verdade. | `AiPort.interpretar`, `AssistentePort.responder` |
| **Agente** | Uma tarefa cognitiva que roda em **laço** (modelo ↔ ferramentas) até um critério de parada, sob um **contrato** versionado: objetivo, ferramentas permitidas, dados permitidos, modelos permitidos, orçamento, autonomia e parada. | Não é qualquer chamada de modelo. Uma chamada única com saída validada é **tarefa**, não agente. | Nenhum (correto) |
| **Harness** | O runtime que executa as tarefas cognitivas e é o **único ponto de aplicação de política** em volta delas: monta o contexto mínimo, escolhe o modelo, aplica o orçamento, chama ferramentas pelo gateway, roda os verificadores e grava a trilha. **Não pensa.** | Não é biblioteca de chamada de API, nem o Cérebro. | Embrião: `ia-estruturada.ts` + `rota()` + `exigirPapel` + esquemas Zod |
| **Ferramenta (tool)** | Capacidade tipada de ler ou alterar o mundo, com contrato de entrada e saída, classe de risco, idempotência declarada e operação no vocabulário fechado. | Não é "qualquer função". | As operações dos serviços (`concluir`, `transferir`, `confirmar`…) |
| **Tool Gateway** | O caminho único pelo qual qualquer ator não humano chama uma ferramenta: identidade, autorização, escopo de dados, orçamento, confirmação humana quando exigida, registro. Recomendo **gateway** para o ponto de política; *runtime* é onde a execução acontece, detalhe de implementação. | Não é uma segunda API paralela aos serviços. | **Os próprios serviços** + `OperacaoSchema`. Agente futuro usa os mesmos serviços, com o próprio `Ator`. |
| **Grafo de execução** | Definição versionada de passos (nós) e transições com condição (arestas), interpretada pelo Harness. | Não é o grafo de relações do domínio. | Implícito nos serviços; o ciclo de vida do item é o primeiro candidato a ficar explícito |
| **Laço (loop)** | Aresta de retorno num grafo de execução, **sempre** com condição de parada e limite de iterações. | Não é sinônimo de grafo. | A única repetição do modelo: uma, e só por formato |
| **Estado** | Os fatos operacionais atuais, persistidos, com uma fonte de verdade por fato. | Não é o que o modelo "lembra". | Banco relacional: `Item`, `Atribuicao`, `Escala`, `Afastamento`… |
| **Memória** | Registros sobre o passado: o que aconteceu (trilha, eventos), o que se decidiu (rodadas, revisões) e o que se aprendeu (notas). Nunca é verdade **atual** sem revalidação. | Não é contexto de prompt (invariante 12). | `LogAuditoria`, `EventoProcessamento`, `RodadaDistribuicao`, `Revisao`, `Nota` |
| **Realidade** | O que aconteceu fora do sistema e chegou por uma fonte registrada: e-mail recebido, clique de conclusão, cadastro da associação. | Não é o que a IA diz que aconteceu. | `IngestaoPort` (só leitura), ações humanas com `Ator` |
| **Grounding** | A exigência de que toda afirmação usada numa decisão aponte para uma **referência resolvível** no estado ou na realidade. | Não é "o modelo leu o documento". | Assistente: `verbetesUsados` conferidos contra o que foi enviado |
| **Evidência** | Uma referência endereçável: id do registro, mais a versão ou o instante, mais a fonte. Texto do modelo **não** é evidência. | Não é confiança, nem justificativa escrita pelo modelo. | Ids em `RodadaDistribuicao.elegiveis`, `Revisao.itemId` |
| **Verificador (validator)** | Checagem **determinística** e reproduzível que responde sim ou não sobre uma proposta, com o motivo. | Não é outro modelo. | Zod, conservação, dígito do CPF, papel, datas |
| **Crítico (critic)** | Avaliador **não determinístico** (modelo ou pessoa) que produz **objeção**, nunca aprovação sozinha. Uma objeção leva a humano ou a verificação adicional. | Não é aprovador. | Nenhum modelo crítico; o humano da Revisão cumpre esse papel |
| **Feedback** | Sinal sobre o resultado, ligado a uma decisão ou a uma tela: correção humana, resultado medido, comentário da equipe. | Não é instrução ao modelo. | `Revisao.desfecho`; `A21` decidido |
| **Meta-grafo** (sugestão: **camada de avaliação e mudança**) | O processo que observa métricas de tarefas, modelos e regras, gera **propostas** de mudança de configuração e as submete a avaliação fixa e aprovação. | Não é algo que altera o sistema em tempo de execução. | A escada de `A30`, hoje só no papel |
| **Engenharia de agentes** | O processo, humano com ferramentas, de projetar, avaliar, promover e aposentar contratos de agente. | Não é agente criando agente. | — |
| **Roteador de modelo** | Função de política: (tarefa, classe de dado, risco, orçamento restante, resultados de avaliação) → modelo autorizado e plano de escalonamento. | Não é "tentar o barato e, se der errado, o caro". | `criarAiPort()` escolhe um só, por variável de ambiente |

---

## 7. Arquitetura proposta

### Crítica das 10 camadas sugeridas (§ 41)

- **State Layer separada de Reality/Data** é redundante. O estado **é** o banco de registro mais as projeções derivadas dele. Separar cria duas fontes de verdade.
- **Verification Layer ao lado de Agents e Tools** passa a ideia errada de que verificar é uma capacidade opcional que alguém chama. Verificação são **portões dentro do fluxo do Harness**: antes de executar e depois do resultado. Quem é verificado não escolhe se chama o verificador.
- **Graph/Orchestration** separada do Harness divide o ponto de política em dois. A orquestração **é** o runtime do Harness.
- **Feedback/Evaluation** e **Evolution/Meta** são o mesmo ciclo: medir, propor, avaliar, promover. Juntas.
- **Faltam três coisas:** o **domínio determinístico** como camada própria (é a âncora de verdade, e é o que o SBP tem de mais forte); a **classificação de dados** (LGPD decide para onde um dado pode ir); e a **interface humana** de aprovação e feedback como camada, não como detalhe.

### Seis camadas e duas transversais

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 6. AVALIAÇÃO E MUDANÇA                                                │
│    conjuntos de avaliação fixos · métricas · previsão × realidade    │
│    propostas de mudança · promoção e reversão (sempre com humano)    │
└──────────────────────────────▲───────────────────────────────────────┘
                               │ lê métricas, propõe; nunca altera direto
┌──────────────────────────────┴───────────────────────────────────────┐
│ 5. HUMANO NO CIRCUITO                                                 │
│    revisão · confirmação · aprovação por classe de risco · feedback  │
└──────────────────────────────▲───────────────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────────────┐
│ 3. GOVERNANÇA (HARNESS) ─ envolve a camada 4 nos DOIS sentidos        │
│                                                                      │
│   ENTRADA                        ┌───────────────────────────┐        │
│   identidade e papel ──────────► │ 4. COGNIÇÃO               │        │
│   classificação do dado ───────► │    tarefas e agentes      │        │
│   contexto mínimo ─────────────► │    (contratos versionados)│        │
│   defesa contra injeção ───────► │    modelos, via roteador  │        │
│   orçamento ───────────────────► └─────────────┬─────────────┘        │
│                                                │ PROPOSTA              │
│   SAÍDA                                        ▼                       │
│   esquema ─► verificadores ─► evidência ─► classe de risco ─► autoriz. │
│                                                │                       │
│   orquestração (máquina de estados, fluxos) · gateway de ferramentas  │
└────────────────────────────────────────────────┬─────────────────────┘
                                                 │ só por serviços do domínio
┌────────────────────────────────────────────────▼─────────────────────┐
│ 2. DOMÍNIO DETERMINÍSTICO  (a âncora)                                 │
│    regras · motor · invariantes · transições permitidas · cálculos    │
└────────────────────────────────────────────────┬─────────────────────┘
                                                 │ transação
┌────────────────────────────────────────────────▼─────────────────────┐
│ 1. REALIDADE E ESTADO                                                 │
│    banco de registro · integrações só-leitura · projeções derivadas   │
└──────────────────────────────────────────────────────────────────────┘

TRANSVERSAIS:  observabilidade e proveniência (correlação, trilha, uso, custo)
               segurança (segredos, limites, isolamento, retenção)
```

A diferença decisiva para o diagrama da § 38: **a cognição não fica acima de tudo; fica dentro da governança, e a governança só toca a realidade pelo domínio determinístico.** Um agente não grava no banco; ele chama um serviço, e o serviço aplica as mesmas transações, invariantes e trilha que valem para uma pessoa.

### Onde cada camada está no SBP

| Camada | Arquivos hoje | Falta, no tamanho do protótipo |
|---|---|---|
| 1. Realidade e estado | `prisma/schema.prisma`, `adapters/ingestao-mock.ts`, `armazenamento-disco.ts` | Ingestão real do Outlook (só leitura); PostgreSQL na implantação |
| 2. Domínio determinístico | `core/` inteiro | Tabela de transições do item |
| 3. Governança | `ia-estruturada.ts`, `servidor/http.ts`, `servidor/ator.ts`, `core/seguranca/`, esquemas | Registro de uso e orçamento; hash do prompt; verificadores pós-IA; ator do sistema com papel próprio |
| 4. Cognição | `ports/ia.ts`, `ports/assistente.ts`, `adapters/ia-*.ts` | Nada agora |
| 5. Humano no circuito | Revisão, Distribuição, confirmações | Feedback em tela (`A21`) |
| 6. Avaliação e mudança | `core/qualidade-ia.ts`, `experimentar-ia.ts`, `A30` no papel | Conjunto de avaliação com gabarito e nota |

---

## 8. Cérebro × modelo

A visão acerta ao separar os dois. Vou mais longe: **o Cérebro não deve ter identidade própria além da configuração versionada.**

- **O que é do modelo:** gerar texto dado um contexto. Pesos, fornecedor, versão, preço, latência, janela de contexto.
- **O que é do Cérebro (camada cognitiva):** *quais* tarefas existem, *qual* contrato cada uma tem, *qual* prompt e versão, *quais* modelos são autorizados e *qual* avaliação cada modelo precisa passar.
- **O que não é de nenhum dos dois:** o estado (banco), a memória (trilha e registros), os objetivos de negócio (regras e decisões registradas), as permissões (Harness) e a verdade (realidade).

**Por que isso importa:** se "identidade, memória e objetivos" morarem no Cérebro como coisa viva (um contexto longo, um resumo que ele mesmo mantém), a troca de modelo muda o comportamento de forma que ninguém consegue auditar. E o resumo que ele mantém vira a narrativa internamente consistente e desconectada da realidade que a § 6 quer evitar. Tudo o que o Cérebro "sabe" deve ser **reconstruível** a partir do banco e da configuração, a cada chamada.

**Teste prático da separação:** trocar `IA_ADAPTER` e rodar a mesma avaliação deve mudar **só** a nota, nunca o que o sistema faz com a proposta. Hoje isso já vale para a interpretação.

---

## 9. Harness

| Sobre | Papel do Harness | Hoje no SBP | Agora | Depois |
|---|---|---|---|---|
| Cérebro | Monta a entrada (contexto mínimo, delimitado) e confere a saída (esquema, verificadores); nunca entrega o fluxo de controle ao modelo | Sim, para as duas tarefas | Verificadores pós-IA | Contrato por tarefa em arquivo |
| Agentes | Executa o laço dentro do contrato; corta por orçamento, profundidade e parada | Não há agentes | — | Quando existir o primeiro |
| Ferramentas | Único caminho; autorização por operação e escopo | Serviços + `exigirPapel` para humanos | Ator do sistema com papel próprio | Agente com `Ator` próprio |
| Modelos | Escolhe o modelo autorizado para a tarefa e a classe de dado | Uma variável global | — | Roteador, quando dois modelos passarem na avaliação |
| Dados | Classifica e filtra antes de enviar; decide o que pode sair da casa | Filtro por papel no assistente; só o e-mail na interpretação; invariantes 11 e 12 | — | Classe de dado declarada por tarefa |
| Custo | Mede cada chamada; aplica o teto; bloqueia e avisa, sem degradar em silêncio | Teto por chamada; limite do assistente | Registro de uso e teto diário | Orçamento por tarefa e por agente |
| Segurança | Injeção, limites, segredos, isolamento, corte automático | Forte (seção 14) | Corte por falhas de transporte seguidas | Lista de destinos permitidos para ferramentas com rede |
| Validação | Portões antes e depois; o verificado não escolhe se é verificado | Zod, conservação, revisão | Literalidade e CPF | Comparação entre previsão e realidade para mudanças de regra |

---

## 10. Arquitetura contra alucinação

**Regra formal proposta:**

> **Confiança é sinal de roteamento, nunca de autoridade.** Uma confiança baixa pode mandar uma proposta para **mais** verificação. Uma confiança alta **nunca** dispensa um verificador obrigatório, e só pode dispensar revisão humana numa classe em que a calibração tenha sido **medida contra gabarito**, com amostra mínima declarada.

E a regra de proveniência que a acompanha:

> **Toda informação usada numa decisão tem um status epistêmico:** *observado* (veio de fonte registrada), *declarado por humano*, *calculado* (determinístico sobre fatos), *inferido* (saída de modelo) ou *hipótese* (regra ou previsão marcada como observação). Uma decisão que altera o estado só pode se apoiar em *inferido* se um verificador ou um humano o tiver convertido em *declarado* ou *calculado*.

**Não é preciso uma tabela genérica para isso.** No SBP o status já é derivável: item com `modeloIa` preenchido e sem revisão é *inferido*; com `Revisao.valorFinal`, *declarado por humano*; registro manual (`emailId` nulo), *declarado*; rodada, *calculado*; `A33`, *hipótese*. **Derivável não se persiste de novo** (política de simplicidade, seção 19).

### Cada modo de falha da § 6 e o mecanismo contra ele

| Modo de falha | Mecanismo | No SBP |
|---|---|---|
| Interpretar dado incorretamente | Esquema + verificadores determinísticos + revisão por risco | Zod, `decidirRevisao`; **faltam** literalidade e CPF |
| Confundir hipótese com fato | Status epistêmico; hipótese marcada | `A33`; o assistente diz "não sei" (`respondida: false`) |
| Usar contexto desatualizado | A decisão referencia a **versão** do estado em que se baseou; o executor reconfere a pré-condição e recusa se mudou | Prévia e gravação pela mesma função, com trava por dia e releitura dentro da transação |
| Criar relação que não existe | Toda referência precisa **resolver** (chave estrangeira, busca, lista fechada) | Liga resolvida por regra (`AT-10`); citação de verbete conferida; nome de campo em lista fechada (`core/nome-de-campo.ts`) |
| Decisão coerente e inadequada ao objetivo | Contrato de objetivo e resultado esperado, com validação do resultado (seção 11) | Conservação e crédito são resultado validado; para a IA, `Revisao.desfecho` |
| Solução válida para o problema errado | Avaliação com gabarito **escrito antes** e fixo | **Falta** (lacuna 1) |
| Confiar em agente que estava errado | Saída de agente é *inferida* para outro agente; nunca evidência sem verificação | Não se aplica ainda; invariante proposto |
| Loops | Limite de iterações e de orçamento no Harness; parada obrigatória | Uma repetição, só por formato |
| Narrativa consistente e desconectada | Nenhuma afirmação sem referência resolvível; a narrativa **descreve**, nunca recalcula | `A6`: a narrativa da rodada é função pura sobre o registro, sem IA |
| Omissão (a visão não cita, e é o modo mais caro aqui) | Conferir **ausência** contra a fonte: e-mail sem item e suspeito vai para pessoa | `A34`, `AT-24` |

### A "âncora": crítica da metáfora

A ideia é correta, e a metáfora engana em um ponto: âncora sugere algo **fixo**, e a realidade muda enquanto o modelo pensa. O que prende a inteligência à realidade não é um peso, é um **contrato de pré-condição e pós-condição**. Tecnicamente, a âncora é a soma de cinco coisas:

1. **Fonte de verdade única por fato** (banco de registro, integração só-leitura).
2. **Proveniência**: toda proposta carrega de onde vieram as entradas e em que versão do estado.
3. **Pré-condição reconferida na execução**: se o estado mudou desde a proposta, a execução recusa e a proposta volta (controle de concorrência otimista).
4. **Invariantes do domínio verificados na transação**: a proposta pode ser qualquer coisa; o commit só acontece se as regras continuarem verdadeiras.
5. **Pós-condição e resultado observado**: o que aconteceu de fato é gravado e comparado com o esperado.

Nome sugerido: **ancoragem por contrato** (pré-condição, invariante, pós-condição), ou simplesmente *grounding* com verificação de estado.

---

## 11. Arquitetura de verificação

### Quem valida o Cérebro

**Ninguém sozinho, e esse é o ponto.** A validação do Cérebro vem da **separação de poderes**: o componente verificado não pode escrever os próprios verificadores, o próprio conjunto de avaliação, as próprias métricas nem as próprias permissões. Com isso ele é validado por cinco instâncias que não controla:

1. **Falta de autoridade:** a saída dele é proposta; o commit depende de regra.
2. **Verificadores do domínio:** código determinístico, versionado e testado. E os testes desses verificadores são provados por sabotagem, prática que o projeto já adota ("teste verde não prova nada").
3. **Avaliação fixa, escrita antes:** gabarito que o Cérebro não vê nem altera. Mudança de prompt ou de modelo só é promovida se a nota não cair.
4. **Resultado real:** correção humana (`Revisao.desfecho`) e métricas operacionais, comparadas com o que era esperado.
5. **Pessoas que validam os validadores:** revisão de código, decisões registradas, a escada de `A30`.

Outro modelo revisando o Cérebro entra só como **crítico** (produz objeção), e só quando as condições da tabela abaixo se cumprem.

### Por tipo de verificação

| Tipo | Quando usar | Exemplo no SBP | Custo |
|---|---|---|---|
| **Determinístico** | Sempre que a propriedade puder ser escrita como regra | Esquema, papel, transição permitida, dígito do CPF, valor extraído presente no texto, nome de campo em lista fechada | Quase zero |
| **Matemático** | Somas, contagens, limites, conservação, equilíbrio | `Σ == entrada`, `|crédito| < 1`, soma dos créditos igual a zero | Quase zero |
| **Evidência** | A saída cita algo: conferir que a referência existe e foi fornecida | `verbetesUsados` contra o material enviado; liga resolvida | Baixo |
| **Crítica semântica (modelo)** | Não determinístico **e** alto impacto **e** avaliação mostra que o crítico pega erros que o primeiro deixa passar **e** entrada ou família de modelo independente | Hoje: nenhum caso justifica | Uma chamada a mais por caso |
| **Resultado real** | Toda decisão com efeito mensurável | Desfecho da revisão; tempo parado na fila; carga por pessoa depois de mudar uma regra | Baixo, se o dado já é gravado |
| **Humano** | Irreversível, sensível, ambíguo, ou classe sem calibração medida | Revisão, confirmação da distribuição, encurtar prazo | Tempo da equipe: é o que se quer reduzir **com evidência** |

### Quando NÃO usar uma segunda IA

- **Quando existe verificador determinístico.** Nunca pergunte a um modelo se a soma fecha.
- **Quando os dois modelos veem a mesma entrada contaminada.** Uma injeção no e-mail atinge o crítico igual; o conteúdo suspeito vai para **pessoa**, não para um modelo maior.
- **Quando não há como arbitrar o desacordo.** Duas IAs discordando ainda precisam de humano; se o humano é obrigatório de qualquer jeito, o crítico só gastou dinheiro.
- **Quando a avaliação não mostra ganho.** Crítico sem ganho medido é custo e latência.
- **Quando o dado não pode ir a outro fornecedor.** Dado de associado só vai a fornecedor autorizado (`A38`).
- **Quando o erro é barato e reversível.** Um item mal classificado cai na revisão ou é devolvido; o custo do erro é menor que o do crítico.

### Execução correta × objetivo correto, generalizado para o SBP

O exemplo do salário líquido tem forma geral: **o teste confere a execução contra a especificação que o próprio implementador escreveu.** A saída é ter o **resultado esperado escrito por quem não executa**, antes da execução.

| Tarefa | Objetivo | Resultado esperado (escrito antes) | Ação | Resultado observado | Conferência |
|---|---|---|---|---|---|
| Interpretar e-mail | Transformar pedido em itens de trabalho corretos | N itens, categoria, campos **literais** | Chamada ao modelo | Itens gravados; desfecho da revisão | Gabarito na avaliação; literalidade; desfecho |
| Distribuir | Carga equilibrada e conservada | `Σ == entrada`; `|crédito| < 1`; ninguém afastado recebe | Motor | Rodada e créditos gravados | Invariantes na transação |
| Mudar uma regra (`A33`) | Ex.: lote pequeno inteiro para uma pessoa não sobrecarregar ninguém | Métrica, faixa e data de revisão escritas **antes** | Mudar o parâmetro | Métrica medida no período | Previsão × realidade, registrado |
| Responder dúvida | Explicar o sistema sem inventar | Resposta apoiada em verbetes enviados | Chamada ao modelo | Verbetes citados | Citação conferida; "não sei" quando não cobre |

**Consequência de implementação, pequena:** só a terceira linha pede estrutura nova, e ela pode começar como uma seção fixa no registro da decisão em `DECISOES.md` (métrica, faixa esperada, data de revisão). Tabela só quando houver ajuste pela tela (degrau 3 de `A30`).

---

## 12. Roteamento de modelo e custo

### A regra de roteamento

Em ordem, e cada passo é **restrição**, não preferência:

1. **Classe do dado → fornecedores autorizados.** Dado de associado real só vai a fornecedor em camada paga, sem uso para treino (`A38`), ou a modelo local. Esta regra vence qualquer outra.
2. **Tarefa → modelos que passaram na avaliação desta tarefa**, com nota mínima declarada.
3. **Entre esses, o de menor custo total** (tokens mais latência que atrasa a equipe).
4. **Escalar só por sinal determinístico de falha:** esquema inválido depois da repetição, campo não encontrado no texto, resposta truncada. **Nunca** pela confiança que o modelo declara, e **nunca** por conteúdo suspeito: suspeito vai para pessoa.
5. **Orçamento estourado → parar e avisar**; os itens esperam ou vão para a revisão. **Nunca** cair em silêncio para um modelo que não passou na avaliação.

### Local × API: crítica honesta

A divisão proposta (local para o frequente e simples, API para o complexo e crítico) faz sentido **em volume alto**. No SBP, hoje:

- **Estimativa de custo de API para interpretar**, com os preços da apresentação de 14/09/2026 (Sonnet 5 a US$ 2 por milhão de tokens de entrada e US$ 10 de saída; dólar a R$ 5,12) e ~3.000 tokens de entrada e ~500 de saída por e-mail: **cerca de US$ 0,011, ou R$ 0,06, por e-mail**. Com mil e quinhentos e-mails por mês, a ordem de grandeza é **R$ 85 por mês**, e o dobro com repetições e folga. O volume real de e-mails ainda não foi medido; é estimativa.
- **Um modelo local capaz de extrair campos em português com qualidade** precisa de máquina com memória e, provavelmente, GPU, além de alguém para manter. Em CPU comum a latência pode ser de dezenas de segundos por e-mail. Não se sabe se a associação tem essa máquina.
- **Conclusão:** no volume atual, **custo não justifica o modelo local; privacidade pode justificar.** Se a empresa não aprovar dado de associado indo a fornecedor externo, o modelo local passa de opção a condição. Essa é a pergunta a levar à empresa, não "local ou API".
- **Onde a divisão da visão faz sentido de verdade:** tarefas de volume alto e baixo risco no futuro (resumo de feedbacks, agrupamento de temas, triagem de muitas frentes), e agentes em laço, onde o custo cresce com as iterações.

**Encaixe técnico:** um modelo local servido por endpoint compatível (Ollama, vLLM ou similar) entra como mais um `ia-<nome>.ts` implementando `ClienteDeModelo`. A fronteira já existe; nada fora de `adapters/` muda.

### Orçamento de execução (o "Cognitive Budget")

O conceito está certo. O nome **orçamento de execução** cobre também tempo e número de chamadas, e não só dinheiro.

**No protótipo, três peças e nada mais:**

1. **Registro por chamada:** tarefa, fornecedor, modelo, tokens de entrada e saída, latência, espécie de falha, custo estimado por uma tabela de preços em configuração, `correlacaoId`. Uma tabela pequena própria, porque somar por dia dentro de JSON em `EventoProcessamento` não é portável entre SQLite e PostgreSQL.
2. **Teto diário por tarefa**, conferido **antes** da chamada. Estourou: erro alto, como `InterpretacaoIndisponivelError`; o lote para, e a tela diz por quê.
3. **Corte automático por falhas seguidas de transporte**, porque hoje uma sequência de `503` segue e-mail por e-mail.

**Depois:** orçamento por agente e por execução (chamadas, profundidade, tempo), e custo por decisão no painel de qualidade.

---

## 13. Agentes: nascer, evoluir e morrer sem caos

### Um agente é um arquivo, e o ciclo de vida é o Git

A § 20 propõe dez estados de ciclo de vida. Todos já existem, de graça, no processo que o projeto usa:

| Estado da visão | No protótipo |
|---|---|
| Proposto | Issue ou pergunta registrada em `§ H.4` |
| Desenhado | Arquivo de contrato do agente num branch |
| Sandbox | Execução contra o conjunto de avaliação, no CI e sem dado real |
| Avaliado | Nota da avaliação publicada no PR |
| Aprovado | Revisão do PR e decisão do dono em `DECISOES.md` |
| Ativo | Merge e implantação |
| Monitorado | Registro de uso, desfecho e custo por versão |
| Degradado, atualizado, substituído | Novo PR com nova versão; a avaliação compara as duas |
| Aposentado | Remoção do arquivo, com o motivo registrado |
| Rollback | Reverter o commit |

**Nenhuma tabela, nenhum registro em banco, nenhum serviço novo.** Um registro de agentes em runtime só se paga quando houver muitos agentes ou troca de configuração sem implantação, e isso está longe.

### O contrato mínimo

O que o contrato precisa ter quando existir o primeiro agente. O restante da lista da § 4 é derivável ou prematuro.

```text
id, versão
objetivo                  (uma frase) e resultado esperado verificável
modelos autorizados       + classe de dado permitida
ferramentas permitidas    (operações do vocabulário fechado)
escopo de dados           (quais entidades, filtradas por qual regra)
autonomia                 sugere | executa_reversível | nunca executa sem humano
orçamento por execução    chamadas, tokens, tempo
parada                    critério de sucesso, de falha e limite de iterações
avaliação                 conjunto e nota mínima
```

**Fica de fora agora:** dependências entre agentes, agentes que pode chamar, profundidade e estratégia de rollback própria. Com profundidade zero, que é a regra proposta, nenhum desses campos tem uso.

### A escada antes de criar um agente (§ 18)

Correta, e com um degrau a mais no topo e uma ordem fixa:

```text
0. Isto precisa ser feito?              (métrica ou feedback que prova a necessidade)
1. Uma regra resolve?
2. Um cálculo resolve?
3. Uma ferramenta ou operação existente resolve?
4. Uma tarefa cognitiva de chamada única, com saída validada, resolve?
5. Um agente existente, adaptado, resolve?
6. Só então: agente novo, com contrato, avaliação e aprovação.
```

O SBP já pratica os degraus 1 e 2 como cultura: a narrativa da rodada (`A6`), o aviso do dia (`A17`), a detecção de reenvio (`A28`) e a junção de ligas (`A31`) foram todos resolvidos **sem IA**, por decisão.

### Agente criando agente (§ 19)

**Proibido no protótipo e na primeira fase de agentes.** Profundidade máxima: zero. Um agente pode **registrar a necessidade** (como proposta, texto para humano). A criação é sempre engenharia de agentes, humana e com avaliação. Rever só quando houver evidência de muitas necessidades legítimas e repetidas que um humano não consiga atender, e mesmo aí com cota, orçamento e aprovação.

---

## 14. Grafo e meta-grafo

**Agora, o grafo que importa é o ciclo de vida do item.** Uma tabela pura em `core/` com os estados (`aguardando_revisao`, `aprovado`, `distribuido`, `em_andamento`, `pausado`, `concluido`, `devolvido`, `cancelado`), as transições permitidas, quem pode disparar cada uma e as pré-condições. Os serviços consultam essa tabela em vez de repetir a regra. É barato, testável em milissegundos, e é exatamente o que a fase 3 vai precisar.

**Os fluxos (ingestão → interpretação → revisão → distribuição) continuam como código**, com cada etapa gravada em `EventoProcessamento`. **Não adotar framework de grafo de agentes agora.** Ele traria dependência, uma segunda forma de expressar política e nenhum ganho com uma tarefa cognitiva por fluxo.

**O grafo de relações** (liga, ligante, item, pessoa, categoria) já está no banco relacional. Banco de grafos só se aparecer consulta de caminho que o SQL não resolva, e nenhuma aparece hoje.

**Meta-grafo → camada de avaliação e mudança.** Funcionamento:

```text
métricas (acerto por modelo e categoria, custo, tempo parado, feedbacks agrupados)
   ↓ leitura, só leitura
diagnóstico (regra ou relatório; IA só sobre dado sem identificação, com decisão)
   ↓
PROPOSTA de mudança de configuração (prompt, modelo, limiar, regra)
   ↓
avaliação fixa + período de observação com resultado esperado escrito
   ↓
aprovação humana (degraus de A30)
   ↓
promoção (versão nova) ou descarte; reversão sempre possível
```

**O que ela nunca faz:** mudar grafo, agente, rota ou regra em tempo de execução. "O Cérebro adaptar grafos sob governança do Harness" (§ 16) só é seguro se "adaptar" significar **propor uma nova versão** que passa pelo processo acima. Adaptação em tempo de execução é código se reescrevendo sem revisão.

---

## 15. Humano no circuito e autonomia progressiva

### Classes de risco

A proposta da § 31 (baixo, médio, alto, crítico) está certa. Recomendo definir as classes por **critérios verificáveis**, e não por julgamento caso a caso:

| Classe | Critério | Tratamento | Exemplo no SBP |
|---|---|---|---|
| **R0** | Só leitura, sem dado pessoal | Automático | Painel, aviso do dia |
| **R1** | Efeito reversível, local, sem dado sensível | Automático, com trilha e verificadores | Item aprovado automaticamente **numa categoria calibrada** |
| **R2** | Muda a carga de pessoas ou dado de associado | Verificador determinístico **e** humano confirma, ou amostragem auditada quando a calibração permitir | Confirmar distribuição; aprovar desdobramento |
| **R3** | Irreversível, externo ou muda regra ou permissão | Humano obrigatório, com confirmação no servidor | Encurtar prazo de retenção; enviar e-mail (futuro); mudar regra |

### A autonomia sobe por evidência, e o botão já existe

O **limiar de confiança por categoria** é, literalmente, o botão de autonomia por classe. A proposta para o piloto, **a decidir com o dono**:

1. **Primeira fase, modo sombra:** limiar 1,0 em todas as categorias. A IA sugere, e toda sugestão passa por uma pessoa. Custa revisão, mas revisar é mais rápido do que ler e classificar do zero, e **cada revisão vira gabarito** para medir a calibração real.
2. **Depois:** baixar o limiar **só na categoria** em que a taxa de erro medida entre os casos acima do limiar fique abaixo de um teto combinado, com amostra mínima declarada.
3. **Sempre:** amostragem aleatória de itens aprovados automaticamente, para a calibração não envelhecer sem ninguém ver.

Isso transforma "a IA ficou confiável" de opinião em número, e esse número é argumento para a empresa.

---

## 16. Segurança

| Mecanismo | Estado | Observação |
|---|---|---|
| Menor privilégio | Parcial | `Ator`, `exigirPapel`, operações fechadas; **C1** aberta |
| Autenticação e sessão | Presente | Senha com scrypt, bloqueio progressivo, `SESSAO_SECRET` obrigatório, revogação |
| Injeção de prompt | Forte | Truncar, detectar (com forma dobrada contra ofuscação), delimitar; sinal duplo; sem memória no prompt |
| Exfiltração | Forte por ausência | IA sem ferramenta; assistente sem dado; logs com redação recursiva |
| Segregação de contexto | Presente | Filtro por papel em código; cada tarefa só com o próprio material |
| Segredos | Presente | Ambiente, validados na partida; chaves de anexo e de busca com sentinela |
| Limites | Parcial | Por chamada e no assistente; **falta** teto diário de modelo |
| Corte automático | Parcial | Credencial recusada para o lote; **falta** corte por falhas seguidas |
| Loops | Não se aplica | Uma repetição só; invariante proposto para quando houver agente |
| Sandbox de código | Não se aplica | **Não criar execução de código por IA.** Nenhum problema do SBP pede isso. |
| Retenção e LGPD | Forte | `A17`, `A20`, `A23`; trilha sem dado pessoal |
| Classificação de dados por fornecedor | Parcial | Decidida em `A38`; não é regra de código ainda (C2) |
| Reversão | Parcial | Transações e versões; configuração ainda sem versão (C5) |

**A regra de segurança que mais importa para agentes futuros:** agente não ganha caminho próprio de escrita. Ele chama os **mesmos serviços** que uma pessoa, com o próprio `Ator`, e herda de graça transações, invariantes, papéis e trilha. Uma API paralela para agentes seria a porta dos fundos.

---

## 17. Estado, memória e o objeto de decisão

### Estado do sistema

| Informação | Tipo | Fonte de verdade |
|---|---|---|
| Itens, atribuições, execuções, escala, afastamentos, pessoas, habilitações | **Estado persistente** | Banco |
| Carga, crédito, painel, aviso do dia, fila de cada pessoa | **Derivado**, recalculado | Consulta sobre o estado; nunca digitado (invariante 4) |
| Rodadas, revisões, trilha, eventos | **Memória de decisão e histórico**, append-only | Banco |
| Notas do setor, feedbacks | **Memória aprendida**, arquivável | Banco |
| Conteúdo de e-mail, anexos, dados extraídos | **Temporário**, com prazo | Banco e disco, expurgados por regra |
| Cadastro do associado | **Consultado sob demanda** (futuro) | Sistema de cadastro da associação (`A22`), nunca duplicado |
| Contexto de uma chamada ao modelo | **Temporário**, descartado | Montado pelo Harness a cada chamada |
| Regras e parâmetros | **Configuração versionada** | Código e `DECISOES.md` hoje; tabela versionada quando houver ajuste pela tela |

Um "Current System State" como objeto único não é necessário. O estado atual **é** a consulta ao banco no momento da decisão, e o objeto de decisão registra **qual** estado foi lido.

### Memória: validade no tempo

- **Fato** tem instante e fonte; não expira, mas pode ser **superado** por fato posterior (a liga juntada aponta para a que ficou, `A31`).
- **Conhecimento derivado** (nota, regra marcada como observação) tem **data de revisão**; passado o prazo, aparece como "a confirmar", sem sumir.
- **Hipótese** nunca vira regra em silêncio: essa é a regra do `CLAUDE.md`, já em uso.
- **Nada da memória vai ao prompt** sem a decisão de `A37 (C)`.

### Objeto de decisão (§ 29)

**Avaliação da estrutura proposta:**

| Campo | Veredito |
|---|---|
| objetivo, ação proposta, resultado, proveniência | **Necessários** |
| estado atual | Necessário **como referência** (ids e versão), nunca como cópia |
| evidência | Necessária **como referência resolvível** |
| requisitos de validação e resultado das verificações | Necessários; é o que responde "qual regra autorizou" |
| permissões | Necessário **quem autorizou e por qual regra**; a lista de permissões é do Harness |
| resultado esperado e resultado observado | Necessários **para decisões de regra e de política**; excessivos por item |
| riscos, estimativa de custo | Classe de risco sim; custo **real** no registro de uso |
| premissas | Só para decisões de regra (`A33`) |
| **resumo do raciocínio** | **Não persistir como justificativa.** O texto que o modelo produz sobre o próprio raciocínio não é evidência, pode carregar dado pessoal e é a narrativa infalsificável da § 6. Persistir entradas, verificações e autorização. |
| plano de execução | Do grafo de execução, não da decisão |
| feedback | Ligado à decisão **por referência**, gravado depois |

**No SBP não é preciso uma tabela genérica `Decision`.** O padrão já existe e é melhor: **cada tipo de decisão com efeito tem o seu registro tipado** (`RodadaDistribuicao`, `Revisao`). Quando nascer uma decisão nova, nasce com o seu registro, seguindo o mesmo formato mínimo: quem ou o quê decidiu e em qual versão, sobre quais entradas, quais verificações passaram, quem autorizou, e o `correlacaoId`.

---

## 18. Invariantes

**Os 14 do `CLAUDE.md` continuam valendo integralmente.** Propostos para quando o primeiro componente cognitivo além dos dois atuais existir, e **a registrar só com aprovação do dono**:

1. **Saída de modelo é inferência.** Nunca é fonte de verdade sem verificador ou humano (reforça o 2).
2. **Confiança é sinal de roteamento, nunca de autoridade** (seção 10).
3. **Nenhum componente cognitivo escreve no estado.** Ele chama serviços do domínio com um `Ator` próprio, e herda transações, invariantes, papéis e trilha.
4. **Ator automático não tem papel humano.** Cada automação ou agente tem identidade própria e as operações mínimas.
5. **O verificado não controla o verificador:** não escreve os próprios verificadores, a própria avaliação, as próprias métricas nem as próprias permissões.
6. **Fluxo de controle é código.** O modelo não decide qual verificação roda nem se roda.
7. **Toda chamada a modelo é registrada** com tarefa, modelo, versão do prompt derivada por hash, tokens, latência e desfecho.
8. **Todo gasto tem teto.** Estourar para e avisa; nunca degrada em silêncio para um modelo não avaliado.
9. **Dado vai só a fornecedor autorizado para a classe dele.** A regra vence o roteamento.
10. **Todo laço tem parada e limite.** Profundidade de agente criando agente: zero.
11. **Mudança de prompt, modelo, limiar ou regra é versionada e avaliada antes de valer.** O sistema propõe; uma pessoa promove.
12. **Toda referência usada numa decisão resolve** para um registro existente, na versão lida.
13. **Execução reconfere a pré-condição.** Se o estado mudou desde a proposta, a execução recusa.
14. **Conteúdo suspeito vai para pessoa**, nunca para um modelo "mais forte".
15. **Omissão também é erro.** Entrada sem saída esperada é registrada e conferida.
16. **Narrativa descreve, nunca recalcula** (generaliza `A6`).

---

## 19. Política "simplicidade primeiro"

Toda capacidade nova responde, **por escrito, no PR ou na decisão**, na ordem, e para no primeiro "sim":

```text
1. Precisa existir?          Qual métrica ou feedback prova a necessidade?
2. Código determinístico resolve?
3. Precisa de IA?            Se sim: chamada única com saída validada resolve?
4. Precisa de agente?        Justificar o laço e as ferramentas.
5. Precisa de modelo grande? A avaliação mostra que o menor não passa?
6. Precisa sair da casa?     Que classe de dado vai, e para quem?
7. Precisa ser persistido?   Ou é derivável do que já está gravado?
8. Precisa de estrutura nova (tabela, port, grafo, serviço)?
                             Existe segunda implementação plausível ou leitor real hoje?
9. Onde mora?                Domínio (regra), Harness (política) ou Cognição (tarefa)?
```

O critério do item 8 já é regra do projeto: o `MemoriaPort` e a tabela genérica de memória foram recusados em 28/08 por não terem segunda implementação nem leitor. Vale igual para registro de agentes, tabela de decisão e roteador.

---

## 20. O princípio fundamental (§ 34)

**Avaliação:** tecnicamente sólido. É a formulação de "defesa em profundidade" aplicada a sistemas com modelo, e é a premissa certa. Tem três lacunas:

1. **Não cobre a omissão.** "Transformar-se em realidade" pensa no erro que age; o erro que **deixa de agir** (o pedido que some) é o mais caro neste domínio.
2. **Não cobre a mudança de regra.** Um erro pode não virar fato operacional e mesmo assim virar **regra**, se uma proposta de evolução for promovida sem avaliação.
3. **Não diz proporcional a quê.** Verificar tudo com o mesmo rigor inviabiliza o sistema; verificar pouco o que é grave é o risco.

**Reescrita proposta:**

> **Não precisamos de uma IA que nunca erre. Precisamos de uma arquitetura em que nenhuma saída de IA vire fato, ação ou regra sem uma verificação proporcional ao dano que causaria; em que o que a IA deixou de ver também seja conferido; e em que todo erro que passar deixe rastro suficiente para ser detectado, revertido e medido, por componentes que a própria IA não controla.**

**Sobre o princípio maior (§ 48), frase a frase:**

- *"O Cérebro deve ser o núcleo de inteligência"*: sim, **de inteligência**, não de controle. Acrescentar: e **não controla o fluxo de execução**.
- *"O Harness governa, contém e executa"*: sim, e **envolve a entrada** também, não só a saída.
- *"Agentes são especializações controladas"*: sim, como **configuração versionada**, não entidades criadas em tempo de execução.
- *"Grafos estruturam relações, estados e execução"*: separar os dois grafos (seção 14).
- *"A realidade é a fonte de verdade"*: sim, e a âncora técnica é o contrato de pré-condição, invariante e pós-condição.
- *"Verificadores podem contestar"*: sim, e **o verificado não os escreve**.
- *"Feedback confronta decisão com consequência"*: sim, com a ressalva de que numa equipe de 4 a 7 pessoas a medida é ruidosa. Não há como fazer teste A/B com cinco pessoas; a comparação é antes e depois, com resultado esperado escrito antes e cautela nas conclusões.
- *"Evolução sem evolução irrestrita"*: sim, com promoção sempre humana.
- *"Sem depender de um fornecedor"*: sim, e já provado no código.

---

## 21. Matriz de arquitetura

Estado atual pela classificação da § 39: **presente**, **parcial**, **ausente**, **incompatível**, **desconhecido**.

| Conceito | Estado atual | Importância | Risco se ignorado | Agora? | Implementação futura |
|---|---|---|---|---|---|
| Cérebro | Parcial: duas tarefas delimitadas (interpretar, explicar) | Alta no futuro | Baixo agora; alto se nascer controlando o fluxo | Não | Tarefas com contrato em arquivo; nunca dono do fluxo |
| Harness | Parcial: política comum da IA, rotas, papéis, esquemas | Crítica | Inteligência sem contenção | Sim, pequeno: uso, teto, verificadores | Runtime de tarefas e agentes com contrato |
| Tool Gateway | Parcial: serviços + operações fechadas; IA sem ferramenta | Alta quando houver agente | Porta dos fundos de escrita | Só o ator do sistema com papel próprio | Agente chama os mesmos serviços, com `Ator` próprio e lista de destinos |
| State | Presente: banco relacional | Crítica | — | Manter | PostgreSQL na implantação |
| Memory | Presente, com separação e retenção | Alta | Injeção persistente, dado pessoal eterno | Manter | Consulta por caso; nada ao prompt sem `A37 (C)` |
| Grounding | Parcial: assistente confere citações; extração não | Alta | Campo inventado aprovado | **Sim:** literalidade e CPF | Referências resolvíveis em toda decisão |
| Provenance | Parcial: modelo, versão do prompt, rodada, ator; falta hash, uso e correlação | Alta | Não saber por que algo aconteceu | **Sim:** hash do prompt, registro de uso | Correlação ponta a ponta |
| Validation | Presente para formato e distribuição; parcial para o sentido | Crítica | Execução correta, objetivo errado | Verificadores pós-IA | Previsão × realidade para regras |
| Deterministic Rules | **Presente e forte** | Crítica | — | Manter | Máquina de estados do item |
| Agents | Ausente (correto) | Futura | Complexidade sem valor | **Não** | Primeiro agente só com contrato, avaliação e aprovação |
| Agent Registry | Ausente (correto) | Baixa agora | — | **Não** | Arquivos versionados no Git |
| Agent Lifecycle | Ausente (correto) | Futura | — | **Não** | PR, CI com avaliação, merge, reversão |
| Graph | Parcial: fluxos em código; ciclo do item implícito | Média | Transições inconsistentes na fase 3 | **Sim:** tabela de transições do item | Fluxos versionados, se houver agentes com ramificação |
| Meta-Graph | Ausente; `A30` no papel | Futura | Autoevolução sem controle, se feito cedo | **Não** | Camada de avaliação e mudança, com humano |
| Model Router | Ausente; um fornecedor global por variável | Média | Custo ou privacidade errados | **Não** | Quando dois modelos passarem na avaliação, dentro da política de dados |
| Local Model | Ausente; fronteira pronta | Depende da decisão de privacidade | Dado externo sem aprovação | Não, salvo decisão da empresa | Um adapter, comparado pela avaliação |
| External APIs | Presente: Gemini, Anthropic | Alta | — | Manter | Camada paga para dado real (`A38`) |
| Cost Control | Parcial: tetos por chamada, limite do assistente | Alta | Gasto invisível | **Sim:** registro e teto diário | Orçamento por tarefa e agente; custo no painel |
| Feedback | Parcial: desfecho da revisão; `A21` decidido | Crítica para o piloto | Não provar valor nem saber o que melhorar | **Sim:** `A21` no piloto | Agrupamento, relatório (`A32`), escada (`A30`) |
| Observability | Parcial e forte: correlação, eventos, redação | Alta | "Por que fez isso?" sem resposta | Correlação até o 500 | Custo e desfecho por decisão |
| Human Approval | Presente: revisão, confirmações | Crítica | — | Modo sombra no piloto (a decidir) | Classes de risco R0–R3 formalizadas |
| Sandbox | Ausente: não há avaliação fixa | Alta como avaliação; nula como execução de código | Promover prompt ou modelo por palpite | **Sim:** conjunto de avaliação com gabarito | Avaliação no CI a cada mudança |
| Rollback | Parcial: transações, versões; configuração sem versão | Média | Mudança de regra sem volta | Não | Parâmetros versionados quando houver ajuste pela tela |

---

## 22. Fluxos concretos

### Fluxo 1: tarefa simples, e a correção do fluxo proposto

Proposto: `entrada → Cérebro → regra/código → resultado`.

**Correção:** tarefa de tipo conhecido **não passa pelo Cérebro**. Chamar um modelo para decidir que uma soma é uma soma é custo e risco. O roteamento de tarefa conhecida é estático, em código.

```text
Confirmar distribuição do dia
  operador ─► rota (Ator, papel) ─► motor puro ─► Σ == entrada? ─► commit ─► rodada gravada
                                                       │ não
                                                       └► aborta tudo (ConservacaoVioladaError)
```

### Fluxo 2: tarefa simples com modelo

```text
E-mail novo
  ingestão ─► Harness: truncar · detectar · delimitar · teto de orçamento?
          ─► modelo autorizado ─► esquema válido? ─(não)─► 1 repetição só por formato ─► falha ─► revisão
          ─► verificadores: campo literal? CPF confere? suspeito? desdobrou?
          ─► classe de risco ─► aprovado (categoria calibrada) | revisão humana
          ─► registro: modelo, versão (hash), tokens, latência, desfecho
```

### Fluxo 3: escalonamento

```text
modelo barato ─► esquema inválido após repetição, ou campo não encontrado no texto
  ─► classe do dado permite o modelo maior?
        ├ não ─► revisão humana
        └ sim ─► orçamento permite?
                   ├ não ─► para e avisa; item espera ou vai à revisão
                   └ sim ─► modelo maior ─► MESMOS verificadores ─► resultado
Nunca escala por confiança declarada. Nunca escala conteúdo suspeito: vai para pessoa.
```

### Fluxo 4: agente (futuro)

```text
gatilho ─► Harness carrega contrato vX ─► contexto mínimo ─► laço {
     modelo propõe chamada de ferramenta
     ─► gateway: operação permitida? escopo? classe de risco? orçamento?
     ─► serviço do domínio com Ator do agente ─► invariantes ─► resultado *inferido/calculado*
} até parada ou limite ─► verificação do resultado esperado ─► humano, se R2 ou R3 ─► trilha
```

### Fluxo 5: proposta rejeitada

```text
proposta ─► verificador determinístico falha (ex.: valor extraído não está no texto)
  ─► motivo estruturado (código e caminho do campo, SEM texto do modelo)
  ─► 1 revisão pelo modelo, se a falha for de formato ─► falhou de novo ─► humano
Nunca: laço de "tente de novo até passar". Isso treina o modelo a contornar o verificador.
```

### Fluxo 6: validação pelo resultado real

```text
Mudança de regra marcada como observação (A33). Ex.: lote de até 3 itens inteiro para uma pessoa
  antes: escrever métrica (itens por pessoa por categoria na semana), faixa esperada, data de revisão
  ─► vigência ─► período ─► medir ─► comparar com a faixa
  ─► dentro: confirma como regra (DECISOES) | fora: hipótese falhou, reverte ou ajusta (escada A30)
Cuidado: equipe pequena, sem grupo de controle; conclusões com cautela e amostra declarada.
```

### Fluxo 7: criação de agente (futuro)

```text
métrica ou feedback mostra necessidade ─► escada da seção 13 (regra? cálculo? ferramenta? tarefa única?)
  ─► todas "não" ─► contrato em arquivo (PR) ─► avaliação com gabarito no CI, sem dado real
  ─► nota ≥ mínima ─► revisão + decisão do dono ─► merge ─► ativo em autonomia "sugere"
  ─► monitorado ─► autonomia sobe por categoria de ação, com evidência
```

### Fluxo 8: evolução

```text
registro de uso + desfechos + feedbacks agrupados
  ─► diagnóstico (ex.: acerto de FICHA caiu de 94% para 81% com o modelo novo)
  ─► proposta (voltar o modelo, ou ajustar o prompt) ─► avaliação fixa: nova versão × atual
  ─► melhora sem piorar outra categoria? ─► aprovação humana ─► promoção
  ─► observação por período ─► confirma ou reverte
```

---

## 23. Fronteira do protótipo

### Implementar agora

Todos pequenos, cada um com valor direto para o piloto ou para evitar bloqueio futuro:

1. **Conjunto de avaliação com gabarito e nota automática** para a interpretação: e-mails sintéticos com resposta esperada (categoria, número de itens, campos, suspeita) e nota por modelo e versão de prompt. **Nada de e-mail real no conjunto** (invariantes 8 e 9).
2. **Registro de uso de modelo e teto diário**, com falha alta ao estourar.
3. **Verificadores pós-IA:** valor extraído precisa aparecer no texto normalizado; CPF com dígito inválido manda para a revisão com motivo próprio.
4. **Versão do prompt derivada por hash** das instruções e do esquema.
5. **Ator do sistema com papel próprio**, sem operações que decidem carga. Resposta ao `§ H.4` item 7, a confirmar com o dono.
6. **Máquina de estados do item** em `core/`, antes da fase 3.
7. **Correlação até a resposta de erro.**

### Deliberadamente NÃO implementar agora

- Cérebro como entidade ou orquestrador por modelo.
- Framework de agentes ou de grafos.
- Qualquer agente, registro de agentes, ciclo de vida em banco.
- Meta-grafo ou qualquer autoevolução em tempo de execução.
- Agente criando agente.
- Modelo crítico, segundo modelo validador.
- Roteador dinâmico (só com dois modelos aprovados na avaliação).
- Modelo local em produção (só experimento pela avaliação, se houver máquina e decisão).
- Memória, notas ou feedbacks no prompt (`A37 (C)`).
- Tabela genérica de decisão, estado ou memória.
- Busca vetorial ou RAG sobre dados operacionais.
- Execução de código por IA.
- Barramento de eventos.

---

## 24. Próximo passo recomendado

**A empresa não aprova arquitetura; aprova resultado medido.** Então a sequência tem dois trilhos que andam juntos: o trilho **produto** leva a equipe a usar e mede o valor, e o trilho **fundação** é pequeno e deixa a arquitetura na direção certa sem atrasar o primeiro.

**Trilho produto** (o que convence):

1. Mesclar o PR #44 (decisão do dono).
2. Implantação mínima para a equipe usar: leitura real do Outlook, banco PostgreSQL, publicação na rede ou na nuvem, IA em camada paga ou local conforme a decisão de privacidade.
3. Feedback em toda tela (`A21`), com situação visível para quem escreveu.
4. **Medida de antes e depois**, escolhida antes de começar: tempo para distribuir o dia (hoje 30–45 min, meta ≤ 5), dias com soma certa (hoje 71%, meta 100%), digitações eliminadas, itens parados há mais de N dias, acerto da IA por categoria e tempo de revisão.
5. Piloto em modo sombra, se o dono aprovar, baixando o limiar por categoria conforme a calibração medida.

**Trilho fundação** (antes ou junto do piloto, na ordem):

1. Conjunto de avaliação com gabarito (item 1 da seção 23): destrava o resto.
2. Registro de uso e teto diário, junto com a versão do prompt por hash.
3. Verificadores de literalidade e CPF.
4. Ator do sistema com papel próprio (depende da resposta do dono).
5. Máquina de estados do item (antes da fase 3).
6. Correlação até o 500.

Nada disso muda `core/distribuicao`, a conservação, a retenção ou as telas que já funcionam.

### Perguntas para o dono antes de implementar

1. **Privacidade:** a empresa vai aceitar dado de associado indo a um fornecedor externo em camada paga, ou isso precisa ficar dentro da associação? A resposta decide se o modelo local é opção ou condição.
2. **Máquina:** a associação tem servidor próprio, ou prefere nuvem? Existe máquina com GPU?
3. **Piloto em modo sombra:** aceita que, na primeira fase, toda sugestão da IA passe por uma pessoa, para medir o acerto real antes de soltar a aprovação automática?
4. **`§ H.4` item 7:** o ator automático passa a ter papel próprio (`sistema`), sem confirmar distribuição nem aprovar revisões?
5. **Registrar os invariantes da seção 18** no `CLAUDE.md` agora, ou só quando existir o primeiro componente cognitivo novo?
