# Direção do projeto — em uma página

Última revisão: **29/09/2026** (linha de chegada do protótipo). Esta página não decide nada sozinha: ela junta, em um lugar, o rumo que está espalhado em `DECISOES.md` e em `docs/arquitetura/`. Quando o dono trouxer informação nova, ela é comparada com esta página (igual, diferente, complementar ou em conflito) antes de virar trabalho.

## Para que o SBP existe agora

Um protótipo que **a equipe usa de verdade**, que mostra eficiência, recebe feedback e melhora — para validar a ideia com a empresa e conseguir aprovação para algo maior. **Bem feito antes de rápido.** Uso real puxa para frente a implantação e o canal de feedback, sem cortar qualidade.

## O princípio

**Micro hoje, plataforma amanhã.** Fundamento certo, que permita crescer sem reescrever. Nada da arquitetura futura é construído só porque foi descrito.

- Escada "simplicidade primeiro" e fronteira agora × futuro: `arquitetura/2026-09-14-avaliacao-arquitetura-cognitiva.md` (seções 19 e 23).
- Estágios AGORA / PRÓXIMO / DEPOIS: `arquitetura/2026-09-16-evolucao-prototipo-para-plataforma.md`.
- **Diagnóstico antes de modificação. Evidência antes de decisão. Pequenas mudanças antes de grandes refatorações.**

## A visão de longo prazo

Um Cérebro que não depende de modelo, um Harness que governa toda a inteligência (inclusive a entrada), agentes com contrato, ferramentas por um portão único, proveniência, verificação determinística antes de IA, roteamento por tarefa, sensibilidade, confiança e custo, e autonomia que cresce aos poucos.

Correções já assumidas: o Cérebro **propõe**, não controla o fluxo; evolução é avaliação com promoção humana, nunca mudança automática.

**A lacuna que destrava quase tudo:** um conjunto de avaliação com gabarito e nota automática. Sem ele não dá para comparar modelos, justificar um modelo local nem promover um prompt. **Existe desde 17/09/2026** (`npm run ia:avaliar`, `DECISOES.md § AT-36`); falta a equipe conferir as respostas esperadas (`§ H.4` item 31).

## Dado e equipe

Resumo de `DECISOES.md § A19–A26, A30, A33`:

- Guardar **contexto e processo**, não dado bruto; não duplicar o cadastro da associação.
- O feedback da equipe define o rumo; toda tela nasce com campo de feedback; nenhum feedback muda o sistema sozinho.
- Ajudar quem tem dificuldade, **sem nota sobre pessoa** (invariante 10).
- Na dúvida, a opção reversível e medida, marcada como observação.
- Meta: a equipe abre o sistema e trabalha, sem varrer o Outlook todo dia.

## Inteligência artificial

**Onde entra:** entender o e-mail (tipo e campos) e explicar o sistema (assistente). **Onde não entra:** dividir o trabalho, tratar o resto, calcular métrica, achar CPF — isso é código (invariante 2).

**Nenhum fornecedor é premissa.** Vale para este sistema e para os próximos projetos do dono: port + perfil do fornecedor + fábrica por variável de ambiente, e fornecedor novo sem tocar `core/`, `servicos/` nem `app/` (`A15`).

| Peça | Situação |
|---|---|
| Anthropic | IA paga, depois da rodada de segurança (`A49`); vira capacidade avançada e escalonamento (`A51`) |
| Gemini | Rotina de teste até o protótipo ficar pronto (`A50`) |
| IA local | Desde o início da implantação (`A51`). Máquina garantida, **8 GB de RAM**. Estrutura pronta em 17/09/2026: gabarito (`AT-36`) e `ia-local.ts` (`AT-37`); faltam a máquina, o modelo e a decisão do dono para dado real |
| CPF | Sai do texto antes de modelo externo (`A52`) |
| Custo | Registro por chamada, teto diário e disjuntor (`A54`) |
| Aprender | Medir e propor regra, com aprovação humana (`A53`); nada de treinar com dado real (invariante 9) |

## Odysseus — ferramenta, nunca o cérebro

Decisão em `A56`. Em resumo:

- O SBP fala com **qualquer servidor de modelo compatível com OpenAI**. O Odysseus é uma das formas de escolher, testar e servir esse modelo.
- **O SBP funciona se o Odysseus sumir amanhã:** trocar de servidor é trocar um endereço.
- Nada do SBP é delegado a ele: nem e-mail, nem memória, nem agentes com dado da associação.
- Nenhum código dele é copiado para cá (AGPL).
- **Escolha do modelo, só com a máquina em mãos:** CPU, RAM, GPU, VRAM, disco, sistema, drivers → modelos compatíveis → desempenho, qualidade (pelo gabarito) e estabilidade → só então o primeiro modelo. O maior não é necessariamente o melhor.

## Segredos

Gestor de segredos (Infisical ou o da empresa) no lugar do `.env` em produção — **e a rodada paralela já conta como produção** (`A68`). O projeto está **preparado, não migrado** (`auditoria/2026-09-16-segredos-e-dados-sensiveis.md`, seção 8). A migração é de operação, não de código.

**Cuidado:** a suíte de testes nunca roda com `DATABASE_URL` injetada de produção (N-01).

## Linha de chegada do protótipo *(29/09/2026, pedido do dono)*

O dono teme evoluir o sistema sem necessidade e nunca terminar. **O medo tem fundamento.** O núcleo do protótipo está pronto desde setembro:
- ingestão, interpretação, revisão, distribuição, fila, caixa e painel;
- assistente, acesso, afastamentos e retenção;
- 1609 testes.

O que separa o protótipo do uso real está **quase todo fora do código**: TI, servidor e decisões. Trabalho de código pode crescer para sempre enquanto isso espera.

**Pronto é:** a equipe usar o SBP **com e-mail real, em paralelo com a planilha, por 2 semanas** (a rodada paralela do `A5`). O resultado se lê pelos critérios de aceitação do PRD (seção 5).

**1. Código que ainda falta — só o que bloqueia a rodada paralela:**
- ~~(a) fechar os PRs #146 e #147~~ — mesclados em 29/09;
- ~~(b) **pendência 17**: conferir que o valor extraído está no texto~~ — mesclada no #150 (`AT-51`);
- (e) **os atritos 2 e 3** (`A67`): a Revisão mostra o e-mail ao lado do que a IA leu, e a Minha fila vira lista e detalhe. Entram porque a rodada paralela só funciona se a equipe quiser usar o sistema;
- (c) **pendência 37**: recusar `NODE_TLS_REJECT_UNAUTHORIZED=0` em produção, porque com ela o texto do e-mail fica exposto no caminho;
- (d) **a sincronização não pode prender a tela**, e só se a medição mandar. Primeiro medir, na máquina da IA local, o tempo por e-mail. Se passar de alguns segundos, a sincronização vira rotina em segundo plano.

**2. Fora do código — o caminho crítico de verdade, do dono e do TI:**
- credencial do Microsoft 365 com `Mail.Read` só da caixa do setor, e a data de `GRAPH_LER_DESDE` (`AT-35`, `AT-47`);
- servidor Linux (`A61`): distribuição, MySQL, backup sem `.env`, segredos fora do disco (`AT-47`);
- **segredos no gestor (Infisical ou o da empresa) antes do primeiro e-mail real** (`A68`): a rodada paralela já é produção;
- **o servidor precisa alcançar a IA local.** Hoje o Ollama da máquina Debian só atende a ela mesma (`127.0.0.1`). É preciso decidir entre rodar o SBP na mesma máquina ou abrir o Ollama só para o servidor, na rede interna e com firewall. O `AT-37` já recusa endereço público;
- **decisão do dono:** e-mail real na IA local (`IA_PARA_DADO_REAL.local`, `A56 (e)`);
- repositório privado (pendência 20);
- recomendado: meia hora da equipe conferindo o gabarito (`§ H.4` 31);
- decisões abertas que tocam o uso: `§ H.4` 30 e 32, `AT-42`.

**3. Congelado até o fim da rodada paralela** (não é abandonado; é depois):
- o Jev, inclusive a medição e o "Jev próprio";
- o Harness em `core/harness/` e o registro por chamada;
- o Control Center, o papel Supervisor do sistema e a operação autônoma;
- o assistente administrativo e a memória de evolução;
- a fase de design;
- as pendências que não estão no item 1.

O plano delas está em `docs/arquitetura/2026-09-29-jev-harness-e-operacao-autonoma.md`, e a ordem delas **depois** vai sair do que a equipe relatar na rodada paralela, não da arquitetura.

**Regra até a linha de chegada.** Toda ideia nova, do dono ou do agente, entra numa lista "depois do protótipo" no `ESTADO.md` e **não vira trabalho**. A exceção é o que se enquadra em pelo menos um de três casos:
- **(i)** bloqueia a rodada paralela;
- **(ii)** é defeito real;
- **(iii)** é risco de segurança ou de dado real.

O agente diz em qual dos três a ideia se encaixa antes de começar.

## O que não fazer agora

- Framework de agentes ou de grafos.
- Roteador dinâmico.
- Filas, barramento, Kubernetes, vários bancos.
- IA local em produção antes do gabarito.
- Memória soprada de volta ao modelo (invariante 12).
- Dezenas de modelos.
- Grandes refatorações só para parecer com a arquitetura futura.
