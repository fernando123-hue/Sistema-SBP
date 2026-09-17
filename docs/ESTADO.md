# Estado do projeto — retomada

Última atualização: **17/09/2026, tarde** — `main` em `35dc5d2` (PR #67). Suíte: **91 arquivos, 1032 testes** verde, local e no CI. Trabalho em curso: **rodada de segurança e qualidade** (`DECISOES.md § A49`), etapa 2 (corrigir).

> ## ▶ Próxima sessão: comece aqui
>
> ### Situação em 17/09/2026, manhã — o dono deu autonomia total e foi descansar
>
> **Feito nesta manhã, tudo mesclado com as duas revisões publicadas no PR e o CI lido check a check:**
> - **#56** — documentos da auditoria (etapa 1) e `.gitignore` para chaves.
> - **#57 — N-01**: a suíte só apaga base cujo nome termina em `_teste`.
> - **#58 — C-01**: `campos` volta a sair preenchido com a Anthropic (lista de pares); prompts `anthropic-1.1.0`/`gemini-1.1.0`; o SDK não valida mais por nós (erro de forma volta a repetir uma vez).
> - **#59 — C-02/C-03**: leitura da caixa com janela de 7 dias a partir de `GRAPH_LER_DESDE` (novo, obrigatório com `graph`), mensagem ruim recusada pelo nome, teto de 200 só sobre as novas (`AT-35`).
> - **#60 — C-04**: `messageId` e `referencia` do evento limitados a 191 (conferido contra a coluna), corte por caractere e SHA-256 quando corta.
> - **#61**: identificador repetido com outra data vira aviso (`repetidas`) e evento agregado; mensagens recusadas viram `naoLidas` na tela (visto rodando).
> - **#62 — N-02/N-27**: anexo do Graph que não é arquivo vira recusa; grande não é baixado; teto de 50 anexos e de 100 MB por mensagem antes do download.
> - **#63 — N-17/N-18**: caixa real só sobe com IA permitida para dado real (hoje só `anthropic`); produção recusa segredo público ou previsível. `.gitleaksignore` criado (uma exceção, com motivo).
>
> - **#65 — C-12**: acesso sem senha, `unsafe-eval` e cookie sem `Secure` só com `NODE_ENV=development`; a variável é recusada fora de desenvolvimento e quando escrita num `.env*`.
> - **#66 — C-10, C-22, C-23, N-10**: concluir/devolver/transferir/resolver/desligar travam a linha antes de ler; impasse repetido (`servidor/conflito.ts` — o impasse em consulta crua chega como `P2010`).
> - **#67 — C-09, C-08 (parte), N-07**: tentativa de senha reservada antes do hash; gestor não redefine a própria senha; último gestor travado. **Pergunta nova ao dono: `DECISOES.md § H.4` item 30.**
>
> **Fila agora:** (a) médios confirmados abertos: **C-13/C-17** (rotas sem conferência de origem; CSRF de login), **C-14** (limite por origem escolhido pelo cliente), **C-06 = `A54`** (disjuntor, teto diário, custo da IA), **C-11/N-13** (e-mail que a IA nunca estrutura é pago de novo a cada leitura), **C-05** (máscara de CPF, `A52`, medir antes); (b) baixos confirmados C-15…C-21, C-24; (c) verificar os `N-` restantes — já verificados: N-01, N-02, N-07, N-10, N-14, N-17, N-18, N-27.
>
> **Pendências para o dono:** o MySQL desta máquina está ligado **sem** `--mysqlx=OFF` (porta 33060 aberta em todas as interfaces, M-01): o classificador recusou que o agente o desligasse. Desligue e suba de novo como no passo 1 abaixo.
>
> **Lições gravadas:** nunca rodar dois `vitest` ao mesmo tempo (o `globalSetup` recria a base — deu 17 falhas falsas); revisor por agente sem rodar testes durante a suíte e com temporários só na pasta da sessão; link de revisão no corpo do PR só depois de listar os comentários.
>
> ### Retomada de 17/09/2026, madrugada — depois de um `/clear`
>
> **O dono limpou o contexto de propósito.** Leia *Como o dono prefere trabalhar* (mais abaixo) e **`docs/PROCESSO.md`** antes de mexer em qualquer coisa. Se algo aqui contradisser o código, o código vence.
>
> **Duas regras novas do dono (17/09/2026):**
> - **Não usar Workflow** (agentes em paralelo): a auditoria gastou cerca de 5,5 milhões de tokens e bateu o limite duas vezes. Um agente revisor por vez, quando o processo exigir.
> - **Quando ele avisar "vou dar clear" ou "vou trocar de chat": parar e preparar a retomada** — tudo que só existe na conversa vai para o repositório, commit e push, este bloco atualizado, nada rodando em segundo plano.
>
> **1. Ligue e confira, nesta ordem:**
> 1. MySQL (não é serviço; para quando a sessão acaba). PowerShell, em segundo plano — **com `--mysqlx=OFF`** (achado M-01: sem isso o protocolo X abre a porta 33060 em todas as interfaces): `& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --datadir=C:\Users\Irineu\mysql-sbp\dados --port=3307 --bind-address=127.0.0.1 --mysqlx=OFF`. Confira: `netstat -an | findstr "3307 33060"` — só `127.0.0.1:3307`.
> 2. `git fetch && git switch docs/auditoria-rodada-seguranca-qualidade && git pull` → `git log --oneline -1` mostra o commit desta retomada ou mais novo. `git log --oneline -1 origin/main` → `47373ab` ou mais novo.
> 3. `npm ci` (servidor de visualização parado antes), `npx prisma generate`, `npx prisma migrate deploy`, `npm run verificar` — zero vermelho, zero pulado.
>
> **2. O que aconteceu em 16–17/09/2026 (depois da retomada anterior):**
> - **Dois roteiros do dono, gravados:** `docs/auditoria/roteiro-da-auditoria-de-seguranca.md` (método obrigatório da auditoria; formato de achado da seção 21) e `docs/arquitetura/2026-09-16-evolucao-prototipo-para-plataforma.md` (arquitetura evolutiva; perguntas respondidas).
> - **Decisões novas** em `DECISOES.md`: `A50` (teste da IA com Gemini vira rotina — tarefa agendada `sbp-teste-ia-gemini`, 7h30 e 13h30, histórico em `C:/Users/Irineu/sbp-rotina-ia/historico.md`, fora do repositório), `A51` (IA local desde o início da implantação; até lá, estruturar), `A52` (CPF trocado por marcador antes de modelo externo, medido antes), `A53` ("aprender" = medir e propor regra com aprovação; conta do dono única e separada da gestão), `A54` (custo e disjuntor da IA entram nesta rodada), `A55` (processo por nível de risco). Pergunta nova ao dono: `§ H.4` item 29 (o que a conta do dono faz além de ver).
> - **PR #55 mesclado** (`47373ab`): `docs/PROCESSO.md`, `scripts/processo/` e o job **Processo** do CI. **Todo PR agora precisa das seções de evidência do modelo; nível 2+ exige link de revisão por agente publicada no PR; nível 3 exige também revisão de segurança.** O próprio #55 passou por isso (duas revisões, 1 alto + 3 médios + 1 baixo corrigidos com teste visto vermelho).
> - **Auditoria de segredos** (`docs/auditoria/2026-09-16-segredos-e-dados-sensiveis.md`): **nenhum segredo real** no histórico (83 revisões, branches remotas incluídas). `.gitignore` passou a recusar `*.pem`, `*.key`, `*.p12`, `*.pfx`. Ação do dono pendente: restringir a chave do Google no console.
> - **Medições** (`docs/auditoria/2026-09-16-rodada-de-seguranca-e-qualidade.md`): `npm audit` 0; cobertura 95,63% das linhas; `ia-anthropic.ts` só 35%; bateria Gemini com `503` em 7 de 8 chamadas; achado manual **M-01**.
> - **Auditoria por agentes** (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`): 68 achados únicos. **27 confirmados** (nenhum crítico; **4 altos**, 10 médios, 10 baixos, 3 informativos), **41 sem verificação** (o limite acabou; 1 alto), 19 de menor valor descartados pelo teto. O crítico de completude não rodou.
>
> **3. PRÓXIMO TRABALHO, nesta ordem:**
> 1. **Abrir o PR da branch `docs/auditoria-rodada-seguranca-qualidade`.** É **nível 3** (mexe em `.gitignore`): preencher as seções de evidência do modelo; revisão técnica e de segurança por agentes, **uma de cada vez**, publicadas no PR e linkadas no corpo; CI check a check; mesclar.
> 2. ~~**N-01**~~ **FEITO (17/09/2026, manhã):** confirmado lendo o código e corrigido — `src/testes/preparar-banco.ts` (`conferirBaseDeTeste`) recusa, antes do `migrate reset`, qualquer base cujo nome não termine em `_teste`. Um `DATABASE_URL` da base `sbp` esquecido no shell agora derruba a suíte com mensagem clara, sem apagar nada.
> 3. **Os 4 altos confirmados**, um PR por tema (nível 3):
>    - **C-01** `src/adapters/ia-anthropic.ts:88` — com a Anthropic, `campos` sai sempre vazio (nome, CPF, CRM nunca extraídos). **CORRIGIDO (17/09/2026, manhã):** `campos` passou a viajar do modelo como lista de pares `{chave, valor}` (a saída estruturada da Anthropic fecha todo objeto e reduzia o mapa a `{}`); prompts `anthropic-1.1.0` e `gemini-1.1.0`. **Ainda falta, antes da chave paga:** a amostra contra o modelo real (`A49`) e a rotina do Gemini (`A50`) mostrar `campos` preenchido com o formato novo.
>    - ~~**C-02 e C-03**~~ **CORRIGIDOS (17/09/2026, manhã):** a caixa é lida numa janela de 7 dias a partir de `GRAPH_LER_DESDE` (novo, obrigatório com `graph` — o dia da implantação); mensagem fora do esquema vira falha com o identificador, sem derrubar as outras; o já processado sai antes do teto de 200 (`AT-35`).
>    - ~~**C-04**~~ **CORRIGIDO (17/09/2026, manhã):** `messageId` limitado a 191, conferido contra a coluna; e a `referencia` do evento também é cortada em 191 — sem isso, gravar a falha de um identificador longo derrubava a sincronização inteira.
> 3b. ~~**Colisão de `internetMessageId`**~~ **FEITO (17/09/2026, manhã):** identificador repetido com outra data vira evento agregado, fora do teto — `DECISOES.md § AT-35`.
> 4. **Verificar os 40 restantes sem verificação (N-02…)**, um por vez, lendo o código (sem workflow) — cada um vira confirmado (com destino) ou refutado (com motivo) na tabela.
> 5. **Médios, baixos e informativos confirmados**, agrupados por tema, e `A54` (registro de uso, teto diário, disjuntor da IA — há achados confirmados sobre isso).
> 6. Preencher a coluna **Destino** de todos os achados; nenhum fica sem destino. Decisão de negócio vira pergunta ao dono (`§ H.4`).
>
> **4. Esperando gente de fora:** TI da associação (Microsoft 365, `Mail.Read` só da caixa, subpastas — `AT-33`; e, no dia de ligar, o `GRAPH_LER_DESDE` — `AT-35`); Anthropic só depois da rodada e de C-01; onde publicar (`A46`); canal de feedback (`A21`); papel `dono` (`A32` + `§ H.4` item 29); contar à equipe que as buscas são contadas (`A44(i)`).
>
> **5. Armadilhas desta máquina, novas:**
> - **Git Bash converte argumentos que começam com `/`** em caminho do Windows (`/x` vira `C:/Program Files/Git/x`). Use `MSYS_NO_PATHCONV=1` antes do comando.
> - **Worktree** (`.worktrees/…`) não tem `.env`: a suíte falha com `SESSAO_SECRET` ausente — defina um valor de teste no comando. Se ligar `node_modules` por junction, **remova a junction com `cmd /c rmdir` antes de `git worktree remove`**, senão a remoção pode apagar o original. Sobrou uma pasta vazia travada em `.worktrees/processo` (ignorada pelo Git; apagar quando destravar).
> - O job **Processo** roda de novo a cada edição do corpo do PR e cancela o anterior: um check "cancelado" ao lado de um "sucesso" no mesmo commit é normal.
> - As anteriores continuam valendo (abaixo, na retomada de 16/09 à tarde).
>
> ---
>
> *Histórico das retomadas anteriores, mantido como registro:*
>
> ### Retomada de 16/09/2026, fim da tarde — depois de um `/clear`
>
> **O dono limpou o contexto de propósito.** Tudo o que importa está neste bloco, em `DECISOES.md` e no código. Se algo aqui contradisser o código, o código vence. Leia *Como o dono prefere trabalhar*, logo abaixo, **antes** de falar com ele.
>
> **1. Ligue e confira, nesta ordem** (este computador; outro computador: *Preparar o ambiente*):
> 1. MySQL — **não é serviço do Windows** e para quando a sessão acaba. Em PowerShell, em segundo plano: `& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --datadir=C:\Users\Irineu\mysql-sbp\dados --port=3307 --bind-address=127.0.0.1`. Confira com `netstat -an | findstr 3307`.
> 2. `git switch main && git pull` → `git log --oneline -1` deve mostrar `c60fbea` ou um commit mais novo (o PR de documentação desta retomada entra por cima dele).
> 3. `npm ci` — **pare o servidor de visualização antes**, senão o Windows trava arquivos e a instalação falha. O PR #50 trouxe **vitest 5**; `node_modules` antigo não serve.
> 4. `npx prisma generate` e `npx prisma migrate deploy` (aplica na base `sbp` o que faltar; nunca apaga).
> 5. `npm run verificar` — tem de fechar com **zero vermelho e zero pulado**. Vermelho antes de mexer em qualquer coisa: rode o arquivo sozinho antes de chamar de regressão (máquina ocupada e data fixa em teste já enganaram).
>
> **2. O que entrou em 16/09/2026 à tarde** — tudo mesclado, cada PR revisado por agente, revisão publicada no PR e os três checks lidos um a um:
> - **#50** — dependências (zod 4.6, `@anthropic-ai/sdk` 0.125, next 16.3.5, **vitest 5**). Substituiu os PRs do dependabot #33, #34, #42 e #43, fechados.
> - **#51** — a caixa do Microsoft 365 é lida **só pela caixa de entrada** (`§ AT-33`, provisória). Antes, a resposta da própria secretaria (Itens Enviados) voltaria como pedido novo.
> - **#52** — a busca por CPF ou matrícula é **contada** por pessoa e por dia (`ContagemDeBusca`), sem bloquear ninguém, por 90 dias (`§ A48`). **Nenhuma tela lê a contagem.** Falta o nível 2 de `A44` (bloqueio da busca da conta), que depende dos limites medidos com uso real.
> - **#53** — **todas as tabelas em `utf8mb4_0900_as_cs`** (`§ AT-34`). O Prisma grava `unicode_ci` em cada `CREATE TABLE`; com isso, "Liga X" e "liga x" viravam uma liga só, e dois e-mails do Graph podiam virar um. **Regra nova: toda migração que cria tabela termina com `ALTER TABLE … CONVERT TO … utf8mb4_0900_as_cs`** — `src/servidor/colacao.test.ts` fica vermelho se esquecer.
>
> **3. Esperando gente de fora:**
> - **TI da associação** — o dono **já enviou** o pedido em 16/09/2026 (confirmar Microsoft 365; permissão `Mail.Read` restrita só à caixa da secretaria; segredo entregue fora do e-mail, com data de validade; se regras do Outlook movem pedidos para subpastas — isso decide o `AT-33`). O texto ficou fora do repositório, com o dono. Quando a resposta chegar: credenciais só no `.env`, nunca em conversa nem em arquivo versionado.
> - **IA paga: Anthropic** (`§ A49`) — **mas só depois da rodada abaixo.** Antes da chave: termos sem uso do conteúdo para treino (`A38`), adapter conferido contra o SDK 0.125, amostra contra o modelo real.
> - Ainda abertos com o dono: onde publicar (`A46`, falta a máquina), canal de comentários em toda tela (`A21`), papel `dono` (`A32`), e contar à equipe no primeiro dia que as buscas são contadas e por quê (`A44(i)`).
>
> **4. PRÓXIMO TRABALHO — rodada de segurança e qualidade (`§ A49`).** Pedido do dono: *"reforçar a segurança e a qualidade do protótipo"* com o que está ao nosso alcance. **Bem feito antes de rápido.**
>
> *Por que agora:* a última auditoria completa (16 dimensões) é de **08/09/2026** e a última revisão de segurança do conjunto é de **15/09/2026**, só sobre a fase 1. **Nunca foram auditados como conjunto:** a fase 2 (#48, quem vê o quê), a implantação (#49: MySQL, adapter do Graph, CI com banco) e #50–#53. Cada PR teve revisão própria, mas defeito de fronteira mora entre os PRs.
>
> *Como fazer — em três etapas, uma por conversa se o contexto apertar:*
> 1. **Auditar, só leitura, sobre a `main` inteira**, e **gravar o resultado antes de corrigir** em `docs/auditoria/AAAA-MM-DD-rodada-de-seguranca-e-qualidade.md` (achado que só existe na conversa se perde no próximo `/clear`). Cada achado: arquivo:linha, severidade, cenário concreto, correção sugerida. Dimensões mínimas:
>    - **Segurança:** autorização por papel em **cada** rota de `src/app/api` (e o recorte de `A24` em toda leitura de item); sessão, cookie, saída e troca de senha; limites por minuto; injeção de prompt nas três camadas (`conteudo-nao-confiavel`) e na pergunta do assistente; anexos (assinatura, tamanho, cifra, download com trilha); cabeçalhos e CSP (`next.config.ts`, `src/middleware.ts`); segredos e `.env.example`; nada de CPF, e-mail ou texto digitado em log, trilha ou endereço; `ACESSO_LOCAL_SEM_SENHA` recusado em produção; o adapter do Graph só lendo.
>    - **Privacidade e retenção:** as três limpezas e a contagem de buscas; invariantes 9 a 14.
>    - **Banco:** consultas sem limite, N+1, índices, transações que garantem a conservação, a colação (`AT-34`), `onDelete` que apagaria histórico.
>    - **Falhas silenciosas:** `catch` que engole, valor padrão que esconde erro (invariante 7).
>    - **Testes:** o que não tem teste nenhum; teste que passa sem provar; datas fixas; cobertura (`npm run test:cobertura`, estava em 92,8% das linhas).
>    - **Tipos e contratos**, **dependências** (`npm audit`; `AT-31`, override do `mariadb`), **telas** (texto simples para a equipe, acessibilidade, celular), **documentos contra o código**.
> 2. **Corrigir por severidade**, crítico e alto primeiro. **Um PR por tema**, a partir da `main`. Cada correção com **teste visto vermelho** contra o defeito antes; mudança de tela **vista rodando** (`sbp-local`); CI lido check a check.
> 3. **Revisar e mesclar no fim**, como o dono pediu (ver *Como o dono prefere trabalhar*). Atualizar a tabela da auditoria com o destino de cada achado — nenhum fica sem destino. Decisão de negócio que aparecer vira pergunta ao dono (`§ H.4`), nunca regra inventada.
>
> *Sobre usar vários agentes ao mesmo tempo:* uma auditoria em várias dimensões rende mais com agentes em paralelo, mas o ambiente só dispara um *workflow* de vários agentes quando o dono pede com as próprias palavras ("use um workflow"). Sem isso, rode as dimensões uma a uma, com agentes revisores de leitura (`security-reviewer`, `database-reviewer`, `silent-failure-hunter`, `pr-test-analyzer`, `type-design-analyzer`), e **pergunte ao dono** se ele quer a versão em paralelo, dizendo o custo. O limite de uso dele é apertado: resultados curtos, sem despejar saídas longas.
>
> **5. Armadilhas desta máquina, já medidas:**
> - `gh pr checks --watch` sai com 0 mesmo com check vermelho: leia `gh pr view N --json headRefOid,statusCheckRollup` check a check, e confira que o commit do check é o último enviado.
> - O classificador de permissões **bloqueia mesclar sem revisão**. Publique a revisão no PR (`gh pr comment`) antes do `gh pr merge --squash --delete-branch`.
> - `npx prisma migrate dev` numa branch mais velha que a base `sbp` pede para **apagar a base**: não aceite; crie a migração à mão (pasta com data e `migration.sql`) e aplique com `migrate deploy`.
> - No Windows, `migrate diff` acusa diferenças falsas (`AT-32`); vale o CI em Linux.
> - Captura de tela do painel às vezes vem preta: leia o texto da página (`get_page_text` ou `document.body.innerText`).
> - Não há Python nesta máquina; scripts de edição, em Node, gravados com a ferramenta de arquivo (heredoc com aspas quebra a shell). Arquivos em CRLF: normalize antes de procurar texto com várias linhas.
>
> ---
>
> *Histórico das retomadas anteriores, mantido como registro:*
>
> **Retomada de 16/09/2026, pensada para continuar em OUTRA máquina.** As anotações que o agente guarda entre conversas ficam só no computador onde ele rodou — **um chat em outra máquina não as enxerga**. O essencial está neste arquivo e em `DECISOES.md`. Se algo aqui contradisser o código, o código vence: confira antes de confiar.
>
> **1. Onde está.** `git switch main && git pull`. Na `main`: fase 1 (PR #44), piso de retenção (PR #47), fase 2 — `A24` (PR #48) — e o primeiro bloco da implantação (PR #49). **Nenhum PR aberto.** **Nenhuma pessoa revisou o código — só agentes**; por decisão do dono (`§ A43`), a leitura humana acontece quando o protótipo inteiro estiver pronto para rodar.
>
> **2. Qual computador você está usando — é isso que decide o primeiro passo.**
> - **Este mesmo computador, acessado remotamente:** o ambiente está pronto — MySQL instalado, bases criadas, `.env` preenchido —, mas **o MySQL não é serviço do Windows e fica parado** depois de reiniciar ou de a sessão acabar. Ligue antes de qualquer coisa: *Continuando em outra máquina → Caso A*.
> - **Outro computador, com clone novo:** nada do ambiente vem junto — nem banco, nem `.env`, nem segredos. Siga *Preparar o ambiente*, do começo ao fim.
>
> **3. O banco é MySQL, e nada roda sem ele ligado** (`§ A42`, `§ AT-28`, `§ AT-30`). A suíte inteira roda contra ele — 80 arquivos, 860 testes, verde aqui e no CI. A base precisa da colação `utf8mb4_0900_as_cs`. Três armadilhas já medidas: o driver só é seguro com o `override` do `package.json` (`§ AT-31`); **no Windows**, a conferência de schema contra migrações acusa diferença que não existe (`§ AT-32`); e o Prisma 7 recusa várias opções de linha de comando que versões antigas aceitavam — confira `--help` antes de usar uma.
>
> **4. Próximo trabalho — depende do dono, não de código.**
> - **Caixa de e-mail real:** perguntar ao TI da associação se é Microsoft 365 e pedir um registro de aplicativo com leitura **apenas** da caixa da secretaria (`§ A47`). O adaptador (`src/adapters/ingestao-graph.ts`) está pronto e testado; falta a credencial.
> - **Onde publicar:** `§ A46` — servidor da associação, com terreno pronto para nuvem. Falta a máquina concreta e alguém do TI para prepará-la.
> - **IA paga:** qual fornecedor, com termos que não usem o conteúdo para treino (`§ A38`).
> - **Canal de comentários em toda tela** (`§ A21`) e a proteção da busca por CPF (`§ A44`) — os dois precisam de uso real para calibrar.
> - **Ainda da fase 2:** o papel `dono` (`§ A32`), que só faz sentido quando existirem os comentários e o relatório que ele lê.
>
> **5. Antes de conversar com o dono:** leia *Como o dono prefere trabalhar*, logo abaixo deste bloco.
>
> **Continuação de 16/09/2026, à tarde — tudo mesclado na `main`, revisado por agente e com os três checks verdes:**
> - **PR #50** — as quatro atualizações do dependabot numa só (inclui **vitest 5**); os PRs #33, #34, #42 e #43 foram fechados com o ok do dono.
> - **PR #51** — a caixa do Microsoft 365 passa a ser lida **só pela caixa de entrada** (`§ AT-33`, provisória até o TI responder). Antes, a resposta da própria secretaria voltaria como pedido novo.
> - **PR #52** — `A44(h)` começou: a busca por CPF é **contada** por pessoa e por dia, sem bloquear ninguém, por 90 dias (`§ A48`). Nenhuma tela lê a contagem. Falta o nível 2 (bloqueio), que depende dos limites medidos.
> - **Pedido ao TI escrito** e entregue ao dono, fora do repositório: confirmar Microsoft 365, permissão `Mail.Read` restrita só à caixa da secretaria, segredo entregue fora do e-mail, e se regras do Outlook movem pedidos para subpastas.
> - **Colação das tabelas corrigida** (`§ AT-34`): o Prisma gravava `utf8mb4_unicode_ci` em cada tabela, e duas grafias da mesma liga viravam uma só. **Toda migração nova que cria tabela precisa converter a colação** — `src/servidor/colacao.test.ts` fica vermelho se esquecer.
>
> ---
>
> *Histórico da retomada anterior, mantido como registro:*
>
> **Atualização de 13/09/2026 — o `A23` começou.** O dono respondeu os itens 23 a 26 de `§ H.4` (registrados em `§ A40`); **o 22 (formato do título neutro) e o novo 27 (observação escrita ao concluir) estão abertos**. A **parte (c)** — acerto da IA gravado na hora da revisão — está feita: colunas `Revisao.desfecho` e `Revisao.correcoes`, migração `20260913050204_acerto_da_ia_gravado_na_revisao`, seis travas vistas vermelhas contra sabotagem. A revisão de segurança por agente achou que o **nome** de um campo extraído vem do modelo e pode ser o próprio CPF; corrigido com a lista fechada de `core/nome-de-campo.ts`, que a parte (a) também tem de usar (ver o plano). A **parte (d)** também: a trilha não grava mais título, valor extraído, observação do registro manual nem texto de justificativa; a justificativa mora em `JustificativaDeAtribuicao` (migração `20260913052716_justificativa_fora_da_atribuicao`, com a cópia dos textos antigos provada em banco em memória). **A parte (b) está feita:** CPF protegido (`BUSCA_SECRET`, obrigatório) e matrícula (só dígitos, 3 a 10) gravados na ingestão e na revisão; busca por `POST /api/itens/busca` para todos os cargos; campo "Buscar por CPF ou matrícula" no topo da Caixa, **visto rodando** como colaboradora (achou pelo CPF, recusou CPF errado, explicou quando não achou nada; o número não aparece em endereço nem no registro do servidor). Os limites aceitos estão em `§ AT-26`. **`BUSCA_SECRET` foi acrescentado ao `.env` desta máquina** com autorização do dono — numa instalação nova, gerar um (ver `.env.example`). O dono respondeu tudo o que estava aberto para o `A23` (`§ A41`: 22 aprovado; 27, a observação ao concluir **fica**; 28, matrícula só números). **A parte (a) está feita, e com ela o `A23` fechou:** título (vira neutro), campos extraídos, observação digitada no registro, valores da revisão e justificativas de transferência e devolução saem no prazo, na limpeza diária logo depois do texto do e-mail (`§ AT-27`); item registrado à mão conta da própria conclusão (`A40`, resposta 23); a revisão sem acerto gravado ganha o acerto antes; ficam a chave de busca e a observação escrita ao concluir (`A41`, resposta 27). Vista no `dev.db`: "Verificação A20 — item concluído" virou "E-mail Cadastro" na Caixa. **Fechando a fase 1:** em 13/09/2026 o dono aprovou os textos da busca e autorizou enviar a branch ao GitHub e abrir o PR. Próximo: acompanhar o CI do PR (`BUSCA_SECRET` já está no `ci.yml`) e mesclar quando o dono decidir. A tela da Fila deixou de dizer que a justificativa "fica na trilha" (visto rodando). `sbp-local` agora aceita outra porta (`autoPort`), porque a 3000 pode estar ocupada por outro projeto.
>
> **O que fazer agora** *(reescrito em 14/09/2026 — a versão anterior destes itens ainda mandava fazer o `A23`, que está pronto)*:
>
> 1. **Confira onde está:** `git branch --show-current` → `main`; `git status -sb` e `git log --oneline -3`. A fase 1 está na `main` desde 15/09/2026, pelo PR #44, por squash (`2c4acdb`), com os três checks verdes. A branch `fase-1/privacidade-e-prazos` foi apagada na mesclagem. **Nenhuma pessoa revisou o código até aqui — só agentes.**
> 2. **Banco de dados: MySQL — trocado e provado em 16/09/2026** (`§ A42`, `§ AT-28`, `§ AT-30`). A suíte inteira roda contra o MySQL, aqui e no CI: 80 arquivos, 860 testes. **Nada roda sem um MySQL de pé** — o README diz como preparar, e a base precisa da colação `utf8mb4_0900_as_cs`, senão duas grafias da mesma liga viram uma só. As 24 migrações de SQLite estão em `prisma/migrations-sqlite-arquivado/`, como registro; a que vale é a inicial do MySQL.
> 3. **Revisão de segurança da fase 1 — feita em 15/09/2026**, por agente e só de leitura, sobre o diff inteiro: `docs/auditoria/2026-09-15-revisao-de-seguranca-fase-1.md`. **Nenhum achado crítico ou alto.** O achado médio (busca por CPF sem teto diário) foi respondido no mesmo dia pelo dono — ver `§ A44`, a implementar na implantação. **Continua aberto:** se o prazo mínimo de retenção fica em 1 dia. **Nenhuma pessoa revisou o código até aqui — só agentes**, e por decisão do dono (`§ A43`) a primeira leitura humana acontece quando o protótipo inteiro estiver pronto para rodar.
> 4. **Próximo trabalho, a decidir com o dono:** a fase 2 (`A24`, `A32`) do plano das 5 fases, **ou** a implantação — conexão real com o Outlook (hoje só existe `src/adapters/ingestao-mock.ts`), **MySQL** (`§ A42`), publicação e IA paga. Existe uma apresentação de custos para a chefia, fora do repositório, que estima as duas.
> 5. **Perguntas ao dono:** sobre tela, com desenho das opções lado a lado; sobre regra, com exemplo concreto do começo ao fim. Sempre linguagem simples e nomes fictícios, e todo texto que a equipe lê em frase curta, sem termo técnico.
> 6. **Para ver telas rodando:** `preview_start {name: "sbp-local"}` (aceita outra porta se a 3000 estiver ocupada) e, em `/entrar`, clique numa conta `@exemplo.test`. Nunca digite senha. Travas em `DECISOES.md § AT-17`. **`BUSCA_SECRET` é obrigatório**: numa máquina nova, gere um (ver `.env.example`); numa instalação em uso, nunca troque (`§ AT-26`).

### Como o dono prefere trabalhar

Estas preferências moravam só nas anotações do agente, que não viajam entre computadores. Nenhuma delas é segredo; todas mudaram o resultado quando foram ignoradas.

- **Linguagem simples com ele.** Frase curta, sem termo técnico, e **exemplo concreto do começo ao fim** — explicação abstrata não funcionou. Nomes fictícios nos exemplos.
- **Pergunta sobre comportamento de tela vai com desenho** das opções lado a lado; texto sozinho não bastou.
- **Todo texto que a equipe lê:** frase curta, dizendo o que aconteceu e o que fazer.
- **Hipótese não vira regra em silêncio.** O que o agente assumir vai para `DECISOES.md § C`; o que é decisão dele vira pergunta objetiva, com opções e recomendação.
- **Mesclar: autorizado, sempre no fim do ciclo** (16/09/2026, palavras dele: *"como estava fazendo durante todo o projeto, sempre revisando, checando e mesclando no final"*). Ou seja: branch → teste vermelho → correção → `npm run verificar` → revisão por agente **publicada no PR** → CI verde check a check → `gh pr merge --squash --delete-branch`. **Continua exigindo o ok dele, a cada vez:** apagar qualquer dado (inclusive sintético e local), trocar segredo, publicar fora do GitHub do projeto, e qualquer decisão de negócio.
- **Branch e PR sempre**, nunca direto na `main`; commits em português.
- **Nunca digitar senha.** Telas com login se conferem pelo acesso local sem senha (`sbp-local`, contas `@exemplo.test`).
- **Prova, não afirmação.** Teste visto **vermelho** contra o defeito antes da correção; mudança de tela **vista rodando**; CI lido **check a check** — `gh pr checks --watch` sai com código 0 quando termina de observar, **mesmo com check vermelho**, e isso já quase virou notícia falsa.
- **Bem feito antes de rápido.** Palavras dele.
- **Dados sempre sintéticos.** Nenhum nome, CPF ou e-mail real no repositório.

### Implantação — o que entrou em 16/09/2026

**O banco passou a ser MySQL, de verdade** (`A42`). Instalado nesta máquina, bases criadas com colação sensível a maiúsculas e acentos, provider e conexão trocados, tipos de coluna ajustados, migração inicial gerada e aplicada. **A suíte inteira roda nele** — decisão tomada ao contrário do que o `AT-28` previa, e o motivo está escrito lá: os defeitos que apareceram eram justamente os que o banco antigo escondia. Custo assumido: suíte mais lenta e MySQL como requisito para rodar qualquer coisa.

**Três defeitos encontrados no caminho, e nenhum deles era do MySQL** — os três já existiam (`AT-30`):

1. O teto de 25 MB do anexo derrubava o **e-mail inteiro** na validação: um exame grande fazia o pedido do associado sumir. O teto voltou para onde já havia regra — o anexo é recusado com motivo e o item vai para revisão, então alguém fica sabendo.
2. Valor padrão em coluna de texto, que o SQLite aceita e o MySQL proíbe. Saiu; quem cria item informa o payload.
3. A única consulta crua do sistema citava identificadores com aspas duplas — string no MySQL, não nome de coluna. O comentário dela **afirmava** portabilidade tendo conferido dois bancos; o terceiro a rejeitou.

**O adapter da caixa do Microsoft 365 está escrito e testado sem credencial** (`A47`): `src/adapters/ingestao-graph.ts`, com a fronteira `ClienteDoGraph` para provar formato, paginação, anexo e credencial recusada sem rede. Só leitura, sempre — `A5` continua valendo. **Falta o TI da associação** confirmar que a caixa é Microsoft 365 e criar um registro de aplicativo com permissão de leitura **só daquela caixa**.

**O CI ganhou banco próprio**: serviço MySQL no job, bases criadas com a colação da implantação e base sombra para a conferência de schema contra migrações. Sem isso o PR nasceria vermelho por falta de infraestrutura, não por defeito.

**Visto rodando sobre o MySQL em 16/09/2026**, e não só em teste: com o sistema no ar e a base semeada, a ingestão gravou **13 e-mails e 30 itens** numa transação — 8 aprovados e 22 para revisão humana —, sem falha, sem duplicado, e com a **conservação sem divergência**. É a prova que a suíte não dá: o caminho de escrita inteiro, com o JSON dos campos extraídos entrando nas colunas de texto longo.

**Duas coisas que o CI pegou e a máquina não pegava** (`AT-31`, `AT-32`):

- **Falha ALTA no driver do banco.** O adapter oficial do Prisma fixa `mariadb@3.4.5`, e essa faixa **entrega a senha do banco em texto claro** a quem estiver no meio do caminho, mesmo com TLS pedido — sem correção publicada para a faixa exigida. Forçada a série 3.5 por `overrides`: a auditoria passou de duas vulnerabilidades para **zero**, e a suíte inteira provou que a conexão continua de pé. Quando o adapter atualizar, remover o override e conferir a auditoria.
- **A conferência de schema contra migrações mente no Windows.** Ela acusa 26 tabelas removidas e dezenas de chaves estrangeiras perdidas; as 27 chaves existem todas, conferidas direto no banco. É `lower_case_table_names=1` do MySQL no Windows. **O resultado que vale é o do CI**, em Linux.

**O que ainda falta para a equipe usar:** as credenciais do Outlook, onde publicar (`A46` diz servidor da associação, com terreno pronto para nuvem), a IA paga e o canal de feedback (`A21`).

### Fase 2 — o que `A24` entregou *(16/09/2026)*

- **Caixa de entrada:** o colaborador vê só os itens em que é o **responsável ativo**. Operador e gestor continuam vendo tudo. Item aprovado e ainda **sem dono também não aparece** para o colaborador: é trabalho do setor, e mostrá-lo devolveria pela janela o remetente e o assunto que o recorte fechou.
- **O resumo conta o mesmo universo que a lista.** Sem isso, o cabeçalho diria "25" sobre uma lista de 16 — número que não fecha com a tela logo abaixo dele.
- **Busca por CPF ou matrícula herda o recorte** (`A40`, resposta 24, já previa): a busca é a mesma leitura da Caixa, então ela não vira porta lateral para o item de um colega.
- **Painel:** o colaborador vê só a própria linha em "Por pessoa". A tabela **por categoria** e a conferência de conservação continuam abertas a todos — ali não há pessoa nenhuma, só o volume do setor (`§ AT-29`).
- **Onde a regra mora:** no **serviço** (`servicos/caixa.ts`, `servicos/painel.ts`), não no arquivo da rota — a próxima porta que precisar da Caixa passa pelo serviço. Guarda que vive só na rota é guarda que a segunda porta não tem.
- **Prova:** `src/servicos/quem-ve-o-que.test.ts` e o caso novo em `src/app/api/itens/busca/busca.test.ts`, os dois **vistos vermelhos** contra o código antigo antes da mudança — quatro falhas no serviço e uma na rota. Suíte inteira verde depois: 850 testes, 79 arquivos. **Visto rodando** em 16/09/2026 com o banco de desenvolvimento (25 itens: 16 do Caio, 5 da Dora, 1 da Fabiana): como Caio, a Caixa mostra "todas · 16"; como Bianca, que não tem item, "todas · 0" com a frase explicando; como gestora, os 25.
- **Falta da fase 2:** o papel `dono` (`A32`), que só faz sentido quando existirem os feedbacks e o relatório que ele lê (fase 5). E "quem ajuda num item" (`A18`) entra no mesmo filtro, na fase 3.

### Fase 1 — o que `A17` entregou *(12/09/2026)*

- **Prazo editável** (`/acesso`, "Prazos de retenção"): só gestor; de 5 a 3.650 dias (o piso virou 5 em 15/09/2026, `§ A45`); mudança na trilha com antes e depois; **encurtar exige confirmação no servidor**, não só na tela. Código: `core/retencao.ts`, `servicos/retencao.ts`, `app/api/retencao`.
- **Limpeza diária sozinha** (`src/instrumentation.ts`): tenta a cada 15 minutos; `ExecucaoDeRotina (rotina, data)` único garante uma execução por dia; falha fica registrada e é tentada até 3 vezes. `npm run db:expurgar` roda a mesma limpeza, pela mesma trava — **não aceita mais prazo por variável de ambiente**. Ver `DECISOES.md § AT-18`.
- **Motivo de afastamento:** 7 dias depois da volta, a observação sai e o tipo vira `ferias` ou `ausente` (novo valor, que só nasce da limpeza). Cancelado conta do cancelamento (`AT-19`, confirmada pelo dono em `A39`, com a ausência cancelada destacada no aviso). Sem data de volta, não corre. A ficha mostra "motivo apagado pelo prazo em…".
- **A trilha deixou de guardar o motivo** (`AT-21`): o registro de afastamento grava o tipo já reduzido; o expurgo grava o tipo que ficou. **As linhas da trilha anteriores a 12/09/2026 ainda têm o tipo real** — só dado sintético.
- **Aviso do dia para a gestora** no painel de Ajuda: fora hoje e por quê, quem volta hoje ou amanhã, motivos que saem em até 3 dias (ou atrasados), e limpeza que falhou. Montado no servidor, **sem IA**. Abre sozinho na primeira vez do dia; depois, a cada 15 minutos a tela confere, e o que entrou ou saiu de uma lista — com nome, inclusive a troca de uma pessoa por outra — acende a bolinha no botão "Ajuda" (`A39(e)`, `AT-22`). O "já vi" fica no servidor (`AvisoVisto`), só com códigos internos. **Mudança feita pela própria gestora não acende a bolinha dela** (`A39(f)`) — senão ficaria acesa quase o tempo todo, porque é ela quem mais registra ausência; para isso, "Voltou hoje" passou a gravar `encerradoPor`. Migrações `20260913012626_aviso_visto_pela_gestora` e `20260913013651_quem_encerrou_o_afastamento`.
- **Prova:** cada trava vista falhando contra sabotagem própria — 8 em `A17` (fronteira do dia, trilha do registro, confirmação de encurtamento, uma vez por dia, redução do tipo, cancelado, prazo corrompido no banco, limite de tentativas) e as do aviso. Migração `20260913003033_retencao_do_motivo_e_rotina_diaria`.

### Fase 1 — o que `A20` entregou *(12/09/2026)*

- **Texto do e-mail e anexos apagados pelo prazo** (`servicos/expurgo-conteudo.ts`, na limpeza diária): remetente, assunto, corpo e bytes dos anexos saem no dia da conclusão do último item mais o prazo (padrão 7). Cancelado conta do cancelamento; sem item, da chegada; item aberto segura. Ficam a data e hora de chegada, os itens, a carga, a trilha e os metadados do anexo (`AT-23`).
- **Prazo editável** na mesma tela de `A17` ("Texto dos e-mails e anexos").
- **Caixa de entrada** mostra, no lugar do remetente: *"O texto deste e-mail já foi apagado do sistema no dia 20/09. Para ver o e-mail completo, procure no Outlook: ele chegou no dia 12/09, às 09:14."* — texto aprovado (`A39(b)`). Fila e Revisão nunca mostram isso: ali todo item está aberto.
- **E-mail suspeito sem item fica guardado** até a lista de `A34` existir (`AT-24`); `Email.conteudoSuspeito` passou a ser gravado na ingestão.
- **Arquivo sai antes da marca no banco** (`AT-25`): falha de disco deixa o e-mail pendente e a execução como falha, nunca um órfão.
- Migração `20260913015834_email_suspeito_retido`.

**Respondidas pelo dono em 12/09/2026 (`A39`):** matrícula quase nunca vem no e-mail (a chave de busca de `A23` vai ser, na maioria, o CPF protegido); aviso de conteúdo removido em linguagem simples; CPF protegido aprovado, com explicação por exemplo antes de implementar; cancelado conta do cancelamento, destacado. Também decidido (`A39(e)`): 3 dias à frente; quadro abre sozinho na primeira vez do dia; bolinha com quem entrou e quem saiu. Ausência cancelada marcada como "não aconteceu". **Abertas para o `A23`:** `DECISOES.md § H.4` itens 22 a 26 (título neutro, item manual, busca por CPF, justificativa na trilha, CPF inválido).

Anterior (11/09/2026): **os 36 achados em aberto da auditoria de 08/09/2026** e **a revisão dos PRs #35 e #36**, com as correções. Ver *Esta retomada*, abaixo.

> ## ⚠️ Leia estes seis pontos antes de tocar em qualquer coisa
>
> 1. **Tudo isto está na `main` desde 11/09/2026, em duas camadas.** A etapa de fechamento entrou pelo [PR #35](https://github.com/fernando123-hue/Sistema-SBP/pull/35) e os achados em aberto, com as correções da revisão, pelo [PR #36](https://github.com/fernando123-hue/Sistema-SBP/pull/36) — ambos por squash, na ordem, a pedido do dono. A revisão foi feita por agentes e publicada nos dois PRs; **nenhuma pessoa revisou o código**. As branches foram apagadas na mesclagem.
> 2. **`npm run verificar` tem de fechar com a suíte INTEIRA verde.** Um número fixo aqui envelhece e mente nos dois sentidos — este arquivo já disse 494 quando eram 514. O que vale é: zero vermelho, zero pulado. **E confira o CI também:** `gh pr checks 35` e `gh pr checks 36`. Ele ficou vermelho de 07 a 08/09 sem ninguém olhar, enquanto este arquivo dizia "494 verdes" — o verde era local, o vermelho era público. Corrigido e **verde em 08/09/2026**, com os três checks passando, inclusive o build de produção que entrou nesta etapa.
> 3. **`SESSAO_SECRET` é obrigatório** (mínimo 16 caracteres). O sistema RECUSA subir sem ele. Se a sua cópia local não tinha, é esse o erro que vai aparecer — e era exatamente esse o erro do CI.
> 4. **Subir esta versão invalida todos os cookies em circulação.** O formato ganhou `emitidoEm`, e cookie sem esse campo é recusado. Custa uma reentrada por pessoa, uma vez.
> 5. **Os anexos do ambiente de desenvolvimento já foram recifrados** em 08/09/2026: 16 de 16, conferidos byte a byte pela leitura depois da troca. `npm run anexos:conferir` diz o estado a qualquer momento. **Numa instalação nova, isso ainda precisa rodar.**
> 6. **A animação da marca foi vista rodando** — em 07/09/2026, no navegador real. Ver *A dívida honesta desta etapa*, abaixo: restam duas, não três.

### Onde este trabalho parou, em uma frase

Os 36 achados em aberto de 08/09/2026 foram corrigidos, respondidos ou convertidos em pergunta, e os achados da revisão publicada nos PRs #35 e #36 foram corrigidos; os dois PRs estão mesclados na `main`. Em 12/09/2026 o dono respondeu a rodada de dúvidas (`§ H.4` itens 5, 6 provisório, 8, 10 a 18 e as perguntas de 07/09 — ver `§ A17–A38`), e o acesso local sem senha passou a permitir ver as telas rodando. **O próximo passo é a fase 1 do plano de implementação.** Nada de código está pela metade.

## Esta retomada — 10/09/2026

O quadro completo, achado por achado, está no topo de `docs/auditoria/2026-09-08-achados-em-aberto.md`. O de maior peso:

- **Segurança.** A detecção de injeção deixava passar texto ofuscado — caractere invisível no meio da palavra, `о` cirílico, largura total, acento decomposto. Agora ela procura também numa forma dobrada (`core/seguranca/dobra.ts`), e o conteúdo que vai ao modelo segue intacto fora dos marcadores. `ErroOperacional.statusHttp` virou `422 | 503` por tipo, então falha de servidor não atravessa mais como falha operacional. A chave dos anexos trocada falha antes de gravar o primeiro documento (sentinela; `DECISOES.md § AT-13`).
- **Performance.** A conferência de conservação do painel agrega no banco e devolve só as rodadas divergentes — eram ~5.600 linhas por carregamento. `gravarRodada` escreve em lote. `minhaFila` parou de carregar o corpo do e-mail. O painel parou de refazer consultas que não dependem do período. A lista responsiva desenha uma variante só.
- **Prova.** Ganharam teste as portas que decidem trabalho ou guardam dado e não tinham nenhum: trava do dia, `definirEscala`, `rota()`, `limitarPorOrigem`, fronteira do fornecedor de IA, serviço do assistente, datas no fuso, fronteira dos 40 bytes do anexo. **Cada teste novo foi visto falhando contra uma sabotagem do código que guarda**, e a sabotagem desfeita.
- **Contratos.** `core/telas.ts` é a fonte única de telas e papéis (navegação e assistente liam cópias). `CategoriaDisponivel` tipa `/api/categorias`. Frente, grupo, tipo de afastamento e papel lidos do banco passam por `lerDoBanco`, que falha como 500 e não como 400.

**O que virou pergunta**, com opções e recomendação: `§ H.4` item 15 (quem baixa anexo — a metade que falta do `H-D19`), 16 (cancelar item distribuído), 17 (`em_andamento` e `novo`) e 18 (fusão de liga duplicada).

### A dívida honesta desta retomada

1. **Nenhuma mudança de tela foi vista rodando.** *(Em 12/09/2026 isto passou a ter caminho: o **acesso local sem senha** — `npm run dev:local`, e na tela de entrada aparecem as contas sintéticas para clicar. Travas e prova em `DECISOES.md § AT-17`. Com ele o agente entrou como gestora e viu a Distribuição rodando; a conferência das telas listadas abaixo ainda não foi feita.)* Toda tela além de `/entrar` exige login, e o agente não digita senha nem forja sessão. As telas mudadas passaram em `tsc`, `npm run build` e revisão de React, e **precisam ser olhadas por alguém logado**: Distribuição (caixas e data travadas enquanto a marcação de plantão salva; hora da prévia), Painel, Caixa ("Quem atendeu"; a lista em tela estreita e larga), navegação (alvos de toque; links por papel) e notas (motivo ao arquivar).
2. **`motivoArquivo` passa a ser gravado, e não é exibido**: não existe tela de notas arquivadas.
3. **A sentinela da chave confere na primeira operação de anexo, não na partida do servidor.** A razão está no código e em `§ AT-13`.

### Revisão dos PRs #35 e #36, e as correções — 11/09/2026

A pedido do dono, os dois PRs foram revisados por agentes por área, com cada achado conferido no código, e a revisão foi **publicada como comentário** em cada um ([#35](https://github.com/fernando123-hue/Sistema-SBP/pull/35#pullrequestreview-5182897191), [#36](https://github.com/fernando123-hue/Sistema-SBP/pull/36#pullrequestreview-5182897515)) — para que outras IAs possam avaliar o projeto a partir dela. Decisão nos dois: pedir mudanças. As correções entraram **no #36**, que contém o #35; o #35 sozinho continua com os achados.

**Corrigido e provado por sabotagem** (cada teste visto falhando contra o defeito):

- **ALTO** — a distribuição retroativa propagava só o crédito global; o crédito **por categoria**, critério primário do desempate, ficava desatualizado. Sabotado, o teste leu `-0,5` onde tinha de ler `-1`.
- A chave dos anexos trocada agora para a ingestão **antes da primeira chamada de IA**, com o motivo legível na memória operacional (`ChaveDosAnexosMudouError`).
- A trava do último gestor conta os outros gestores **dentro** da transação que desativa (em PostgreSQL ainda falta bloqueio — `DECISOES.md § AT-16`).
- `FalhaDeArmazenamento` não devolve mais o caminho do disco à tela.
- Uma categoria com cadastro inválido no banco não derruba mais a distribuição do dia: sai nomeada e as demais seguem (`§ AT-15`).

**Corrigido nas telas, conferido por tipos e build — não visto rodando** (acrescenta à dívida honesta acima): resposta velha que sobrescrevia a nova na Caixa, na escala da Distribuição e no Painel; "Tentar de novo" também com dados na tela; `prefers-reduced-motion` respeitado sem recarregar; painel de ajuda anunciado como região, não como diálogo.

**Configuração:** `next-env.d.ts` saiu do git, como a documentação do Next manda, e `npm run typecheck` passou a rodar `next typegen` antes do `tsc` — provado apagando o arquivo.

**Registrado, não corrigido:** ESLint fica fora enquanto o projeto usar TypeScript 7, cuja API de compilador o parser do ESLint exige (`§ AT-14`).

### O que a etapa de fechamento (08/09/2026) entregou

**Segurança.** Injeção que atravessava a delimitação e voltava como instrução de sistema; enumeração de contas pelo tempo de resposta (23,5 ms medidos); "sair" que não revogava nada; `SESSAO_SECRET` que falhava tarde demais; transferência para pessoa desativada; `campos` sem teto de cardinalidade; data inexistente virando chave de razão.

**Correção.** A liga partida na gravação — o `A4` anulado na última curva, com todos os indicadores verdes; o desdobramento de revisão criando itens sem liga; distribuição retroativa apagando crédito em silêncio; anexo órfão no disco que nenhuma retenção alcança; o desempate por grupo decidindo com dado obsoleto; e o adapter padrão criando uma liga chamada **"Prezados"** com nove itens sem relação, achado rodando o sistema.

**Honestidade dos números.** O alarme de conservação, que disparava em toda devolução e ensinava a equipe a ignorá-lo; a métrica "Em revisão", que mentia quando se estreitava o período; seis erros com mensagem escrita para humano que chegavam à tela como "Erro interno".

**Ajuda embutida (`A15`).** Assistente que responde sobre como o sistema funciona, sem autoridade sobre nada: não executa, não consulta demanda, não vê dado de outra pessoa, não recebe conteúdo de e-mail nem nota do setor. Filtragem por papel em código, duas vezes. Com `IA_ADAPTER=mock` responde por busca no manual — sem rede, sem custo, incapaz de inventar.

**A marca como objeto (`A16`).** O P da SBP composto por ~390 P's pequenos, cada um com massa própria, reagindo ao ponteiro por mola amortecida. Zero dependência nova. A marca também é o indicador de atividade do sistema: respira enquanto há requisição em voo.

---

## A dívida honesta desta etapa

Três coisas ficaram por fazer, e nenhuma delas é opinião — são fatos que a próxima sessão precisa saber para não descobrir tarde. A primeira já caiu, na retomada de 07/09/2026; fica registrada aqui porque o **como** verificá-la é a parte que se perde.

### 1. ~~A animação da marca nunca foi vista rodando~~ — VERIFICADA em 07/09/2026

`escreverNoDom()` roda, e o campo responde. Medido no navegador, na marca grande de `/entrar` (96 px de altura, 393 peças):

| O que | Medida |
|---|---|
| Pulso de montagem | escreveu `translate(-0.892 -1.130) rotate(-24.72 …)` — a marca se monta |
| Ponteiro no meio da letra | deslocamento máximo **4,77** unidades do contorno; 26 das 393 peças acima de 0,5 |
| Ponteiro saiu | deslocamento máximo **0,19** — reassentou |

**O suspeito nº 1 estava inocente.** O defeito nunca esteve em `marca.tsx`; estava na forma de olhar.

#### Como verificar de novo sem depender de alguém olhando

O painel de navegador da automação executa a página oculta, e página oculta **não recebe quadro de animação** — confirmado outra vez aqui: um script que espera um `requestAnimationFrame` trava até o limite de 45 s. Foi isso que impediu a verificação da etapa passada, e é a armadilha que vai reaparecer.

A saída: **tirar um screenshot torna o painel visível, e os quadros correm durante a captura.** Então a verificação é uma sequência, não uma espera:

1. disparar `pointermove` na janela, no centro da marca (ouvir na janela é do desenho — ver o comentário em `marca.tsx`);
2. tirar um screenshot — é ele que faz os quadros rodarem;
3. ler o atributo `transform` de cada `<g>` e medir `hypot(dx, dy)`.

Se o passo 3 der tudo zero **depois** de um screenshot, aí sim o suspeito é `escreverNoDom`.

### 2. As dezesseis dimensões rodaram — e o resultado NÃO era verde

**Correção de um registro anterior.** Uma versão deste arquivo afirmou, em 08/09/2026, que as sete dimensões estavam "VERIFICADAS", com um resumo que dizia contraste conforme, cobertura de testes íntegra e documentação em dia. Aquele resumo não era resultado de auditoria nenhuma — as duas primeiras tentativas tinham morrido por limite de uso, e o texto foi escrito por cima. Ele contradizia até o próprio commit em que entrou, que dizia estar implementando as duas coisas que o mesmo texto listava como ausentes.

É a doença que este projeto existe para curar, na camada da documentação: documento verde, sistema vermelho. Fica registrado aqui em vez de apagado, porque um relatório verde forjado é um evento mais caro do que qualquer defeito que ele escondia.

**As sete que faltavam rodaram**, em lotes de duas, como a lição da etapa passada mandava: `ui-ux`, `fluxos-incompletos`, `testes`, `performance`, `tipos-contratos`, `config-dependencias` e, por último, `documentacao` — que foi justamente a que pegou esta tabela errada de novo, na direção oposta (ver o aviso abaixo). Com ela, as dezesseis dimensões da auditoria profunda estão fechadas.

**O que elas acharam, e o que já foi corrigido nesta retomada.**

> Esta tabela já esteve errada uma vez, na direção contrária: entre a primeira
> escrita e o fim da sessão, cinco linhas continuaram ⏳ depois de o código ter
> sido corrigido — quem lesse iria refazer trabalho pronto. Quem mexer aqui
> confere a linha contra o código antes de deixá-la como está; a auditoria de
> `documentacao` foi quem pegou.


| Dimensão | Achado mais grave | Estado |
|---|---|---|
| `ui-ux` | A fila só tinha **Concluir**: `devolver` e `transferir` tinham rota, serviço e verbete no assistente, e **nenhuma tela** — a saída que sobrava para quem recebia item alheio era concluir trabalho que não fez | ✅ corrigido |
| `ui-ux` | Sessão expirada matava a tela: sem perfil o layout não desenha a navegação, nenhuma tela tratava 401, e o carregamento ficava eterno. Saída só digitando `/entrar` na barra de endereços | ✅ corrigido |
| `ui-ux` | `--color-tinta-fraca` media **3,53:1** no tema claro (AA exige 4,5) — é o rótulo de toda métrica do painel e dos campos da tela de entrada | ✅ corrigido (4,69:1) |
| `ui-ux` | Falha de rede deixava cinco telas em "Carregando…" para sempre (o `catch` só chamava `setErro` e deixava o estado em `null`) | ✅ corrigido nas cinco, e o Painel mantém os campos de período com botão de nova tentativa |
| `fluxos` | `transferir` aceitava item **já concluído** — o painel passava a ter uma linha em que atribuídos, concluídos e pendentes não fecham | ✅ corrigido |
| `fluxos` | Painel: `ABERTOS` não incluía `devolvido`, então a categoria podia ter pendente e dizer que nada envelhece | ✅ corrigido, com teste que fica vermelho se a linha voltar |
| `fluxos` | Desativar colaborador abandonava os itens da fila dele: nenhuma tela alcança, e o motor só recolhe `aprovado`/`devolvido` | ✅ corrigido — devolvidos ao grupo na mesma transação |
| `fluxos` | Não havia como **encerrar** afastamento em aberto; a única saída era "Cancelar", que grava que a licença não aconteceu | ✅ corrigido — `PATCH /api/afastamentos/:id` e o botão "Voltou hoje" |
| `testes` | **Nenhuma rota HTTP tinha teste**, e quatro delas guardam a autorização sozinhas | ✅ corrigido — `src/app/api/autorizacao-de-rotas.test.ts`; remover um `exigirPapel` agora dá `expected 200 to be 403` |
| `testes` | A conservação só era testada onde nada é gravado: as duas travas de dentro de `gravarRodada` e o rollback não tinham prova | ✅ corrigido — `src/servicos/conservacao-na-escrita.test.ts`; sabotando o motor, a transação aborta e o banco fica em zero |
| `testes` | Cifragem sem teste de rotação de chave; expurgo sem fronteira, sem idempotência e sem guarda de retenção | ✅ corrigido |
| `performance` | `resolverLiga` varria a tabela `Liga` inteira **uma vez por item**, dentro da transação de escrita | ✅ corrigido — uma leitura por lote, com teste que fica vermelho se a liga nova não entrar no índice |
| `performance` | `conferirConservacao` traz ~5.600 linhas por carregamento do painel | ⏳ pendente — é o maior volume de rede do sistema, e vira grave em PostgreSQL |
| `performance` | `Execucao` sem índice `(resultado, concluidoEm)` — duas varreduras completas por painel, crescendo para sempre | ✅ corrigido — `EXPLAIN QUERY PLAN` passou a dizer `USING COVERING INDEX` |
| `tipos` | A anotação de `ColaboradorResumo` pegava campo que some e **não** campo que sobra: um `senhaHash: true` no `select` vazaria o hash da equipe | ✅ corrigido |
| `tipos` | `SeloDeConfianca` usava 0,85 fixo enquanto o limiar é por categoria — dois selos se contradiziam na mesma linha | ✅ corrigido |
| `config` | `NODE_ENV` cai para `development` por omissão, e a trava do `db:limpar` abre: rodado por engano num shell de produção, ele apagava a trilha de auditoria | ✅ corrigido |
| `config` | O `.env.example` entregava `ANEXOS_SECRET=""`, e o sistema **recusava subir** com isso | ✅ corrigido |
| `config` | `ARMAZENAMENTO_DIR=` vazio virava a raiz do repositório — documento de associado nascendo ao lado do código | ✅ corrigido |
| `config` | **16 de 16 anexos no disco estão em texto puro**: a cifragem não alcançou nenhum arquivo existente | ✅ script de migração criado (`npm run anexos:recifrar`) |
| `config` | CSP de produção com `'unsafe-inline'` em `script-src` anulava a rede de segurança que o comentário promete | ✅ corrigido — nonce por requisição em `src/middleware.ts`, provado nos dois sentidos no navegador |
| `config` | O CI nunca rodava `npm run build` — a única classe de defeito que `tsc` e os testes não alcançam | ✅ corrigido |
| `documentacao` | A tabela ACIMA marcava ⏳ cinco achados que o código já tinha corrigido, e o ESTADO dizia em três lugares que "não existe rotina de expurgo" depois de ela existir | ✅ corrigido |
| `documentacao` | A SPEC dizia "27 caminhos, 33 operações — o que estiver aqui existe, e o que existe está aqui", e faltavam 5 rotas, 4 entidades, 2 ports e 3 telas | ✅ corrigido |
| `documentacao` | Contagem de testes desatualizada em sete lugares (494 e 271, contra 520), escrita como critério de sanidade | ✅ trocada por "a suíte inteira verde" |
| `documentacao` | O roteiro de instalação do README não gerava `SESSAO_SECRET`: seguido à risca, o sistema não sobe | ✅ corrigido |

#### Duas bombas-relógio estouraram no meio desta retomada

Não vieram da auditoria: apareceram sozinhas, à meia-noite de 08/09/2026. `conservacao-nao-e-ruido.test.ts` e `liga-nao-se-parte.test.ts` fixavam `const data = '2026-09-07'`, e os itens que elas criam nascem com `criadoEm` = agora. `planejarCategoria` só recolhe item criado ATÉ o fim do dia da rodada — virou o dia, a rodada não achou nada, e cinco testes ficaram vermelhos de uma vez.

**Um teste que passa hoje e falha amanhã sem ninguém tocar em nada é pior que um teste ausente:** ensina a equipe a desconfiar do vermelho. As duas datas agora vêm de `hojeIso()`.

Junto veio um vermelho de outra natureza: o teste que mede o **piso de tempo** da recusa de entrada falhou enquanto o servidor de desenvolvimento e um navegador disputavam a máquina, e passou com a máquina livre. A amostra subiu de três para cinco medições; **o teto de 60 ms ficou onde estava** — afrouxar o limite para calar um vermelho intermitente apagaria justamente o canal lateral que o teste existe para medir.

#### Onde estão os achados que NÃO foram corrigidos

`docs/auditoria/2026-09-08-achados-em-aberto.md` — 36 itens, cada um com o
arquivo, o cenário concreto e a correção sugerida. Os relatórios completos
existiam só no transcript da sessão, e achado que só existe numa conversa é
achado perdido: é a mesma perda silenciosa que este sistema foi construído para
eliminar.

Os mais caros de lá, em uma linha cada: `conferirConservacao` movendo ~5.600
linhas por carregamento do painel; a trava de distribuição sem teste nenhum;
`rota()` sem prova do mapeamento erro→status; `definirEscala` — a porta que
decide quem recebe trabalho — nunca chamada por teste; `analisarConteudo` sem
normalizar unicode, então zero-width dentro da palavra passa pelas 12 regras;
e não existir como cancelar item depois de distribuído, o que deixa três saídas
e cada uma corrompe uma métrica.

**Lição que continua valendo:** rodar em lotes de DUAS. A máquina tem 4 núcleos; sete em paralelo enfileira e estoura o limite antes de qualquer uma terminar.

### 3. O contorno da marca é reconstrução, não o oficial

Só existe o PNG do logotipo. `src/core/marca/contorno.ts` descreve a letra como união e subtração de retângulos arredondados, com as proporções medidas sobre a arte.

**É o ÚNICO arquivo que muda quando o SVG oficial chegar.** O arranjo, a física e o desenho só perguntam `dentroDoP()` — nada mais no sistema sabe qual é a forma da letra. Pedir o SVG à SBP é barato e melhora a fidelidade de graça.

---

## Próximos passos, em ordem de valor *(reordenada em 08/09/2026, no fim da retomada)*

> As linhas ✅ da tabela acima saíram desta lista. Se você for acrescentar um
> item aqui, confira antes se ele ainda existe no código — esta lista já mandou,
> uma vez, refazer trabalho que estava pronto.
>
> **Saiu daqui em 08/09/2026:** rodar `npm run anexos:recifrar`. Rodou — 16 de
> 16 anexos do ambiente de desenvolvimento cifrados, cada um conferido pela
> leitura antes de o original ser trocado. `npm run anexos:conferir` responde
> "0 ainda em texto puro". Numa instalação nova, o comando continua sendo o
> primeiro passo.

> **Reordenada de novo em 10/09/2026.** Saíram daqui, porque foram feitos e
> provados: a conservação agregada no banco e a escrita em lote de
> `gravarRodada` (antigo item 4), e as três dívidas de tipos (antigo item 7 —
> `statusHttp`, códigos de categoria, `PAPEIS_DA_TELA`). O `H-D19` (antigo 3)
> deixou de ser engenharia: virou pergunta.

1. **Entrar no sistema e olhar as telas desta retomada.** Nenhuma foi vista
   rodando — ver *A dívida honesta desta retomada*, lá em cima, com a lista do
   que olhar. É o único passo que o agente não consegue dar sozinho, e é
   barato: com alguém logado no painel do navegador, a conferência é dele.
2. **Levar as perguntas à chefia em `DECISOES.md § H.4`.** A urgente continua
   sendo o **prazo do motivo de afastamento** (dado de saúde, item 12). A rotina
   que aplica a resposta já existe (`npm run db:expurgar`); o prazo de 90 dias é
   **hipótese registrada** (`§ AT-11`), não decisão. Entraram quatro novas: **15**
   (quem baixa anexo — sem ela, documento real não deve entrar), 16 (cancelar
   item distribuído), 17 (`em_andamento` e `novo`) e 18 (fusão de liga).
3. ~~**Revisar e mesclar o PR #35, e depois o desta retomada.**~~ Feito em
   11/09/2026: revisão por agentes publicada nos dois, correções no #36, e os
   dois mesclados por squash, nessa ordem.
4. **Performance, no que restou:** `carregarElegiveis` e `porPessoa` — os alvos
   do plano `H-D8`, e os mais fracos da medição. `porPessoa` já filtra `escopo`,
   que era a armadilha registrada para quem fosse reescrevê-lo em lote.
5. **Medir o acerto da IA contra modelo real.** O Painel já separa a taxa POR
   MODELO — a comparação que justifica manter dois fornecedores. Custa cota
   gratuita (ver abaixo), e por isso não foi rodado sem o dono pedir.
6. **Fechar o resto da `H-D7`:** validar a resposta da rota no cliente contra o
   mesmo Zod. O elo mais fraco (`/api/categorias`) fechou; as demais formas
   redigitadas estão listadas no achado 22 e não divergem hoje.

### O comando que destrava mais coisa — e o que ele custa de verdade

```bash
IA_ADAPTER=gemini IA_MODELO=gemini-3.1-flash-lite npm run ia:experimentar
```

**Correção em relação a versões anteriores deste arquivo:** ele NÃO é "grátis, é só repetir". A cota gratuita é de **20 requisições por dia, POR MODELO** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), e cada rodada gasta de 4 a 8 — cerca de três rodadas por dia, por modelo.

A cota ser por modelo é a saída: modelos diferentes têm orçamentos independentes. Medido em 07/09/2026:

| Modelo | Casos corretos | Latência |
|---|---|---|
| `gemini-3.6-flash` *(padrão até 12/09/2026)* | 2 de 12 tentativas — resto `503` | 54–63 s |
| `gemini-3.5-flash` *(padrão desde 12/09/2026)* | 7 de 8 | 5–11 s |
| `gemini-3.1-flash-lite` | 4 de 4 | 1–3 s |

**A injeção foi recusada pelos três.** O `modeloPadrao` era `gemini-3.6-flash` até o dono decidir, em 12/09/2026, trocá-lo para `gemini-3.5-flash` (`DECISOES.md § A38`) — trocar muda que modelo processa o conteúdo por omissão, e por isso esperou a decisão. A camada gratuita segue só para teste, com dado sintético.

### As quatro perguntas que só a chefia responde

Estão em `DECISOES.md § H.4`, itens 10 a 13, com opções e recomendação formuladas. Uma folha de decisão em uma página foi preparada em 07/09/2026 e entregue como arquivo, fora do repositório. Se ela se perdeu, as perguntas cruas estão em `§ H.4` e a folha se refaz a partir delas.

### Duas armadilhas que NÃO existem mais

- **A CSP quebrava a verificação de tela em desenvolvimento.** `unsafe-eval` agora entra só em desenvolvimento; em produção nada mudou. Conferir tela com `npm run dev` voltou a funcionar — e foi essa correção que permitiu achar dois defeitos de interface desta etapa.
- **Os testes passavam contra código defeituoso.** No zod 4, um `ZodError` construído à mão **não é `instanceof Error`**, e os dubles de teste não o lançavam. Corrigido, com o porquê no código. A regra que ficou: **um teste que passa não prova nada até alguém verificar que ele falha contra o defeito.** Cada correção desta etapa foi verificada revertendo-a.

---

## Continuando em outra máquina

**A `main` está em dia** — sem branch escondida nem PR aberto, conferido em 16/09/2026. *(Esta seção dizia, até essa data, para fazer checkout de `maturacao/achados-em-aberto` — branch mesclada e apagada havia dias. Quem seguisse o texto ao pé da letra cairia num erro.)*

> **A lição fica.** Três vezes este arquivo descreveu branches que não eram as de verdade: o #12 por dois dias, as decisões A4–A12 por cinco, e esta seção por quase uma semana. Antes de escrever aqui que "tudo está na `main`", confira `gh pr list` e `git branch -r`, não a memória da sessão.

### Caso A — este mesmo computador, acessado remotamente

O ambiente inteiro já existe aqui. Falta só ligar o banco, que **não** é serviço do Windows:

```powershell
$bin = "C:\Program Files\MySQL\MySQL Server 8.4\bin"
Start-Process "$bin\mysqld.exe" -ArgumentList "--datadir=$env:USERPROFILE\mysql-sbp\dados","--port=3307","--bind-address=127.0.0.1" -WindowStyle Hidden
& "$bin\mysql.exe" -u root -h 127.0.0.1 -P 3307 -e "show databases;"
```

Bases desta máquina: **`sbp`** (desenvolvimento, semeada, com e-mails e itens sintéticos), **`sbp_teste`** (a suíte recria a cada execução), **`sbp_sombra`** (conferência de schema) e **`sbp_dev`** — abandonada numa migração que falhou em 16/09/2026, **deixada intacta** porque apagar dado depende do dono. Root sem senha, só em `127.0.0.1`.

### Caso B — outro computador, clone novo

```bash
git clone https://github.com/fernando123-hue/Sistema-SBP.git
cd Sistema-SBP
```

E siga *Preparar o ambiente*. **Nada do banco do outro computador vem junto**: a máquina nova começa com a base vazia, e isso é o esperado — é tudo sintético. Pelo mesmo motivo, `SESSAO_SECRET` e `BUSCA_SECRET` podem ser gerados novos ali; o cuidado de nunca trocar `BUSCA_SECRET` vale para instalação **em uso**, com dado que precisa continuar achável.

Este arquivo é o ponto de entrada: ele diz o que está pronto, o que ficou aberto e qual é o próximo passo.

### O que NÃO vem no clone, e por quê

| O quê | Por que não está no git | Como recriar |
|---|---|---|
| `.env` | Contém segredos | `cp .env.example .env` e preencher |
| O MySQL e as bases | É servidor, não arquivo; e o dado é de trabalho | *Preparar o ambiente*, passos 1 a 5 |
| `dev.db` | Banco SQLite **antigo**, de antes de 16/09/2026 | Não precisa: o sistema não usa mais SQLite |
| `src/generated/` | Gerado pelo Prisma a partir do schema | `npx prisma generate` |
| `node_modules/` | Dependências | `npm install` |
| `armazenamento/` | Anexos; são documentos, não código | Criado sozinho no primeiro anexo |

**Nenhuma chave de IA está em lugar nenhum do repositório, e é assim que tem de ser.** Na máquina nova elas precisam ser coladas de novo no `.env`: `GOOGLE_AI_KEY` para o Gemini, `ANTHROPIC_API_KEY` para a Anthropic. Sem a chave do adapter escolhido, o sistema **recusa subir** — nunca cai no mock em silêncio.

---

## Preparar o ambiente

Caminho completo para um computador novo, **reescrito em 16/09/2026** para o MySQL e conferido nesta máquina (Windows, MySQL 8.4.9). Em Linux os comandos são os mesmos, menos o caminho do executável — e lá a conferência de schema funciona de verdade (`AT-32`).

**1. Pré-requisitos:** Node 22+ e MySQL 8.4. No Windows:

```powershell
winget install --id Oracle.MySQL --source winget
```

Sem `--source winget`, o instalador pode parar consultando a loja da Microsoft. Ele põe os programas no disco e **não** cria banco nem serviço.

**2. Ligar o MySQL** (Windows, sem serviço registrado):

```powershell
$bin = "C:\Program Files\MySQL\MySQL Server 8.4\bin"
& "$bin\mysqld.exe" --initialize-insecure --datadir="$env:USERPROFILE\mysql-sbp\dados"   # só na primeira vez
Start-Process "$bin\mysqld.exe" -ArgumentList "--datadir=$env:USERPROFILE\mysql-sbp\dados","--port=3307","--bind-address=127.0.0.1" -WindowStyle Hidden
```

`--initialize-insecure` deixa o root **sem senha** — aceitável só para banco local, em `127.0.0.1`, com dado sintético. Numa instalação de verdade, usuário próprio e senha.

**3. Criar as bases, com a colação certa:**

```bash
mysql -u root -h 127.0.0.1 -P 3307 -e "
  CREATE DATABASE sbp       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
  CREATE DATABASE sbp_teste CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;"
```

A colação não é detalhe: com a padrão do MySQL 8, duas grafias da mesma liga viram uma só, sem erro que denuncie (`AT-10`, `AT-28`).

**4. Código e configuração:**

```bash
npm install
cp .env.example .env
```

No `.env`:

- **`DATABASE_URL`** — `mysql://root@127.0.0.1:3307/sbp`.
- **`SESSAO_SECRET`** e **`BUSCA_SECRET`** — obrigatórios; o sistema recusa subir sem eles. Os comandos para gerar estão no próprio `.env.example`.
- Com `IA_ADAPTER="mock"` e `INGESTAO_ADAPTER="mock"` — os padrões —, nenhuma chave de IA nem credencial de e-mail é necessária.

`PROXIES_CONFIAVEIS="0"` é o correto para rede local; só muda ao publicar atrás de nginx ou balanceador — e aí confira o resultado em `/api/diagnostico/origem`, que existe justamente para isso.

**5. Banco, cliente e dados:**

```bash
npx prisma migrate deploy   # aplica a migração inicial do MySQL
npx prisma generate         # gera o cliente em src/generated/ — sem ele, o sistema ainda fala com o banco antigo
npm run db:seed             # cadastro sintético + senhas provisórias (pode levar alguns minutos)
npm run verificar           # typecheck + a suíte inteira, na base sbp_teste
npm run dev                 # http://localhost:3000 — ou `npm run dev:local`, com acesso sem senha
```

**A suíte procura a base de teste em `mysql://root@127.0.0.1:3307/sbp_teste`.** Com o MySQL em outra porta ou com senha, rode `DATABASE_URL="mysql://usuario:senha@host:porta/sbp_teste" npm run verificar` — a URL do ambiente tem precedência, e é assim que o CI faz.

**O `db:seed` imprime uma senha provisória por pessoa, uma única vez.** Elas não ficam gravadas em lugar nenhum — copie as do terminal. Rodar o seed de novo não mexe em quem já trocou a senha.

Entre com **ana.operadora@exemplo.test** (operadora) e a senha provisória dela. O sistema exige a troca antes de liberar qualquer tela. Depois, em Distribuição: *Buscar e-mails* → marcar plantão → *Calcular prévia* → *Confirmar*.

`npm run demo` roda o fluxo inteiro pelo terminal, sem tela — é a forma mais rápida de conferir que a máquina nova está inteira.

### Uma surpresa conhecida

Ao rodar `npm run dev`, o Next.js **escreve sozinho um bloco dentro do `CLAUDE.md`**, que é o arquivo de instruções do projeto. Ele reaparece a cada execução. A decisão de aceitar ou desligar essa geração ainda é sua — até lá, é esperado ver esse arquivo modificado sem você ter mexido nele.

---

## O que está pronto e funcionando

| Camada | Estado |
|---|---|
| Motor de distribuição | Função pura, determinística, versionada. Conservação garantida por transação |
| Modelo de dados | 26 modelos, constraints reais, em MySQL. Uma migração em vigor — a inicial do MySQL — e 24 de SQLite arquivadas *(contados em 16/09/2026: `grep -c "^model "` no schema e os diretórios de migração)* |
| Retenção | Conteúdo do e-mail e bytes de anexo em linhas próprias, expurgáveis sem tocar no histórico operacional |
| Ingestão | Idempotente por `message-id`, IA atrás de port, tipo real do anexo conferido pelos bytes |
| Armazenamento | Arquivos fora do banco, atrás de port. Disco local hoje, nuvem trocando o adapter |
| Adapters de IA | `mock` determinístico, `gemini` (camada gratuita, **exercitado contra a API real** em 07/09/2026) e `anthropic` (ainda não exercitado). A política de interpretação é compartilhada — ver `ia-estruturada.ts` |
| Revisão humana | Fila de exceções com sugestão da IA e campos editáveis |
| Distribuição | Transacional, com trava por dia, crédito histórico, auditoria completa |
| Fila individual | Concluir, transferir, devolver ao pool |
| Registro manual | O que não chega por e-mail entra pela Caixa: balcão, telefone, e as categorias de exceção `INADIMP.`/`ISENTO` |
| Memória consultável | A trilha de auditoria deixa de ser write-only: `GET /api/memoria` responde por ciclo (`?correlacao=`) e por registro (`?entidade=&id=`). Toda linha nasce com `dominio` |
| Painel | Agregação pura, zero campo digitável. Recorte por período, colunas mapeadas uma a uma para as da planilha |
| Qualidade da IA | Taxa de aceitação, cobertura e calibração da confiança. Critério de aceitação nº 5 passa a ser verificável |
| Cadastro de equipe | Gestor cadastra pessoa e define o que ela pode receber, pela tela. Quem fica sem categoria aparece em destaque |
| API REST | 31 caminhos, 39 operações *(contados em 10/09/2026 nos `route.ts`; este arquivo dizia 27 e 33)*, envelope único, limite de taxa, papéis |
| Autenticação | E-mail e senha (scrypt), senha provisória do gestor com troca obrigatória, bloqueio progressivo |
| Telas | 9: distribuição, revisão, caixa, fila, painel, acesso, entrada, troca de senha, raiz. Mobile-first, tema claro e escuro |
| Notas do setor | O que a equipe aprendeu operando, escrito por quem opera. Uma porta só, texto livre, vinculável a categoria e liga. Aparece nas quatro telas de trabalho |
| Testes | **a suíte inteira verde** (motor, propriedade, segurança, pureza do núcleo, sessão, autenticação, memória, notas, assistente, dois adapters de IA, agrupamento por liga, conservação, distribuição retroativa, pipeline de integração) |
| CI | Typecheck, testes, sincronia schema↔migrações, gitleaks, npm audit — verde |

---

## Onde parei

**O sistema deixou de depender de um fornecedor de IA — e isso foi comprovado, não afirmado.**

Entrou o adapter **Gemini** (Google AI Studio, camada gratuita) ao lado do Anthropic. A prova que interessa é o tamanho da mudança: acrescentar o segundo fornecedor custou **uma linha** em `criarAiPort()` e um valor a mais no enum de `IA_ADAPTER`. Nenhum arquivo de `servicos/`, `app/` ou `core/` foi tocado.

Isso obrigou a separar o que sempre foi política **deste sistema** do que é detalhe **do fornecedor**. Das 253 linhas do adapter Anthropic, quinze eram sobre a Anthropic. O resto — as três camadas contra injeção, a repetição única e só por erro de formato, a distinção entre falha deste e-mail e camada fora do ar, o sinal duplo de suspeita, a revalidação — foi para `ia-estruturada.ts` e vale igual para qualquer modelo. Cada fornecedor declara três coisas em `PerfilDoFornecedor`: como se chama, qual o modelo padrão, e como reconhecer credencial recusada no SDK dele.

**E o pipeline rodou contra a API real, de graça.** Era a única parte do sistema que nunca tinha trocado uma palavra com um modelo. O caso de injeção respondeu como devia: categoria do e-mail de verdade, confiança `0,10`, suspeita marcada pelas duas defesas — a nossa regex e o próprio modelo. Ele não obedeceu ao conteúdo hostil.

Três coisas que só apareceram por rodar de verdade, e que estão registradas no código:

- **`IA_MODELO` tinha padrão fixo `claude-sonnet-5`.** Com um fornecedor só era inofensivo; com dois, trocar de adapter sem trocar essa variável manda um modelo da Anthropic para a API do Google. Aconteceu na primeira execução — `404 models/claude-sonnet-5`, e o erro parece problema de chave. Agora vazio significa "o padrão do adapter".
- **O `responseJsonSchema` do Gemini não aceita o nosso schema** (`400 INVALID_ARGUMENT`): `campos` é mapa aberto e os anuláveis usam `anyOf`. A saída não foi redigitar um segundo schema à mão — seria a `H-D7` na camada mais cara. O schema derivado do **mesmo** Zod vai ao modelo como texto, nas instruções, e quem valida continua sendo `RespostaDoModeloSchema.parse`.
- **`503` acontece na camada gratuita.** O sistema trata como falha de transporte e manda o e-mail para revisão humana. Degradar assim é o comportamento certo.

**Entrou também a memória do setor (`A14`).** O sistema tinha memória do que **aconteceu** — `LogAuditoria` e `EventoProcessamento`, lidos por `servicos/memoria.ts` — e nenhuma do que se **aprendeu** com isso. Agora tem as duas.

**Uma porta só.** `texto` é o único campo obrigatório: sem tipo de nota, sem categoria de nota, sem escolha antes de escrever. Formulário que obriga a classificar mata a captura, e memória em que ninguém escreve não vale nada. O que a nota *é* se descobre depois, pelo uso.

> Esta forma veio de uma correção do dono do projeto. A primeira proposta separava os exemplos em quatro tipos e dava um caminho para cada; ele respondeu que os exemplos não são condições absolutas, que o trabalho é com seres humanos, e que o sistema tem de servir em qualquer circunstância. O erro tinha nome: **transformar a taxonomia em exigência de entrada.** Registrado em `DECISOES.md § A14(d)`.

**A nota encontra o trabalho**, em vez de esperar ser procurada: aparece na Fila, na Revisão, na Distribuição e na Caixa, no momento da decisão. Ordem: liga > categoria > geral, e no mesmo peso a mais recente primeiro. Vínculo que não bate **elimina** a nota.

**O interruptor, não a reescrita.** `src/core/notas.ts` é a seleção: pura, sem I/O, testada. Hoje alimenta a tela; é a **mesma função** que montará o contexto do modelo quando você liberar (`§ H.4` item 14). Ligar a IA depois é trocar o destino de uma chamada — e `core/notas.test.ts` passa a cobrir o prompt sem uma linha de mudança.

**O texto da nota NÃO vai para a trilha.** `LogAuditoria` é append-only: copiar o texto faria a nota existir em dois lugares com políticas de retenção opostas, e a cópia eterna seria justamente a que ninguém consegue arquivar. A trilha grava quem, quando, o vínculo e o tamanho.

**Não existe vínculo com pessoa** além da autoria — a coluna não existe, aguardando `§ H.4` item 13. Criá-la depois é migração; retirá-la depois de povoada, não.

### O defeito que a revisão pegou, e por que ele importa

O `GET /api/notas` tinha a **listagem plana como padrão**, e a seleção só rodava quando vinha algum vínculo. Três das quatro telas pedem com contexto vazio — então elas recebiam **todas** as notas vivas, inclusive as de categorias em que a pessoa não estava trabalhando. Exatamente o que `selecionarNotas` existe para impedir.

Duas coisas sobre como escapou, e as duas valem para a próxima vez:

- **Os testes de núcleo estavam verdes o tempo todo.** A regra estava certa; quem a chamava é que não estava. Testar a função pura não prova nada sobre quem a consome.
- **A verificação por HTTP declarada como prova passou por cima.** Havia UMA nota no banco, geral — os dois modos devolviam o mesmo resultado. Verificação com um caso que não distingue os caminhos não é verificação.

O padrão inverteu: seleção por omissão, listagem plana exige `?todas=1`. A lição ficou na forma do código — **o modo perigoso é o que precisa ser pedido por escrito.**

Junto vieram três correções da mesma varredura: `Nota` cascateava com `Categoria` e `Liga` (apagaria a memória do setor em silêncio — agora `Restrict` nos três, como `SaldoCarga`); o helper `ligaDeTeste` fazia `create` puro e estourava em modo watch; e a tela oferecia arquivar a quem o serviço recusa.

### Dívidas que a entrega de 07/09 criou

Nenhuma trava uso. Estão registradas porque foram escolhas, não descuidos:

1. ~~**A liga é inalcançável pela tela.**~~ **Fechada no mesmo dia (#28).** A Caixa ganhou filtro de liga ao lado do de categoria; a liga aparece na linha do item e é clicável; escolher uma troca o bloco de memória, e o que se anota ali nasce ligado a ela. A causa era mais antiga que as notas: a liga governava o rateio desde o `A4` e nunca tinha sido vista por quem opera.
2. **`NotaDoSetor` está declarado duas vezes** — em `servicos/notas.ts` e em `componentes/notas.tsx`. Instância nova da dívida `H-D7`, com `criadoEm` já sendo `Date` de um lado e `string` do outro, que é a forma exata que o defeito assumiu da última vez. Documentado dentro do arquivo. Corrigir a família inteira atravessa a fronteira servidor/cliente e não é carona de entrega de funcionalidade.

Também registrado, e deliberado: **a leitura de `paraContexto` não tem teto.** Um `take` pareceria prudente e seria pior — ordenado por data, descartaria em silêncio a nota de liga mais antiga em favor de notas gerais recentes. Mesma classe de `H-D8`.

Testes: 358 → **386**.

---

## Antes disso — o A13

**Entrou o A13 — quem pode ver o motivo de uma ausência.** Era a última pergunta aberta desta sessão, e você respondeu em 06/09/2026. Detalhe em `DECISOES.md § A13`.

**Todo mundo vê que a pessoa está fora; só o gestor vê por quê.** Para colaborador e operador, a ausência aparece como *"de férias"* ou *"indisponível"*. Para gestor, uma ficha com o motivo real e a observação livre — onde cabe "motivos pessoais".

Duas razões separam os níveis: a operação **precisa** saber quem não vai receber trabalho hoje, senão a tela promete uma equipe que não existe; e o motivo médico não é assunto de quem divide fila.

Três detalhes que não são acidente:

- **`férias` atravessa** porque é agenda, não saúde. Esconder produziria a pergunta *"por que fulano está indisponível?"* — a conversa que a redação existe para evitar.
- **Todos os motivos sensíveis viram o MESMO rótulo.** Se `atestado` tivesse rótulo próprio e os outros não, a ausência do rótulo já denunciaria o motivo.
- **A redação acontece no servidor**, nunca no componente. Mandar o tipo real e esconder na tela deixaria o dado numa resposta HTTP que qualquer pessoa autenticada lê — a tela é vitrine, não fechadura. Há teste que prova que `atestado` não sai do servidor para operador.

Com isso o Painel ganhou a linha *"Fora hoje"*, que era a metade do `A10` que faltava.

Testes: 337 → **358**.

---

### Antes disso, na mesma data — A4

**Entrou o A4 — agrupamento por liga. Era a última decisão do dono pendente.** Detalhe em `DECISOES.md` § A4/A4.1, `§ AT-10` e `§ C2`; contrato do motor em `03-SPEC.md` § 5.

**A liga é a unidade que não se separa; o e-mail não é.** Você respondeu a pergunta que faltava em 06/09 (`A4.1`): a unidade é `(liga, DIA)`, não `(liga, e-mail)`. Dois e-mails da mesma liga no mesmo dia vão para a mesma pessoa; entre dias, ela não fica presa a ninguém.

**O A4 era maior do que a documentação dizia.** Estava escrito como "mudança no contrato do motor". É — mas faltava a metade de baixo: **`Item.ligaId` nunca era preenchido por ninguém.** As tabelas `Liga` e `Ligante` existiam desde a fundação, vazias, sem um único escritor. O que existia era `ligaMencionada`, texto livre que a IA extrai. Sem transformar esse texto em identidade, o motor não teria o que agrupar.

**A identidade é por nome normalizado, e a comparação é exata — nunca aproximada** (`AT-10`). Separar uma liga em duas é erro que o operador vê e corrige; unir duas ligas diferentes entrega o trabalho de uma como se fosse da outra, e ninguém descobre. Os dois erros não custam a mesma coisa.

**Dois testes do critério de aceitação nº 1 ficaram vermelhos, e não eram defeito.** O crédito chegou a `15,33` onde se exigia `< 1`. O invariante forte pressupõe que a menor coisa entregável é um item; o `A4` diz que é uma liga inteira, e uma liga de 30 numa equipe de 3 desloca o crédito em 20 de uma vez — o próprio texto do `A4` já assumia isso.

**Mas afrouxar o teste até passar seria trocar uma garantia por nada.** "Equilíbrio na semana" só vale se o crédito **voltar**; se crescesse todo dia, a mesma pessoa acumularia dívida para sempre, devagar e em silêncio. Ninguém tinha provado essa parte. Entrou o teste que faltava: 24 dias simulados, medindo se o pior crédito da segunda metade é sistematicamente maior que o da primeira. **Não é** — o crédito oscila e volta, e a soma por categoria continua zero.

Testes: 312 → **337**.

---

### Antes disso, na mesma data — A10

**Entrou o A10 — afastamento como entidade.** Detalhe em `DECISOES.md`, seção *Afastamento (A10)*.

Férias, atestado, falta e licença deixam de ser catorze marcações de escala feitas na mão. **Escala e afastamento respondem perguntas diferentes** — quem está de plantão hoje (decisão diária do operador) contra quem está fora num período (fato, declarado uma vez pelo gestor) — e `carregarElegiveis` exige as duas. É por isso que o afastamento funciona mesmo com a escala marcada, que é exatamente o caso de esquecer de desmarcar.

**O crédito congela sozinho, e não foi escrita uma linha para isso.** Crédito só muda para quem entra numa rodada, e quem está afastado não entra. Escrevi o teste que prova a propriedade em vez do código que já existia de graça — um "congelador" criaria um segundo lugar onde o crédito é manipulado, e um segundo lugar para errar.

**Verificado por HTTP com A/B, e a primeira tentativa não provava nada:** pus alguém de férias e ela não recebeu — mas ela não estava escalada naquele dia de qualquer forma. Refeito com quem **estava** de plantão e recebendo: Dora sai, a carga é absorvida pelos outros, a conservação fecha, e a narrativa do `A6` acompanha sozinha ("com 1 pessoa de plantão" no lugar de 2).

**Um obstáculo de ambiente ficou registrado — e foi RESOLVIDO em 07/09/2026, na etapa de fechamento.** A CSP quebrava a verificação de tela em desenvolvimento (`eval() is not supported`, HMR caindo, formulário controlado sem reagir), e esta entrega teve de ser verificada por HTTP. `unsafe-eval` passou a entrar só em desenvolvimento; em produção nada mudou. Conferir tela em `npm run dev` voltou a funcionar.

Testes: 295 → **309**.

---

### Antes disso, na mesma data — A7 e A6

**Entraram A7 e A6 — prioridade por idade e relatório da rodada.** Detalhe em `DECISOES.md`, seção *Prioridade por idade e relatório da rodada*.

**A fila ordenava pela idade errada.** Era `atribuidoEm` — a idade da *atribuição*, não a do trabalho. As duas divergem exatamente no caso que importa: item de três semanas devolvido ao pool e redistribuído hoje aparecia no **fim** da fila, como se fosse novo. Agora ordena por `item.criadoEm`, a mesma definição que a distribuição já usava.

**O painel ganhou a coluna "Mais antigo (hoje)"**, com há quantos dias está parado o item aberto mais velho de cada categoria. **Sem faixa de alerta, de propósito:** o `A7` diz que o setor não trabalha com prazo, e colorir a partir de N dias inventaria um SLA que ninguém definiu.

**A narrativa da rodada descreve, nunca recalcula.** `core/distribuicao/narrativa.ts` é função pura sobre o snapshot que o motor já gravou. Sem IA — o `A6` permite que ela redija a frase, mas o texto determinístico não custa crédito, não falha por rede e não pode alucinar um número. Verificado na tela: a narrativa apareceu acima dos números crus da mesma rodada, e os dois batem.

**A verificação no navegador achou um defeito que não era o objetivo.** O seed criava uma habilitação **nova a cada dia**, porque a chave do upsert incluía `DATA_INICIAL` (`hoje − 7`), que anda. Medido: 80 linhas para 20 pares reais. A tela de plantão repetia o mesmo selo quatro vezes e o React acusava chave duplicada — que ele trata como podendo *omitir* elementos. A distribuição não foi afetada, mas por sorte de implementação. Corrigido e provado: seed rodou três vezes seguidas, 20/20/20.

Testes: 278 → **295**.

---

### Antes disso, na mesma data — A11 e A12

**Entraram A11 e A12 — peso e limiar de confiança por categoria.** Detalhe em `DECISOES.md`, seção *Peso e limiar por categoria*.

`DOC = 4` e `FICHA = 1,75` no peso; `0,95` e `0,90` no limiar; resto na base (`1` e `0,85`). As duas vieram da mesma frase do cliente e entraram juntas: uma trata do esforço (equilíbrio entre categorias), a outra do cuidado (quanto vai para a revisão humana).

**O custo estava superestimado aqui, e a correção importa para as próximas estimativas.** Este arquivo dizia que A11 mexeria no motor. Não mexeu: `motor.ts` já multiplicava por `categoria.peso`, e `ingestao.ts` já lia `categoria.limiarConfianca`. As duas decisões eram **valor de dado**, não lógica ausente.

**O risco real estava em outro lugar — na unidade.** Dois testes do critério de aceitação nº 1 falharam com `2,667 < 1` e `3,5 <= 3`. Nenhum era regressão: `2,667 = 0,667 × 4`. O crédito é um livro-razão em unidades **ponderadas**, e o teto estava escrito como a constante `1`; enquanto todo peso era `1`, "um item" e "1 unidade" eram o mesmo número. Manter `1` teria exigido de documento um equilíbrio quatro vezes mais apertado que o de e-mail — regra que ninguém decidiu. Os testes passaram a comparar contra o peso da própria categoria.

**Duas consequências que ficam registradas:** o histórico anterior a 06/09/2026 foi calculado com peso `1` e **não** foi recomputado (o invariante 11 proíbe reescrever o passado), então há descontinuidade de unidade nesta data e a comparação lado a lado precisa ser refeita a partir daqui. E o A12 significa **mais** documento e ficha na fila de revisão humana — é o efeito desejado, mas é fila de gente; se incomodar, o número é configurável sem deploy.

**Estes valores ainda não foram relidos com o dono do negócio.** Foram decididos em 26/08 e implementados a pedido explícito de 06/09, com o aviso registrado. `1,75` já nasceu negociável.

Testes: 271 → **278**.

---

### Antes disso, na mesma data — sessão de manutenção

**Sessão de manutenção, zero regra nova.** Conferência do repositório de ponta a ponta — código, dependências, branches, segurança — e correção do que estava quebrado ou defasado. Nenhuma decisão de negócio nova foi tomada; nenhum comportamento do produto mudou. Detalhe completo em `DECISOES.md`, seção *Manutenção de sessão — 06/09/2026*.

**O achado que importa: um teste que dependia do calendário.** `src/testes/apoio.ts` fixava `DATA_BASE = '2026-09-01'`. Item criado por teste recebe `criadoEm` do relógio real (`@default(now())` do Prisma — por design, não dá para um teste fingir que criou algo no passado). O corte temporal do motor (`criadoEm <= fimDoDia(data)`, deliberado e correto) passou a descartar esses itens assim que o relógio real avançou além de 1º/09 — o que já tinha acontecido quando esta sessão começou. Dois testes vermelhos (`itens.test.ts`, `pipeline.test.ts`), sem ninguém ter tocado em código de produção no meio do caminho. Corrigido ancorando `DATA_BASE` em `hojeIso()`.

**`node_modules` estava desalinhado do lockfile.** `typescript` instalado era `5.9.3`; o projeto pede `7.0.2`. `@types/node` instalado era `22.20.1`; o projeto pede `26.3.0`. O typecheck rodava com compilador dois majors atrás, sem aviso nenhum. `npm ci` corrigiu — a primeira tentativa corrompeu a instalação (`node_modules/.bin` sumiu), reinstalação limpa resolveu.

**Dependências e GitHub em dia.** Os dois PRs do Dependabot que estavam abertos e verdes (`#13`, `#14`) foram mesclados — zero PR aberto agora. Dois branches locais órfãos apagados; os sete branches remotos obsoletos já não existiam de verdade (o repositório apaga branch ao mesclar; só o cache local (`git fetch --prune`) estava desatualizado).

**O CI estava vermelho e a documentação dizia que estava verde.** O job `Auditoria de dependências` (`npm audit --audit-level=high`) falhava por duas vulnerabilidades em `mysql2` — uma alta —, enquanto este arquivo afirmava "npm audit acusa zero vulnerabilidades". `mysql2` é dependência do **CLI do Prisma** (que empacota suporte a MySQL sempre), nunca importado por este projeto, que usa SQLite; mas vermelho permanente ensina a equipe a ignorar vermelho, e isso o projeto já tinha registrado como inaceitável. Como o Prisma fixa `mysql2` em versão **exata**, subir o Prisma não resolveria e `--force` o rebaixaria dois majors. Corrigido com `overrides` no `package.json` — padrão que o projeto já usava para `deepmerge-ts` —, subindo `mysql2` para a versão corrigida `3.24.3`. `npm audit`: **0 vulnerabilidades**.

`npm run verificar`: **271 testes verdes**, typecheck limpo, `npx prisma generate` funcionando.

---

### 31/08/2026 — consolidação: `PR #12` e as decisões A4–A12

**Duas consolidações, nenhuma linha de regra nova.** Aquela sessão não construiu funcionalidade: fechou duas divergências entre o que o repositório fazia e o que a documentação dizia que ele fazia.

#### 1. O `PR #12` entrou na `main`

Estava aberto, verde e mesclável desde 28/08 — 6 commits, +2.971/−95 em 24 arquivos, os três checks passando. Enquanto ele esperava, a `main` não tinha o registro manual (`H-D4`), a fundação do cérebro operacional, nem as duas correções de segurança que a revisão adversarial daquela branch achou. Mesclado, e a `main` verificada num ambiente limpo: `npm install`, `.env`, `migrate deploy`, `generate` e **271 testes verdes**, sem etapa extra.

#### 2. As decisões A4–A12 voltaram para a `main`

**Este é o achado que importa.** Nove decisões do dono do negócio, tomadas em 26/08, viviam só no branch `claude/prototipo-em-progresso-unesv2`. A `main` seguiu dois dias de construção sem saber delas.

O sintoma era visível e ninguém tinha olhado: este arquivo listava **três perguntas como "aguardando o dono do negócio"** — etapa 6, itens mais antigos, dono único — e as três já tinham resposta escrita, com data, a cinco dias dali. A documentação não estava desatualizada por descuido de alguém; ela ficou errada sozinha, porque o trabalho foi para um lugar e o índice ficou em outro.

O que entrou: agrupamento por liga (A4), etapa 6 e conclusão pelo app (A5), relatório da rodada (A6), prioridade por idade (A7), lembrete semanal (A8), janela do desempate (A9), cadastro de afastamento (A10), peso por categoria (A11) e limiar por categoria (A12).

**Um conflito real apareceu, e ele é de número.** O A9 (26/08) decidiu janela de **15 dias**; o *Complemento arquitetural* (27/08), também diretriz do dono, decidiu **30 dias** — que é o implementado. Concordam no essencial (janela deslizante no lugar do mês corrente, como a `RN-11` exige) e divergem só no tamanho. **Resolvido pela data:** 27/08 é posterior, então 30 vigora e o código não foi tocado. As duas ficam registradas, para a revisão ser visível em vez de o número menor sumir sem rastro. Se 15 era o certo, a troca é decisão do dono — mexe no crédito acumulado de todo mundo de uma vez.

**O que foi registrado e NÃO foi implementado, de propósito:** A4, A10, A11 e A12 pedem código que não existe. A11 (peso `DOC = 4`, `FICHA = 1,75`) parece troca de constante e não é — o peso entra na cota justa em `motor.ts`, então mudá-lo muda toda a divisão entre categorias e a suíte de distribuição junto. Está na tabela *O que destas decisões ainda não existe em código*, em `DECISOES.md § A`, e virou item do próximo passo. Registrar não é implementar, e a distância entre as duas coisas precisa ficar escrita.

---

#### 3. Revisão geral e limpeza

Varredura do repositório inteiro atrás do que não serve mais. O que saiu:

**Quatro dependências de produção que nunca foram importadas** — `class-variance-authority`, `clsx`, `tailwind-merge` e `lucide-react`. Sobra do plano shadcn/ui, abandonado ainda no começo. `matrizes.tsx` importa **só `react`** e resolve composição de classe com a própria função `juntar()`, de duas linhas.

O incômodo não era o peso: a `03-SPEC.md` **afirmava** que o design system era construído sobre os quatro. Documentação descrevendo um sistema que não é este — e ninguém descobre até ir procurar o uso e não achar. Corrigido no SPEC, com o motivo. De quebra, o [PR #15](https://github.com/fernando123-hue/Sistema-SBP/pull/15) do Dependabot (`lucide-react` 1.34 → 1.35) ficou sem objeto: era manutenção sobre pacote que ninguém usava.

**Cinco símbolos exportados e inalcançáveis:**

| Símbolo | Por que saiu |
|---|---|
| `LIMIAR_CONFIANCA_PADRAO` | Duplicava o `@default(0.85)` do schema, que é de onde o limiar sai de verdade (`ingestao.ts` lê `categoria.limiarConfianca`). O tipo `Categoria` do core nem carrega o campo |
| `categoriaPorCodigo` | Função sem nenhum chamador |
| `inicioDaSemana` | Sem chamador — **e o comentário dizia "usado só na leitura do painel"**, uso que não existia |
| `dataDoEmail` | Invólucro de uma linha sobre `paraDataIso`, nunca chamado. Apagá-lo deixou o import órfão, e o typecheck pegou |
| `FrenteSchema` / `GrupoSchema` | Duplicavam as uniões `Frente` e `Grupo` de `tipos.ts`, sem leitor |

Mais **sete aliases de tipo** em `esquemas.ts` (`CategoriaCodigo`, `StatusItem`, `MotivoAtribuicao`, `Anexo`, `ItemDividido`, `RegistroManual`, `PayloadDoItem`) sem nenhum consumidor — nem em outro arquivo, nem no próprio. Não é convenção do arquivo: 17 dos 31 esquemas têm tipo pareado, ou seja, o tipo é criado quando alguém precisa. Agora todo símbolo exportado de `esquemas.ts` tem consumidor, o que é uma propriedade conferível.

**Um caso não era código morto e não foi apagado.** `SituacaoEventoSchema` parecia sobra, mas a lista `'iniciado' | 'sucesso' | 'falha' | 'reprocessavel'` estava escrita **duas vezes** — como enum Zod em `esquemas.ts` e como união TypeScript em `observabilidade.ts`. Duas fontes para o mesmo vocabulário fechado é exatamente o que o PR #12 corrigiu para `acao` e `operacao`. Em vez de apagar, `observabilidade.ts` passou a derivar o tipo do esquema. Sobrou uma fonte.

**A maior duplicação que sobrou já tem nome: `H-D7`.** As telas redigitam à mão os tipos que os serviços já declaram — `caixa/page.tsx` × `servicos/caixa.ts`, `fila` × `fila`, `painel` × `painel`, `revisao` × `revisao`, `distribuicao` × `resumo.ts`. **Não mexi:** é dívida registrada, com abordagem já escolhida (derivar dos esquemas Zod), e o conserto é refatoração que atravessa a fronteira servidor/cliente — não é apagar coisa morta. Ela já cobrou uma vez (`emAndamento` sumiu; `Date` contra string). Continua no *Próximo passo*.

**Três casos pareceram duplicação e não eram, conferidos um a um:** `conferirAssinatura` existe duas vezes com significados diferentes (HMAC do cookie de sessão × bytes mágicos de anexo); `linhaDe` são dois auxiliares de teste sem relação; `mensagemDoErro` tem versão de servidor e de cliente, e a do cliente acrescenta o identificador de correlação — mesma assinatura, responsabilidades distintas nos dois lados do fio.

**A varredura do schema deu falso positivo e nada foi tocado lá.** Oito colunas apareceram como "nunca referenciadas", e nenhuma era morta: `revisoesFeitas` e os `ligaId` são **relações**, `atualizadoEm` é `@updatedAt` gerido pelo Prisma, e `Item.ligaId` é justamente o que o `A4` vai precisar. Apagar coluna exige migração e esbarra no invariante 11 — o custo de errar é alto e o ganho era zero.

**O que foi conferido e está limpo:** nenhum arquivo órfão em `src/` (todos os cinco sem import são entradas legítimas — `npm scripts` e o `globalSetup` do vitest); zero `TODO`, `FIXME` ou `@deprecated`; zero bloco de código comentado; zero `console.log` solto. Os números que a documentação afirma foram medidos de novo e batem: 7 migrações, 20 modelos, 9 telas, 24 arquivos de rota, 13 invariantes, 271 testes.

**O que NÃO foi apagado, de propósito:** os comentários que registram o defeito que cada linha previne (são memória cara, e o `CLAUDE.md` manda preservá-los) · o histórico deste arquivo e do `DECISOES.md` · `CONTEXTO.md` e `ENGENHARIA_REVERSA` (documentos de origem) · o workflow do CodeQL, desarmado de propósito e com plano de religar · `AdapterIndisponivelError`, que parece sem uso porque é lançado e capturado genericamente.

`npm run verificar`: **271 testes verdes**, antes e depois. Nenhum comportamento mudou — nada aqui era alcançável.

---

## O que veio antes

**Entrou a fundação do cérebro operacional.** Detalhe em `DECISOES.md`, seção *Fundação do cérebro operacional*.

A diretriz era grande — memória, eventos, capacidades, contexto, isolamento de domínio, ecossistema futuro — e a análise com agentes especializados devolveu a resposta que interessava: **a maior parte já estava atendida**. O gateway de IA está limpo desde 26/08, a memória de feedback (`sugestaoIa` × `valorFinal`) existe e já é lida por `qualidade-ia.ts`, o histórico é reproduzível, e conteúdo já está separado de histórico operacional.

**O buraco real era outro: memória que ninguém conseguia ler.** `LogAuditoria` e `EventoProcessamento` eram gravados em 27 pontos do código e não tinham **um único leitor em produção** — nenhuma rota, nenhuma tela. A trilha de um sistema que existe para acabar com erro silencioso só era alcançável por `prisma studio`.

**O caso mais concreto estava na mensagem de erro.** Num 500, o sistema sorteia um identificador, entrega ao usuário dizendo que ele *"permite rastrear a falha no log"*, e gravava **só em stdout**. Quem da secretaria dissesse "deu erro, o código é `a3f…`" só podia ser atendido por alguém com o terminal do servidor à mão. Agora o 500 grava evento, e `GET /api/memoria?correlacao=<id>` resolve — com teste que estoura uma rota de verdade e prova a ponta a ponta.

**Três peças entraram, e só três:**

- **`dominio` em `LogAuditoria` e `EventoProcessamento`.** É o que fica mais caro a cada dia: a trilha é append-only, então acrescentar a coluna depois preencheria as linhas antigas por `UPDATE` — a única escrita que o projeto promete nunca fazer. Mesmo raciocínio do `escopo` que você aceitou em 27/08.
- **Vocabulário fechado.** 41 literais de `acao` e de operação eram `string` livre; um `concluido` digitado `concluído` entrava calado numa tabela que ninguém pode corrigir. O compilador casou com as 19 chamadas de produção de primeira.
- **Interface de consulta.** Por ciclo e por registro. **Sem listagem geral, de propósito** — a trilha diz quem fez o quê sobre a operação inteira, e despejá-la em página transformaria auditoria em vigilância.

**E o teste que faltava havia meses.** A regra mais citada do projeto — `app → servicos → core` — era sustentada **só por disciplina**: nenhum teste, nenhuma checagem no CI. Agora `src/core/pureza.test.ts` varre o núcleo resolvendo cada import por caminho, e falha nomeando arquivo, linha e regra. Provado com um violador temporário de 8 casos. Nenhuma violação real no código atual.

**O que eu recusei construir, e é o que mais parecia central na diretriz:** montagem de contexto para a IA com "casos parecidos corrigidos por humano". Devolver ao modelo texto que veio de e-mail transforma injeção de prompt — hoje limitada a uma mensagem — em ataque persistente. E selecionar correções humanas para injetar no prompt é aprendizado em contexto: treinar com dado real da associação a cada requisição, sem decisão sua. Também fora: tabela de memória genérica (`Categoria` já é a memória de domínio), `MemoriaPort` (sem segunda implementação, seria outro `RegraDistribuicao`) e barramento de eventos (nada precisa reagir).

**Dois invariantes novos** no `CLAUDE.md`, custo zero: memória é lida, nunca soprada de volta ao modelo (12); toda linha de memória nasce sabendo de que domínio é, e evento vai na mesma transação do fato (14 — era 13 antes de o invariante do assistente entrar).

**Duas perguntas novas para você**, em `DECISOES.md § H.4`: um agente é ator de quê (hoje `ATOR_SISTEMA` tem papel `operador` e confirmaria distribuição), e de que lado da retenção a memória cai.

Testes: 248 → **271**.

**A revisão desta entrega achou quatro defeitos meus, dois graves.** O pior: a rota reintroduzia, uma requisição depois, o vazamento que `http.ts` proíbe três linhas acima — `ConservacaoVioladaError` carrega o id de cada colega da rodada, e eu gravava a mensagem crua no evento. O ramo especial tinha sido tirado da resposta e recolocado como recurso consultável. O segundo: `entidade` era texto livre, então `?entidade=Colaborador` dava a `operador` o e-mail e o histórico de senha de uma colega — o que `GET /api/colaboradores` exige `gestor` para ver. Ambos corrigidos, com teste. Detalhe em `DECISOES.md`, *Revisão do próprio trabalho*.

**E preciso corrigir uma afirmação minha.** Eu disse que o identificador do erro 500 passa a resolver o ciclo. Resolve pela metade: `http.ts` sorteia uma correlação NOVA, sem relação com a que o serviço gerou por dentro, então a consulta devolve uma linha — "às 14:32 a rota X falhou com erro do tipo Y" — e não a história. É mais do que o stdout dava, e menos do que eu afirmei. Costurar de verdade exige propagar a correlação de dentro para fora, o que toca todos os serviços; ficou registrado como trabalho próprio, não como fundação.

---

**Entrou o registro manual de item** (`H-D4`). Detalhe em `DECISOES.md`, seção *Registro manual de item*.

`INADIMP.` e `ISENTO` estavam num beco sem saída: semeadas em `config.ts`, marcadas fora do rateio, proibidas à IA — e sem nenhuma rota que as criasse. Existiam no cadastro e eram inalcançáveis. Duas linhas da planilha (`CAD-MAIO`, 35–36) sem correspondente nenhum aqui dentro. Na rodada de comparação lado a lado, essas linhas apareceriam zeradas do lado do substituto, e não haveria explicação boa para dar.

O sintoma estava escrito no próprio código, meses antes: `CategoriaForaDoRateioError` termina com *"Registre manualmente"*, apontando para um caminho que não existia.

**A regra do responsável é assimétrica, e é isso que protege o motor.** Categoria fora do rateio **exige** quem atendeu; categoria do rateio **recusa**. Dentro do rateio quem escolhe a pessoa é o motor — aceitar um responsável ali abriria a porta lateral que este sistema substitui. Fora do rateio o motor nunca passa perto: sem responsável, o item nasceria `aprovado` e ficaria assim para sempre, porque `concluir` exige atribuição ativa. A pendência do painel cresceria sozinha, todo dia, sem ninguém ter errado nada — o defeito da planilha entrando pela porta da funcionalidade que veio consertar outra coisa.

**Um lançamento pode valer N itens.** A planilha digita `Mov.Extra = 11` numa célula; exigir onze operações aqui devolveria a equipe à planilha na primeira semana. `quantidade` cria 11 itens **rastreáveis** — a facilidade da planilha, sem a contagem anônima dela. Teto em 50, para que `111` no lugar de `11` vire recusa visível.

**O item não nasce concluído**, ainda que a planilha lance `Aberto` e `Realizado` no mesmo dia. Isso seria o operador declarando a conclusão do trabalho de outra pessoa, que é exatamente o que `concluir` recusa. Nasce `distribuido` na fila do responsável; fechar continua sendo ato dele.

**A verificação na tela achou um defeito meu.** O item manual aparecia com **Confiança 100%** — número de aparência ótima sobre uma classificação que modelo nenhum fez. Mesma família do `SUBTOTAL(109)`: o valor está lá, parece resultado, e não significa o que quem lê acha que significa. Agora a coluna mostra o selo `manual`, pelo mesmo critério (`modeloIa`) que a taxa de acerto usa para montar o denominador.

**Uma decisão ficou provisória e é sua.** Carga de categoria fora do rateio **não** entra no crédito (`§ AT-09`): contá-la faria uma categoria de exceção inclinar a cota justa de categorias das quais ela não participa. Escolhi o lado reversível — começar a contar depois é decisão; despoluir um razão já acumulado exige recomputar histórico. A pergunta objetiva está em `DECISOES.md § H.4`, item 6.

Testes: 229 → **248**.

**Os PRs [#1](https://github.com/fernando123-hue/Sistema-SBP/pull/1) e [#2](https://github.com/fernando123-hue/Sistema-SBP/pull/2) foram mesclados.** `actions/checkout` e `actions/setup-node` agora em `v7` nos três jobs e no CodeQL. O prazo de 16/09, quando o Node 20 sai dos runners do GitHub, está resolvido.

**Entrou o recorte de período no painel** (`H-D5`). Detalhe em `DECISOES.md`, seção *Painel com recorte de período*.

O painel contava desde a fundação e chamava isso de "pendente". A planilha tem uma aba por mês. Na rodada de comparação lado a lado — que é como este sistema se prova — os dois nunca bateriam, e a conclusão natural de quem olha seria que o substituto está errado.

**Cada coluna agora tem correspondente na planilha**, e a tela diz isso no rodapé: `Saldo` · `Entrou` (Mov. do Dia) · `Aberto` (ABERTO) · `Concluído` (Realizado) · `Pendente` (Pend.). Sem esse mapeamento a conferência vira discussão sobre o que cada palavra significa.

**O carry-over deixou de ser digitado.** A planilha faz `Saldo(d) = Pend.(d−1)` à mão, sem fórmula, e por isso erra em ~10% dos dias. Verificado com histórico atravessando a virada do mês: julho fechou com pendência 2, e agosto abriu com saldo 2 — sem ninguém digitar.

**Uma divergência é deliberada e vai aparecer.** A planilha grampeia `Pend.` em zero, e quem limpa backlog antigo tem o excedente descartado (`RN-09`). Aqui não há grampo e nem precisa: só entra em "concluído" o que estava em "aberto". Quando os números divergirem num dia de limpeza de backlog, **o certo é o do sistema** — registrado para não virar discussão na hora.

`Item.canceladoEm` é coluna nova. Sem ela, cancelar hoje mudaria retroativamente a pendência do mês passado, e o painel mudaria de número sozinho entre duas consultas. Conclusão não precisou de equivalente: já vive em `Execucao.concluidoEm`, e item concluído nunca reabre.

E o painel ganhou o invariante que faltava: `pendente` sai de uma subtração, `conferirPendencia` conta direto, e os dois têm de bater. Mesmo espírito de `conferirConservacao` — número que só existe de uma forma não tem como se provar errado.

Testes: 215 → **226**. A revisão desta entrega achou pendência NEGATIVA na fronteira exata do período — o defeito `E.9` reconstruído — e foi o próprio invariante das duas contagens que pegou.

**Entrou o tratamento de proxy confiável** (`H-D16`), da lista de *obrigatório antes de expor fora da rede local*. Detalhe em `DECISOES.md`, seção *Origem da requisição e proxy confiável*.

**O item saiu na frente do `H-D18` porque a justificativa do `H-D18` não se sustenta mais.** Ele existia para garantir que métrica sobrevivesse a um expurgo — mas depois da separação entre conteúdo e histórico, o que a retenção pode apagar é `EmailConteudo` e bytes de anexo, e nenhuma métrica lê essas linhas. Painel, conservação e acerto da IA saem todos de `Item`, `Atribuicao`, `SaldoCarga` e `Revisao`, que o invariante 11 proíbe apagar. `H-D18` continua valendo por recorte histórico barato, mas deixou de bloquear a retenção. Reclassificado.

**E o `H-D16`, medido, era pior do que estava escrito.** Subi o servidor e li os cabeçalhos reais: sem `x-forwarded-for` o Next preenche com o endereço do socket; **com** o cabeçalho, ele repassa o valor do cliente inteiro. E `origemDaRequisicao` lia a *primeira* entrada — exatamente o pedaço que o atacante escolhe. Variar um cabeçalho dava um balde de limite de taxa novo por requisição: o limite por origem não existia.

O erro de ler a primeira entrada é independente da configuração — mesmo **com** proxy confiável, a primeira entrada é a que o cliente mandou; o proxy acrescenta a verdadeira no fim.

Agora `PROXIES_CONFIAVEIS` declara quantos saltos confiáveis existem. Com `0` (padrão), o código **admite que não sabe a origem** em vez de fingir, e o teto sobe para o balde compartilhado não virar um DoS de graça contra a própria equipe. Com `N > 0`, lê a entrada certa da cadeia.

Provado na aplicação rodando: 25 pedidos forjando a primeira entrada com a última fixa deram 20 aceitos e depois `429` (mesmo balde); 25 pedidos com últimas entradas distintas passaram todos (clientes reais continuam separados, sem `429` falso).

**A revisão desta entrega achou um buraco pior que o defeito original.** A leitura por posição na cadeia assume que o proxy acrescentou alguma coisa — e nem todo proxy acrescenta. Na configuração comuníssima do nginx que manda `X-Real-IP` **sem** mexer em `X-Forwarded-For`, o Next preenche a cadeia com o endereço do próprio proxy. Medido com 25 clientes distintos: todos num balde só, e o limite **apertado** disparando no 21º pedido. A correção tinha trocado um defeito de segurança por um de disponibilidade — pior, porque derruba a operação num dia normal, sem atacante nenhum.

Corrigido: a cadeia manda quando ela realmente cresceu além dos saltos confiáveis; com um salto, `x-real-ip` desfaz o empate. Depois disso, 25 clientes distintos passam todos, e o mesmo cliente 25 vezes continua sendo travado no 21º.

**A ambiguidade que sobrou não dá para resolver sozinha, então virou visível.** `GET /api/diagnostico/origem` (só gestor) devolve o que o servidor entendeu como origem daquela requisição, com os cabeçalhos crus. Abrir de dois dispositivos e comparar `chave` responde em dez segundos se o proxy está configurado certo. Sem isso, o jeito de descobrir era a equipe parar de conseguir entrar.

A revisão também desmentiu uma afirmação minha: eu tinha escrito que o teto global afrouxado protege CPU e contém laço automatizado. Fui medir — 900 requisições em 30 processos paralelos **não** o alcançaram, e uma entrada legítima no meio passou. O `scrypt` satura a vazão antes do teto. Comentário corrigido para dizer o que foi medido.

Testes: 204 → **215**.

**Entrou o cadastro de pessoa pela tela** (`H-D17`), junto com a habilitação. Detalhe em `DECISOES.md`, seção *Cadastro de pessoa e habilitação*.

Até aqui só o seed criava colaborador — montar a equipe exigia terminal e banco, o que na prática significa que o gestor não montava equipe nenhuma.

**As duas coisas entraram juntas porque separá-las produz gente invisível.** `obterEscala` filtra por quem tem habilitação, então alguém criado sem categoria não aparece na tela de plantão: existe, tem senha, entra no sistema, e nunca recebe trabalho. Sem erro, sem aviso, sem onde olhar.

Cadastrar sem categoria continua possível — gestor administra e não recebe rateio —, mas deixou de ser silencioso: o formulário avisa na hora, e a lista marca quem está nesse estado com um selo vermelho *"sem categoria · não recebe nada"*.

Tirar uma categoria **desliga a linha, nunca apaga** — o histórico de carga se apoia nela. E desliga com efeito imediato, não a partir de amanhã: o gestor tira a categoria justamente antes da distribuição do dia, e uma revogação que só valesse amanhã chegaria tarde no único momento em que importa.

Verificado na tela ponta a ponta: cadastrei uma pessoa pela interface, o aviso de "sem categoria" apareceu e sumiu ao marcar `Ligante`, a senha provisória apareceu uma vez, **a pessoa entrou no sistema com essa senha** e caiu na troca obrigatória, apareceu no plantão com a categoria certa, e sumiu do plantão na hora em que tirei a categoria.

**A revisão desta entrega achou dois defeitos meus, os dois na fronteira de entrada.** O primeiro: `.trim()` vinha DEPOIS de `.min(1)` no esquema, e em Zod a validação roda na ordem da cadeia — `"   "` tem comprimento 3, passa, e só então vira `""`. Rodando o cadastro real, a resposta voltou com `"email": ""`: uma conta que existe, tem senha, e **nunca abre**.

O segundo: não havia validação de formato de e-mail em lugar nenhum. E o `type="email"` que eu tinha posto no campo não valida nada — o input não está dentro de um `<form>` e o botão é `onClick`, não `submit`. O campo parecia conferido e não era. E-mail sem domínio cria uma conta que a pessoa nunca encontra, o gestor cadastra de novo com o endereço certo, e passam a existir duas pessoas que são a mesma, com o histórico de carga partido — o dano que a regra de "reative em vez de duplicar" existe para impedir, entrando pela porta da frente.

Corrigidos os dois no esquema, que é o servidor. A tela passou a conferir com o **mesmo** esquema antes de enviar — não substitui a validação de lá, evita a ida inútil.

Testes: 187 → **204**.

**Entrou a taxa de acerto da IA** (`H-D3`) — o item 2 do roteiro, e o que destrava os outros. Detalhe em `DECISOES.md`, seção *Taxa de acerto da IA*.

O critério de aceitação nº 5 pede "aceita sem correção ≥ 80%". Esse número não existia em lugar nenhum, e sem ele mexer no limiar de confiança era palpite. Nenhum dado novo precisou ser coletado: `Revisao` guarda `sugestaoIa` ao lado de `valorFinal` desde sempre — faltava a conta.

**A decisão de projeto foi o denominador.** Se o universo fosse todos os itens, os que nunca foram à revisão contariam como acerto, e bastaria subir o limiar até ninguém revisar nada para a taxa ir a 100% — o indicador subindo justamente enquanto a conferência humana sumia. Então o universo é só o que passou por humano: número pessimista por construção, e o único que não se infla mexendo em parâmetro. A **cobertura** aparece sempre ao lado, porque 95% de acerto sobre 2% de cobertura é ruído com cara de resultado.

A tela mostra também a **confiança média quando acerta ao lado da confiança média quando erra**. Se as duas estiverem coladas, o número que o modelo reporta não separa acerto de erro e mexer no limiar é regular ruído. Rodando contra o mock, saíram 0,91 e 0,90 — o aviso dispara. Com o modelo real, é isso que a medição vai dizer.

Verificado na tela com dado real do fluxo: 27 revisões resolvidas, 48% aceitas sem correção, cobertura 82%, e a repartição do que o humano mudou (6 categoria trocada, 5 título editado, 3 recusadas).

**Revisei a própria implementação antes de dar por pronta, e ela tinha dois defeitos.** O primeiro: a cobertura dividia universos diferentes — itens contados por data de criação, revisões contadas por data de resolução. Fila acumulada (item velho, decisão nova) fazia a fração passar de 100%. E o `Math.min` que eu tinha posto para limitá-la não corrigia, **escondia** — devolvia 100% redondo e falso. É o mesmo padrão que a revisão do adapter tinha acabado de condenar. Corrigido ancorando as três consultas na mesma data.

O segundo: o painel pedia `?dias=tudo`, carregando todas as revisões desde a fundação na tela mais visitada do sistema — a proibição que `conferirConservacao` documenta no arquivo ao lado. Agora usa a janela de 30 dias, e a tela diz qual período está mostrando.

Testes: 159 → **187**. Dezenove sobre o critério, puros; nove sobre a leitura contra banco real — um erro de leitura produziria um número plausível e falso, que é o pior resultado possível aqui.

**Uma revisão dirigida ao código ainda não mesclado encontrou quatro defeitos** — dois deles da categoria que este sistema existe para eliminar. Detalhe completo em `DECISOES.md`, seção *Revisão do adapter e da ingestão*.

Os dois graves eram **perda silenciosa de trabalho**, o defeito `E.9` da planilha reconstruído dentro do substituto:

1. **E-mail sem item nenhum sumia.** O schema aceitava lista vazia. O e-mail era gravado como processado, zero item criado, e a idempotência por `messageId` garantia que ele nunca mais voltasse. Sem erro, sem log, sem contador, sem fila.
2. **Item com categoria ausente do banco era descartado** por um `continue` — e o e-mail seguia marcado como processado do mesmo jeito.

A correção dos dois é deliberadamente **diferente**, porque as situações são diferentes. Zero item é resultado legítimo (resposta automática, aviso de entrega): o e-mail é processado, contado em `emailsSemItem` e registrado como evento — recusá-lo criaria repetição infinita gastando crédito. Categoria ausente é sistema mal configurado: aborta a transação inteira, o e-mail fica reprocessável e volta quando o cadastro for corrigido.

Corrigir o primeiro expôs um problema maior: **a tela de distribuição descartava o resumo inteiro da sincronização.** Nenhum número chegava ao operador — cinco e-mails podiam falhar sem que ninguém visse. Um contador que ninguém lê não é visibilidade. A tela agora mostra o resumo depois da busca.

Os outros dois: o adapter tratava **erro de rede como erro de validação** (o log dizia "recusada pela validação" com causa `timeout`, e a segunda tentativa pedia ao modelo que consertasse a rede), e este arquivo descrevia um caminho de falha que o código não percorre.

**Chave recusada agora para o lote inteiro** na primeira ocorrência, via `InterpretacaoIndisponivelError`. Antes, virava falha por e-mail: mil chamadas condenadas e a causa real — uma variável de ambiente errada — diluída em mil linhas iguais.

Testes: 155 → **159**. Cada defeito tem teste que o provou antes da correção.

**Entrou o complemento arquitetural sobre histórico e retenção** (`DECISOES.md`, seção *Complemento arquitetural*). A avaliação mostrou que a maior parte da evolução pedida já estava preservada — tempo por tarefa, devolução com motivo, carga acumulada e reconstrução de decisão já eram calculáveis. Mas havia **um conflito real**: conteúdo de e-mail e metadado operacional viviam na mesma linha, então ou se guardava dado pessoal para sempre, ou se perdia o histórico junto com ele.

Resolvido: `EmailConteudo` é linha separada e expurgável; `Email` guarda o metadado que sobrevive. Há teste que apaga **todo** o conteúdo e verifica que item, atribuição, carga e conservação continuam de pé. Nenhuma política de retenção foi implementada — a estrutura permite, o prazo é decisão sua.

Outras quatro mudanças estruturais, todas baratas agora e caras depois: janela deslizante de 30 dias no desempate (sai a fronteira mensal que a `RN-11` manda eliminar), carga ponderada gravada ao lado da contagem, escopo por frente no livro-razão global, e anexos como entidade com os arquivos fora do banco. Junto veio a **verificação do tipo real do arquivo** — um executável chamado `laudo.pdf` passava pela allowlist de extensão inteiro.

Três invariantes novos em `CLAUDE.md`: guardar histórico não é treinar modelo · métrica por pessoa é observabilidade, não avaliação · conteúdo tem retenção, histórico operacional não.

**Entrou o adapter Anthropic.** `IA_ADAPTER=anthropic` passa a usar o modelo real; nenhum serviço mudou, porque nenhum serviço sabe qual adapter está atrás do `AiPort`. A saída do modelo é gerada a partir do próprio schema Zod, então o formato pedido e o formato validado não podem divergir. Resposta que não valida volta ao modelo uma vez, com o erro junto; falhando de novo, o e-mail é contado como falha da rodada, registrado como reprocessável e **volta inteiro na próxima sincronização** — ele não entra em fila de revisão nenhuma, porque sem item não há o que revisar.

Repetir só acontece quando o problema é o **formato** da resposta. Timeout, 429 e erro de servidor não repetem — reescrever o prompt não conserta rede, e o SDK já tentou por conta própria antes de erguer o erro. Chave recusada não vira falha de e-mail: ela para o lote inteiro na primeira ocorrência, para a causa real não ficar diluída em centenas de linhas idênticas.

A detecção de injeção continua sendo **nossa**, por regex, antes de o texto chegar ao modelo — o sinal do modelo entra como reforço, nunca como substituto. Perguntar ao modelo atacado se houve ataque é pedir ao réu que se julgue.

> **Atenção, e é a parte importante:** o adapter **nunca rodou contra a API real** — não há credencial nesta máquina e gastar crédito não é decisão minha. Os 12 testes cobrem tudo que é nossa responsabilidade (delimitação, retentativa só quando cabe, falha alta, parada do lote por credencial recusada, recusa de categoria inventada e de confiança inflada) com a rede substituída por um duble. Antes de confiar nele em qualquer volume, rode com a chave configurada:
>
> ```bash
> IA_ADAPTER=anthropic npm run ia:experimentar
> ```
>
> O script mostra quatro casos — comum, desdobramento em N itens, campo faltando e tentativa de injeção — e não toca no banco.

**Entrou também a autenticação real com senha** — era o item que bloqueava qualquer dado de associado. A entrada agora é por e-mail e senha; o gestor cadastra a pessoa com uma senha provisória e a entrega, e o sistema não libera tela nenhuma nem rota nenhuma até ela definir a própria senha. Quem erra a senha cinco vezes seguidas trava por alguns minutos e destrava sozinho.

Sumiu junto a pior brecha que existia: a tela antiga **listava a equipe inteira** e deixava assumir qualquer identidade sem senha, inclusive a de gestor. A lista de colaboradores agora exige papel `gestor`.

**Passei uma auditoria em cima do meu próprio trabalho antes de dar por pronto**, e ela achou cinco defeitos reais — todos corrigidos e com teste. O mais grave: o contador de tentativas era lido e regravado, então dez tentativas *simultâneas* contavam como uma e o bloqueio nunca disparava; provei o furo com um teste antes de consertar. O mais traiçoeiro: trocar a senha **não** derrubava as sessões antigas — ou seja, a reação natural de quem desconfia de um acesso indevido não expulsava ninguém. Agora expulsa, e redefinir a senha de alguém virou a ferramenta do gestor para cortar uma sessão na hora.

O raciocínio de cada escolha (por que `scrypt` do Node em vez de `bcrypt`, por que mensagem única de erro, por que o bloqueio nunca é permanente) e a lista completa dos defeitos encontrados estão em `DECISOES.md`, seção *Autenticação com senha*. Testes: 98 → 120.

Antes disso, a tela de Revisão passou a deixar o operador **editar os campos que a IA extraiu** e **ajustar o N do desdobramento pra cima**. Detalhe em `DECISOES.md`, seção *Divisão manual da revisão*.

Antes disso, tinha terminado uma **auditoria completa com oito agentes** (arquitetura, segurança, banco, performance, qualidade de código, testes, regras de negócio, telas) e aplicado as correções classificadas como *CORRIGIR AGORA*. Estão todas em `DECISOES.md § H`.

As mais graves que foram corrigidas:

1. **Fuso horário** — a chave temporal do sistema era UTC. Depois das 21h em Brasília o sistema achava que já era o dia seguinte. Corrigido em `src/core/util/datas.ts`.
2. **Conservação com falso positivo** — o contador incluía atribuições encerradas, então qualquer transferência marcava a rodada como divergente. O indicador que prova o valor do sistema acusava erro justamente quando ele funcionava.
3. **Pendência negativa** — o painel subtraía universos diferentes; era o defeito `E.9` da planilha reconstruído dentro do substituto.
4. **A IA decidia quantidade sem revisão** — desdobramento de 1 e-mail em N itens entrava aprovado sem ninguém ver. Agora sempre passa por humano.
5. **Aprovar revisão apagava os campos extraídos** — o dataset de melhoria nascia vazio.
6. **Concorrência na distribuição** — duas confirmações do mesmo dia decidiam desempate com crédito obsoleto. Resolvido com `TravaDeDistribuicao`.
7. **Vazamento em erro 500** — `ConservacaoVioladaError` devolvia a alocação inteira ao cliente.
8. **Limite de taxa global no login** — 21 requisições de qualquer pessoa travavam a entrada da equipe inteira.
9. **Contraste ilegível no tema escuro** — o botão mais usado do sistema media 2,43:1.

---

## Situação do CI e das dependências

**O CI roda e passa em três jobs:** `verificar` (typecheck, testes e sincronia entre schema e migrações — a sincronia é um passo dentro dele, não um job próprio), `segredos` (gitleaks) e `dependencias`. `npm audit` acusa **zero vulnerabilidades** — voltou a zero em 06/09/2026, com o `override` de `mysql2`; entre 31/08 e essa data o job `dependencias` estava vermelho e este arquivo dizia o contrário. Antes de repetir a frase "o CI está verde" aqui, olhe o CI, não a memória da sessão — é a mesma lição que os branches órfãos já tinham dado.

O segundo arquivo de workflow, o do CodeQL, está **desarmado de propósito** (`workflow_dispatch` apenas). A análise funciona, mas o upload do resultado exige "code scanning", que o GitHub só oferece em repositório público ou com Advanced Security — e workflow eternamente vermelho ensina a equipe a ignorar vermelho. Reativar é descomentar os gatilhos quando o plano permitir.

### O que foi mesclado em 28/08/2026

| PR | O quê | Estado |
|---|---|---|
| [#11](https://github.com/fernando123-hue/Sistema-SBP/pull/11) | Toda a fundação do domínio — 20 commits | ✅ mesclado |
| [#5](https://github.com/fernando123-hue/Sistema-SBP/pull/5) | `gitleaks-action` v2 → v3 | ✅ mesclado |
| [#9](https://github.com/fernando123-hue/Sistema-SBP/pull/9) | `@types/node` e `typescript` (dev) | ✅ mesclado |
| [#2](https://github.com/fernando123-hue/Sistema-SBP/pull/2) | `actions/checkout` v4 → v7 | ✅ mesclado |
| [#1](https://github.com/fernando123-hue/Sistema-SBP/pull/1) | `actions/setup-node` v4 → v7 | ✅ mesclado |

**O prazo do Node 20 está resolvido.** #1 e #2 tinham data marcada: em **16 de setembro de 2026** o GitHub remove o Node 20 dos runners, e o log do CI já avisava —

```
Node.js 20 is deprecated. The following actions target Node.js 20 but are
being forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4
```

Os dois estavam parados por limitação de permissão (alteram arquivo de workflow), não por defeito. Foram mesclados por API em 28/08/2026, e `checkout` e `setup-node` estão em `v7` nos três jobs do CI e no workflow do CodeQL. Nenhuma ação continua apontando para o Node 20.

### PRs — nenhum aberto

**Zero PRs abertos em 07/09/2026.** Seis mesclados neste dia, todos com CI verde: [#24](https://github.com/fernando123-hue/Sistema-SBP/pull/24) fuso do teste · [#25](https://github.com/fernando123-hue/Sistema-SBP/pull/25) retenção e `A14` · [#26](https://github.com/fernando123-hue/Sistema-SBP/pull/26) notas do setor · [#27](https://github.com/fernando123-hue/Sistema-SBP/pull/27) este arquivo · [#28](https://github.com/fernando123-hue/Sistema-SBP/pull/28) liga na tela · [#29](https://github.com/fernando123-hue/Sistema-SBP/pull/29) adapter Gemini.

**Uma dependência nova:** `@google/genai`. Entrou com o `#29` e passou pela auditoria do CI.

Histórico anterior: [#12](https://github.com/fernando123-hue/Sistema-SBP/pull/12) mesclado em 31/08; [#15](https://github.com/fernando123-hue/Sistema-SBP/pull/15) (`lucide-react`) fechado sem merge — ficou sem objeto quando a dependência foi removida do projeto por não ter uso (seção *Revisão geral e limpeza*, 31/08); [#4](https://github.com/fernando123-hue/Sistema-SBP/pull/4) (`codeql-action` v3 → v4) fechado sem merge em 28/08 — inócuo, o workflow do CodeQL está desarmado; [#13](https://github.com/fernando123-hue/Sistema-SBP/pull/13) (`@types/node` 26.3.0 → 26.4.0) e [#14](https://github.com/fernando123-hue/Sistema-SBP/pull/14) (`@anthropic-ai/sdk` 0.121.0 → 0.122.0) mesclados em 06/09/2026, rotina, verdes.

### Branches — limpos

`claude/prototipo-em-progresso-unesv2` (órfão de onde A4–A12 foram resgatadas em 31/08) e os seis branches do Dependabot de PRs já mesclados/fechados **não existem mais no remoto** — o repositório apaga o branch de origem ao mesclar/fechar um PR, e isso já tinha acontecido; só o cache local (`git branch -r`) mostrava fantasma até um `git fetch --prune` em 06/09/2026. Os locais órfãos `feat/fundacao-dominio` e `pr5` também foram apagados — mesmo conteúdo já estava na `main`.

### Histórico que vale saber

O CI já produziu **vermelho que não era defeito**, duas vezes, e as duas foram corrigidas:

- O job do gitleaks falhava com `Resource not accessible by integration` em PR comum, porque o `permissions` global é `contents: read` e ele precisa de `pull-requests: read` para listar os commits. Falhava **sem ter encontrado segredo nenhum**.
- O mesmo job falhava em todo PR do Dependabot, que recebe token somente-leitura. Hoje ele pula quando o autor é o Dependabot — Dependabot só mexe em manifesto de dependência, e segredo novo não entra por aí.

E um defeito real que o CI pegou: `TS5102: Option 'baseUrl' has been removed`. O `tsconfig.json` usava `baseUrl` junto com `paths`, e a versão nova do TypeScript removeu a opção — isso travaria **qualquer** upgrade de TypeScript.

**A suíte já esteve perto de estourar o tempo limite.** Depois que o desdobramento passou a exigir revisão humana, a simulação de 30 dias passou a gerar centenas de pendências, e o helper de teste as aprovava uma a uma. Trocado por operação em lote: o arquivo caiu de 140s para ~50s. O `testTimeout` subiu para 90s, para dar margem em máquina mais lenta.

---

## Próximo passo sugerido

**O topo da lista não mudou, e agora tem duas razões para estar lá.** Rodar o adapter contra a API real sempre foi a parte nunca provada; desde 07/09 ele também é o **pré-requisito que o próprio dono escolheu** para a IA passar a ler as notas do setor (`§ A14(c)`). Sem linha de base medida, *"a IA melhorou com as notas"* é afirmação que ninguém consegue falsificar.

> **O que muda o rumo desta lista não é código, é resposta.** Cinco perguntas em `DECISOES.md § H.4`, itens 10 a 14. Quatro vão para a chefia do setor — e uma delas, o prazo do motivo de afastamento, é dado de saúde sob a LGPD, o item mais urgente do documento inteiro. Enquanto elas não voltam, o dado bruto acumula por omissão: a rotina de expurgo passou a existir em 08/09/2026 (`npm run db:expurgar`), mas **alcança só a observação de afastamento**, o prazo dela é hipótese (`§ AT-11`) e **nada a agenda** — de propósito, porque agendar uma hipótese é transformá-la em regra em silêncio.

**O roteiro de 26/08 fechou em 06/09/2026:** `A4` a `A13` estão implementadas. `A14` entrou em 07/09.

### O que foi construído em 06/09/2026

| | Entrega |
|---|---|
| `A11` · `A12` | Peso e limiar por categoria — `DOC = 4`, `FICHA = 1,75`; limiar `0,95` / `0,90` |
| `A7` | Fila pelo mais antigo + indicador de atraso no painel |
| `A6` | Narrativa da rodada, função pura, sem IA |
| `A10` | `Afastamento` como entidade, com exclusão automática do rateio |
| `A4` | Agrupamento por liga — SPEC antes do código |
| `A13` | Motivo da ausência só para gestor |

### O que ficou pendente destas decisões, e por quê

- **`A6` — leitura narrada do histórico.** A rodada do dia é narrada na tela; reler em português uma rodada de três semanas atrás ainda exige `GET /api/rodadas/[id]`, que devolve dados crus. A narrativa é função pura sobre o snapshot, então aplicá-la ao histórico é trabalho de rota e tela, não de regra.
- **`A8` — lembrete semanal.** Depende de capacidade de **envio** de e-mail, que o próprio `A5` adiou: o `IngestaoPort` é só-leitura por decisão.
- **`A11` — os valores nunca foram relidos com o cliente.** `DOC = 4` e `FICHA = 1,75` redistribuem carga entre pessoas reais. Trocar qualquer um é uma linha de migração.

> **Duas lições desta sessão, para as próximas estimativas.**
>
> **O documento errou o custo nas duas direções.** Disse que `A11` mexeria no motor — não mexia, `motor.ts` já multiplicava por `categoria.peso`. E descreveu `A4` como mudança de motor, escondendo que **`Item.ligaId` nunca era preenchido por ninguém**: metade do trabalho era transformar o texto da IA em identidade de liga. Antes de estimar pelo que está escrito aqui, abra o código.
>
> **Duas vezes um teste vermelho não era defeito.** No `A11` e no `A4`, o invariante antigo media um sistema que o cliente mandou mudar. Nos dois casos a saída não foi afrouxar o teste: foi entender o que a garantia perdida protegia e escrever a garantia nova — no `A4`, o teste de **não-deriva** do crédito ao longo de 24 dias.

### Primeiro — juntar amostra contra o modelo real

> **A parte "nunca provada" deixou de existir em 07/09/2026.** O pipeline de IA rodou de ponta a ponta contra a API real do Gemini, na camada gratuita. O caso de injeção respondeu como devia: categoria do e-mail de verdade (`EMAIL_CADASTRO`), confiança `0,10`, suspeita marcada pelas **duas** defesas — cinco padrões da nossa regex mais `modelo_sinalizou`. O modelo não obedeceu ao conteúdo hostil. Detalhe em `DECISOES.md`, seção de 07/09/2026.

1. **Rodar de novo, e mais vezes, para ter amostra.** Sem custo:
   ```bash
   IA_ADAPTER=gemini npm run ia:experimentar
   ```
   Quatro casos — comum, desdobramento em N itens, campo faltando e tentativa de injeção — sem tocar no banco. **Espere `503` de vez em quando:** a camada gratuita satura, e o sistema trata isso como falha de transporte, mandando o e-mail para revisão humana. Degradar assim é o comportamento certo; não é defeito para consertar.

   Para comparar fornecedores sobre a mesma bateria — que é como se descobre se este sistema depende de um modelo específico:
   ```bash
   IA_ADAPTER=anthropic npm run ia:experimentar   # gasta crédito
   ```

2. **Depois de rodar, olhar a seção *Acerto da IA* no Painel.** Ela responde o critério de aceitação nº 5 e diz se a confiança que o modelo reporta separa acerto de erro. Contra o mock as duas médias saem coladas (0,91 e 0,90) e a tela avisa. Com o modelo real esse número muda — e é ele que autoriza, ou proíbe, afrouxar o limiar de confiança.

   **Isto virou pré-requisito de outra coisa em 28/08.** A diretriz do cérebro pede montagem de contexto para a IA, e eu recusei construí-la agora em parte por este motivo: sem linha de base medida contra o modelo real, acrescentar contexto compra a maior superfície de risco do sistema em troca de uma melhoria que ninguém consegue falsificar. Este passo destrava aquele.

### Depois — o que tem gatilho real

3. **`H-D19` — cifrar os bytes de anexo em repouso.** Obrigatório antes de documento real de associado entrar. Depende da aprovação formal da associação, que ainda não veio.

> Os PRs #1 e #2, que estavam aqui com prazo em 16/09, foram mesclados em 28/08/2026. Ver *Situação do CI e das dependências*.

### Depois disso, por valor decrescente

4. ~~**A liga inalcançável pela tela.**~~ **RESOLVIDA em 07/09/2026** — a Caixa ganhou filtro de liga, a liga aparece na linha do item e escolher uma troca o bloco de memória. Saiu desta lista no mesmo dia em que entrou.

5. **`H-D7`** — os contratos de API redigitados à mão nas telas. Já divergiram uma vez (`emAndamento` sumiu; `Date` vs. string), e cada tela nova aumenta a superfície. Derivar os tipos dos esquemas Zod mata a família inteira de divergência silenciosa entre API e tela — e o legado do cliente vai consumir essas rotas. **Ganhou uma instância nova em 07/09:** `NotaDoSetor` está declarado em `servicos/notas.ts` e redigitado em `componentes/notas.tsx`, com `criadoEm` já sendo `Date` de um lado e `string` do outro — a forma exata que o defeito assumiu da última vez. Está documentado dentro do arquivo, não escondido.

6. **`H-D18`** — agregados de métrica materializados. Reclassificado: nenhuma métrica lê linha expurgável, então **não bloqueia mais a política de retenção**. Continua valendo por recorte histórico barato.

7. **`H-D8`** — as consultas N+1 do painel e da distribuição. Irrelevantes com 4-7 pessoas em SQLite local (medido: ~29 consultas por carregamento do painel, ~14 por categoria na distribuição). Viram problema de verdade na migração para PostgreSQL, e pior por acontecerem dentro da transação que segura a trava do dia.

8. **Demais itens de `DECISOES.md § H.2`.** Onze dívidas continuam abertas no total; tirando as quatro já nomeadas acima, sobram **sete**. Nenhuma com prazo, nenhuma travando uso.

---

## Nove decisões que dependem do dono do negócio

Estão registradas em `DECISOES.md § H.4`, sem resposta inventada. **Cinco nasceram em 07/09/2026** (itens 10 a 14) e vêm primeiro porque quatro delas têm prazo de mundo real: enquanto não voltarem, dado se acumula sem política.

### As cinco de retenção e memória — 07/09/2026

| # | Pergunta | De quem |
|---|---|---|
| 12 | **Motivo de afastamento é dado de saúde** (LGPD art. 11). Hoje fica guardado sem prazo. O `A13` resolveu *quem vê*; não resolveu *por quanto tempo fica* | **o mais urgente** |
| 10 | Por quanto tempo fica o corpo do e-mail e os bytes de anexo | operação + DPO |
| 11 | Por quanto tempo fica o que a IA extraiu (`Item.titulo`, `Item.payload`, as revisões). A pergunta prática: até quando a equipe precisa reabrir um item antigo e ver o que foi extraído? | operação + DPO |
| 13 | Nota sobre pessoa: existe, e sob que regra? Três saídas formuladas | chefia |
| 14 | A memória volta a alimentar a IA? Respondida em parte — *depois de medir o modelo real* | dono |

> **Uma folha de decisão foi preparada para a chefia**, com opções, uma recomendação marcada em cada, e o que acontece se ninguém decidir. Ela não está no repositório: foi entregue como arquivo na sessão de 07/09/2026. Se o arquivo se perdeu, as perguntas cruas estão em `§ H.4` e a folha se refaz a partir delas.

### As quatro anteriores

> ~~**Quem pode ver que alguém está de atestado?**~~ **Respondida em 06/09/2026** e implementada como `A13`: todo mundo vê que a pessoa está fora, só o gestor vê por quê. Saiu desta lista.

1. **Quem vê a caixa de entrada inteira?** *(levantada na auditoria de 28/08/2026)* Hoje `GET /api/itens` exige sessão mas não exige papel, e a navegação oferece a tela a `colaborador` — então qualquer pessoa autenticada vê remetente e assunto de TODOS os e-mails. O `RF-23` diz que colaborador vê *os seus*. **Não foi alterado de propósito:** a equipe já trabalha de uma caixa compartilhada, então restringir mudaria a operação em vez de corrigir defeito.
2. **Carga de exceção conta para o balanceamento?** *(levantada em 28/08/2026, com o registro manual)* Quem atende 30 inadimplentes num dia fez trabalho real, e hoje esse trabalho **não** entra no crédito — a pessoa continua recebendo cota cheia das categorias do rateio. Contar resolveria a justiça de carga, mas faria uma categoria de exceção mexer na cota justa de categorias das quais ela não participa. Escolhi o lado reversível (`§ AT-09`) porque despoluir um razão já acumulado exige recomputar histórico; começar a contar depois, não.
3. **Um agente é ator de quê?** *(levantada em 28/08/2026, com a fundação do cérebro)* Hoje `ATOR_SISTEMA` tem papel **`operador`** — e com esse papel passam `confirmar distribuição` e `aprovar revisões em massa`. Um agente futuro empunhando essa identidade decidiria distribuição, e a trilha registraria `sistema`, indistinguível do cron de ingestão. Pior: `'sistema'` não é `Colaborador`, então não pode ser desativado, expirado nem travado. Isto é verdade **antes** do cérebro; o cérebro só torna o caminho alcançável. Tem consequência de schema.
4. **Memória cai de que lado da retenção?** *(levantada em 28/08/2026)* `LogAuditoria` guarda `Item.titulo`, que a IA extraiu do corpo do e-mail e pode carregar nome de associado. Se a retenção expurgar `EmailConteudo`, o título **sobrevive** na trilha — que o invariante 11 proíbe apagar. Decisão de DPO, não de engenharia.

> **Eram sete até 31/08/2026.** Três saíram da lista sem ninguém decidir nada de novo: *dono único*, *etapa 6* e *itens mais antigos* já tinham sido respondidas em 26/08 (A4, A5 e A7), numa sessão cujo trabalho ficou num branch órfão. A lista aqui continuou pedindo resposta para pergunta já respondida por cinco dias. Ver `DECISOES.md`, seção *Reconciliação: A4–A12*.
>
> Uma oitava — **"período" do desempate** — foi respondida em 27/08/2026: janela deslizante de 30 dias, já implementada. O resgate mostrou que ela tinha sido respondida **duas** vezes, com números diferentes (15 em 26/08, 30 em 27/08); vale a mais recente.

---

## Pendências que aguardam decisão, não código

- **Retenção:** a estrutura separa conteúdo de histórico e permite expurgo. Desde 08/09/2026 existe UMA rotina (`npm run db:expurgar`), que redige a observação de afastamento e **não é agendada**; o prazo é hipótese, não decisão (`§ AT-11`). Para todo o resto — corpo de e-mail, anexo, `Item.payload`, revisões — **nenhum prazo foi definido e nada apaga nada**. A auditoria de 07/09/2026 acrescentou que a fronteira foi desenhada num lugar só: `Item.titulo`, `Item.payload`, as revisões, a trilha, `Ligante` e `Afastamento` são todos de retenção longa e todos podem carregar identificação de pessoa. **Hoje é possível expurgar o e-mail e o nome do associado seguir vivo em quatro tabelas.** Ver `DECISOES.md`, seção de 07/09/2026, e as três camadas propostas lá.
- **Dado real para qualquer API de IA:** bloqueado por decisão de 27/08/2026 — só dados sintéticos até aprovação formal da associação. Vale igual para Gemini e Anthropic: a decisão é sobre o dado sair da casa, não sobre quem o recebe.
- **Onde o dado vai parar muda com o fornecedor, e isso é decisão, não detalhe.** Trocar `IA_ADAPTER` troca a empresa que processa o conteúdo do e-mail. Enquanto for dado sintético, é indiferente; no dia em que entrar dado real, o fornecedor escolhido precisa constar da autorização.

---

## Mapa do repositório

```
docs/
  01-BRIEFING.md    por quê — problema medido, objetivos
  02-PRD.md         o quê — requisitos, invariantes, aceitação
  03-SPEC.md        como — camadas, dados, motor, API, telas
  DECISOES.md       decisões, correções, hipóteses, achados da auditoria
  ESTADO.md         este arquivo

src/
  core/             domínio puro — não importa Prisma, React nem Next
    distribuicao/   o motor e a ordenação (núcleo de valor)
    seguranca/      injeção de prompt, validação e tipo real de anexo
    autenticacao.ts política de bloqueio (pura, sem I/O)
    notas.ts        que notas valem para o contexto atual — hoje a tela, amanhã o prompt
  ports/            AiPort, IngestaoPort, ArmazenamentoPort
  adapters/         mock, gemini, anthropic, disco + fábrica escolhida por ambiente
    ia-estruturada.ts  a política de interpretação, igual para todo fornecedor
  servicos/         transações, orquestração
  servidor/         prisma, ambiente, ator, sessão, credenciais, http
  app/              rotas de API e telas (inclui /acesso e /senha)
  componentes/      design system (matrizes) e cliente de API
```

**Regra de dependência:** as setas apontam só para dentro — `app → servicos → core`. `core/` não importa infraestrutura. É isso que mantém o motor testável em milissegundos e auditável para sempre.

**Onde mexer para cada coisa:**

| Quero… | Vou em |
|---|---|
| mudar como o trabalho é repartido | `src/core/distribuicao/motor.ts` (puro) e `ordenacao.ts` |
| mudar o que a IA extrai | `src/adapters/ia-estruturada.ts` (prompt e política, valem para todo fornecedor) e `src/core/esquemas.ts` (contrato) |
| trocar de fornecedor de IA | `IA_ADAPTER` no `.env`. Só isso — `criarAiPort()` é o único lugar que sabe qual sobe |
| acrescentar um fornecedor novo | um arquivo `ia-<nome>.ts` com `PerfilDoFornecedor` + `ClienteDeInterpretacao`, um `case` na fábrica, um valor no enum. Nada em `servicos/`, `app/` ou `core/` |
| mudar a janela do desempate | `DIAS_DA_JANELA` em `src/servicos/distribuicao.ts` |
| mudar as colunas do painel | `porCategoria` em `src/servicos/painel.ts` — mantenha `conferirPendencia` batendo |
| mudar o critério de acerto da IA | `src/core/qualidade-ia.ts` (puro) — o serviço só lê o banco |
| mexer em cadastro de pessoa ou habilitação | `src/servicos/colaboradores.ts` e a tela `/acesso` |
| registrar trabalho que não veio por e-mail | `src/servicos/itens.ts` e o formulário em `/caixa` |
| investigar "o que aconteceu com este item / neste erro" | `GET /api/memoria` e `src/servicos/memoria.ts` |
| mudar **quais notas aparecem** para quem trabalha | `selecionarNotas` em `src/core/notas.ts` (puro). É também o que alimentará o modelo — mude aqui, não na tela |
| mostrar notas numa tela nova | `<NotasDoSetor>` de `src/componentes/notas.tsx`, passando o contexto que a tela conhece |
| **ligar as notas ao prompt da IA** | NÃO faça sem a decisão do dono (`§ H.4` item 14). Quando entrar: o texto passa pelas três camadas de `core/seguranca/conteudo-nao-confiavel` no caminho de LEITURA e vai dentro dos delimitadores |
| acrescentar uma ação de auditoria ou uma operação com papel | `AcaoAuditavelSchema` / `OperacaoSchema` em `src/core/esquemas.ts` — são uniões fechadas |
| ajustar confiança em proxy | `PROXIES_CONFIAVEIS` no `.env`; confira em `/api/diagnostico/origem` |
| implementar retenção | apagar `EmailConteudo` e bytes; **nunca** `Item`, `Atribuicao`, `SaldoCarga`, `LogAuditoria` |
| trocar disco por nuvem | novo adapter de `ArmazenamentoPort` + `criarArmazenamentoPort()` |

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run verificar` | Typecheck + a suíte inteira |
| `npm run dev` | Aplicação em http://localhost:3000 |
| `npm run demo` | Fluxo completo pelo terminal |
| `npm run ia:experimentar` | Compara mock e modelo real. **Único** comando que gasta crédito |
| `npm run db:seed` | Cadastro base sintético + senhas provisórias |
| `PERMITIR_LIMPEZA=sim npm run db:limpar` | Apaga dados transacionais, preserva o cadastro. Exige o opt-in explícito: sem ele, recusa — a trava anterior deduzia segurança da ausência de `NODE_ENV` |
| `npm run db:expurgar` | Roda agora a limpeza diária que o servidor já roda sozinho: motivo de afastamento, texto e anexos dos e-mails e dados extraídos dos itens, cada um no seu prazo (`A17`, `A20`, `A23`). **Irreversível**; uma execução por dia |
| `npm run anexos:conferir` | Diz quantos anexos ainda estão em texto puro no disco |
| `npm run anexos:recifrar` | Cifra os que faltam, conferindo cada um pela leitura antes de trocar |
| `npm run db:studio` | Inspeciona o banco |
| `npx prisma migrate deploy` | Aplica as migrações num banco novo |
| `npx prisma generate` | Regenera o cliente Prisma em `src/generated/` |

Dados são 100% sintéticos. Nenhum nome, CPF ou e-mail real entra no repositório.

---

## Se algo parecer quebrado ao retomar

- **`npm run db:seed` não mostra senha de alguém:** é o comportamento correto — quem já trocou a senha não é tocado. Para recomeçar do zero, limpe o banco e rode as migrações de novo.
- **Erro de typecheck vindo de `.next/`:** artefato do dev server, não do código. `rm -rf .next` e rode de novo.
- **`AdapterIndisponivelError`:** `IA_ADAPTER` ou `INGESTAO_ADAPTER` aponta para um adapter não implementado. É proposital — o sistema recusa subir em vez de cair no mock em silêncio.
- **`SESSAO_SECRET ausente ou curto demais`:** gere um com `node -e "console.log(crypto.randomUUID())"` e cole no `.env`.
- **Login recusado com a senha certa:** confira se a conta não está desativada ou travada por tentativas. A mensagem é genérica de propósito — ela não revela qual dos casos é. Use a tela `/acesso` como gestor.
- **`Cannot find module ... src/generated/prisma`:** o cliente do Prisma não é versionado. Rode `npx prisma generate`.
- **O `CLAUDE.md` aparece modificado sem você ter mexido:** é o `next dev` escrevendo um bloco sozinho a cada execução. Esperado até a decisão de aceitar ou desligar.
- **`Não foi possível preparar o banco de teste` ou `ECONNREFUSED`:** o MySQL está desligado. Ligue-o (*Continuando em outra máquina*) e rode de novo.
- **`The Driver Adapter ... is not compatible with the provider sqlite`:** o cliente gerado é de antes da troca de banco. `npx prisma generate`.
- **`P1013 ... shadowDatabaseUrl must not be an empty string`:** alguém deixou a base sombra como texto vazio em `prisma.config.ts`. Ela tem de **sumir** quando não há valor — ver o comentário ali.
- **No Windows, `prisma migrate diff` acusa 26 tabelas removidas e chaves estrangeiras perdidas:** não é defeito (`DECISOES.md § AT-32`). Confira as chaves direto no banco; o resultado que vale é o do CI.
- **`npm audit` acusando `mariadb`:** o `override` do `package.json` saiu, e o driver voltou para a faixa que entrega a senha do banco em texto claro (`§ AT-31`). Recoloque-o.
- **`BLOB, TEXT ... can't have a default value` numa migração:** coluna `@db.Text` com `@default` — o MySQL proíbe (`§ AT-30`).
- **`You have an error in your SQL syntax ... near '"id"'`:** consulta crua com aspas duplas; no MySQL, identificador vai entre crases (`§ AT-30`).
- **`prisma migrate reset` pede consentimento explícito:** a ferramenta se recusa a apagar banco quando quem pede pode ser um agente. Na suíte o preparador declara que a base é descartável; **fora dela, pergunte ao dono** — ou siga numa base nova, sem apagar nada.
- **`unknown or unexpected option`:** o Prisma 7 removeu várias opções que versões antigas aceitavam (`--skip-seed`, `--skip-generate`, `--shadow-database-url`). Confira `--help`.
- **Testes lentos ou estourando tempo:** a suíte roda contra o MySQL de verdade, e isso custa mais que o SQLite de antes — uns seis a oito minutos nesta máquina. `testTimeout` está em 90s para dar margem.
