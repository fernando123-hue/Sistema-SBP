# Direção do projeto — em uma página

Última revisão: **17/09/2026**. Esta página não decide nada sozinha: ela junta, em um lugar, o rumo que está espalhado em `DECISOES.md` e em `docs/arquitetura/`. Quando o dono trouxer informação nova, ela é comparada com esta página (igual, diferente, complementar ou em conflito) antes de virar trabalho.

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

**A lacuna que destrava quase tudo:** um conjunto de avaliação com gabarito e nota automática. Sem ele não dá para comparar modelos, justificar um modelo local nem promover um prompt.

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
| IA local | Desde o início da implantação (`A51`). Máquina garantida, **8 GB de RAM**; até ela chegar, só estrutura (`A56`) |
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

Gestor de segredos (Infisical ou o da empresa) no lugar do `.env` em produção. O projeto está **preparado, não migrado** (`auditoria/2026-09-16-segredos-e-dados-sensiveis.md`, seção 8). A migração é de operação, não de código.

**Cuidado:** a suíte de testes nunca roda com `DATABASE_URL` injetada de produção (N-01).

## O que não fazer agora

- Framework de agentes ou de grafos.
- Roteador dinâmico.
- Filas, barramento, Kubernetes, vários bancos.
- IA local em produção antes do gabarito.
- Memória soprada de volta ao modelo (invariante 12).
- Dezenas de modelos.
- Grandes refatorações só para parecer com a arquitetura futura.
