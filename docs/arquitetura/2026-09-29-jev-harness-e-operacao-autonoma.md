# Jev, Harness e operação autônoma: investigação

*29/09/2026. Análise feita antes de qualquer código, como o dono pediu. Responde a dois pedidos dele recebidos juntos: (I) "explorar todo o potencial do Jev dentro do SBP" e (II) "Autonomous Operations + SBP Control Center". O segundo foi pensado para depois do primeiro. O documento segue essa ordem porque a Parte II depende da Parte I.*

**Base desta análise.** Li o código, e não só os documentos:
- `ports/` (classificador, IA, consumo);
- `adapters/`: fábrica, `classificador-externo.ts`, `classificador-typesafe.ts`, `ia-estruturada.ts`, `ia-local.ts`, `cliente-com-consumo.ts`;
- `servicos/`: `ingestao.ts`, `segunda-opiniao.ts`, `qualidade.ts`, `avaliacao-da-ia.ts`, `rotinas.ts`, `painel.ts`;
- `core/`: `ia/concordancia.ts`, `ia/consumo.ts`, `qualidade-ia.ts`, `avaliacao/`, `seguranca/protecao-para-fornecedor-externo.ts`;
- `servidor/`: `ator.ts`, `observabilidade.ts`;
- o `schema.prisma` (trilha, uso da IA, rotinas, revisão);
- `PROCESSO.md` e `scripts/processo/nivel-de-risco.ts`;
- os workflows do CI;
- as decisões `A14`, `A21`, `A26`, `A30`, `A32`, `A33`, `A38`, `A49` a `A63`, `§ H.4` itens 7, 29 a 36;
- `DIRECAO.md` e as duas análises anteriores em `docs/arquitetura/`.

Cada afirmação sobre o código traz o arquivo. O que **não** foi conferido ou medido está escrito assim.

**O que não foi possível medir, e por quê.** Tentei chamar `api.typesafe.ai` e `docs.typesafe.ai` desta sessão em 29/09: **403 no túnel da rede da nuvem**, igual a 26/09. Não há chave (`A63`). Portanto **nenhum número de latência, throughput, preço ou acerto do Jev existe**. Onde este documento fala do Jev, fala de *desenho e de hipótese a medir*, nunca de resultado. Os números da IA local vêm do `A59` (medidos pela sessão da máquina Debian, não por esta).

---

## 0. Resumo executivo — o que a investigação concluiu

1. **A hipótese central do dono está certa na direção e precisa de uma correção de forma.** "Jev como camada cognitiva probabilística, rápida e barata, sob um Harness determinístico" é o desenho certo. O que precisa mudar é o *diagrama*. O Data Guard não fica na frente de toda a camada cognitiva: ele é o portão **de cada fornecedor externo**. E o Harness não fica só embaixo dos sinais: ele **envolve** a camada cognitiva dos dois lados. Antes, escolhe que pergunta fazer, a quem e com que dado. Depois, decide o que fazer com a resposta. Seção I.D.

2. **O SBP já tem um Harness, espalhado em seis lugares.** Não é preciso criar outro:
   - `decidirRevisao` (`servicos/ingestao.ts:1018`);
   - a política de consumo (`core/ia/consumo.ts`);
   - a política de interpretação (`adapters/ia-estruturada.ts`);
   - as paradas da segunda opinião (`servicos/segunda-opiniao.ts`);
   - as travas de dado real (`servidor/ambiente.ts`);
   - o nível de risco do processo (`scripts/processo/nivel-de-risco.ts`).

   A proposta é **juntar a parte que decide** numa função pura versionada (`core/harness/`), sem framework e sem mudar comportamento no primeiro passo.

3. **Regra de ouro proposta, e a mais importante deste documento: sinal probabilístico só aumenta o cuidado, até ser calibrado.** Um sinal do Jev ou da IA pode mandar um item para mais verificação ou para uma pessoa. Ele **não pode poupar** verificação ou revisão sem três coisas: calibração medida, decisão do dono por categoria e uma amostra de conferência contínua.

   Isso resolve de uma vez três preocupações do pedido:
   - **concordância ≠ verdade:** concordar não dispensa nada;
   - **erro correlacionado:** o pior caso é o de hoje, nunca pior;
   - **injeção de prompt:** enganar o Jev não abre porta nenhuma, só fecha.

4. **Três premissas do pedido não se sustentam hoje, e é melhor dizer:**
   - **"A IA local é barata e rápida."** Ela é barata em dinheiro e **lenta**. Na máquina Debian, cada chamada do 3B leva ~90 s, e o 1.5B é ~2× mais rápido (`A59`); o `A59` não traz o tempo por caso do 1.5B, e a medição com relógio é a primeira coisa a pedir à máquina. A ingestão é **síncrona, dentro da requisição HTTP** de quem clica "sincronizar" (`app/api/ingestao/route.ts`). Com a IA local, uma sincronização de dezenas de e-mails vira uma requisição de dezenas de minutos. É o gargalo real, e vem antes de qualquer otimização com o Jev (seção I.J).
   - **"IA paga como fallback."** Ela não existe hoje (`A63`), e dado real só vai a camada paga sem treino (`A38`). Enquanto isso valer, **o degrau acima da IA local é o humano**. O desenho reserva o degrau da IA paga, mas não o constrói.
   - **"Jev valida a extração de CPF, matrícula, CRM."** Não consegue, por desenho: a camada de defesa **tira esses números do texto antes** de ele sair (`core/seguranca/protecao-para-fornecedor-externo.ts`). E nem precisa, porque conferir identificador é trabalho de código (dígito verificador, presença literal no texto). O Jev só agrega em perguntas **semânticas**: categoria, segmentação ("quantas pessoas pedem?"), papel de um nome ("é quem pede ou um terceiro?"), suspeita.

5. **O maior ganho de confiabilidade disponível hoje não é o Jev. É código, e custa zero.** Dois sinais determinísticos derrubam a maior fraqueza medida da IA local (literalidade 0,69, `A59`):
   - conferir que cada valor extraído aparece no texto (pendência 17);
   - mandar para revisão o CPF com dígito verificador errado (lacuna 4 da análise de 14/09, ainda aberta).

   Os dois vêm antes de qualquer uso do Jev no fluxo.

6. **Onde o Jev tem valor provável, em ordem:**
   - **(a)** categoria e suspeita: já em modo sombra;
   - **(b)** **"quantas pessoas/pedidos há neste e-mail?"**, contra a quantidade de itens que a IA local devolveu. Ataca exatamente a falha medida do 1.5B, que junta três ligantes num item só (`A59`);
   - **(c)** "este e-mail pede alguma ação?", para não gastar ~45 s de máquina com resposta automática;
   - **(d)** assistente escolhendo o verbete do manual em vez de gerar texto.

   Onde **não** tem valor: distribuição, métrica, painel, regra de negócio, identificadores, detecção de anomalia operacional (estatística simples faz melhor) e qualquer decisão sobre pessoa (invariante 10).

7. **Calibração é pré-requisito, e o gabarito atual não a sustenta.** São 17 casos, com respostas escritas pelo agente e não conferidas pela equipe (`§ H.4` item 31). Com 17 casos, o intervalo de confiança de uma taxa de 0,76 vai de ~0,53 a ~0,90. Não dá para escolher limiar nenhum com isso. É preciso um gabarito maior, com respostas conferidas por gente, e **ligar a opinião do modo sombra ao desfecho da revisão humana**. Hoje as duas coisas existem no banco e ninguém as cruza.

8. **Parte II — a autonomia precisa de dois planos separados, e a separação é estrutural, não de política.**
   - **Plano de operação:** o servidor do SBP observa, detecta, abre ocorrência, aplica só contenção **pré-autorizada que desliga** coisas e avisa.
   - **Plano de evolução:** mudança de código passa por Git, PR, CI, o portão do `PROCESSO.md` e aprovação. Quem executa é um agente de desenvolvimento (uma rotina do Claude Code), **nunca o servidor de produção**.

   O servidor não tem credencial para escrever no próprio repositório nem para mudar a própria política. É isso, e não uma regra escrita, que impede o laço de autoalteração.

9. **Parte II — conflitos com decisões em vigor que o dono precisa resolver antes de construir:**
   - o assistente administrativo "executando" coisas colide com o **invariante 13**;
   - a memória de evolução alimentando o modelo toca o **invariante 12**;
   - notificação fora do sistema exige capacidade de envio que o `A5` recusou;
   - o agente automático não pode existir antes do `§ H.4` item 7, porque `ATOR_SISTEMA` ainda tem papel `operador` (`servidor/ator.ts:58`).

   Nada disso bloqueia as primeiras fases.

10. **Rota escolhida:** medir e consolidar primeiro, grátis e determinístico; o Jev no fluxo só depois de medido; a operação autônoma começa **lendo** (saúde, ocorrências, relatório) e só depois **propõe**. A ordem está na Parte III, e as decisões que só o dono pode tomar estão no `§ H.4`, itens 37 a 46.

---

# PARTE I — O Jev na camada cognitiva do SBP

## I.A. Estado atual — como o Jev funciona hoje

### O fluxo real de um e-mail (conferido no código)

```text
IngestaoPort (Graph só-leitura | mock)
  → sincronizar()                                   servicos/ingestao.ts:278 — dentro do POST /api/ingestao
    → para cada e-mail, EM SÉRIE:
      1. AiPort.interpretar(email)                  IA atual (mock | gemini | anthropic | local)
           trunca → detecta → delimita (3 camadas)   adapters/ia-estruturada.ts
           1 repetição só por erro de forma; Zod na volta
           teto diário + disjuntor                   adapters/cliente-com-consumo.ts, core/ia/consumo.ts
      2. colherSegundaOpiniao()  [se CLASSIFICADOR_ADAPTER ≠ nenhum]
           texto = assunto + corpo + nomes de anexo
           ClassificadorExterno: detecta no ORIGINAL → Data Guard → delimita → 1 chamada com 2 perguntas
           confere coerência das probabilidades; copia só o que foi perguntado
           para no lote por: credencial, teto, disjuntor, 3 falhas seguidas, 60 s somados
      3. anexos: allowlist + assinatura dos bytes
      4. TRANSAÇÃO:
           Email, EmailConteudo, Itens
           decidirRevisao(confiança, limiar, campoAusente, suspeito, anexoRecusado, desdobramento)
           evento `segunda_opiniao` (só códigos e números)          ← MODO SOMBRA: nada muda no fluxo
```

### O que o Jev é, pelo que foi possível conferir (`A62`)

- Não gera texto. Recebe um texto (`state`) e perguntas fechadas de três tipos:
  - sim/não (`noul`);
  - escolha entre rótulos (`choice`);
  - nota numa escala (`score`).
- Devolve probabilidades e uma `confianca` cujo significado **não está confirmado**.
- Várias perguntas vão **numa chamada só** (`classificador-typesafe.ts`: `questions` é um mapa). Perguntar mais coisas custa tokens de instrução, não idas e voltas.
- Modelo padrão `jev-latest`. **É um apelido**: o fornecedor pode trocar o modelo por baixo sem que nada mude do nosso lado. Achado desta investigação, ver I.I.

### Proteções que já existem em volta dele

| Proteção | Onde |
|---|---|
| Pergunta é constante do código, congelada, com versão (`ingestao-1`) e hash fixado em teste | `servicos/segunda-opiniao.ts` |
| Só `segunda-opiniao.ts` chama `classificar(`, por varredura de texto (frágil: pendência 35) | `segunda-opiniao.test.ts` |
| Data Guard: link, e-mail, número de conselho/matrícula, 5+ dígitos, data completa, valor longo, base64; corte em 4000 | `core/seguranca/protecao-para-fornecedor-externo.ts`, `AT-49` |
| Detecção de injeção no texto original, que vira o sinal `suspeito` | `classificador-externo.ts` |
| Resposta conferida: todas as perguntas, tipo, rótulos exatos, soma ≈ 1, escolha = a mais provável, nota = a esperada | `classificador-externo.ts` |
| Endereço fixo, sem redirecionamento, sem repetição, 10 s, 256 KB | `classificador-typesafe.ts` |
| Mesmo teto diário e disjuntor da IA, tarefa `classificacao` | `fabrica.ts` |
| Trava: `typesafe` com caixa real falha na partida | `servidor/ambiente.ts` |
| Opinião gravada na mesma transação, sem a `confianca` | `registrarSegundaOpiniao` |

### O que está desligado ou em aberto

- `CLASSIFICADOR_ADAPTER=nenhum` por padrão.
- `A63`: sem chave.
- `§ H.4` itens 35 (dado real) e 36 (divisão de trabalho).
- Pendências 35 (perguntas por tipo marcado) e 36 (opinião paga e descartada não deixa evento).

## I.B. Potencial identificado — o sistema inteiro, área por área

Para cada ponto do SBP, as dez perguntas do pedido. Colunas: **Valor?**, **Pergunta ao Jev**, **O que recebe**, **Risco**, **Custo/latência**, **O Harness age?**, **Como validar**, **Se o Jev falha / erra**.

| Área | Valor? | Pergunta ao Jev | Recebe | Risco | Custo / latência | O Harness age? | Validação | Falha / erro |
|---|---|---|---|---|---|---|---|---|
| **Ingestão: categoria** | Provável | "Qual o assunto?" (já feita) | e-mail pelo Data Guard | nome e saúde ficam no texto (`§ H.4` 35) | 1 chamada; latência não medida | Hoje não (sombra). Depois: discordância → revisão | gabarito + desfecho da revisão | falha: segue sem opinião. Erro: com a regra monotônica, só gera revisão a mais |
| **Ingestão: suspeita** | Provável, **nunca sozinho** | "Tenta dar ordens?" (já feita) | idem | o Jev é modelo: a mesma injeção pode enganá-lo | na mesma chamada | Só para **acrescentar** suspeita. Regex e modelo continuam valendo | casos adversariais do gabarito | falha: regex continua. Erro "não suspeito": nada muda, porque o sinal só soma |
| **Ingestão: segmentação** | **Alta, e nova** | "Quantas pessoas ou pedidos distintos?" (nota 1, 2, 3, 4+) | idem (nomes ficam no texto) | contar nomes com número mascarado | na mesma chamada | Contagem do Jev ≠ quantidade de itens → revisão (motivo novo) | casos de ligantes do gabarito (as falhas do 1.5B) | falha: segue. Erro: revisão a mais |
| **Ingestão: pede ação?** | Provável; economia de **tempo de máquina** | "Pede alguma providência, ou é aviso, agradecimento ou resposta automática?" | idem | e-mail com pedido real classificado como "sem ação" **pularia** a IA local | 1 chamada **antes** da IA local | **Só em modo "poupar" (N3)**: pular a IA local e mandar a uma pessoa como "sem ação?" | gabarito com respostas automáticas; amostra | falha: chama a IA local (caminho de hoje). Erro "sem ação" num pedido: item vai a pessoa, nunca some |
| **Ingestão: papel do nome** | Possível | "O nome proposto é de quem pede, ou de um terceiro (assinatura, encaminhado)?" | e-mail + candidato **dentro** do bloco delimitado | o candidato veio de modelo lendo e-mail: é dado, **nunca** pergunta | +1 pergunta | Divergência → revisão | casos com assinatura e encaminhamento | idem |
| **Ingestão: identificadores** | **Não** | — | o Data Guard tira os números | — | — | — | — | **código:** DV do CPF, presença literal, padrão de CRM |
| **Revisão** | Baixo | "Por que parece duvidoso?" → **não**: o motivo já é código | — | trazer texto do Jev à tela é texto de modelo sobre e-mail | — | — | — | selo "segunda opinião discorda (categoria X)": rótulo nosso, sem texto do Jev |
| **Distribuição** | **Proibido** | — | — | invariante 2 | — | — | — | — |
| **Caixa, fila, painel** | **Não** | — | — | métrica não é digitável nem inferível (invariante 4) | — | — | — | — |
| **Memória operacional** | **Não** | — | — | invariante 12 | — | — | — | — |
| **Assistente** | **Alto, com trava própria** | "Qual destes verbetes responde à pergunta?" (`escolha` entre ids do manual já filtrado por papel) | pergunta de quem está logado, pelo Data Guard | a pergunta real traz e-mail colado: dado real ao Jev. Precisa de trava própria (ESTADO, anotação do #142) | 1 chamada; troca geração por escolha | Mostra o **texto do manual** do verbete escolhido; baixa probabilidade → "não sei" | perguntas-modelo por papel | falha: a busca atual (`assistente-busca.ts`). Erro: verbete errado, **nunca texto inventado** |
| **Gabarito** | Alto | as mesmas perguntas da ingestão | casos sintéticos | nenhum (sintético) | N chamadas por rodada | não é fluxo | é a própria validação | — |
| **Segurança: anomalia** | **Não** | — | — | contagens e taxas são estatística simples | — | — | — | código: limiar sobre contagem (`AT-45`) |
| **Priorização** | **Não** | — | — | `A7`: prioridade é idade, regra explícita | — | — | — | — |
| **Feedback da equipe** (`A21`, `A32`) | Baixo agora | "Qual tela ou tema?" | feedback pelo Data Guard | o texto pode citar colega ou associado; o `A32` disse sem IA externa | — | — | — | agrupamento por tela e tema escolhido por quem escreve (código) |
| **Operação autônoma** (Parte II) | Baixo | "Qual hipótese é mais provável?" | números e códigos | hipótese de modelo virando causa sem evidência | — | Nunca decide. Pode ordenar hipóteses para humano ler | — | — |

**Leitura honesta da tabela:** o Jev tem lugar em **quatro perguntas da ingestão e numa do assistente**. Em todo o resto, a resposta certa é código, gente ou nada. Isso não é pouco. As quatro perguntas atacam as duas falhas medidas da IA local:
- **segmentação** (ligantes juntados);
- **latência** (chamada desnecessária).

## I.C. Matriz de capacidades

Legenda:
- ✅ **medido** no SBP;
- ◐ **plausível, não medido**;
- ○ **fraco ou medido ruim**;
- ✗ **inadequado**;
- ⛔ **proibido** por invariante ou decisão.

**Nenhuma célula do Jev é ✅:** nada dele foi medido (`A63`).

| Tarefa | Código | Jev | IA local (qwen2.5 1.5B) | IA paga | Humano | Estratégia |
|---|---|---|---|---|---|---|
| Categoria do pedido | ○ palavras-chave frágeis | ◐ pergunta nativa | ✅ gabarito, dentro da nota 0,76 (`A59`) | ◐ (Gemini medido em 07/09 com 4 e-mails) | ✅ revisão | IA local propõe; Jev opina em sombra → discordância manda à revisão (N2) depois de medido |
| Segmentação (quantos itens) | ◐ contar linhas de lista | ◐ pergunta de nota | ○ **falha medida** em ligantes (`A59`) | ◐ | ✅ desdobramento sempre revisado | código + Jev contam; quantidade diferente → revisão |
| Extrair identificador (CPF, CRM, matrícula, e-mail, telefone) | ✅ padrão + DV (`core/chave-de-busca.ts`) | ✗ o Data Guard remove | ○ literalidade 0,69 | ◐ | ✅ | **código extrai e confere**; a IA só diz *de quem* é |
| Extrair nome e liga | ✗ | ✗ não extrai | ○ reescreve | ◐ | ✅ | IA local extrai; **código confere a presença literal**; Jev pode conferir o papel (terceiro?) |
| Validar valor extraído | ✅ literal, DV, faixa | ◐ só semântico | ✗ não se autovalida | ◐ crítico caro | ✅ | código primeiro; Jev só para papel ou semântica |
| Ambiguidade | ✗ | ◐ probabilidade espalhada é sinal natural | ○ confiança autodeclarada, não calibrada | ◐ | ✅ | entropia das probabilidades do Jev como sinal de **mais** cuidado |
| Suspeita / injeção | ✅ regex no original | ◐ vulnerável à mesma injeção | ◐ `modelo_sinalizou` | ◐ | ✅ | qualquer sinal → pessoa. Nenhum sinal **tira** a suspeita |
| Roteamento de recurso | ✅ tabela de política | ◐ só fornece sinal | ✗ | ✗ | define a política | **o Harness decide pela tabela**; o Jev é uma coluna de entrada |
| Interpretação livre | ✗ | ✗ | ○ | ◐ | ✅ | IA + verificadores + revisão |
| Geração de texto (título, narrativa) | ✅ narrativa da rodada é código (`A6`) | ✗ não gera | ○ | ◐ | ✅ | título da IA, sempre conferido; narrativa continua código |
| Regra de negócio (distribuição, crédito) | ✅ motor puro, conservação na transação | ⛔ | ⛔ | ⛔ | define a regra | só código (invariante 2) |
| Explicar o sistema | ✅ busca por verbete | ◐ escolha de verbete | ○ gera texto | ◐ | — | Jev escolhe, o código mostra o texto do manual |
| Anomalia operacional | ✅ contagem, taxa, limiar | ✗ | ✗ | ✗ | interpreta | código (Parte II) |

## I.D. Arquitetura proposta

### Correção do diagrama do pedido

O pedido desenha `DADOS → DATA GUARD → CAMADA COGNITIVA → HARNESS → REGRAS → ESTADO → HUMANO`. Três ajustes, cada um com motivo no código:

1. **O Data Guard é por destino, não por camada.** A IA local roda dentro da associação e recebe o texto cru: é o que o `A52` decidiu ("não vale para modelo local, onde o dado não sai"). Mascarar para ela só tiraria dela o que ela precisa extrair. O Data Guard é o portão de **todo fornecedor externo**, qualquer que seja: Jev, Gemini, Anthropic, o próximo.
2. **O Harness vem antes e depois.** Antes, decide *que* pergunta, *a quem*, com *que* dado. Depois, decide *o que fazer* com os sinais. É o que a análise de 14/09 (seção 1, problema 2) já pedia, e é o que o código já faz em miniatura.
3. **Código determinístico também vem antes da IA, não só depois.** Extrair o que é extraível por padrão (CPF, e-mail, telefone, CRM, datas, valores) é mais barato, exato e auditável. A IA recebe o problema **menor**.

### O desenho

```text
 E-MAIL / PERGUNTA / MÉTRICA            (todo dado de fora é NÃO CONFIÁVEL)
            │
            ▼
 ┌─ PORTÃO DE ENTRADA (código) ───────────────────────────────────────────────┐
 │  truncar → detectar → delimitar (invariante 6); classe do dado: real/sintético│
 └────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
 ┌─ PRÉ-EXTRAÇÃO DETERMINÍSTICA (código) ─────────────────────────────────────┐
 │  CPF + DV, e-mail, telefone, CRM/matrícula, datas, valores, lista numerada   │
 └────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
 ┌─ HARNESS · antes (core/harness, função pura) ──────────────────────────────┐
 │  tarefa × classe do dado × política versionada → QUAIS chamadas, A QUEM      │
 │  orçamento: chamadas, tempo, dinheiro; parada; no máximo 1 escalonamento     │
 └────────────────────────────────────────────────────────────────────────────┘
      │                     │                              │
      ▼                     ▼                              ▼
  IA LOCAL             DATA GUARD ─► JEV              DATA GUARD ─► IA PAGA
  (interpreta,         (perguntas fechadas,           (reservado: A63, A38)
   segmenta, nomeia)    em paralelo com a IA local)
      │                     │                              │
      └──────────┬──────────┴──────────────────────────────┘
                 ▼
       SINAIS TIPADOS: fonte · natureza (observado | calculado | inferido | declarado)
                       · valor · versão de quem produziu
                 │
                 ▼
 ┌─ VERIFICADORES DETERMINÍSTICOS (código) ───────────────────────────────────┐
 │  esquema (Zod) · literalidade · DV · contagem × segmentação · limites        │
 └────────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
 ┌─ HARNESS · depois ─────────────────────────────────────────────────────────┐
 │  tabela de política → destino + MOTIVOS em código + versão da política      │
 │  aprovado │ revisão(motivo) │ desistir (Outlook) │ escalar 1 degrau          │
 │  REGRA MONOTÔNICA: sinal inferido só sobe o cuidado, até ser calibrado       │
 └────────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
  ESTADO (transação: invariantes 3 e 14; evento com a impressão das versões)
                 │
                 ▼
  HUMANO (Revisão) ─► desfecho = verdade de campo ─► calibração ─► o DONO muda a política
```

### O que é novo nesse desenho e o que já existe

| Peça | Existe? | O que falta |
|---|---|---|
| Portão de entrada | ✅ `conteudo-nao-confiavel.ts` | — |
| Pré-extração determinística | ◐ só CPF, para a chave de busca | extrair e **comparar** com a IA |
| Harness antes | ◐ espalhado (`fabrica.ts`, `ambiente.ts`, paradas) | juntar a escolha de chamadas numa tabela |
| Jev em paralelo | ✗ hoje é em série, depois da IA | `Promise.all` no modo sombra (I.J) |
| Sinais tipados | ✗ | um tipo em `core/harness/` |
| Verificadores | ◐ esquema sim; literalidade e DV não | pendência 17, lacuna 4 |
| Harness depois | ◐ `decidirRevisao` | mover para `core/`, com motivos e versão |
| Regra monotônica | ✗ (implícita: o Jev não age) | escrita como invariante e testada |
| Desfecho → calibração | ◐ `qualidade-ia.ts` (médias) | faixas de calibração; cruzar com a opinião do Jev |

## I.E. O papel do Harness

**Definição:** o Harness é a função determinística, versionada e testada que recebe **sinais** e **política** e devolve **decisão + motivos**. Não é IA, não é serviço, não é framework. É código puro em `core/harness/`, chamado pelos serviços.

### Responsabilidades

| Responsabilidade | Hoje | Proposta |
|---|---|---|
| Quais recursos chamar para uma tarefa | `IA_ADAPTER` global (`fabrica.ts`) | tabela `tarefa → recursos autorizados`, filtrada pela classe do dado |
| Que dado pode sair | travas `IA_PARA_DADO_REAL`, `CLASSIFICADOR_PARA_DADO_REAL`; Data Guard | idem; a trava é consultada pelo Harness, não só na partida |
| Que pergunta fazer | constantes em `segunda-opiniao.ts` | conjunto de perguntas marcado por tipo (pendência 35) |
| Limites | teto diário, disjuntor, 60 s por lote, 3 falhas | idem, mais **orçamento por e-mail** (chamadas, escalonamentos) |
| Quando a resposta basta | `decidirRevisao` | tabela de política, com motivos e versão |
| Conflito | não existe (sombra) | discordância → revisão com motivo próprio (N2) |
| Fallback | "desistir" depois de 3 tentativas (`AT-41`) | escada de um degrau (I.H) |
| Revisão humana | gatilhos fixos | gatilhos fixos + sinais inferidos (só para subir) |
| Recusar decisão | Zod, `FalhaDeInterpretacao` | idem |
| Quando o sinal pode influenciar | nunca (sombra) | por **nível de autonomia por tarefa e categoria** (I.F) |

### Limites: o que o Harness nunca faz

- **Não muda a si mesmo.** A política é constante no código, com versão e hash fixado em teste, como as perguntas e o prompt já são. Mudar é PR de nível 3.
- **Não lê texto de modelo como instrução.** Só lê sinais tipados: número, rótulo nosso, booleano.
- **Não decide a distribuição.** Ela é do motor (invariante 2). O Harness decide o **caminho da interpretação**, não quem recebe.
- **Não esconde a decisão.** Todo destino sai com os motivos em código e a versão da política, gravados na mesma transação do fato (invariante 14).
- **Não degrada em silêncio.** Recurso indisponível vira motivo gravado (`classificador_indisponivel`), nunca "segue como se nada fosse" sem rastro (invariante 7).

### Por que não "votos" (seção 4 do pedido)

A decisão não é contagem de concordâncias. É uma **tabela ordenada de regras**, na qual cada sinal tem um **papel** fixado pela natureza dele:

| Natureza do sinal | Exemplo | Pode aprovar? | Pode mandar para revisão? |
|---|---|---|---|
| **Calculado** (código sobre o texto) | DV do CPF errado; valor não está no texto | — | **Sim, sempre** |
| **Observado** (fato registrado) | anexo recusado; desdobramento | — | **Sim, sempre** |
| **Inferido e calibrado** | probabilidade do Jev numa categoria com calibração medida e aprovada | **Só em N3**, com amostra de conferência | Sim |
| **Inferido e não calibrado** | a `confianca` da IA hoje; o Jev hoje | **Não** | Sim |
| **Declarado por humano** | revisão | Sim | — |

É por isso que **"dois modelos concordaram" não aprova nada**: concordância entre inferidos não calibrados continua sendo inferida e não calibrada. E **"o Jev discordou" não diz que o Jev está certo**: diz só que o caso vai para quem pode dizer.

## I.F. Modelo de roteamento e níveis de autonomia

### A escada de minimização (seção 34 do segundo pedido)

Formalizada, em ordem. Cada degrau é **restrição**, não preferência:

1. **Dá para decidir por código?** Então é código, e nenhuma IA é chamada. Exemplos: CPF, conservação, prioridade por idade, contagem de anomalia.
2. **A classe do dado permite qual recurso?** Dado real: IA local só com a trava do dono (`A56 (e)`); Jev só com o `§ H.4` 35; IA paga só com os termos do `A38`. Esta regra vence todas as outras.
3. **Qual recurso autorizado passou na avaliação desta tarefa?** Sem avaliação, não entra no caminho de decisão; no máximo em sombra.
4. **Entre esses, o de menor custo total**: dinheiro, mais tempo de máquina, mais o custo esperado de revisão e de erro (I.K).
5. **Escalar só por sinal determinístico de falha**: esquema inválido depois da repetição, valor fora do texto, contagem divergente. **Nunca** pela confiança autodeclarada, e **nunca** por suspeita. Suspeita vai para pessoa, não para modelo maior (análise de 14/09, seção 12).
6. **Orçamento estourado → parar e dizer.** Nunca cair em silêncio para um recurso não avaliado.

### A tabela de roteamento — hoje e proposta

| Situação | Hoje | Proposto (depois de medido) |
|---|---|---|
| Campo identificador | a IA extrai; ninguém confere | **código** extrai e confere; divergência → revisão |
| E-mail comum, dado real | IA local (quando a trava abrir) | IA local ‖ Jev em paralelo (sombra) → verificadores → Harness |
| Lista de ligantes | IA local; desdobramento sempre revisado | idem, mais a contagem do Jev e do código como motivo explícito |
| Resposta automática ou agradecimento | IA local (~45 s) | Jev "sem ação" com probabilidade calibrada → pessoa confirma "sem ação" (**N3**, só se medido) |
| Falha de forma depois da repetição | desiste depois de 3 sincronizações | idem; com a IA paga autorizada, **um** degrau para ela antes de desistir |
| Suspeito | pessoa | pessoa (sem mudança; nenhum modelo "tira" suspeita) |
| Discordância IA × Jev | sombra | revisão com motivo `segunda_opiniao_discorda` (**N2**) |
| Recurso fora | sem opinião / lote para | idem, com motivo gravado |

### O Jev como "router de modelos" (seção 10 do pedido): onde a hipótese erra

O pedido imagina o Jev classificando a tarefa como "simples → IA local, complexa → IA paga". Três problemas:

1. **Não há para onde rotear.** Com o `A63`, os recursos disponíveis com dado real são a IA local e o humano. Um roteador com uma saída só é enfeite.
2. **"Complexidade" não é observável antes da extração.** O que se mede **depois** é melhor: esquema, literalidade, contagem. O próprio fracasso determinístico da IA local é o melhor sinal de "precisava de mais". Rotear *antes* pelo palpite do Jev troca um sinal medido por um inferido.
3. **Um roteador que escolhe fornecedor por texto do e-mail vira alvo.** Quem escreve o e-mail passa a influenciar para qual empresa o texto vai. Com a classe do dado filtrando antes, o risco cai, mas não some.

**O que sobra de útil:** o Jev pode dizer **"não precisa de extração"** (sem ação). Isso economiza a chamada lenta. É roteamento do tipo "pular", não do tipo "escolher fornecedor". E, como pular reduz cuidado, é N3.

### Níveis de autonomia: taxonomia proposta

A escala linear do pedido (0 a 5) mistura duas coisas: **o que o sinal faz** e **o risco do que ele toca**. Proposta: nível por **efeito**, aplicado **por tarefa e por categoria**, nunca global.

| Nível | Efeito do sinal inferido | Exige | Exemplo |
|---|---|---|---|
| **N0 — observar** | grava; nada muda | versão das perguntas, sem texto na trilha | a fase 3 de hoje |
| **N1 — sinalizar** | mostra a quem revisa um selo com rótulo **nosso** | medição em N0 | "a segunda opinião sugere LIGANTE" |
| **N2 — endurecer** | manda para revisão ou para mais uma verificação | taxa de discordância medida × capacidade da equipe; decisão do dono | discordância → revisão |
| **N3 — poupar** | dispensa uma chamada ou uma revisão | calibração medida **nesta categoria**; limite de erro aprovado pelo dono; amostra de conferência contínua; interruptor | "sem ação" pula a IA local |
| **N4 — agir sobre estado ou regra** | **nunca** | — | distribuir, mudar política, mudar o Harness |

**Por que a amostra de conferência é obrigatória em N3.** `qualidade-ia.ts` explica: a taxa de acerto é calculada **só sobre o que passou por humano**. Um N3 que dispensa revisão tira do denominador exatamente os casos que ele aprova, e a medida de acerto dele fica cega. Uma fração fixa, sorteada por código (não pelo modelo), continua indo para pessoa, para a medida não morrer.

**Por que a regra monotônica é a defesa principal.** Nos níveis N0 a N2, um atacante que engane o Jev só consegue **mais** revisão, nunca menos. O pior caso da combinação é o de hoje, sem o Jev. Isso vale inclusive se a IA local e o Jev errarem juntos (erro correlacionado): o resultado é o de hoje. Por isso N0 a N2 podem ser ligados com evidência modesta, e N3 exige evidência forte.

## I.G. Extração segura — como evitar que a IA local invente dados

A fraqueza medida é a **literalidade 0,69** (`A59`): o 1.5B reescreve em vez de copiar. **Hoje nada no fluxo confere isso**: a literalidade só existe no gabarito (`core/avaliacao/gabarito.ts`). Um valor reescrito com confiança acima do limiar entra aprovado.

### Três arranjos comparados

| Arranjo | Como | Contra alucinação | Custo | Veredito |
|---|---|---|---|---|
| **(1) IA local → Jev valida → Harness** | o Jev confere cada campo | fraco: o Data Guard tira os números, e o Jev não extrai | +1 chamada externa, com o nome do associado saindo | **Não para identificadores.** Só para papel e semântica |
| **(2) Jev avalia a tarefa → IA local ou paga** | roteamento prévio | não reduz alucinação, só escolhe quem alucina | +1 chamada antes | Só o "sem ação" (N3) |
| **(3) Código primeiro → IA só onde precisa → código confere** | pré-extração + extração + conferência | **forte**: valor fora do texto é recusado por construção | ~0 | **Recomendado, e vem antes do Jev** |

### O arranjo (3) em detalhe

```text
1. PRÉ-EXTRAÇÃO (código, puro, core/)
   CPF (padrão + DV) · e-mail · telefone · CRM/RQE/matrícula (padrões já usados pelo Data Guard)
   · datas · valores · linhas de lista numerada/tracejada (candidatas a ligantes)

2. EXTRAÇÃO (IA local) — o que continua sendo dela
   quantos itens · categoria · nome · liga · qual identificador é de qual pessoa

3. CONFERÊNCIA (código, puro)
   a) todo valor devolvido aparece no texto?                       → senão: revisão `valor_fora_do_texto`
      (critério da pendência 17: igualdade depois de normalizar caixa, espaço e acento;
       para número, só os dígitos)
   b) CPF devolvido tem DV válido?                                 → senão: revisão `cpf_invalido`
   c) CPF devolvido está entre os que o código achou?              → senão: revisão
   d) o código achou identificadores que a IA não usou em nenhum item? → revisão `dado_nao_atribuido`
   e) quantidade de itens × linhas de lista × contagem do Jev       → diferença: revisão `segmentacao_divergente`

4. REPARO DETERMINÍSTICO (opcional, depois de medido)
   valor normalizado-igual a UM trecho único do texto → grava o trecho literal, marcado `reparado_por_codigo`
   (nunca escolhe entre dois trechos; ambiguidade é revisão)
```

**Efeito esperado, que precisa ser medido e dito ao dono antes:** com literalidade 0,69, a conferência (a) manda para revisão uma fração relevante dos itens da IA local, **que hoje passam aprovados com valor possivelmente errado**. É o comportamento correto (invariante 7), mas aumenta o trabalho de revisão. A medição no gabarito dá o número antes de ligar.

**Onde está a decisão:** o critério de igualdade é a pendência 17, que já espera o dono. Proposta concreta acima.

## I.H. Sistema de fallback — escalar sem explodir

| Degrau | Recurso | Entra quando | Sai quando |
|---|---|---|---|
| 0 | código | sempre | resolve o que é determinístico |
| 1 | IA local | há o que interpretar e a trava permite | esquema válido **e** verificadores passam → Harness |
| 1′ | IA local, 2ª tentativa | erro de **forma** (já existe: 1 repetição) | idem |
| 2 | IA paga | **reservado.** Falha determinística depois do 1′, dado autorizado para ela e orçamento do dia | idem; nunca volta ao degrau 1 |
| 3 | humano | qualquer verificador falhou, suspeita, desdobramento, discordância (N2), orçamento esgotado, recurso fora | — |

**Contra laço e custo explosivo** (a maior parte já existe, falta juntar):
- **Um escalonamento por item e por passo**, contado no próprio pedido: sem recursão.
- **Orçamento por sincronização:** 60 s para o Jev (existe), teto diário por fornecedor (existe), disjuntor (existe) e **um teto de escalonamentos para a IA paga por dia** (novo, quando ela existir).
- **Parada registrada em código** e frase nossa (existe para o Jev; estender).
- **Nada escala por suspeita.**
- **O "desistir" do `AT-41` é o fim da escada:** o e-mail vira número na tela e segue no Outlook.

## I.I. Segurança

### O Data Guard: privacidade × utilidade (seção 18 do pedido)

Hoje o Data Guard troca todo número por `[número]`, e-mail por `[e-mail]`, link por `[link]` (`protecao-para-fornecedor-externo.ts`). **Marcadores tipados** (`[CPF]`, `[DATA]`, `[VALOR]`, `[CRM]`, `[MATRÍCULA]`):

- **Privacidade:** o tipo não revela o valor. O risco novo é mínimo: revela que *há* um CPF, o que o formato já sugeria.
- **Utilidade:** provável para categoria. "Tem CPF e data" sugere ficha; "tem valor" sugere título ou anuidade. **Não medido.**
- **Porém:** se a presença de um CPF ajuda a decidir a categoria, **o código já sabe disso sem o Jev**. A mesma detecção vira um sinal *calculado*, e sinal calculado vale mais que inferido.
- **Recomendação:** não mudar agora. Quando houver chave, medir no gabarito sintético **três braços**: Jev com texto cru (só sintético), com `[número]` e com marcadores tipados. A diferença entre o primeiro e o segundo **é o custo de utilidade do Data Guard, medido**. Só então decidir. O Data Guard continua genérico, para todo fornecedor externo, e o `AT-49` continua valendo.

### Auditoria adversarial (seção 25 do pedido)

| Ataque ou falha | Defesa hoje | Lacuna | Proposta |
|---|---|---|---|
| Jev fora do ar ou em timeout | 10 s; parada por credencial, teto, disjuntor, 3 falhas, 60 s | — | manter; em N2, sem opinião = caminho de hoje (nunca "aprovado por falta de objeção") |
| Resposta inválida ou parcial | pergunta sem resposta ou a mais = falha alta | — | — |
| Probabilidade absurda | coerência: soma, escolha, nota | a `confianca` é só conferida na faixa | nunca decidir pela `confianca` (já regra) |
| **Modelo trocado por baixo** | `modeloUsado` gravado | **`jev-latest` é apelido**: calibração medida vira lixo sem aviso | fixar versão datada se a TypeSafe oferecer; **mudança de `modeloUsado` = ocorrência que suspende N3** até recalibrar |
| Pergunta errada ou editada | versão + hash em teste | varredura por texto (pendência 35) | tipo marcado; **versão da pergunta faz parte da chave da calibração** |
| Data Guard tira contexto demais | — | não medido | braços com e sem proteção no gabarito sintético |
| **Data Guard deixa dado demais** | trava de dado real | nome, endereço e saúde ficam (`A62`) | `§ H.4` 35 continua valendo; nada muda aqui |
| IA local alucina | Zod; revisão por confiança | **ninguém confere a literalidade** | I.G (pendência 17), antes de tudo |
| IA paga fora | — | não existe | escada termina no humano |
| Laço de fallback | 1 repetição, só por forma | — | 1 escalonamento por item e passo |
| Custo explode | teto diário, disjuntor | teto é por chamadas, não por dinheiro | custo estimado por chamada (tabela de preço em `core/config.ts`), somado por dia |
| **Erro correlacionado** | — | — | regra monotônica: concordar não dispensa nada |
| **Injeção dirigida aos dois** | 3 camadas; regex no original | — | a injeção só ganha se um sinal puder **reduzir** cuidado: por isso N3 nunca vale com regex suspeita |
| Pergunta vira canal de injeção | constantes | pendência 35 | tipo marcado; candidato de extração vai **dentro** do bloco delimitado |
| Vazamento pelo log | resumo e máscara (`resumoDeTransporte`) | pendências 31, 32 | — |
| Harness aceita o que não devia | — | a política não existe como unidade | tabela pura, testes por sabotagem, hash da política fixado |
| Harness recusa o que devia aceitar | — | — | "revisão desnecessária" é métrica de primeira classe (I.L) |
| Concorrência e repetição | idempotência por `messageId`; evento na transação | opinião paga e descartada (pendência 36) | ler medição sabendo disso |
| Rede fora | disjuntor; lote segue | — | — |
| Observabilidade insuficiente | eventos e `UsoDaIa` diário | **sem registro por chamada; sem latência por percentil; sem versão do Data Guard** | I.J e I.L |

## I.J. Performance

### O que se sabe, com a fonte

| Fato | Valor | Fonte |
|---|---|---|
| IA local 1.5B, por chamada, CPU i5-3330 | ~45 s (estimado: metade dos ~90 s do 3B) | `A59` (não medido aqui) |
| IA local, primeira chamada com modelo frio | 16 s | `maquina-da-ia-local.md` |
| Teto por chamada da IA local | 300 s | `ia-local.ts:65` |
| Jev: prazo por chamada | 10 s | `classificador-typesafe.ts` |
| Jev: orçamento por sincronização | 60 s | `segunda-opiniao.ts` |
| Jev: latência real P50/P95/P99 | **desconhecida** (rede bloqueada, sem chave) | — |
| Ingestão | **em série, dentro do `POST /api/ingestao`** | `app/api/ingestao/route.ts`, `servicos/ingestao.ts` |
| Sincronização máxima | 200 e-mails | `AT-35` |
| Volume real | "dezenas por dia" (estimativa, não medido) | `core/ia/consumo.ts` |

### Os gargalos, em ordem de gravidade

1. **A sincronização síncrona com a IA local.** 40 e-mails × ~45 s ≈ 30 min numa requisição HTTP; 200 ≈ 2,5 h (estimativas). Nenhuma otimização do Jev compensa isso. **Proposta:** a ingestão vira rotina em segundo plano, com o mesmo mecanismo de `servicos/rotinas.ts`: linha única por execução, abandono em 30 min, eventos. O botão "sincronizar" passa a **pedir** uma rodada e mostrar o progresso. É pré-requisito da IA local em produção, com ou sem Jev.
2. **A máquina da IA local não paraleliza:** 4 núcleos sem AVX2, 8 GB. Chamadas concorrentes disputam a mesma CPU. **Uma por vez** é o certo nela.
3. **O Jev em série depois da IA.** Hoje soma até 10 s por e-mail. Como a IA local é várias vezes mais lenta, pôr o Jev **em paralelo** (`Promise.all`) torna o custo de tempo dele ~zero. Em modo sombra isso não muda nada no resultado. Ressalva: com o texto vazio ou com a desistência (`AT-41`), o Jev não roda, como hoje.
4. **Perguntas novas ao Jev vão na mesma chamada** (o mapa `questions`). Somar segmentação e "sem ação" custa tokens de instrução, não latência de ida e volta. **Não medido**: pode crescer com o número de perguntas.
5. **O Jev como acelerador de verdade é só o "sem ação" (N3):** cada resposta automática corretamente pulada economiza uma chamada inteira da IA local. O ganho depende da **fração de e-mails sem ação no volume real**, que ninguém mediu. É a primeira coisa a contar quando houver dado real (sem IA: uma contagem de categorias revisadas).

### Como medir P50, P95, P99 e throughput

- **No gabarito** (sintético, com chave): um script `ia:medir-classificador` que roda N casos em concorrência 1, 2 e 4, grava a duração de cada chamada e calcula os percentis. Pode ser o mesmo `ia:avaliar` com `--repeticoes`.
- **Em produção:** hoje é impossível. `UsoDaIa` guarda soma de duração por dia (`duracaoMsTotal`), e com soma não se calcula percentil. **Proposta:** um registro por chamada (I.L), com duração, tarefa, fornecedor, modelo e versões. É pouca linha: dezenas a centenas por dia. P95 sai de uma consulta.

## I.K. Economia

**Custo operacional total por e-mail**, e não custo de token:

```text
C(e-mail) = Σ chamadas × preço                  (≈ 0 hoje: local grátis; Jev e paga desligados)
          + tempo de máquina                    (IA local ~45 s de CPU; importa pela fila, não pelo real)
          + P(revisão)       × T_revisão × custo da hora da equipe
          + P(erro não pego) × custo do erro    (item errado na fila errada, chave de busca errada,
                                                 retrabalho, pedido esquecido)
```

**No volume do SBP, dezenas de e-mails por dia, os dois últimos termos dominam.**
- A IA paga (quando existir) está estimada em ~R$ 0,06 por e-mail, ou menos de R$ 100 por mês (análise de 14/09, seção 12; estimativa, não fatura).
- O preço do Jev **não foi confirmado** (`A62`).
- Um minuto de revisão de uma pessoa custa mais que isso.
- Um item aprovado com o CPF errado custa mais que muitos minutos.

**Consequência para o desenho:** otimizar para **reduzir erro não pego** primeiro, e **revisão desnecessária** depois. Token vem por último. "Grátis" não é "barato" (seção 11 do pedido): a IA local grátis com literalidade 0,69 e sem conferência produz exatamente o erro caro.

**Quando o Jev se paga** (a medir no experimento):

```text
em N2:  ΔP(erro não pego) × custo do erro  >  preço do Jev + ΔP(revisão) × T_revisão × custo da hora
em N3:  (chamadas da IA local evitadas × valor do tempo de fila)
          > preço do Jev + P(falso "sem ação") × custo do pedido atrasado
```

Os três números de que a conta depende (custo do erro, custo da hora, tempo de revisão) são **do dono**, não técnicos. Entram como parâmetros no relatório do experimento, não como constantes no código.

## I.L. Avaliação — provar que cada componente agrega valor

### O que existe

- `npm run ia:avaliar`: 17 casos, 5 dimensões, `VERSAO_DO_GABARITO`, qualquer `AiPort`.
- `qualidade-ia.ts`: taxa sobre revisados, por categoria, e "calibração" como média de confiança aceita × corrigida.
- A trilha `segunda_opiniao`: concordância por e-mail.

### O que falta

1. **Gabarito maior e conferido por gente.**
   - Meta: ≥ 150 casos sintéticos, ≥ 15 por categoria, mais adversariais: injeção, listas de ligantes, assinatura, encaminhado, resposta automática, mais de uma pessoa.
   - Respostas **conferidas por alguém da equipe** (`§ H.4` 31). O modelo avaliado nunca vê as respostas.
   - Com 150 casos, o intervalo de 95% de uma taxa de 0,8 fica em ±7 pontos. Com 17, ±20.
2. **O Jev no gabarito** (pendência 35 antes: é o segundo uso do classificador).
3. **Cruzar sombra × desfecho.**
   - O evento `segunda_opiniao` tem `referencia = messageId`; `Revisao` → `Item` → `Email.messageId` tem o desfecho humano.
   - Uma consulta de leitura gera a tabela de três vias: IA certa ou errada × Jev concorda ou discorda × desfecho.
   - Sem mudar schema. **Viés declarado:** só itens revisados têm verdade; a amostra de conferência (N3) corrige isso.
4. **Calibração por faixa**, pura, em `core/`, para qualquer fonte de probabilidade:
   - faixas 0–0,5 · 0,5–0,7 · 0,7–0,85 · 0,85–0,95 · 0,95–1;
   - por faixa: n, acerto observado, intervalo de Wilson;
   - ECE (erro de calibração esperado) e Brier.
   - A chave da calibração é **(fonte, modelo, versão das perguntas ou do prompt, versão do Data Guard, categoria)**: trocar qualquer um zera a validade.
   - Faixa com n < 30 não é lida.

### O experimento (seção 22 do pedido)

| Braço | O que roda | O que mede |
|---|---|---|
| **A** | IA local sozinha | linha de base (existe: `A59`) |
| **B** | Jev sozinho (só categoria, suspeita, segmentação, sem ação) | acerto do Jev nas perguntas dele |
| **C** | IA local + Jev, sem política | concordância; tabela 2×2 de erros |
| **D** | IA local + Jev + Harness (N2) + verificadores | erro não pego, revisão desnecessária |
| **E** | D + IA paga no degrau 2 | ganho marginal do escalonamento (só quando houver chave paga) |
| **F** | código sozinho, onde der (identificadores, contagem de lista) | quanto o determinístico já resolve |
| **F+A** | pré-extração + IA local + conferência (I.G) | ganho do código **antes** do Jev |

**Métricas principais** (por braço, por categoria, com intervalo):
- **Erro não pego:** aprovado sem revisão e errado. É o número que o sistema existe para baixar.
- **Revisão desnecessária:** foi a revisão e estava certo. É o custo humano.
- **Jev evitou erro:** IA errada, Jev discorda. **Jev introduziu revisão:** IA certa, Jev discorda. Em N2, o Jev não introduz *erro*, só revisão; é a vantagem da regra monotônica.
- **Ambos erraram:** o que nenhum sinal pega e só o humano ou o código salvam.
- **Independência dos erros:** P(ambos erram) observado × P(A erra) × P(B erra). Se o observado for muito maior, os erros são correlacionados e a segunda opinião vale menos do que parece.
- **Calibração** (acima); latência P50, P95, P99; chamadas; custo estimado; fallbacks; revisões.

**Regra de decisão, escrita antes de rodar** (análise de 14/09, seção 11: o resultado esperado é escrito por quem não executa):
- **N2 por categoria:** liga se, no braço D, o erro não pego cair e a revisão desnecessária couber no que a equipe aguenta. O limite de revisão é do dono.
- **N3 por categoria:** liga se o limite superior de Wilson do erro, na amostra de conferência com n ≥ 100, ficar abaixo do limite de erro que o dono aprovar. Com N3 ligado, a amostra continua.

## I.M. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| O Jev não funciona bem em português | desconhecida (`A62`) | o plano do Jev para em B | medir antes; o plano da IA local (I.G) não depende dele |
| O preço do Jev não compensa | desconhecida | Jev só no gabarito | conta do I.K com números do dono |
| Termos da TypeSafe incompatíveis com a LGPD | desconhecida | Jev só com sintético, para sempre | `§ H.4` 35 |
| `jev-latest` muda | alta, com o tempo | calibração inválida em silêncio | ocorrência por mudança de `modeloUsado` |
| Conferência de literalidade dobra a revisão | média | equipe sobrecarregada | medir no gabarito antes; reparo determinístico (I.G.4); limite do dono |
| Calibração tirada de amostra pequena | alta hoje | limiar errado com cara de ciência | n mínimo por faixa; intervalos sempre mostrados |
| N3 cega a própria medição | certa sem amostra | acerto "sobe" enquanto erra | amostra de conferência obrigatória |
| Sinal inferido promovido a calculado por engano | média | a regra monotônica quebra | natureza do sinal no **tipo** (compilador), não em convenção |
| Harness vira framework | média | complexidade sem valor | uma função e uma tabela; qualquer coisa além precisa de motivo escrito |

## I.N. Plano de implementação — Parte I

Fases pequenas e reversíveis. A ordem da Parte III intercala com a Parte II.

| Fase | Objetivo | Arquivos | Contrato | Testes | Aceitação | Risco | Volta atrás |
|---|---|---|---|---|---|---|---|
| **J1. Verificadores determinísticos** | literalidade + DV do CPF → revisão | `core/` (função pura nova), `servicos/ingestao.ts` (chamada), `esquemas.ts` (2 motivos novos) | `conferirExtracao(texto, itens) → motivo[]` | valor reescrito → revisão; CPF errado → revisão; valor literal → aprovado; propriedade: nenhum valor fora do texto sai aprovado | gabarito: quantos itens mudam de destino, reportado **antes** de mesclar | mais revisão (medido) | reverter o PR; é uma chamada |
| **J2. Harness puro** | juntar `decidirRevisao` e os sinais em `core/harness/` | `core/harness/` novo; `servicos/ingestao.ts` passa a chamá-lo | `decidir(sinais, POLITICA) → {destino, motivos, versaoDaPolitica}`; tipo `Sinal` com `natureza` | **igualdade** com `decidirRevisao` em todos os casos atuais (tabela exaustiva); hash da política fixado; teste que recusa sinal `inferido` aprovando | zero mudança de comportamento | refatoração de área sensível (nível 2) | reverter |
| **J3. Registro por chamada** | latência por percentil, versão de tudo, custo estimado | `prisma/` (tabela `ChamadaDeIa`), `cliente-com-consumo.ts` | uma linha por chamada: tarefa, fornecedor, modelo, versões, duração, espécie de falha, tokens se houver, custo estimado; **nenhum texto** | gravação não derruba a chamada (como `AT-42`); falha gravada | P95 por tarefa numa consulta | crescimento da tabela (pequeno; sem conteúdo, fica para sempre como histórico operacional) | a tabela pode ficar sem uso |
| **J4. Jev em paralelo** | tirar o Jev do caminho de tempo | `servicos/ingestao.ts` | — | resultado idêntico com e sem; ordem dos eventos preservada | tempo por e-mail = max(IA, Jev) | concorrência de erro (as duas falham) | reverter |
| **J5. Perguntas por tipo marcado** | pendência 35 | `ports/classificador.ts`, módulo de perguntas | `PerguntaDoSistema` só construída num módulo | o compilador recusa pergunta montada | varredura vira redundante | nível 3 | reverter |
| **J6. Gabarito ampliado + Jev no gabarito** | base de medição | `core/avaliacao/`, `scripts/avaliar-ia.ts` | casos com segmentação e "sem ação"; classificador avaliado | nota pura testada | casos conferidos pela equipe (`§ H.4` 31) | tempo da equipe | — |
| **J7. Relatório sombra × desfecho + calibração** | ler o que já se grava | `servicos/qualidade.ts`, `core/` (calibração pura) | tabela de três vias; faixas com Wilson | propriedade da calibração (perfeita → ECE 0) | relatório legível pelo dono | viés de seleção (declarado) | leitura pura |
| **J8. Perguntas novas em sombra** | segmentação, sem ação | `segunda-opiniao.ts` (sobe `VERSAO_DAS_PERGUNTAS`) | — | hash e versão | medição em N0 | nível 3 | versão anterior |
| **J9. N2** (decisão do dono) | discordância → revisão | `core/harness/` (uma linha na política) | motivo `segunda_opiniao_discorda` | sem opinião = caminho de hoje | experimento braço D aprovado | mais revisão | interruptor na política |
| **J10. N3** (decisão do dono, por categoria) | "sem ação" pula a IA local | idem + amostra de conferência | — | amostra sorteada por código | regra do I.L | é o único degrau que **reduz** cuidado | interruptor; suspensão automática por mudança de modelo |

J5 a J10 dependem da chave (`A63`) e do `§ H.4` 35 para dado real. **J1 a J4 e J7 não dependem de nada pago** e servem com a IA local sozinha.

## I.O. O que NÃO fazer — Parte I

- **Não** criar microsserviço, fila ou barramento para o Jev. É um `fetch` com 10 s de prazo.
- **Não** usar framework de agentes nem de grafos (LangGraph e afins). O Harness é uma função e uma tabela.
- **Não** criar roteador dinâmico de fornecedor pelo texto do e-mail (`DIRECAO.md`, `A62`).
- **Não** decidir pela `confianca` do Jev (`A62`).
- **Não** usar o Jev para CPF, CRM, matrícula ou telefone: é código.
- **Não** tratar concordância como aprovação.
- **Não** deixar o Jev tirar suspeita.
- **Não** mandar texto do Jev ou da IA para a tela da revisão: só rótulos nossos.
- **Não** montar pergunta com texto de e-mail. O candidato vai dentro do bloco delimitado.
- **Não** ligar N3 sem amostra de conferência.
- **Não** usar `jev-latest` como se fosse versão.
- **Não** reduzir o Data Guard para ganhar acerto sem medir o braço "sem proteção" em sintético.
- **Não** otimizar token antes de erro não pego.
- **Não** criar interfaces genéricas ("ProvedorCognitivo", "Estrategia", "Pipeline") antes do segundo uso real.

---

# PARTE II — Operação autônoma e o SBP Control Center

## II.A. Estado atual — o que já existe para essa visão

| Peça pedida | O que existe | Onde |
|---|---|---|
| Rotina agendada, uma por período, com falha que não some | limpeza diária: linha única `(rotina, data)`, 3 tentativas, abandono em 30 min, evento | `servicos/rotinas.ts`, `instrumentation-node.ts`, `ExecucaoDeRotina` |
| Trilha append-only com domínio | `LogAuditoria`, `EventoProcessamento` (invariantes 11, 12, 14) | `schema.prisma`, `servidor/observabilidade.ts` |
| Checagem de integridade | `conferirConservacao`, `conferirPendencia` | `servicos/painel.ts` |
| Qualidade da IA | taxa de acerto, cobertura, por modelo | `servicos/qualidade.ts`, `core/qualidade-ia.ts` |
| Uso da IA | chamadas, falhas e duração somada por dia, fornecedor, modelo e tarefa | `UsoDaIa` |
| Teto e disjuntor | política pura + invólucro | `core/ia/consumo.ts`, `cliente-com-consumo.ts` |
| Aviso ao gestor | montado por código, sem IA, com "o que mudou" | `core/aviso-do-gestor.ts`, `servicos/aviso-do-gestor.ts` (e o alerta por volume de entrada decidido em 29/09) |
| Memória consultável por caso | por correlação e por entidade, com limite por pessoa | `servicos/memoria.ts` |
| Assistente | explica, nunca opera (invariante 13); material filtrado por papel em código | `core/assistente/`, `adapters/assistente-*.ts` |
| Avaliação | gabarito com nota automática | `core/avaliacao/`, `npm run ia:avaliar` |
| **Governança de mudança de código** | nível de risco pelos arquivos, evidência exigida, revisão por outro agente, CI, CodeQL (desarmado), gitleaks, `npm audit` | `PROCESSO.md`, `scripts/processo/`, `.github/workflows/` |
| Escada de mudança | registro → agrupamento → ajuste em faixa → regra → código | `A30` |
| Relatório semanal e papel `dono` | **decididos, não implementados** | `A32`, `A53`, `§ H.4` 29 |
| Canal de feedback | **decidido, não implementado** | `A21` |

**Leitura honesta:** a fundação existe (rotina, trilha, checagens, portão de processo). O que falta é **juntar e mostrar**, não inventar.

## II.B. Lacunas

1. **Não há papel `dono`.** `PapelSchema` tem `operador`, `colaborador`, `gestor` (`core/esquemas.ts:16`). A conta "do dono" do pedido é esse papel (`A32`, `A53`), não a de gestor. **Confirmar com o dono** (`§ H.4` 45).
2. **Não há entidade de ocorrência** (incidente): severidade, estado, deduplicação, evidência.
3. **Não há registro por chamada de IA** (I.J), nem versão do Data Guard, nem impressão de versões por evento.
4. **Saúde é calculada sob demanda, nunca guardada.** Sem série no tempo não há "o que mudou desde a última auditoria".
5. **Silêncio parece saúde.** Se a ingestão parar de rodar, não há evento de falha, só ausência de evento. Nada hoje alerta pela **falta** do esperado.
6. **O disjuntor mora na memória do processo** (`AT-38`). A tela não o vê hoje; com um processo só (`A61`), dá para expor por leitura em memória.
7. **Não há canal de notificação para fora do sistema.** Enviar e-mail foi recusado (`A5`).
8. **`ATOR_SISTEMA` é `operador`** (`servidor/ator.ts:58`): qualquer automação herdaria "confirmar distribuição" (`§ H.4` 7).
9. **Não há entidade de proposta de evolução**, nem ligação entre ocorrência, proposta, PR e resultado.
10. **Os resultados do gabarito não são guardados** pelo sistema: saem no terminal ou em JSON fora do repositório.

## II.C. Arquitetura proposta

### A decisão estrutural: dois planos, com uma parede entre eles

```text
┌──────────────────────── PLANO DE OPERAÇÃO (servidor do SBP, produção) ─────────────────────────┐
│  observa (checagens determinísticas, por rotina)                                              │
│  → abre / atualiza OCORRÊNCIA (severidade, evidência em códigos e números)                     │
│  → aplica CONTENÇÃO pré-autorizada (só DESLIGA: IA externa, Jev, ingestão automática)          │
│  → avisa o DONO (na tela; fora dela, se houver canal: § H.4 41)                                │
│  → grava RETRATO semanal (números) para comparar antes × depois                                │
│                                                                                               │
│  NÃO TEM: credencial do repositório, escrita na própria política, ação sobre carga de pessoa    │
└───────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                │ leitura: ocorrências, retratos, relatório
                                                ▼
                        ┌──────── DONO no CONTROL CENTER ────────┐
                        │  lê · aprova · rejeita · pede estudo    │
                        │  ajusta DENTRO de faixas que o código   │
                        │  define (A30, degrau 3)                 │
                        └──────────────┬─────────────────────────┘
                                       │ proposta aprovada (ou tarefa de auditoria agendada)
                                       ▼
┌──────────────────────── PLANO DE EVOLUÇÃO (fora da produção) ─────────────────────────────────┐
│  agente de desenvolvimento (rotina do Claude Code, repositório só)                            │
│  → lê o repositório, a proposta e os retratos (números, nunca dado da associação)            │
│  → abre PR → portão do PROCESSO.md (nível pelos arquivos) → CI → revisão por outro agente     │
│  → merge automático SÓ onde o dono autorizar por nível; governança NUNCA                       │
│  → implantação → o próximo RETRATO mede se melhorou                                           │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Por que a parede resolve o laço de autoalteração (seção 25):**
- O processo que detecta problemas **não consegue** mudar o próprio código, a própria política nem os próprios limites. Não é uma regra que ele obedece; é credencial que ele não tem.
- O agente que muda código não tem acesso ao banco de produção nem a dado da associação. Os números chegam por retrato agregado.
- Os arquivos de governança (lista em II.K) exigem o dono **sempre**, e o agente automático nem consegue abrir PR que os toque (trava determinística no CI).

### Onde cada peça mora no código

| Peça | Lugar | Por quê |
|---|---|---|
| Regras de severidade, deduplicação, avaliação de checagem, faixas de configuração | `core/operacao/` (puro) | testável em milissegundos; mesma regra na tela e na rotina |
| Checagens (consultas) | `servicos/saude.ts` | reusa `painel.ts`, `qualidade.ts`, `UsoDaIa` |
| Rotina de monitoramento | `servicos/rotinas.ts` (mesmo mecanismo da limpeza) | uma execução por janela; falha que não some |
| Ocorrência, retrato, proposta, configuração | `prisma/` (tabelas novas, pequenas) | histórico operacional: fica (invariante 11) |
| Contenção | lida pela `fabrica.ts` antes de criar o adapter | o interruptor desliga na origem |
| Telas | `app/controle/*` (só papel `dono`) | — |
| Auditoria de código | **fora do SBP**: rotina do Claude Code | não mistura planos |

Nada disso pede microsserviço, fila, barramento ou Kubernetes. É o mesmo processo, o mesmo banco e o mesmo mecanismo de rotina.

## II.D. O Control Center

Área exclusiva do papel `dono`, com duas camadas de permissão: **ler tudo o que é número e código**, **agir só em configuração e aprovação**. Não opera: não distribui, não revisa, não mexe em acesso (`A32`).

| Seção | O que mostra | Fonte | Fase |
|---|---|---|---|
| **Saúde** | semáforo por área; checagens da última execução; tendência de 4 semanas | `servicos/saude.ts`, retratos | O2 |
| **Ocorrências** | abertas por severidade; linha do tempo; evidência | `Ocorrencia` | O3 |
| **Inteligência** | acerto por modelo e categoria; cobertura; calibração; gabarito por versão | `qualidade.ts`, `ResultadoDeAvaliacao` | O2 |
| **IA local** | chamadas, falhas, P50/P95, disjuntor, modelo em uso | `ChamadaDeIa`, `UsoDaIa` | O2 (depois de J3) |
| **Jev** | concordância por categoria e versão das perguntas; paradas; mudança de modelo | eventos `segunda_opiniao` | O2 |
| **APIs pagas** | idem, com custo estimado | `ChamadaDeIa` | quando existir |
| **Automações** | rotinas: última execução, próxima, falhas | `ExecucaoDeRotina` | O2 |
| **Evolução** | propostas: estado, PR, retrato antes × depois | `PropostaDeEvolucao` | O5 |
| **Aprovações** | propostas aguardando; contenções a religar | idem | O5 |
| **Histórico** | linha do tempo: ocorrências, propostas, mudanças de configuração, versões | junção das tabelas + `LogAuditoria` | O5 |
| **Políticas** | a política vigente (só leitura), versões, travas de dado real, faixas ajustáveis | constantes do `core/` + `Configuracao` | O4 |
| **Memória do sistema** | observações e ideias do dono, por estado | `RegistroDeEvolucao` | O6 |
| **Assistente** | perguntas sobre tudo acima, com evidência | II.F | O7 |

**Regras de tela que vêm do projeto:**
- métrica é `<p>`, nunca `<input>` (invariante 4);
- nenhum dado de associado nem conteúdo de e-mail em nenhuma seção;
- número de pessoa só no agregado que o `A24` já permite, e **nunca** ranking (invariante 10);
- ação sensível pede a senha de novo (`§ H.4` 30).

## II.E. Operação autônoma: monitoramento, auditoria, ocorrências

### Monitoramento contínuo × auditoria profunda

| | Monitoramento contínuo | Auditoria profunda |
|---|---|---|
| Pergunta | "algo merece atenção agora?" | "qual o estado do sistema?" |
| Frequência | a cada 15 min (o intervalo que as rotinas já usam) | semanal (padrão), quinzenal, mensal, sob demanda |
| Quem executa | servidor, código determinístico | **duas partes:** (1) servidor: checagens profundas e retrato; (2) agente de desenvolvimento: código, testes, dependências, documentação |
| Custo | consultas pequenas | (1) consultas maiores; (2) uso do plano do Claude do dono |
| Saída | ocorrência | retrato + relatório (`A32`) + propostas |

### O catálogo inicial de checagens: só o que já tem dado

| Checagem | Regra | Severidade | Fonte |
|---|---|---|---|
| Conservação divergente | qualquer rodada | **CRÍTICA** | `conferirConservacao` |
| Pendência por subtração ≠ contagem | qualquer categoria | ALTA | `conferirPendencia` |
| Limpeza LGPD falhou 3× no dia | `ExecucaoDeRotina` | ALTA (obrigação legal) | `rotinas.ts` |
| **Ingestão sem execução em dia útil há N horas** | ausência de evento esperado | ALTA | `EventoProcessamento` (**checagem de silêncio**) |
| Credencial de IA recusada | evento | ALTA | `InterpretacaoIndisponivelError` |
| Disjuntor aberto | estado em memória | MÉDIA | `consumo` |
| Teto diário ≥ 80% | `UsoDaIa` | MÉDIA | — |
| Revisão mais velha > N dias | `A7` | MÉDIA | `Revisao` |
| E-mails desistidos na semana > N | `AT-41` | MÉDIA | eventos |
| Concordância do Jev caiu > X pontos | janelas de 7 × 28 dias | MÉDIA | `segunda_opiniao` |
| `modeloUsado` do Jev ou da IA mudou | comparação com o último | MÉDIA (suspende N3) | eventos |
| Recusas de entrada acima do corte | `AT-45`, decidido em 29/09 | MÉDIA | `LogAuditoria` |
| Latência P95 da IA 2× a semana anterior | depois de J3 | BAIXA | `ChamadaDeIa` |
| Taxa de aceitação caiu | janelas | BAIXA | `qualidade.ts` |

### A auditoria profunda, particionada (seção 6)

```text
INVENTÁRIO  → o que existe: commit, versões (prompt, perguntas, política, algoritmo, gabarito, Data Guard),
              dependências, migrações, rotinas
PARTIÇÃO    → áreas independentes, cada uma com ferramenta própria
TRIAGEM     → o determinístico roda sempre; o agente só onde o determinístico apontou algo ou a área mudou
CONSOLIDAÇÃO → relatório com números, diffs de versão e propostas (nunca "está tudo bem" sem número)
```

| Área | Quem | Ferramenta | Onde roda |
|---|---|---|---|
| Integridade do banco | código | conservação, pendência, órfãos de anexo, retenção atrasada | servidor |
| Operação | código | volumes, fila, revisões, idades, desistências | servidor |
| IA local e Jev | código | acerto, cobertura, calibração, concordância, latência, custo | servidor |
| Testes e tipos | ferramenta | `npm run verificar`, cobertura | CI / agente |
| Dependências e segredos | ferramenta | `npm audit`, gitleaks, Dependabot | CI |
| Segurança estática | ferramenta | CodeQL (**desarmado pelo plano do GitHub**) | CI |
| Fronteiras de arquitetura | teste | `core/pureza.test.ts`, `fronteira-do-fornecedor.test.ts` | CI |
| Deriva de documentação | agente | ESTADO, DECISOES × código | agente de desenvolvimento |
| Arquitetura e dívida | agente | leitura dirigida pelos achados | agente de desenvolvimento |
| Gabarito | script | `ia:avaliar` na máquina da IA local | máquina Debian (**exige o dono ou a sessão de lá**) |
| Decisão | humano | propostas | dono |

**"Encontrar problemas que ninguém pediu"** (seção 7) **é o catálogo de checagens**, rodando sozinho. Ele cresce por PR, quando uma ocorrência revela uma classe nova de problema. Não é um modelo procurando à toa. Um modelo procurando à toa, sem hipótese nem gabarito, produz **falso positivo convincente**: o "narrativa consistente e desconectada" da análise de 14/09.

## II.F. O assistente administrativo

### O conflito, dito primeiro

O invariante 13 diz: **"O assistente explica; nunca opera"**. O retorno não tem campo de ação, e a ausência é o desenho. O pedido quer comandos como "execute a auditoria agora", "mude a frequência para quinzenal", "permita correções automáticas de baixo risco". **Isso é operar.** O invariante 12 também diz que a trilha não monta contexto de prompt. Nenhum dos dois pode ser contornado por um assistente "com mais contexto"; só por decisão do dono.

### A proposta que preserva os dois invariantes e atende ao pedido

1. **Perguntas → consultas determinísticas → frase.**
   - O servidor tem um conjunto **fechado** de consultas de leitura: saúde, ocorrências, acerto por modelo, uso da IA, propostas, mudanças desde um retrato.
   - O modelo **escolhe** a consulta. Pode ser o Jev: `escolha` entre ids de consulta, que é exatamente o formato dele.
   - O **código** executa a consulta e o modelo só redige.
   - Todo número da resposta tem de estar no resultado da consulta, conferido como os verbetes citados hoje (`assistente-modelo.ts`).
   - Número sem origem = resposta recusada.
2. **Comandos → nunca executados pelo assistente.** "Mude a frequência para quinzenal" devolve **a tela de configuração com a proposta preenchida**. O dono confirma com o botão, que chama a mesma rota autorizada de sempre.
   - Hoje o invariante 13 permite "no máximo o nome de uma tela". Tela **com valor preenchido** é uma extensão, e é decisão do dono (`§ H.4` 44).
3. **Nenhum conteúdo de e-mail nem dado de associado** chega ao assistente administrativo. As consultas devolvem só números e códigos.
4. **Qual modelo:**
   - com o `A63`, a IA local de 1,5B é fraca para análise;
   - o Jev só escolhe;
   - uma IA paga, com dado **agregado e sem pessoa**, é a opção boa quando houver orçamento.

   Até lá, o assistente administrativo é **a própria tela com perguntas prontas**. Isso já responde "como está o SBP?", "o que mudou?", "o que está aberto?" sem modelo nenhum.

### Assistente operacional × administrativo

| | Operacional (existe) | Administrativo (proposto) |
|---|---|---|
| Quem | todos, filtrado por papel | só `dono` |
| Material | manual (`conhecimento.ts`) | consultas fechadas de leitura + manual |
| Autoridade | nenhuma | nenhuma (devolve tela preenchida) |
| Dado de associado | nunca | nunca |
| Trilha como contexto | nunca | nunca o texto; só números das consultas |

## II.G. Memória de evolução

### O que já foi decidido e se aplica

- `A21`: canal de feedback, com a tela, o papel e a data.
- `A30`: escada; nenhum feedback muda o sistema sozinho.
- `A32`: agrupamento por tema, sem IA externa; relatório semanal.
- `A33`: observação ≠ regra.

A "memória de evolução" do pedido **é o mesmo circuito**, com uma fonte a mais: as conversas do dono.

### Estados explícitos, e quem muda cada um

```text
observação ─┐
ideia ──────┤
preferência ┼─► (agrupamento: mesma área e tema, por código) ─► padrão recorrente
hipótese ───┤                                                       │
solicitação ┘                                                       ▼
                                                    proposta de evolução (II.H)
                                                                    │
                                   decisão do dono ─► DECISOES.md (a fonte da verdade continua sendo o Git)
                                                                    │
                                                        requisito ─► PR ─► implementado
```

| Regra | Por quê |
|---|---|
| O registro nasce por **ação explícita** de quem falou (botão "guardar como observação"), com o **texto literal** dele | `A21`: o assistente não grava por conta própria; o modelo resumindo o dono distorceria o que ele disse |
| O modelo pode **sugerir** o estado e a área; a sugestão fica marcada `sugerido` até o dono confirmar | a sugestão de modelo é inferida (I.E) |
| Só o dono promove para **decisão**, e a decisão vai ao `DECISOES.md` por PR | a regra mora no Git; o banco guarda a ligação |
| Recorrência é **contagem por área e tema** escolhidos no registro, não agrupamento semântico por IA externa | `A32`; e agrupar por modelo seria o modelo decidindo o que é "a mesma coisa" |
| A memória de evolução não entra em prompt de interpretação | invariante 12 |

## II.H. Upgrade Engine — de problema a mudança medida

### A entidade `PropostaDeEvolucao`

| Campo | Conteúdo | Quem preenche |
|---|---|---|
| problema | frase + área | agente ou dono |
| evidências | ids de ocorrência, retrato, registro de evolução | código (referência, nunca cópia) |
| hipóteses → causa provável | lista; a causa marcada como `hipótese` até ser confirmada | agente |
| opções | ≥ 1, cada uma com risco, impacto, custo, reversibilidade | agente |
| arquivos previstos | lista | agente |
| **nível de risco** | calculado por `nivelDaMudanca(arquivos)` | **código, nunca o autor** |
| **autonomia exigida** | derivada da matriz II.I a partir do nível e da classe | **código** |
| resultado esperado | métrica, faixa, data de conferência, **escrito antes** | agente, conferido pelo dono |
| estado | rascunho → aguardando → aprovada → em PR → validando → concluída ou revertida; rejeitada | código, por transição permitida |
| PR | link | agente |
| retrato antes e depois | ids | código |
| quem aprovou, quando | — | código (do `Ator`, invariante 5) |

**A proposta aprovada é um arquivo de tarefa para o agente de desenvolvimento, não um comando para o servidor.** O servidor guarda e mostra.

### Validação antes × depois (seção 18)

O **retrato** é uma linha com números e versões, gravada pela rotina semanal e sob demanda:

```text
versões (commit, prompt, perguntas, política, algoritmo, gabarito, Data Guard, modelo)
· testes (quantos, verdes) · cobertura · vulnerabilidades altas
· acerto por categoria + cobertura · calibração (ECE) · concordância do Jev
· revisões por dia · idade da revisão mais velha · desistências
· P50/P95 por tarefa · chamadas e custo estimado por dia
· ocorrências abertas por severidade
```

O relatório de uma proposta compara o retrato antes com o depois e com o **resultado esperado escrito antes**. "Melhorou" é a métrica dentro da faixa esperada, **sem regressão nas outras**. Não é "compilou".

**Limite honesto:** no volume do SBP, um "antes × depois" de uma semana tem amostra pequena. Mudanças de IA se provam no **gabarito** (antes de ir) e se confirmam na operação (depois). Canário (uma fração do tráfego com a mudança) não tem amostra que o sustente aqui, e fica de fora.

## II.I. Matriz de autonomia

| Ação | Observar | Recomendar | Executar sozinho | Exige aprovação | Nunca |
|---|---|---|---|---|---|
| Rodar checagens, abrir ocorrência | | | ✔ | | |
| Gravar retrato | | | ✔ | | |
| Aviso na tela do dono | | | ✔ | | |
| **Contenção que desliga** (IA externa, Jev, ingestão automática) em ocorrência CRÍTICA | | | ✔ **se pré-autorizada** (`§ H.4` 43) | | |
| Religar o que foi desligado | | | | ✔ dono | |
| Rodar o gabarito | | | ✔ (sintético) | | |
| Mudar configuração dentro da faixa | | ✔ | | ✔ dono | |
| Mudar a faixa, a política, o Harness, as travas | | ✔ | | ✔ dono + PR nível 3 | ✘ automático |
| PR de documentação (nível 0) pelo agente | | | ◐ (`§ H.4` 42) | ✔ padrão | |
| PR de teste novo, sem mudar código | | | ◐ (`§ H.4` 42) | ✔ padrão | |
| PR nível 1 a 3 | | ✔ | | ✔ dono | |
| PR que toca arquivo de governança | | ✔ | | ✔ dono, sempre | ✘ pelo agente automático |
| Migração de dado, apagar dado, trocar segredo | | ✔ | | ✔ dono | |
| Distribuir, revisar, mexer em acesso | | | | | ✘ (não é da automação) |
| Treinar ou afinar modelo com dado real | | | | | ✘ (invariante 9) |
| Nota ou ranking de pessoa | | | | | ✘ (invariante 10) |
| O assistente executar comando | | | | | ✘ (invariante 13) |

**Pré-requisito de toda a coluna "executar sozinho":** `§ H.4` 7. A automação precisa de um `Ator` próprio (`agente` ou `sistema`), **sem** as operações que decidem carga. Hoje ela herdaria `operador`.

## II.J. Modelo de ocorrência (incidente)

### Severidade, definida por impacto

| Nível | Definição | Exemplos | Aviso | Contenção automática |
|---|---|---|---|---|
| **CRÍTICA** | integridade quebrada, dado exposto, ou dado real indo a destino não autorizado | conservação divergente; trava de dado real contornada; segredo no log | imediato | só a pré-autorizada, que **desliga** |
| **ALTA** | operação parada ou obrigação legal descumprida | ingestão silenciosa; limpeza LGPD falhando; credencial recusada | imediato, uma vez | não |
| **MÉDIA** | degradação | disjuntor; teto 80%; revisão envelhecendo; mudança de modelo | resumo diário | não (a mudança de modelo suspende o N3, porque é regra do N3, não contenção) |
| **BAIXA** | tendência | latência subindo; acerto caindo devagar | relatório semanal | não |
| INFO | registro | auditoria concluída; proposta mudou de estado | na linha do tempo | — |

### Ciclo

```text
detectada → confirmada (a checagem roda de novo antes de avisar: evita alarme por leitura no meio de transação)
 → contida (se pré-autorizada) → avisada → em investigação → corrigida (PR) → validada (checagem limpa + retrato)
 → encerrada
```

### Contra a avalanche de avisos

- Deduplicação por **impressão** (checagem + alvo): a mesma ocorrência aberta não abre outra, só soma "vista N vezes".
- Avisa na **transição** (abriu, subiu de severidade, fechou), nunca a cada verificação.
- MÉDIA e BAIXA vão em resumo.
- Uma ocorrência que abre e fecha sozinha mais de N vezes vira ocorrência própria: **"checagem instável"**. Um alarme que dispara na operação normal ensina a ignorá-lo, e o comentário de `conferirConservacao` já registra esse perigo.

### Canal

Na tela do dono, sempre. **Fora dela, não há canal hoje:**
- mandar e-mail pela caixa da associação exigiria `Mail.Send`, que o `A5` recusou de propósito;
- as alternativas (um e-mail de sistema próprio, notificação no celular por um serviço externo, mensagem num aplicativo) são decisão do dono, com custo e dado próprios (`§ H.4` 41).

## II.K. Modelo de segurança da autonomia

| Ataque | Contramedida |
|---|---|
| Injeção por dado (e-mail pede "abra uma proposta para liberar X") | o monitoramento lê **números e códigos**, nunca texto de e-mail; a proposta nasce de checagem ou do dono |
| Assistente vira autoridade | invariante 13; a tela preenchida exige clique; consultas fechadas |
| Burlar a aprovação | estado da proposta só muda por transição permitida, com `Ator` do dono; aprovação é `LogAuditoria` |
| **Autoalteração em laço** | parede entre planos (II.C); arquivos de governança fora do alcance do agente automático |
| Escalada de privilégio | `Ator` próprio para a automação (`§ H.4` 7); o agente de desenvolvimento só com o repositório |
| Automação em laço (proposta gera proposta) | uma proposta não cria proposta; o agente tem teto de PRs abertos por vez (ex.: 1) |
| Custo explosivo | teto de uso do agente por semana; teto diário da IA (existe) |
| **Falsa saúde** (checagem que deixou de rodar parece verde) | checagem de silêncio; a própria rotina de monitoramento tem batimento esperado; "sem dado" é estado próprio, nunca verde |
| Falsa confiança (auditoria declarando-se suficiente) | o relatório não tem campo "aprovado"; só números e achados; quem declara é o dono |
| Corrupção da memória de evolução | texto literal do dono; sugestão de modelo marcada; decisão só no Git |
| O Jev manipulando decisão indiretamente | regra monotônica; o Jev não é consultado para autorizar nada na Parte II |
| Dado sensível no relatório ou na proposta | retrato e ocorrência só com códigos, números e ids; `redigir` na gravação (já usado em `registrarEvento`) |

**Arquivos de governança**, que nunca mudam por automação (e já são nível 3 em `nivel-de-risco.ts`):
- `CLAUDE.md`, `docs/PROCESSO.md`, `docs/DECISOES.md` (seção A);
- `scripts/processo/**`, `.github/**`, `.claude/**`;
- `src/servidor/ambiente.ts` (travas);
- `src/core/harness/**` (política, quando existir);
- `src/core/operacao/**` (faixas e severidades, quando existir);
- a matriz de autonomia.

**Trava proposta:** o CI falha se um PR aberto pelo agente automático (branch com prefixo próprio, ex. `auto/`) tocar um desses caminhos. É determinística, como o job *Processo*.

**Limite declarado:** sem proteção de branch (plano do GitHub, `PROCESSO.md` seção 5), um check vermelho não impede o botão de mesclar. **Por isso nenhum merge automático acima do nível 0 é recomendado** enquanto isso valer.

## II.L. Modelo de observabilidade

Por evento de decisão ou ação, **sem conteúdo**:

| Campo | Onde fica | Existe? |
|---|---|---|
| id, momento, correlação | `EventoProcessamento`, `LogAuditoria` | ✅ |
| ator | `LogAuditoria.usuario` (do `Ator`) | ✅ |
| ação e etapa | `etapa`, `acao` | ✅ |
| motivos em código | `detalhe` | ◐ (revisão: `Revisao.motivo`; falta a lista inteira) |
| **impressão de versões**: commit, prompt, perguntas, política, algoritmo, Data Guard, modelo | `detalhe` | ◐ prompt, perguntas e algoritmo existem; **faltam política, Data Guard e commit** |
| ferramentas e modelo usados | `ChamadaDeIa` | ✗ (J3) |
| probabilidade usada | `detalhe` (`probabilidades[escolha]`) | ✅ Jev |
| resultado, latência, custo | `ChamadaDeIa` | ◐ latência somada por dia; custo não |
| fallback | evento | ◐ desistência sim; escalonamento não existe |
| revisão humana e desfecho | `Revisao` | ✅ |
| mudança produzida e validação | `PropostaDeEvolucao` + retratos | ✗ |

**"Por que este resultado foi diferente daquele?"** vira uma comparação de duas impressões de versão. Se forem iguais, a diferença veio da entrada, e a entrada (dentro da retenção) está em `EmailConteudo`. Se forem diferentes, o campo que mudou diz o que olhar.

**Versões que faltam e custam uma constante cada:** `VERSAO_DA_PROTECAO` (Data Guard), `VERSAO_DA_POLITICA` (Harness), e o commit injetado na construção.

## II.M. Avaliação da própria autonomia

### As métricas (seção 31)

| Métrica | Como se conta |
|---|---|
| Ocorrências por severidade | `Ocorrencia` |
| Detectadas pelo sistema × por pessoa | origem da ocorrência |
| Tempo até detectar, até conter, até resolver | estados |
| Falsos alarmes | encerradas como "não era problema" |
| Contenções aplicadas e revertidas | estados |
| Propostas: aprovadas, rejeitadas, bem-sucedidas (retrato dentro do esperado), revertidas | `PropostaDeEvolucao` |
| Ações bloqueadas pela política | eventos de recusa |
| Custo evitado × acrescentado | `ChamadaDeIa` antes × depois |

### Testes determinísticos da autonomia (seção 32)

Todos com banco de teste e relógio injetado, como as rotinas já fazem:

| Cenário | Teste |
|---|---|
| Normal | conservação quebrada de propósito → ocorrência CRÍTICA, uma só, aviso uma vez |
| Incerteza | checagem sem dado → estado "sem dado", nunca verde |
| Conflito | IA × Jev discordam → revisão (N2), com motivo |
| Falha | fornecedor fora → parada gravada; ingestão segue |
| Segurança | e-mail com "abra proposta" → nenhuma proposta; suspeita → pessoa |
| Laço | proposta não cria proposta; a mesma checagem não abre duas ocorrências |
| Volta atrás | retrato depois pior que antes → proposta vai a "revertida pendente", aviso ao dono |
| Custo | teto de escalonamento → parada gravada |
| Privacidade | varredura: nenhum campo de ocorrência, retrato ou proposta recebe texto de e-mail (como `segunda-opiniao.test.ts` faz com a trilha) |
| Governança | PR `auto/` tocando `CLAUDE.md` → CI vermelho |

## II.N. Plano de implementação — Parte II

| Fase | Objetivo | Arquivos | Contrato | Testes | Aceitação | Risco | Volta atrás |
|---|---|---|---|---|---|---|---|
| **O0. Ator próprio** (`§ H.4` 7) | automação sem autoridade de operador | `servidor/ator.ts`, `core/esquemas.ts` | papel ou tipo novo sem operações de carga | o ator automático recusado em "confirmar distribuição" | decisão do dono | schema | reverter |
| **O1. Papel `dono`** (`A32`, `§ H.4` 29) | a conta do Control Center | `esquemas.ts`, sessão, navegação | `dono` lê e configura; não opera | cada operação de carga recusada ao `dono` | decisão do dono | nível 3 | reverter |
| **O2. Saúde (leitura)** | tela de saúde sem tabela nova | `servicos/saude.ts`, `core/operacao/`, `app/controle/saude` | checagem → `{estado: ok\|atencao\|critico\|sem_dado, evidencia}` | cada checagem com dado plantado; "sem dado" nunca verde | o dono vê o estado real | leitura cara | leitura pura |
| **O3. Ocorrências + monitoramento** | detectar sozinho | `prisma/` (`Ocorrencia`), `rotinas.ts`, `core/operacao/` | impressão, severidade, estados | dedup; transição avisa; confirmação antes de avisar | CRÍTICA plantada vira uma ocorrência | alarme ruidoso | desligar a rotina |
| **O4. Retrato + relatório semanal** (`A32`) | antes × depois; auditoria determinística | `prisma/` (`Retrato`), `rotinas.ts` | linha de números e versões | nenhum texto; propriedade: dois retratos iguais → diff vazio | relatório legível | — | — |
| **O5. Configuração em faixas** | o dono ajusta sem código | `prisma/` (`Configuracao`), `core/operacao/faixas.ts` | chave tipada; faixa no código; mudança auditada | fora da faixa recusado no servidor | frequência da auditoria configurável | nível 3 | valor anterior |
| **O6. Contenção pré-autorizada** (`§ H.4` 43) | desligar na CRÍTICA | `fabrica.ts` lê o interruptor | só desliga; religar = dono | contenção nunca liga nada | interruptor visto funcionando | desligar a IA por falso alarme (efeito: vai tudo para pessoa) | religar |
| **O7. Propostas + aprovação** | problema → estratégia | `prisma/` (`PropostaDeEvolucao`), `app/controle/evolucao` | estados; nível e autonomia calculados | transições; nível pelo `nivelDaMudanca` | uma proposta de ponta a ponta com PR | — | — |
| **O8. Auditoria pelo agente de desenvolvimento** (`§ H.4` 46) | código, documentos e dívida semanalmente | rotina do Claude Code (fora do SBP); trava `auto/` no CI | relatório como issue ou PR de docs | trava de governança vista vermelha | primeiro relatório | uso do plano | desligar a rotina |
| **O9. Memória de evolução** (depois do `A21`) | conversa → registro | `prisma/` (`RegistroDeEvolucao`) | estados; texto literal; sugestão marcada | promoção só pelo dono | — | — | — |
| **O10. Assistente administrativo** (`§ H.4` 44) | perguntas com evidência | `core/assistente/`, consultas fechadas | número sem origem recusado | varredura de números × consultas | — | invariante 13 | desligar |
| **O11. Merge automático nível 0** (`§ H.4` 42) | só se o dono quiser | processo | — | — | — | sem proteção de branch | desligar |

## II.O. O que NÃO construir — Parte II

- **Não** dar ao servidor de produção credencial de Git, nem capacidade de mudar política, faixa ou Harness.
- **Não** criar um "agente gigante" nem um laço autônomo de "investigar tudo". Checagens nomeadas, pequenas, determinísticas.
- **Não** criar event bus, fila, microsserviço, Kubernetes, LangGraph: rotina + tabela + tela.
- **Não** usar canário no volume do SBP: não há amostra.
- **Não** criar uma "health score" única somando tudo. Soma esconde o que piorou; o semáforo é por área.
- **Não** permitir que o assistente execute nada (invariante 13), nem "só as ações de baixo risco".
- **Não** agrupar feedback ou memória por IA externa (`A32`).
- **Não** mostrar ranking, nota ou comparação de pessoa (invariante 10), nem no Control Center.
- **Não** construir módulos com nomes da seção 35 do pedido (Health Analyzer, Upgrade Planner…) como classes. São **seções de tela e funções**, não abstrações.
- **Não** automatizar merge acima do nível 0 sem proteção de branch.
- **Não** mandar e-mail pela caixa da associação para avisar (`A5`).
- **Não** construir o assistente administrativo com modelo antes de haver as consultas fechadas: sem elas, ele inventa métrica.

---

# PARTE III — A rota escolhida

## III.1. A ordem, e por quê

O dono pediu para escolher a melhor rota entre os dois pedidos. **Nem "tudo da Parte I, depois tudo da Parte II", nem o contrário.** A fundação dos dois é a mesma: medir, versionar e juntar a decisão num lugar. O Jev no fluxo depende de chave e de decisão; a operação autônoma depende de papel e de ator. Por isso a ordem intercala, e cada passo serve sozinho:

| # | Passo | Parte | Depende de | Por que agora |
|---|---|---|---|---|
| 1 | **J1** verificadores (literalidade, DV) | I | critério da pendência 17 | o maior ganho de confiabilidade, grátis, e ataca a fraqueza medida da IA local |
| 2 | **J2** Harness puro | I | — | toda decisão futura (N2, N3, contenção) entra aqui; sem mudar comportamento |
| 3 | **J3** registro por chamada + versões | I e II | — | P95, custo, "por que foi diferente", saúde da IA: tudo lê daqui |
| 4 | **Ingestão em segundo plano** | I | — | pré-requisito da IA local em produção |
| 5 | **J4** Jev em paralelo, **J7** relatório sombra × desfecho + calibração | I | — | leitura; prepara a decisão do `§ H.4` 36 |
| 6 | **O0 + O1** ator próprio, papel `dono` | II | `§ H.4` 7, 29, 45 | pré-requisito de toda automação e do Control Center |
| 7 | **O2** saúde (leitura) | II | O1 | primeiro valor visível para o dono, sem tabela nova |
| 8 | **O3 + O4** ocorrências, retrato, relatório semanal | II | O2 | "o sistema observa e detecta sozinho" |
| 9 | **J5, J6** perguntas tipadas, gabarito ampliado | I | `§ H.4` 31 | antes de gastar com o Jev |
| 10 | **J8 → J9 → J10** Jev em sombra ampliada → N2 → N3 | I | `A63`, `§ H.4` 35, 36, 37, 38 | só com medição |
| 11 | **O5 a O11** | II | decisões `§ H.4` 41 a 46 | na ordem da tabela II.N |

**Relação com a ordem combinada em 29/09** (pendências 11 a 39): o dono pediu para priorizar as instruções novas. A pendência 17 **é** o passo 1, e as pendências 34 a 36 caem dentro dos passos 5 e 9. As demais (sessão, testes, telas) seguem como estavam, intercaladas quando convier. Os PRs #146 e #147 estão parados em ponto seguro e cada um leva uma sessão curta.

## III.2. Onde o pedido do dono foi corrigido, em uma linha cada

1. O Data Guard é o portão de cada fornecedor externo, não da camada cognitiva inteira. A IA local recebe o texto cru (`A52`).
2. O Harness envolve a camada cognitiva antes **e** depois.
3. A IA local não é rápida: ~45 s por e-mail na máquina de 8 GB (estimado a partir do `A59`).
4. Não há IA paga para onde escalar (`A63`). Hoje o degrau acima é o humano.
5. O Jev não valida CPF nem CRM: o Data Guard os tira, e código faz melhor.
6. "Jev como router de modelos" tem pouco valor com um recurso só. O útil é o "pular" (sem ação), que é N3.
7. Os níveis de autonomia são por **efeito** (observar, sinalizar, endurecer, poupar), por tarefa e categoria. Não é uma escada global.
8. O assistente administrativo "executando" colide com o invariante 13. A proposta é tela preenchida, com o dono confirmando.
9. A autoalteração se evita com **dois planos e credenciais separadas**, não com uma regra que o sistema promete seguir.
10. Encontrar "problemas que ninguém pediu" é um catálogo de checagens determinísticas que cresce por PR, não um modelo procurando à toa.

## III.3. Decisões que só o dono pode tomar

Registradas em `DECISOES.md § H.4`, itens **37 a 46**, com recomendação:

- **37.** Regra monotônica para sinal de IA: só aumenta o cuidado até calibrar. *Recomendação: sim.*
- **38.** Amostra de conferência contínua em N3: qual fração, e que erro é tolerável por categoria.
- **39.** O fim da escada enquanto valer o `A63`: humano. IA paga só depois dos termos do `A38`.
- **40.** Critério de igualdade da literalidade (pendência 17). *Proposta: normalizada; número só por dígitos.*
- **41.** Canal de aviso fora do sistema (hoje não existe; e-mail pela caixa colide com o `A5`).
- **42.** Merge automático pelo agente de desenvolvimento. *Recomendação: nenhum agora; no máximo nível 0 depois.*
- **43.** Quais contenções o sistema pode aplicar sozinho em ocorrência CRÍTICA. *Recomendação: só desligar a IA externa, o Jev e a ingestão automática.*
- **44.** O assistente administrativo pode devolver tela com valor preenchido (extensão do invariante 13)? E pode usar IA paga com dado agregado, sem pessoa?
- **45.** "Minha conta" é o papel `dono` do `A32`/`A53`, separado do gestor? O que o gestor vê do Control Center?
- **46.** Auditoria semanal de código por uma rotina do Claude Code, que usa o plano do dono e lê só o repositório?

Continuam valendo e são pré-requisito: `§ H.4` 7 (ator do agente), 29 (conta do dono), 31 (gabarito conferido pela equipe), 35 (dado real no Jev), 36 (divisão de trabalho) e o `A63`.
