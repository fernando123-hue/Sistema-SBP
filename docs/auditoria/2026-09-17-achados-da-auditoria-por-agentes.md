**Adiado para a publicação (`A46`)**: sem proxy, `PROXIES_CONFIAVEIS=0` já usa o balde único (seguro). No dia do proxy, declarar qual cabeçalho ele escreve em vez de adivinhar pela cadeia. O teto do mapa (segunda parte) foi corrigido no N-37 |**Confirmado e corrigido** (17/09): acima do teto, depois das vencidas, saem as chaves mais antigas; primeiro teste do limitador |**Corrigido** (17/09) com o C-13: a entrada também passa pela conferência de origem |**Corrigido** (17/09): o middleware recusa com 403 pedido que altera estado em `/api` vindo de outra origem (`Sec-Fetch-Site`, ou `Origin` sem ele). Exigir `Content-Type: application/json` em `corpoJson` ficou para depois |**Confirmado e corrigido** (17/09): as linhas dos gestores ativos são travadas antes da contagem |**Corrigido** (17/09): a tentativa é reservada, com a conta travada, antes do hash — na entrada e na troca de senha |**Em parte** (17/09): gestor não redefine a própria senha por esta rota. **Falta decidir** (pergunta ao dono, `DECISOES.md § H.4` item 30): pedir a senha do gestor para redefinir senha, desativar ou mudar papel, e o que fazer com outro gestor |**Corrigido** (17/09): `resolver` recusa categoria desativada |**Corrigido** (17/09): `resolver` trava a linha da revisão antes de ler |**Corrigido** (17/09): `concluir`, `devolver` e `transferir` travam a linha do item antes de ler; `definirAtivacao` também, na mesma ordem; impasse é repetido (`servidor/conflito.ts`) |**Mesmo defeito do N-02**, corrigido no PR #62 |**Em parte** (17/09, PR #63): caixa real recusa IA simulada e Gemini. **Falta** a máscara de CPF de `A52`, que exige medir antes |**Confirmado e corrigido** (17/09): em produção, `SESSAO_SECRET`, `BUSCA_SECRET` e `ANEXOS_SECRET` com valor de teste público são recusados |**Confirmado e corrigido** (17/09): caixa real (`INGESTAO_ADAPTER` diferente de `mock`) recusa `IA_ADAPTER` `mock` ou `gemini` |**Confirmado e corrigido** (17/09): a listagem vem sem bytes, só o arquivo que cabe é baixado, e o tamanho que vale é o dos bytes |**Confirmado** — é o mesmo defeito do C-03; corrigido no PR #59 (`AT-35`) |**Confirmado e corrigido** (17/09): anexo que não é arquivo entra como recusado, com motivo, e o item vai para revisão |# Achados da auditoria por agentes — 16 e 17/09/2026

Etapa 1 da rodada de segurança e qualidade (`DECISOES.md § A49`), método em `roteiro-da-auditoria-de-seguranca.md`. **Só leitura; nada foi corrigido ainda.** Medições automáticas e o achado manual M-01 estão em `2026-09-16-rodada-de-seguranca-e-qualidade.md`.

## Como rodou, e o que NÃO foi feito

- 10 auditores (um por dimensão), cada um limitado a 12 achados: **86 achados, 68 únicos** depois de juntar repetidos. **19 achados de menor valor ficaram de fora** pelo limite — não estão listados em lugar nenhum.
- Cada achado único iria a verificadores céticos (3 para crítico/alto, 1 para os demais). **O limite de uso acabou no meio**: 27 achados foram verificados e **confirmados** (nenhum refutado); **41 ficaram sem verificação**.
- O **crítico de completude** (quais seções do roteiro ninguém cobriu) **não rodou**. As lacunas de cobertura não são conhecidas; a seção 6 lista o que cada auditor declarou não ter olhado.
- **Custo:** as duas rodadas somaram cerca de 5,5 milhões de tokens de agentes. Em 17/09/2026 o dono **revogou** o uso de workflow: daqui em diante, um revisor por vez.
- **Quem auditou foi agente, não pessoa.** Achado confirmado é um agente conferindo outro, lendo o código — não é prova por teste. Cada correção continua exigindo teste visto vermelho (`docs/PROCESSO.md`).

## 1. Resumo

| | Crítico | Alto | Médio | Baixo | Informativo |
|---|---|---|---|---|---|
| Confirmados | 0 | 4 | 10 | 10 | 3 |
| Sem verificação | 0 | 1 | 18 | 18 | 4 |

**Atualização de 17/09/2026, manhã:** C-01 a C-04 corrigidos; N-01, N-02, N-07, N-10, N-14, N-17, N-18, N-27 e N-37 verificados lendo o código e confirmados (N-01 no PR #57, N-14 no #59) (a contagem acima é a do fim da auditoria).

**Nenhum crítico.** Destino de cada achado: coluna "Destino" (vazia = pendente). Nenhum fica sem destino ao fim da rodada.

## 2. Confirmados

| ID | Severidade | Local | Achado | Destino |
|---|---|---|---|---|
| C-01 | ALTO | `src/adapters/ia-anthropic.ts:88` | Com a Anthropic, `campos` sai sempre vazio: nome, CPF e CRM nunca são extraídos | **Corrigido** (17/09): `campos` viaja do modelo como lista de pares `{chave, valor}` e vira o mapa em `ia-estruturada.ts`; prompts `anthropic-1.1.0` e `gemini-1.1.0`. Falta a amostra contra o modelo real (passo de `A49`) |
| C-02 | ALTO | `src/adapters/ingestao-graph.ts:115` | Um único e-mail externo grande demais trava toda a ingestão, e a trava não sai sozinha | **Corrigido** (17/09) com o C-03: mensagem fora do esquema é recusada pelo nome, sem derrubar as outras (`AT-35`) |
| C-03 | ALTO | `src/adapters/ingestao-graph.ts:98` | Um único e-mail de fora (ou o 201º e-mail da caixa) derruba a ingestão real para sempre | **Corrigido** (17/09): janela de 7 dias a partir de `GRAPH_LER_DESDE`, o já processado sai antes do teto, o excedente fica para a próxima leitura (`AT-35`) |
| C-04 | ALTO | `src/core/esquemas.ts:339` | messageId aceito até 500 caracteres, mas a coluna tem 191: um e-mail volta a pagar IA em toda sincronização | **Corrigido** (17/09): `messageId` limitado a 191 (o tamanho da coluna, conferido por teste contra o banco); a `referencia` do evento é cortada em 191, para gravar a falha nunca derrubar a sincronização |
| C-05 | MÉDIO | `src/adapters/fabrica.ts:52` | Nada no código impede e-mail real, com CPF, de ir a fornecedor externo sem máscara (A52) ou à camada gratuita do Gemini (A38) | |
| C-06 | MÉDIO | `src/adapters/ia-estruturada.ts:150` | Não há disjuntor, teto diário nem registro de custo, e 'conta sem crédito' não é detectada como diz o contrato | **CORRIGIDO** 17/09/2026 (PR do `AT-38`): teto diário contado em `UsoDaIa`, disjuntor por fornecedor, registro por dia/modelo/tarefa e `ehSemCredito` nos perfis. Falta o C-11 (tentativas por e-mail). |
| C-07 | MÉDIO | `src/adapters/ingestao-graph.ts:329` | E-mail encaminhado como anexo e anexo-link do OneDrive somem sem registro | |
| C-08 | MÉDIO | `src/servicos/autenticacao.ts:275` | Com uma sessão de gestor roubada ou deixada aberta, o atacante toma a conta de forma permanente e tranca o gestor legítimo para fora | |
| C-09 | MÉDIO | `src/servicos/autenticacao.ts:85` | A trava por conta pode ser furada disparando tentativas em paralelo | |
| C-10 | MÉDIO | `src/servicos/fila.ts:139` | Concluir, devolver e transferir o mesmo item em paralelo passam sem trava | |
| C-11 | MÉDIO | `src/servicos/ingestao.ts:277` | E-mail que falha na interpretação é reinterpretado, e pago, em toda sincronização, sem contador nem limite | |
| C-12 | MÉDIO | `src/servidor/ambiente.ts:323` | 'Produção' é detectada só por NODE_ENV, e a trava de rede do acesso sem senha é toda escrita pelo cliente | **Corrigido** (17/09): acesso sem senha, `unsafe-eval` e cookie sem `Secure` só com `NODE_ENV=development`; a variável é recusada fora de desenvolvimento e quando escrita num `.env*`. Resíduo: `X-Forwarded-For` escrito pelo cliente continua indistinguível (o `dev:local` só escuta em 127.0.0.1). A trava de segredo público do N-18 ainda usa `NODE_ENV=production` |
| C-13 | MÉDIO | `src/servidor/http.ts:318` | Nenhuma rota autenticada confere origem; SameSite=Lax não cobre origem do mesmo site | |
| C-14 | MÉDIO | `src/servidor/http.ts:235` | Com PROXIES_CONFIAVEIS=1, o cliente escolhe a própria chave do limite por origem | |
| C-15 | BAIXO | `src/adapters/assistente-modelo.ts:111` | O assistente grava no log texto livre escolhido pelo modelo, o que abre caminho para a pergunta, com e-mail colado, chegar ao log | |
| C-16 | BAIXO | `src/app/api/notas/route.ts:57` | Qualquer colaborador cria notas sem limite, e toda tela de trabalho carrega todas as notas gerais sem teto | |
| C-17 | BAIXO | `src/app/api/sessao/route.ts:146` | CSRF de login: outro site consegue deixar o navegador da vítima logado na conta do atacante. A única defesa CSRF das demais rotas é SameSite=Lax | |
| C-18 | BAIXO | `src/servicos/autenticacao.ts:91` | A mensagem de conta bloqueada enumera contas ativas, e a premissa registrada no comentário está errada | |
| C-19 | BAIXO | `src/servicos/autenticacao.ts:203` | Tentativas contra e-mail inexistente, falhas na troca de senha e recusas por bloqueio não entram na trilha | |
| C-20 | BAIXO | `src/servicos/memoria.ts:233` | porCorrelacao contorna a lista fechada que tirou a trilha de Colaborador da consulta | |
| C-21 | BAIXO | `src/servicos/qualidade.ts:123` | GET /api/qualidade?dias=tudo lê todas as revisões resolvidas, para qualquer papel e sem limite de taxa | |
| C-22 | BAIXO | `src/servicos/revisao.ts:148` | Resolução da mesma revisão por duas pessoas: a última sobrescreve em silêncio | |
| C-23 | BAIXO | `src/servicos/revisao.ts:152` | Resolver revisão aceita categoria inativa, e o item aprovado some da distribuição e do painel | |
| C-24 | BAIXO | `src/servidor/http.ts:92` | Recusas de autorização (403/401/422) não deixam rastro em lugar nenhum | |
| C-25 | INFORMATIVO | `src/adapters/armazenamento-disco.ts:124` | Com ANEXOS_SECRET vazio (padrão do .env.example), um único segredo forja sessão e decifra os anexos, e rotacioná-lo depois de um vazamento quebra os documentos | |
| C-26 | INFORMATIVO | `src/app/api/distribuicao/confirmar/route.ts:38` | O limite de confirmação usa a data enviada no corpo e muda de balde a cada data | |
| C-27 | INFORMATIVO | `src/servicos/ingestao.ts:172` | Injeção que escapa dos dois detectores some com o trabalho ou passa aprovada; a lista de A34 ainda não existe | |

## 3. Sem verificação — verificar um por um antes de corrigir

| ID | Severidade (do auditor) | Local | Achado | Destino |
|---|---|---|---|---|
| N-01 | ALTO | `src/testes/preparar-banco.ts:45` | A suíte de testes apaga e recria QUALQUER base que estiver em DATABASE_URL, sem conferir se é a base de teste | **Confirmado** (leitura do código, 17/09) e **corrigido**: branch `fix/n01-suite-so-apaga-base-de-teste` — a suíte recusa base cujo nome não termina em `_teste` |
| N-02 | MÉDIO | `src/adapters/ingestao-graph.ts:330` | Anexo do Graph que não é arquivo (e-mail encaminhado como anexo, link do OneDrive) é descartado sem metadado, recusa ou log | |
| N-03 | MÉDIO | `src/app/caixa/page.tsx:573` | Caixa no celular esconde o remetente, a liga e o aviso de "texto apagado pelo prazo, original no Outlook" | |
| N-04 | MÉDIO | `src/app/fila/page.tsx:225` | "Concluir" na Minha fila: um toque, sem confirmação e sem desfazer, com botão de 36 px no celular | |
| N-05 | MÉDIO | `src/app/fila/page.tsx:276` | Lista "Transferir para" inclui a própria pessoa e quem está afastado, e transferir para si mesma some com o item da tela sem aviso | |
| N-06 | MÉDIO | `src/app/painel/page.tsx:489` | Painel "Por pessoa" ignora o período escolhido e não avisa | |
| N-07 | MÉDIO | `src/servicos/autenticacao.ts:409` | A trava do último gestor ativo não segura no MySQL: dois gestores podem desativar um ao outro ao mesmo tempo | |
| N-08 | MÉDIO | `src/servicos/autenticacao.ts:288` | Redefinição e troca de senha e destravamento gravam o fato e a trilha em escritas separadas; falha entre as duas deixa a mudança sem registro | |
| N-09 | MÉDIO | `src/servicos/distribuicao.ts:399` | No InnoDB, a TravaDeDistribuicao serializa a escrita mas não a leitura: a segunda confirmação pode calcular com crédito antigo | |
| N-10 | MÉDIO | `src/servicos/fila.ts:332` | Item concluído pode voltar ao pool e ser distribuído de novo quando concluir e devolver (ou desativar o acesso) acontecem ao mesmo tempo | **Confirmado e corrigido** (17/09) junto com o C-10: `definirAtivacao` lê e trava os itens abertos antes de tudo, e as transições repetem em impasse |
| N-11 | MÉDIO | `src/servicos/fila.ts:49` | Operações sensíveis sem nenhum teste negativo de papel: fila de outra pessoa, confirmar/prévia, resolver/aprovar revisão, habilitação | |
| N-12 | MÉDIO | `src/servicos/ingestao.ts:559` | Conteúdo externo cria Liga sem limite, o índice único de Liga não protege nada e toda ingestão lê a tabela inteira de ligas | |
| N-13 | MÉDIO | `src/servicos/ingestao.ts:212` | E-mail que a IA nunca consegue estruturar nunca chega a um humano e é cobrado de novo a cada sincronização | |
| N-14 | MÉDIO | `src/servicos/ingestao.ts:76` | A sincronização nunca informa 'desde': com mais de 200 mensagens na Inbox, toda busca pelo Graph falha para sempre | |
| N-15 | MÉDIO | `src/servicos/revogacao-e-tempo.test.ts:123` | Os testes de revogação de sessão não chamam perfilAtual: apagar a conferência em sessao.ts deixa a suíte verde | |
| N-16 | MÉDIO | `src/servicos/rotinas.ts:133` | Uma única linha de Afastamento com tipo inválido suspende toda a limpeza diária (motivos, e-mails, dados de item, contagem), e a falha gravada diz só 'Error' | |
| N-17 | MÉDIO | `src/servidor/ambiente.ts:26` | Ingestão e IA simuladas são o padrão também com NODE_ENV=production | |
| N-18 | MÉDIO | `src/servidor/ambiente.ts:61` | SESSAO_SECRET e BUSCA_SECRET aceitam qualquer texto com 16 caracteres, inclusive os valores públicos do CI e do vitest, e produção não tem nenhuma checagem de entropia | |
| N-19 | MÉDIO | `src/servidor/prisma.ts:24` | Trilha append-only e menor privilégio existem só por convenção: a aplicação conecta como root e nada no banco impede UPDATE/DELETE em LogAuditoria | |
| N-20 | BAIXO | `.github/workflows/ci.yml:141` | Actions fixadas por tag mutável (inclusive a de terceiro gitleaks/gitleaks-action@v3, que recebe o GITHUB_TOKEN), checkout com credencial persistida e `npm ci` com scripts de instalação no job que só audita | |
| N-21 | BAIXO | `package.json:42` | @prisma/adapter-better-sqlite3 continua em `dependencies` sem uso e arrasta 40 pacotes transitivos, entre eles um script de instalação que baixa um binário fora do lockfile | |
| N-22 | BAIXO | `prisma/schema.prisma:485` | Chaves estrangeiras que apagariam ou desligariam histórico se um DELETE chegar ao banco | |
| N-23 | BAIXO | `scripts/limpar-transacional.ts:51` | db:limpar apaga Email (e Anexo em cascata) mas deixa os arquivos de anexo no disco, sem referência e fora de qualquer retenção | |
| N-24 | BAIXO | `scripts/recifrar-anexos.ts:55` | 'anexos:conferir' responde '0 em texto puro' quando não consegue ler a pasta | |
| N-25 | BAIXO | `src/adapters/armazenamento-disco.ts:416` | A chave do anexo usa o separador do sistema operacional, e numa migração Windows→Linux o expurgo 'apaga' o que não existe | |
| N-26 | BAIXO | `src/adapters/ingestao-graph.ts:121` | Remetente vem do cabeçalho From sem nenhum sinal de autenticação, e a tela o mostra como fato | |
| N-27 | BAIXO | `src/adapters/ingestao-graph.ts:151` | O teto do anexo decide pelo tamanho declarado e não evita baixar os bytes grandes | |
| N-28 | BAIXO | `src/app/acesso/page.tsx:133` | Mensagens em inglês, com ids internos e com notas de desenvolvimento na tela | |
| N-29 | BAIXO | `src/app/acesso/page.tsx:147` | Senha provisória ainda não anotada é sobrescrita pela próxima, e "Desligar acesso" age com um clique | |
| N-30 | BAIXO | `src/app/revisao/page.tsx:194` | Revisão diz "Nada aguardando" e "fila vazia" com revisões ainda pendentes além do corte | |
| N-31 | BAIXO | `src/app/senha/page.tsx:59` | Colaborador cai na Distribuição depois de trocar a senha e ao clicar no logotipo | |
| N-32 | BAIXO | `src/componentes/matrizes.tsx:228` | Aviso sempre com role="alert", campos sem rótulo e alvos de 36 px no celular | |
| N-33 | BAIXO | `src/servicos/distribuicao.ts:835` | Distribuição concorrente com a desativação de uma pessoa pode entregar itens a quem acabou de ser desligado, e eles ficam invisíveis | |
| N-34 | BAIXO | `src/servicos/revisao.ts:110` | A fila de revisão carrega o corpo inteiro (LongText) de até 100 e-mails a cada abertura e não usa | |
| N-35 | BAIXO | `src/servicos/revisao.ts:174` | Payload ilegível vira padrão vazio na revisão e é sobrescrito, apagando campos da IA e liga mencionada sem log | |
| N-36 | BAIXO | `src/servidor/credenciais.ts:115` | Hash de senha corrompido é tratado como 'senha errada' em silêncio e acaba bloqueando a conta | |
| N-37 | BAIXO | `src/servidor/limite-de-taxa.ts:46` | O teto de chaves do limitador não limita: com mais de 1000 janelas ativas o mapa cresce sem fim, e não há teste | |
| N-38 | INFORMATIVO | `src/adapters/ingestao-graph.ts:176` | O token de aplicativo `.default` alcança toda caixa que a permissão permitir, e o código não tem como limitar | |
| N-39 | INFORMATIVO | `src/app/api/painel/route.ts:33` | Colaborador recebe números da equipe inteira por categoria, a qualidade da IA e a contagem de itens por liga | |
| N-40 | INFORMATIVO | `src/core/seguranca/assinatura-de-arquivo.ts:43` | A assinatura de .docx/.xlsx aceita qualquer ZIP, .txt/.csv não têm verificação e `hash` nunca é preenchido | |
| N-41 | INFORMATIVO | `src/servidor/cpf-protegido.ts:36` | O CPF protegido é um HMAC correto, mas um dump do banco junto com o BUSCA_SECRET revela todos os CPFs | |

## 4. Detalhe dos confirmados

### C-01 — Com a Anthropic, `campos` sai sempre vazio: nome, CPF e CRM nunca são extraídos

**ALTO** · qualidade / adapter-anthropic · `src/adapters/ia-anthropic.ts:88` · dimensão `ia-conteudo-externo` (também: ia-conteudo-externo, testes-contratos)

- **Descrição:** zodOutputFormat() do SDK 0.125 passa o JSON Schema por transformJSONSchema (lib/transform-json-schema.js:67-74). Em todo objeto, esse passo põe `properties` (vazio quando não há) e força `additionalProperties:false`. O z.record de CamposExtraidosSchema vira `{type:'object', properties:{}, additionalProperties:false}`. Conferi rodando esse transform (só leitura, com node) sobre um record igual ao nosso. Com a decodificação restrita, o único valor aceito para `campos` passa a ser `{}`. O propertyNames só sobra como texto na descrição.
- **Vetor:** Operação normal com IA_ADAPTER=anthropic, sem atacante nenhum.
- **Pré-condições:** IA_ADAPTER=anthropic, o caminho decidido em A49.
- **Impacto:** Todo item criado fica sem campos, e nada acusa. chaveDeBusca(extraido.campos) nunca gera chave, então a busca por CPF (A44/A48) nunca encontra item ingerido pela Anthropic. A revisão perde a sugestão de campos (revisao/page.tsx:179). É a degradação calada que o invariante 7 proíbe. Os testes não pegam porque ia-anthropic.test.ts usa clienteFalso e não passa pelo SDK (cobertura de 35%, A50).
- **Causa raiz:** O adapter confia que o SDK traduz o Zod inteiro. O transform do SDK não tem suporte a mapa aberto (record) e reduz o record a objeto fechado vazio.
- **Correção sugerida:** Não mandar o record pela saída estruturada. Uma saída é representar `campos` para o modelo como lista de pares {chave, valor} e converter para o mapa antes do RespostaDoModeloSchema.parse. Outra é passar o schema já transformado e validado à mão. Somar um teste que roda zodOutputFormat(RespostaDoModeloSchema) e confere que `campos` aceita chaves.
- **Teste de regressão:** Teste sem rede: `zodOutputFormat(RespostaDoModeloSchema).schema` precisa aceitar `{campos:{cpf:'...'}}` num validador de JSON Schema. Também uma amostra real contra o modelo (passo de A49) conferindo que `campos` volta preenchido.
- **Evidência do auditor:** Saída do transform: `"campos":{"type":"object","properties":{},"additionalProperties":false,"description":"{default: {}, propertyNames: ...}"}`; esquemas.ts:277 `z.record(z.string().max(60), z.string().max(2000))`
- **Verificação (3 de 3 confirmaram):** O cenário foi confirmado seguindo o código real. Com IA_ADAPTER=anthropic, a chamada em ia-anthropic.ts:88 monta o formato com `zodOutputFormat(esquema)`. O esquema é o `RespostaDoModeloSchema` que ia-estruturada.ts:185 passa. Os itens dele usam `campos: CamposExtraidosSchema.default({})` (esquemas.ts:362), e esse campo é um `z.record` (esquemas.ts:277).

No SDK 0.125.0 instalado, `zodOutputFormat` (helpers/zod.js:18) passa o JSON Schema por `transformJSONSchema`. Em todo `type:'object'`, esse passo (lib/transform-json-schema.js, bloco `if (type === 'object')`) faz três coisas:
- põe `properties` (vazio quando o objeto não tem nenhuma);
- descarta o `additionalProperties` original e força `false`;
- manda `propertyNames` só para a descrição, como texto.

Rodei o transform com node, sem rede e sem banco, sobre um record igual ao nosso. `campos` saiu como `{type:'object', properties:{}, additionalProperties:false}`. Com a decodificação restrita da saída estruturada, o único valor válido para `campos` é `{}`.

Nenhuma outra camada impede o efeito:
- O `parse` local (`zodObject.safeParse` e depois `RespostaDoModeloSchema.parse`) aceita `{}`, porque é um record válido.
- Não sobra erro  […]

### C-02 — Um único e-mail externo grande demais trava toda a ingestão, e a trava não sai sozinha

**ALTO** · negacao-de-servico / conteudo-externo · `src/adapters/ingestao-graph.ts:115` · dimensão `ia-conteudo-externo` (também: falhas-silenciosas)

- **Descrição:** O adapter do Graph valida cada mensagem com EmailBrutoSchema.parse dentro de buscarNovos(), antes do laço de sincronizar(). O esquema recusa corpo acima de 200.000 caracteres (esquemas.ts:342), mais de 50 anexos (esquemas.ts:343), assunto acima de 1000 e nome de anexo acima de 255. Uma dessas recusas derruba o buscarNovos() inteiro. O try/catch por e-mail de sincronizar() (ingestao.ts:112 em diante) nunca chega a rodar. A camada 1 (truncar), que existe justamente para lidar com texto longo, também não chega a agir.
- **Vetor:** Um remetente anônimo manda para a caixa monitorada um e-mail com corpo de texto de 250 KB, ou com 51 anexos pequenos.
- **Pré-condições:** INGESTAO_ADAPTER=graph (A47). Não exige conta nem privilégio.
- **Impacto:** Toda sincronização passa a responder 400 ('corpo: Too big...'), sem dizer qual mensagem causou o erro. A rota chama buscarNovos() sem `desde` (route.ts:36 e ingestao.ts:76) e a listagem lê a caixa de entrada inteira, então o e-mail culpado volta em toda chamada. Nenhum e-mail novo vira trabalho até alguém tirar a mensagem da caixa na mão.
- **Causa raiz:** A validação estrita do esquema fica na fronteira do adapter, fora do isolamento de falha por e-mail. O teto de tamanho age como recusa do lote, quando o desenho pede truncamento com revisão humana.
- **Correção sugerida:** No adapter, cortar o corpo em TAMANHO_MAXIMO_CORPO e marcar que houve corte, e aplicar o mesmo aos anexos (os excedentes entram como anexo recusado com motivo). Validar cada mensagem com safeParse e isolar a que falhar como evento 'reprocessavel' com o messageId, sem derrubar o lote.
- **Teste de regressão:** Um IngestaoGraph com cliente falso devolvendo três mensagens, a do meio com corpo de 200.001 caracteres e outra com 51 anexos: sincronizar() processa as outras e registra as problemáticas pelo messageId (ou as trunca e manda para revisão). Reverter a correção precisa fazer o teste falhar.
- **Evidência do auditor:** ingestao-graph.ts:115 `EmailBrutoSchema.parse({... corpo: mensagem.body?.content ?? '' ...})` dentro de buscarNovos; esquemas.ts:342 `corpo: z.string().max(TAMANHO_MAXIMO_CORPO)`; esquemas.ts:343 `anexos: z.array(AnexoSchema).max(50)`
- **Verificação (3 de 3 confirmaram):** Segui o caminho no código e o cenário se confirma. POST /api/ingestao (route.ts) cria o adapter pela fábrica. Com INGESTAO_ADAPTER=graph, a fábrica devolve `new IngestaoGraph(clienteDoGraph())` (fabrica.ts:117-118).

1. A rota chama `sincronizar()`, que chama `deps.ingestao.buscarNovos()` sem `desde` (ingestao.ts:76). Essa chamada fica fora de qualquer try/catch.
2. Em `buscarNovos`, o laço aplica `EmailBrutoSchema.parse` a cada mensagem (ingestao-graph.ts:115). Não há `safeParse` nem isolamento por mensagem.
3. O esquema tem tetos que o adapter não corta antes de validar:
   - corpo com no máximo 200.000 caracteres (esquemas.ts:301 e 342);
   - no máximo 50 anexos (esquemas.ts:343);
   - assunto com no máximo 1000 caracteres;
   - nome de anexo com no máximo 255 caracteres (esquemas.ts:307).

   Um único estouro lança ZodError e derruba o lote inteiro, antes do try/catch por e-mail de `sincronizar` (ingestao.ts:114 em diante). A truncagem de `prepararConteudoExterno` (ia-estruturada.ts:134) nunca chega a rodar.
4. `rota()` converte o ZodError em 400 (http.ts:55). A mensagem é só o caminho e o problema, por exemplo "corpo: ...". Ela não diz qual messageId causou o erro, e nenhum ev […]

### C-03 — Um único e-mail de fora (ou o 201º e-mail da caixa) derruba a ingestão real para sempre

**ALTO** · disponibilidade / e-mail externo · `src/adapters/ingestao-graph.ts:98` · dimensão `ingestao-anexos`

- **Descrição:** `sincronizar` chama `buscarNovos()` sem `desde` (src/servicos/ingestao.ts:76) e nenhum chamador do sistema passa esse cursor. Então o Graph lê a Inbox inteira a cada sincronização. Como `A5` proíbe mover ou marcar mensagens, a caixa só cresce. Dois caminhos quebram a leitura inteira, e não só a mensagem ruim: (a) acima de 200 mensagens, `buscarNovos` lança `IngestaoIndisponivelError` em toda chamada (linhas 101-107); (b) `EmailBrutoSchema.parse` roda dentro do laço do adapter (linha 115), fora do try/catch por mensagem que existe em `sincronizar`. Isso vale para uma mensagem com mais de 50 anexos, corpo acima de 200.000 caracteres, assunto acima de 1.000, `messageId` acima de 500 ou anexo com `name` vazio (`''` não cai no `??`, e `min(1)` falha). Nesses casos o `ZodError` sai de `buscarNovos` e aborta o lote antes de qualquer e-mail ser processado. A mensagem fica na Inbox, então o lote aborta de novo em toda sincronização seguinte.
- **Vetor:** Qualquer pessoa na internet manda para a caixa da secretaria um e-mail com 51 anexos pequenos (ou um corpo de texto de 250 KB). Ou simplesmente a caixa passa de 200 mensagens na operação normal.
- **Pré-condições:** INGESTAO_ADAPTER=graph. Não exige conta nem privilégio no sistema.
- **Impacto:** Nenhum pedido novo de associado entra mais no sistema até alguém apagar a mensagem no Outlook à mão, o que o próprio sistema não faz. Toda sincronização também baixa de novo todas as mensagens e todos os bytes de anexo (até 200 mensagens, com anexos de dezenas de MB, em memória ao mesmo tempo no array `emails`). O teste 'caixa com histórico inteiro falha ALTO' prova o erro, mas não que a operação continua depois dele.
- **Causa raiz:** Não há cursor persistido de leitura. A validação por mensagem fica no adapter, sem isolar a falha, e o teto de 200 é aplicado à caixa inteira em vez de a cada lote novo.
- **Correção sugerida:** 1) Guardar o `recebidoEm` do último e-mail processado (ou o deltaLink do Graph) e passar `desde` em `sincronizar`. 2) No adapter, usar `safeParse` por mensagem e devolver as inválidas como falha nomeada (evento `reprocessavel`/`falha` com o messageId), sem lançar para o lote. 3) Aplicar o teto ao conjunto posterior ao cursor e processar em lotes em vez de recusar tudo. 4) Normalizar `name` vazio para 'anexo-sem-nome' (usar `||` em vez de `??`) e truncar o assunto em vez de recusar.
- **Teste de regressão:** Dublê de ClienteDoGraph com uma mensagem de 51 anexos entre duas mensagens válidas: `sincronizar` precisa criar os itens das duas válidas e registrar uma falha nomeada para a inválida. Outro teste: com 250 mensagens antigas já processadas e 3 novas, o `desde` persistido faz a sincronização ler só as 3. Ver o teste vermelho contra o código atual.
- **Evidência do auditor:** servicos/ingestao.ts:76 `await deps.ingestao.buscarNovos()` (sem desde); ingestao-graph.ts:115 `EmailBrutoSchema.parse({...})` fora de try; :101 `if (mensagens.length > TETO_POR_SINCRONIZACAO) throw`; :164 `nome: anexo.name ?? 'anexo-sem-nome'`
- **Verificação (3 de 3 confirmaram):** Segui o caminho real e o cenário se confirma. Nenhuma camada impede o defeito.

1. O cursor `desde` nunca é passado. A rota `POST /api/ingestao` chama `sincronizar` (route.ts:32), e `sincronizar` chama `deps.ingestao.buscarNovos()` sem argumento (ingestao.ts:76). `desde` também não existe como variável de ambiente nem como configuração. Por isso `listarMensagens(undefined)` monta a URL sem `$filter` e lê a Inbox inteira, em ordem crescente, a cada sincronização.

2. O teto de 200 derruba tudo. `listarMensagens` pagina até passar de 200 (linha 319) e devolve a lista. Em seguida, `buscarNovos` lança `IngestaoIndisponivelError` (linhas 101-107). A mensagem de erro manda "escolher a data", mas não existe onde escolher. Como `A5` proíbe mover ou apagar mensagens, uma caixa real de secretaria com mais de 200 mensagens na Inbox falha em toda chamada, já no primeiro dia.

3. Uma mensagem ruim derruba o lote inteiro. `EmailBrutoSchema.parse` roda no laço do adapter (linha 115), sem try/catch. O try/catch por mensagem de `sincronizar` (linhas 114-227) só envolve o laço sobre `brutos`, que roda depois. Um ZodError, portanto, sai de `buscarNovos` antes do evento 'iniciado' e antes de qualquer  […]

### C-04 — messageId aceito até 500 caracteres, mas a coluna tem 191: um e-mail volta a pagar IA em toda sincronização

**ALTO** · idempotência / esquema x banco · `src/core/esquemas.ts:339` · dimensão `ingestao-anexos` (também: mysql-dados)

- **Descrição:** `EmailBrutoSchema.messageId` aceita até 500 caracteres, e a migração criou `Email.messageId VARCHAR(191)`. O `internetMessageId` vem do cabeçalho Message-ID, que é escolhido pelo remetente. Com um valor entre 192 e 500 caracteres, a validação passa, a IA é chamada (linha 277), os anexos são gravados e o `upsert` falha por valor longo demais (P2000 no modo estrito do MySQL 8). O erro não é P2002, então cai em `falhas += 1` e vira evento 'reprocessavel'. Na próxima sincronização o e-mail não é encontrado pelo `findUnique`, e tudo se repete.
- **Vetor:** E-mail externo com cabeçalho Message-ID de cerca de 300 caracteres.
- **Pré-condições:** INGESTAO_ADAPTER=graph e IA paga ligada. Não exige privilégio.
- **Impacto:** Uma chamada paga ao modelo por sincronização, para sempre, e o lote marcado como 'falha' todo dia (vermelho permanente que ensina a equipe a ignorar vermelho). O pedido legítimo com Message-ID longo nunca entra. O efeito se soma ao achado anterior (sem cursor).
- **Causa raiz:** O limite do esquema Zod não bate com o tamanho da coluna (`String @unique` sem `@db.VarChar`, e o padrão do Prisma no MySQL é 191).
- **Correção sugerida:** Igualar os dois limites: `.max(191)` no esquema, com falha por mensagem nomeada, ou coluna maior. Para chave única longa, o mais seguro é guardar um SHA-256 do Message-ID como chave de idempotência e o original em coluna separada.
- **Teste de regressão:** Teste de integração contra `sbp_teste`: e-mail com messageId de 300 caracteres não pode chegar a chamar `ia.interpretar` duas vezes em duas sincronizações. Teste estático comparando `max` do esquema com o tamanho da coluna na migração.
- **Evidência do auditor:** esquemas.ts:339 `messageId: z.string().min(1).max(500)`; migration inicial_mysql:97 `` `messageId` VARCHAR(191) NOT NULL ``
- **Verificação (1 de 1 confirmaram):** O cenário acontece de verdade, e o efeito é pior do que o achado descreve. O caminho no código é este:

1. A validação aceita o valor. `IngestaoGraph.buscarNovos` usa `mensagem.internetMessageId` sem cortar nada e valida com `EmailBrutoSchema` (`max(500)`).
2. A IA é chamada. Em `sincronizar`, o `findUnique` não encontra o e-mail e `processarUm` chama `deps.ia.interpretar` (linha 277), fora da transação. Os anexos também são gravados.
3. A gravação falha. O `tx.email.upsert` recebe um `messageId` maior que o `VARCHAR(191)` da coluna. O MySQL 8 roda em modo estrito por padrão, e não achei `sql_mode` alterado no repositório. O Prisma devolve P2000. `desfazerArquivos` apaga os anexos e o erro sobe.
4. No `catch` do laço, o erro não é P2002 nem `InterpretacaoIndisponivelError`. O código soma `falhas += 1` e chama `registrarEvento` com `referencia: candidato.messageId`. Essa coluna, `EventoProcessamento.referencia`, também é `VARCHAR(191)` (migration linha 425). A gravação do evento falha com o mesmo P2000. Essa chamada não tem `try` em volta, então o erro sai de `sincronizar`.

Resultado: o evento 'reprocessavel' que o achado prevê nunca é gravado. A sincronização inteira aborta ali, e […]

### C-05 — Nada no código impede e-mail real, com CPF, de ir a fornecedor externo sem máscara (A52) ou à camada gratuita do Gemini (A38)

**MÉDIO** · privacidade / configuracao · `src/adapters/fabrica.ts:52` · dimensão `ia-conteudo-externo`

- **Descrição:** A52 decidiu trocar o CPF por um marcador antes de mandar o texto a modelo externo. Não existe código para isso (git grep sem ocorrência de mascaramento em src/). O corpo segue inteiro para o fornecedor (ia-estruturada.ts:130-134). criarAiPort() e ambiente() aceitam qualquer combinação, inclusive INGESTAO_ADAPTER=graph com IA_ADAPTER=gemini, que é a chave gratuita usada na rotina A50. A38 exige termos sem treino. Na outra ponta, IA_ADAPTER tem 'mock' como padrão (ambiente.ts:25): com graph ligado e IA_ADAPTER esquecido, e-mails reais são classificados pelas regras do mock, com confiança fixa de 0,89 a 0,93, e aprovados sem revisão quando passam do limiar.
- **Vetor:** Quem configura o ambiente liga a caixa real e mantém a chave gratuita do Gemini que já está nesta máquina para a rotina A50, ou esquece IA_ADAPTER.
- **Pré-condições:** Erro de configuração por quem administra. Não exige atacante.
- **Impacto:** CPF, nome e CRM de associado vão para um fornecedor cuja camada gratuita pode usar o conteúdo, contra A38/A52. Ou então os itens reais são aprovados por regex sem que a decisão tenha sido tomada.
- **Causa raiz:** Uma decisão de privacidade depende de disciplina de configuração, sem trava na partida.
- **Correção sugerida:** Em ambiente(), recusar subir com INGESTAO_ADAPTER diferente de mock junto com IA_ADAPTER=mock ou com a camada gratuita, salvo liberação explícita. Implementar a máscara de CPF de A52 em ia-estruturada.ts (fonte única), aplicada a fornecedor externo.
- **Teste de regressão:** ambiente() com INGESTAO_ADAPTER=graph e IA_ADAPTER=gemini (ou mock) precisa lançar erro. Um cliente falso de modelo precisa receber `[CPF-1]` no lugar do CPF, e o item gravado precisa ter o CPF recolocado.
- **Evidência do auditor:** ambiente.ts:25 `IA_ADAPTER: z.enum([...]).default('mock')`; ambiente.ts:221-230 só exige a chave; ia-estruturada.ts:130 `const bruto = `${email.assunto}\n${email.corpo}``
- **Verificação (1 de 1 confirmaram):** Segui o caminho de verdade e o cenário acontece. Nenhuma camada impede que uma caixa real seja lida junto com um modelo não autorizado.

- **Partida sem trava:** `ambiente()` só recusa subir em dois casos. Um é `ACESSO_LOCAL_SEM_SENHA` ligado em produção. O outro é faltar a chave do adapter de IA escolhido. Nada no código cruza `INGESTAO_ADAPTER` com `IA_ADAPTER`.
- **Fábrica:** `criarIngestaoPort()` devolve `IngestaoGraph` quando vale `graph`, e `criarAiPort()` escolhe o fornecedor só pelo `IA_ADAPTER`. Assim, `graph` junto com `gemini` (com a `GOOGLE_AI_KEY` da rotina A50) ou junto com `mock` (o valor padrão) sobe sem erro.
- **Máscara de CPF (A52):** não existe. `git grep` por `mascar` e `[CPF` em `src/` só acha testes de extensão de anexo. Em `ia-estruturada.ts`, `interpretar()` monta o texto com o assunto e o corpo inteiros e aplica apenas `prepararConteudoExterno`, que trunca, detecta e delimita, mas não tira o CPF.
- **Decisões que o código não cumpre:**
  - A38 diz que a camada gratuita do Gemini serve só para dado sintético e que e-mail real só vai para camada paga.
  - A52 diz que o CPF sai do texto antes de ir a modelo externo.

  Hoje as duas dependem de alguém configur […]

### C-06 — Não há disjuntor, teto diário nem registro de custo, e 'conta sem crédito' não é detectada como diz o contrato

**MÉDIO** · consumo-excessivo / disjuntor · `src/adapters/ia-estruturada.ts:150` · dimensão `ia-conteudo-externo`

- **Descrição:** A54 decidiu que registro de uso, teto diário e corte depois de falhas seguidas entram nesta rodada, e nenhum dos três existe no código. O lote só para em ehCredencialRecusada: Anthropic com 401/403 (ia-anthropic.ts:57) e Gemini com 401/403 ou texto de chave. Saldo esgotado na Anthropic chega como 400 (BadRequestError) e cota diária esgotada no Gemini chega como 429. Os dois viram 'transporte', e o laço segue e-mail por e-mail. Já o comentário do contrato (ports/ia.ts:40) diz que 'conta sem crédito' para o lote.
- **Vetor:** O fornecedor cai (429, 529 ou 503) ou o crédito acaba durante uma sincronização de 200 e-mails (TETO_POR_SINCRONIZACAO).
- **Pré-condições:** Adapter real e queda ou limite no fornecedor.
- **Impacto:** Uma queda gera até 200 × 3 = 600 requisições HTTP na Anthropic (maxRetries 2 do SDK, que repete 408/409/429/5xx), ou 200 no Gemini, cada uma com até 120 s de espera. A sincronização pode ficar horas presa numa única requisição HTTP. Duas sincronizações ao mesmo tempo (limite de 5/min por operador, sem trava) interpretam os mesmos e-mails duas vezes (o próprio comentário em ingestao.ts:127 admite a corrida), pagando em dobro. O assistente tem 12/min por pessoa e nenhum teto global.
- **Causa raiz:** O controle de custo é só taxa por pessoa. Falta estado compartilhado de saúde do fornecedor e de gasto.
- **Correção sugerida:** Implementar A54: disjuntor que interrompe o lote depois de N falhas de transporte seguidas (e reconhece saldo esgotado e 429 de cota como indisponibilidade), teto diário de chamadas e tokens por fornecedor, registro de uso por chamada, e trava para impedir duas sincronizações simultâneas.
- **Teste de regressão:** Uma IA falsa que lança erro de transporte sempre, com 50 e-mails: sincronizar() para depois de N chamadas com InterpretacaoIndisponivelError. Um erro com status 400 e 'credit balance is too low' precisa ser classificado como indisponibilidade.
- **Evidência do auditor:** ia-estruturada.ts:149-152 `primeira.especie === 'transporte' ? primeira : ...`; ingestao.ts:198 só para em `InterpretacaoIndisponivelError`; git grep sem ocorrência de disjuntor ou teto diário em src/
- **Verificação (1 de 1 confirmaram):** Segui o caminho do código e o cenário se confirma. O lote só para quando o perfil reconhece credencial recusada. No Anthropic isso vale apenas para AuthenticationError e PermissionDeniedError (401 e 403). No Gemini vale para 401, 403 ou texto de chave inválida, e o comentário do próprio arquivo diz que 429 "não deve derrubar o lote inteiro".

Qualquer outro erro, inclusive 429, 5xx, timeout ou 400 de saldo esgotado, vira espécie 'transporte'. Nesse caso o núcleo não repete a chamada, mas também não interrompe o laço. O ingestao.ts só relança InterpretacaoIndisponivelError. Os demais erros apenas somam em resumo.falhas, e o laço segue para o próximo e-mail, até 200 por sincronização (TETO_POR_SINCRONIZACAO em ingestao-graph.ts:91).

O cliente Anthropic usa maxRetries 2 e timeout de 120 s. Então, na queda, cada e-mail pode gerar até 3 requisições. Não achei disjuntor, teto diário nem registro de uso em src/. A decisão A54 manda que os três entrem nesta rodada (A49), e o código ainda não os tem. O comentário de InterpretacaoIndisponivelError (ports/ia.ts) promete parar o lote em "conta sem crédito", e nenhum perfil detecta esse caso.

A limitação de taxa é só por pessoa: 5 por minuto  […]

### C-07 — E-mail encaminhado como anexo e anexo-link do OneDrive somem sem registro

**MÉDIO** · falha silenciosa / anexos · `src/adapters/ingestao-graph.ts:329` · dimensão `ingestao-anexos`

- **Descrição:** `listarAnexos` descarta todo anexo sem `contentBytes`. No Graph, isso inclui `itemAttachment` (mensagem .eml/.msg anexada, que é a forma comum de encaminhar o pedido do associado) e `referenceAttachment` (link para arquivo na nuvem). Eles não viram metadado, não contam em `anexosRejeitados` e não forçam revisão (`decidirRevisao` usa `anexosRejeitados > 0`). Se o corpo parecer completo, o item pode ser aprovado sem ninguém saber que havia um documento ou uma mensagem anexada.
- **Vetor:** Colega ou associado encaminha 'como anexo' o e-mail original com os dados, ou anexa o laudo como link do OneDrive.
- **Pré-condições:** INGESTAO_ADAPTER=graph.
- **Impacto:** Trabalho ou documento perdido sem sinal, justamente o defeito que o invariante 7 existe para impedir. É uma decisão operacional errada (item aprovado sem o anexo que o justificava).
- **Causa raiz:** O filtro trata 'sem bytes' como 'não é anexo', em vez de 'anexo que o sistema não guarda'.
- **Correção sugerida:** Mapear todo anexo devolvido. Os sem `contentBytes` entram com `nome`, `tipoDeclarado` (`@odata.type`), `tamanho` e sem `conteudo`, e são recusados por `validarAnexo` ou por regra própria ('anexo do tipo item/link não é guardado'), o que manda o item para revisão.
- **Teste de regressão:** Dublê do Graph devolvendo um `itemAttachment` sem `contentBytes`: `buscarNovos` precisa devolver o anexo como metadado, e `sincronizar` precisa contar `anexosRejeitados = 1` e criar `Revisao`.
- **Evidência do auditor:** ingestao-graph.ts:329 `.filter((anexo) => anexo.contentBytes !== undefined)`
- **Verificação (1 de 1 confirmaram):** Confirmei o caminho no código. A listagem do Graph só entrega anexos com `contentBytes`. Um `itemAttachment` (mensagem anexada) ou um `referenceAttachment` (link da nuvem) chega do Graph sem esse campo e sai da lista ali mesmo, na linha 329. Nenhuma camada adiante recupera esse anexo. `anexosDe` só mapeia o que sobrou. O comentário das linhas 135-146 promete "metadado sempre" e diz que uma pessoa fica sabendo do arquivo não guardado, mas isso só vale para arquivo grande, não para anexo sem bytes. A ingestão monta `anexosRejeitados` a partir dessa lista já filtrada. O e-mail com `hasAttachments=true` que só tenha esse tipo de anexo termina com anexos vazios e `anexosRejeitados=0`, e nenhuma linha de `Anexo` é gravada. `decidirRevisao` usa `anexosRejeitados > 0` como sinal. Se o modelo der confiança acima do limiar, sem campo ausente e com um único item, o item é aprovado sem revisão. Não há log, contador nem linha de banco sobre o anexo descartado, o que contraria o invariante 7. Também não há decisão registrada no DECISOES que aceite esse descarte (nenhuma menção a itemAttachment ou referenceAttachment nos docs). Mantenho MEDIO. O efeito só aparece com INGESTAO_ADAPTER=graph, que d […]

### C-08 — Com uma sessão de gestor roubada ou deixada aberta, o atacante toma a conta de forma permanente e tranca o gestor legítimo para fora

**MÉDIO** · autenticacao/reautenticacao · `src/servicos/autenticacao.ts:275` · dimensão `autenticacao-sessao`

- **Descrição:** `definirSenhaProvisoria` só exige papel gestor. Não pede a senha atual de quem faz o pedido e não recusa `colaboradorId` igual ao do próprio ator nem ao de outro gestor. A resposta devolve a senha provisória em texto. `trocarSenha` (linha 174) promete que 'um cookie roubado não deve bastar para trancar o dono legítimo para fora da própria conta', mas essa rota contorna a promessa para toda conta de gestor e para qualquer outra conta.
- **Vetor:** Sessão de gestor aberta numa máquina compartilhada, ou cookie obtido de outro jeito. O atacante chama POST /api/colaboradores/senha com {"colaboradorId":"<id do próprio gestor>"} e recebe a senha provisória. `senhaDefinidaEm` muda e as sessões do gestor legítimo morrem. O atacante entra com a provisória, troca para uma senha só dele e passa a ser o dono da conta. A mesma chamada com o id de outro gestor ou de um colaborador dá acesso a essas contas também.
- **Pré-condições:** Uma sessão válida de gestor nas mãos do atacante (máquina compartilhada destravada, ou cookie roubado). O cenário da máquina compartilhada é o que o próprio código cita em DELETE /api/sessao.
- **Impacto:** Uma janela de até 12h vira tomada permanente de conta privilegiada. O 'sair' e a troca de senha do dono deixam de servir como resposta. Se for o único gestor, a recuperação exige mexer no banco à mão (o próprio código diz isso em `definirAtivacao`). A trilha registra 'senha_redefinida_pelo_gestor' com o id da vítima como autor.
- **Causa raiz:** A ação sensível não pede reautenticação, e o fluxo de 'redefinir a senha de outra pessoa' não exclui a própria conta nem contas do mesmo nível.
- **Correção sugerida:** No serviço: recusar `dados.colaboradorId === ator.colaboradorId` (a própria senha só se troca por `trocarSenha`). Exigir reautenticação, com a senha atual do gestor no corpo conferida por `conferirSenha` sob a mesma trava de tentativas, para redefinir senha, desativar e mudar papel. Levar ao dono a decisão sobre redefinir senha de outro gestor (exigir dois gestores ou MFA) e registrar em DECISOES § H.4.
- **Teste de regressão:** Em servicos/autenticacao.test.ts: (1) o gestor chama definirSenhaProvisoria com o próprio id e recebe ErroDeNegocio, sem mudança em senhaHash nem em senhaDefinidaEm; (2) sem a senha atual do gestor ou com ela errada, a redefinição é recusada e o contador de tentativas sobe. Reverter a correção e ver os dois testes falharem.
- **Evidência do auditor:** autenticacao.ts:275 `exigirPapel(ator, 'definir senha de outro colaborador', 'gestor')` e depois `findUnique({ where: { id: dados.colaboradorId } })`, sem comparar com ator.colaboradorId; linha 310 `return { colaboradorId, senhaProvisoria }`; route.ts colaboradores/senha:9-10 só chama `exigirAtor()`.
- **Verificação (3 de 3 confirmaram):** O cenário acontece. A rota POST /api/colaboradores/senha só chama `exigirAtor()` e repassa o corpo ao serviço. `definirSenhaProvisoria` (autenticacao.ts:275) só confere o papel gestor. Não compara `dados.colaboradorId` com `ator.colaboradorId`, não pede a senha atual e só recusa conta inexistente ou inativa. Depois grava hash novo e `senhaDefinidaEm = new Date()` e devolve a senha em texto (linha 310). Nenhuma outra camada impede o uso com o próprio id. Na sessão, sessao.ts:196 compara `senhaDefinidaEm` com o valor gravado no cookie: se forem diferentes, a sessão é recusada, então a sessão do dono legítimo morre. O invasor entra com a senha provisória. `precisaTrocarSenha` só o obriga a passar por `trocarSenha`, e a senha atual que essa rota pede é a provisória, que ele conhece. Com isso a promessa do comentário em `trocarSenha` (linha 174) é contornada para a própria conta do gestor. A trilha grava `usuario: ator.colaboradorId`, que é o id da própria vítima.

Rebaixei de ALTO para MEDIO por dois motivos. (1) A parte do achado sobre "outro gestor ou colaborador" é decisão registrada: DECISOES § A-03 aceita, na "Ressalva honesta", que o gestor sempre pode redefinir a senha de alguém […]

### C-09 — A trava por conta pode ser furada disparando tentativas em paralelo

**MÉDIO** · autenticacao/forca-bruta · `src/servicos/autenticacao.ts:85` · dimensão `autenticacao-sessao`

- **Descrição:** O bloqueio é conferido (linha 85) com o `bloqueadoAte` lido ANTES do scrypt (cerca de 90 ms, em fila no pool do libuv). `bloqueadoAte` só é gravado depois que a 5ª falha termina (linhas 113-119). Toda requisição que leu a linha antes disso passa pela conferência e testa uma senha. O incremento atômico corrigiu a contagem, mas não o momento da decisão.
- **Vetor:** Quando o bloqueio expira, o atacante manda N POST /api/sessao simultâneos contra a mesma conta. As N leituras terminam em milissegundos, antes de qualquer scrypt acabar, e todas passam por `restante > 0`. As N senhas são conferidas. Se uma acertar, a linha 138 zera o contador e a sessão é emitida.
- **Pré-condições:** Conhecer o e-mail da conta. N fica limitado pelo balde por origem: sem proxy (`PROXIES_CONFIAVEIS=0`, o padrão) o teto é 20×30 = 600 por minuto num balde global.
- **Impacto:** A trava prometida de 5 tentativas por janela (até 15 min) vira centenas de tentativas por janela. Isso dá dezenas de milhares de palpites por dia contra senhas humanas de 10 caracteres, que é o mínimo da política.
- **Causa raiz:** O padrão ler → decidir → gravar não é atômico: a decisão usa um valor lido antes do trabalho demorado.
- **Correção sugerida:** Reservar a tentativa ANTES do hash com uma escrita condicional atômica, por exemplo `updateMany({ where: { id, OR: [{ bloqueadoAte: null }, { bloqueadoAte: { lt: agora } }], tentativasFalhas: { lt: LIMITE } }, data: { tentativasFalhas: { increment: 1 } } })`. Se `count === 0`, recusar como bloqueado. Na senha certa, desfazer o incremento. Aplicar o mesmo em `trocarSenha`.
- **Teste de regressão:** Contra `sbp_teste`: com a conta em 4 falhas, disparar 20 `autenticar` com senha errada via Promise.all e mais 1 com a senha certa no mesmo lote. Esperar no máximo 1 conferência de hash depois da 5ª falha (espiar `conferirSenha`) e nenhuma sessão emitida. Reverter e ver passar mais de uma.
- **Evidência do auditor:** autenticacao.ts:64 findUnique(... bloqueadoAte) → :85 `bloqueioRestanteEmSegundos(colaborador.bloqueadoAte, new Date())` → :97 `await conferirSenha(...)` → só em :115 `update({ data: { bloqueadoAte: ... } })`.
- **Verificação (1 de 1 confirmaram):** O caminho do código confirma o achado. Em `autenticar`, a conta é lida uma vez só (autenticacao.ts:64-77). A decisão de bloquear usa esse valor antigo (:85-95). Depois vem o `await conferirSenha` (:97), um scrypt assíncrono com N=16384 que roda no pool do libuv. O `bloqueadoAte` só é gravado em :115-118, depois do incremento, e o incremento é uma escrita separada, sem transação que junte leitura e decisão.

Não há outra camada que impeça a corrida:
- A rota POST /api/sessao (src/app/api/sessao/route.ts) só aplica `limitarPorOrigem(requisicao, 'sessao:entrar', 20, 60)`.
- Com `PROXIES_CONFIAVEIS` no padrão 0 (ambiente.ts:166), a chave vira o balde único 'origem-indistinguivel', e o teto sobe para 20 × `FATOR_SEM_ORIGEM` (30) = 600 por minuto (http.ts:210, 270, 282).
- Não há trava de linha, nem escrita condicional, nem fila por conta.

O próprio teste do repositório comprova que várias chamadas passam juntas pela conferência. Em src/servicos/autenticacao.test.ts:209-217, dez `autenticar` com senha errada em `Promise.all` terminam com `tentativasFalhas` = 10. Como a recusa por CONTA_BLOQUEADA sai antes do incremento, as 10 passaram pela checagem e conferiram a senha, embora o limite  […]

### C-10 — Concluir, devolver e transferir o mesmo item em paralelo passam sem trava

**MÉDIO** · concorrencia / logica de negocio · `src/servicos/fila.ts:139` · dimensão `api-autorizacao` (também: negocio-concorrencia)

- **Descrição:** concluir, devolver e transferir seguem o mesmo padrão: leem a atribuição ativa e o status do item sem trava (findFirst), conferem 'já concluído' e depois gravam. Não há SELECT ... FOR UPDATE, nível de isolamento declarado, update condicional (where status in [...]) nem único em Execucao.itemId. No InnoDB (REPEATABLE READ), a leitura simples não trava nada, então as duas transações passam na conferência.
- **Vetor:** O próprio responsável (papel colaborador), dono do item, dispara duas vezes POST /api/itens/{id}/concluir ao mesmo tempo (clique duplo, duas abas ou script). Ou dispara /concluir e /devolver juntos. Ou um operador chama /transferir enquanto o dono chama /concluir.
- **Pré-condições:** Sessão válida de quem é dono do item (qualquer papel), ou operador/gestor para transferir. Janela de corrida curta, mas um script a acerta com facilidade.
- **Impacto:** (a) Conclusão dupla: nascem duas linhas de Execucao, e porPessoa (painel.ts:306) soma execuções, então os 'concluídos' da pessoa sobem. (b) Concluir junto com devolver: o item fica com Execucao 'concluido', status 'devolvido' e sem responsável. A próxima rodada o redistribui, e outra pessoa o conclui de novo. Isso quebra a premissa 'item concluído NUNCA reabre', da qual o cálculo de pendência do painel depende (painel.ts:~100). (c) Concluir junto com transferir: a Execucao diz que A fez e a atribuição ativa diz que o dono é B, exatamente o estado que o comentário de transferir diz impedir.
- **Causa raiz:** A trava 'item já concluído' é uma conferência feita em memória sobre uma leitura sem trava. A escrita não repete a condição.
- **Correção sugerida:** Tornar a transição atômica. Trocar tx.item.update por updateMany({ where: { id, status: { in: ['distribuido','em_andamento'] } } }) e abortar se count !== 1, nas três funções. Ou travar a linha do item (SELECT ... FOR UPDATE via $queryRaw) antes da leitura. Como defesa no banco, avaliar um único parcial de conclusão por item.
- **Teste de regressão:** Contra sbp_teste: Promise.all([concluir(item), concluir(item)]) deve deixar exatamente 1 Execucao. Promise.all([concluir(item), devolver(item)]) deve terminar com um só dos dois efeitos, nunca status 'devolvido' com Execucao 'concluido'. Reverter a correção e ver os dois testes falharem.
- **Evidência do auditor:** fila.ts:139-148 findFirst sem trava + `if (atribuicao.item.status === 'concluido') return` e depois `tx.execucao.create` / `tx.item.update({ where: { id } ...})`; nenhum FOR UPDATE ou isolationLevel em src/ (grep); schema Execucao sem @@unique em itemId.
- **Verificação (1 de 1 confirmaram):** Segui o caminho de ponta a ponta e não achei trava em nenhuma camada. A rota POST /api/itens/[id]/concluir só faz exigirAtor, valida o corpo com Zod e chama concluir. Não há idempotência nem trava na rota.

Em concluir, devolver e transferir (src/servicos/fila.ts), a leitura é um findFirst simples dentro de banco.$transaction. Não há isolationLevel declarado nem SELECT ... FOR UPDATE: o grep em src/ e prisma/ não acha nenhum dos dois. O cliente (src/servidor/prisma.ts) usa PrismaMariaDb sem configurar isolamento, então vale o padrão do InnoDB, REPEATABLE READ. Nesse nível, a leitura simples é um snapshot e não trava nada, então as duas transações passam na checagem "status === 'concluido'".

- **Conclusão dupla:** a primeira transação trava a linha do Item no update. A segunda espera o commit e depois atualiza a versão atual. O InnoDB não levanta erro de serialização nesse caso, então as duas transações confirmam. O modelo Execucao só tem @@index([itemId]), sem @@unique, então nada no banco impede as duas linhas de Execucao.
- **Concluir junto com devolver:** as duas transações escrevem em linhas diferentes de Atribuicao/Execucao e se encontram só no update do Item. Se devolver con […]

### C-11 — E-mail que falha na interpretação é reinterpretado, e pago, em toda sincronização, sem contador nem limite

**MÉDIO** · consumo-excessivo / ia · `src/servicos/ingestao.ts:277` · dimensão `ia-conteudo-externo` (também: ingestao-anexos, falhas-silenciosas)

- **Descrição:** Quando interpretar() lança FalhaDeInterpretacao, nada é gravado além de um evento 'reprocessavel' (linha 223). O e-mail não fica com processadoEm, então a próxima sincronização chama o modelo de novo, na mesma mensagem. Não existe contagem de tentativas nem fila de e-mails que falharam sempre. A listagem do Graph sempre devolve o mesmo e-mail (não usa `desde`).
- **Vetor:** Um remetente anônimo manda N e-mails feitos para o modelo falhar de forma determinística. Um exemplo é uma lista de mais de 1000 nomes, que estoura os 16 mil tokens de saída e sai como 'truncada'.
- **Pré-condições:** Adapter de IA real e ingestão real. Não exige privilégio.
- **Impacto:** Cada sincronização gasta até 16 mil tokens de saída por e-mail envenenado na Anthropic (1 chamada) e 2 chamadas no Gemini (repetição por formato). Isso se repete a cada clique em sincronizar (até 5 por minuto por operador) e para sempre. Cada chamada pode levar até 120 s, o que deixa todo lote lento. Os eventos 'reprocessavel' se acumulam numa tabela que nunca é apagada.
- **Causa raiz:** 'Reprocessável' não tem limite: idempotência sem contagem de tentativas vira repetição infinita.
- **Correção sugerida:** Gravar a tentativa (por exemplo, Email com status de falha e contador, sem conteúdo ou com conteúdo sob a mesma retenção). Depois de K falhas de validação/truncamento, parar de chamar o modelo e mandar o e-mail para uma pessoa (a mesma lista pedida em A34).
- **Teste de regressão:** Uma IA falsa que sempre lança FalhaDeInterpretacao para um messageId, e sincronizar() rodado 5 vezes: o número de chamadas a interpretar() para aquele e-mail fica no teto K, e o e-mail aparece para revisão humana.
- **Evidência do auditor:** ingestao.ts:212-226 `resumo.falhas += 1 ... situacao: 'reprocessavel'` sem nenhuma escrita em Email; ingestao.ts:118-125 só pula quando `jaExiste?.processadoEm`
- **Verificação (1 de 1 confirmaram):** Segui o caminho de ponta a ponta e o cenário acontece como descrito. Nenhuma outra camada o impede.

1. **Entrada.** A rota POST /api/ingestao (`src/app/api/ingestao/route.ts`) exige o papel operador ou gestor. O limite é `limitar('ingestao:' + colaboradorId, 5, 60)`, contado por pessoa. Com vários operadores, o total de sincronizações se multiplica.
2. **Listagem sem `desde`.** `sincronizar` chama `deps.ingestao.buscarNovos()` sem argumento (`ingestao.ts:76`). No Graph, isso monta `listarMensagens(undefined)`, que não tem `$filter`. A caixa de entrada inteira volta em toda sincronização, em ordem crescente, seguindo a paginação até `TETO_POR_SINCRONIZACAO`.
3. **Quando é pulado.** O e-mail só é pulado quando `jaExiste?.processadoEm` existe (`ingestao.ts:118-125`).
4. **Onde nada é gravado.** `processarUm` chama `deps.ia.interpretar(email)` antes de qualquer escrita. O próprio comentário diz "Se falhar, nada foi gravado". Por isso não existe linha em Email nem `processadoEm`.
5. **O catch.** Para `FalhaDeInterpretacao`, o catch (`ingestao.ts:212-226`) só soma `resumo.falhas` e grava um evento `reprocessavel`. Não há contador. O schema do modelo Email (`prisma/schema.prisma:236`) nã […]

### C-12 — 'Produção' é detectada só por NODE_ENV, e a trava de rede do acesso sem senha é toda escrita pelo cliente

**MÉDIO** · configuracao/acesso-sem-senha · `src/servidor/ambiente.ts:323` · dimensão `autenticacao-sessao`

- **Descrição:** As travas 2 do acesso local (ambiente.ts:323, acesso-local.ts:45) e o `secure` do cookie (sessao.ts:140) dependem apenas de `NODE_ENV === 'production'`. O `next start` só preenche NODE_ENV quando a variável está ausente (node_modules/next/dist/bin/next:84): com NODE_ENV=development ou test herdado do ambiente da máquina ou do gerenciador de processos, o build de produção sobe só com um aviso. Nesse caso `ACESSO_LOCAL_SEM_SENHA=1` é aceito, inclusive pelo `.env`, que o código não impede (a proibição é só documental). A trava 3 (`ehRequisicaoLocal` + `ehPedidoDaPropriaTela`) não resiste a um cliente que não seja navegador: Sec-Fetch-Site e X-Forwarded-For são escritos por ele. E o hostname de `requisicao.url` vem de `opts.hostname` do servidor, 'localhost' quando não há `--hostname` (resolve-routes.js:117), não do endereço pedido. A trava 4 ('só conta sintética') protege identidades, não dados: o seed cria `fabiana.gestora@exemplo.test` com papel gestor, e uma conta sintética de gestor enxerga dado real de associado se a base for real.
- **Vetor:** Servidor publicado com `next start` (que escuta em todas as interfaces), NODE_ENV≠production e ACESSO_LOCAL_SEM_SENHA=1. Da rede: `curl -X POST http://srv:3000/api/sessao/local -H 'Sec-Fetch-Site: same-origin' -H 'Content-Type: application/json' -H 'X-Forwarded-For: 127.0.0.1' -d '{"email":"fabiana.gestora@exemplo.test"}'` devolve um cookie de gestor sem senha.
- **Pré-condições:** Duas falhas de configuração no servidor (NODE_ENV fora de production e a variável ligada), mais uma conta @exemplo.test ativa na base. Não foi executado: a leitura do hostname é pelo código do Next, não medida.
- **Impacto:** Acesso de gestor sem autenticação, pela rede, a dado real. De quebra, o cookie sai sem Secure.
- **Causa raiz:** 'Produção' é inferida de uma variável genérica que o Next não força. As defesas de rede se apoiam em cabeçalhos controlados pelo cliente.
- **Correção sugerida:** Fazer o acesso local exigir um sinal positivo de desenvolvimento, e não a ausência de 'production': por exemplo, recusar se `process.env.NEXT_PHASE`/comando não for `dev` e exigir que o `dev:local` passe um marcador próprio (não lido do `.env`). Em `ehRequisicaoLocal`, recusar QUALQUER `x-forwarded-for` vindo do cliente em vez de validar o conteúdo. Recusar subir com contas @exemplo.test ativas quando NODE_ENV=production. Tornar o `secure` do cookie independente de NODE_ENV (variável explícita, com padrão true).
- **Teste de regressão:** acesso-local.test.ts: `ehRequisicaoLocal` com `x-forwarded-for: 127.0.0.1` enviado pelo cliente deve dar false. `ambiente()` com ACESSO_LOCAL_SEM_SENHA=1 vindo do `.env` (sem o marcador do dev:local) deve lançar erro.
- **Evidência do auditor:** ambiente.ts:323 `if (ACESSO_LOCAL_SEM_SENHA && NODE_ENV === 'production') throw`; next/dist/bin/next:84 `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv`; acesso-local.ts:110-114 aceita XFF só com loopback; seed.ts:50-51 gestora @exemplo.test.
- **Verificação (1 de 1 confirmaram):** Segui o caminho no código e ele se confirma, desde que o servidor esteja com a configuração errada que o achado descreve. Nenhuma camada impede o cenário.

(1) As travas 2 dependem só de `NODE_ENV === 'production'`: a de `ambiente.ts` está na linha 208, não na 323 (o arquivo tem 240 linhas), e a de `acesso-local.ts` na linha 45. O `next start` só preenche NODE_ENV quando a variável não existe (`next/dist/bin/next`, `process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv`). O comando só avisa, não recusa. `ACESSO_LOCAL_SEM_SENHA` é lida de `process.env` depois de `carregarArquivoEnv()`, e nada no código recusa o valor vindo do `.env`: a proibição está só no comentário.

(2) Trava 3, conferência do endereço: `requisicao.url` vem do `initURL`. No Next 16.3.5, `resolve-routes.js:117` monta esse endereço com `opts.hostname || 'localhost'`. No `next start`, esse valor vem de `options.hostname` (`next-start.js:72`) e é `undefined` quando não se passa `--hostname`, e nesse caso o servidor escuta em todas as interfaces. Resultado: a conferência do endereço pedido sempre dá 'localhost', seja qual for o endereço que o cliente pediu.

(3) Trava 3, conferência da origem: `base-server.js:612` […]

### C-13 — Nenhuma rota autenticada confere origem; SameSite=Lax não cobre origem do mesmo site

**MÉDIO** · csrf / controle de acesso · `src/servidor/http.ts:318` · dimensão `api-autorizacao` (também: testes-contratos)

- **Descrição:** corpoJson aceita qualquer Content-Type, inclusive text/plain de formulário, e só /api/sessao/local confere Sec-Fetch-Site/Origin (acesso-local.ts:76). A defesa das demais rotas é só o cookie sameSite=lax. Lax impede envio a partir de outro SITE, mas não de outra ORIGEM do mesmo site: outra porta no mesmo IP ou host, ou outro subdomínio do mesmo domínio registrável. O registro de DECISOES (linha ~402, 'Resíduo conhecido') apoia a aceitação na premissa de que 'o cookie sameSite=lax não vai em formulário de outro site'. A premissa é verdadeira só para site diferente, e a implantação (A46) ainda não está definida.
- **Vetor:** Uma página hospedada em origem do mesmo site (ex.: outro sistema da intranet em http://10.0.0.5:8080 quando o SBP está em http://10.0.0.5:3000, ou intranet.associacao... vs sbp.associacao...) com XSS ou conteúdo controlado por um colaborador. Ela faz auto-submit de <form enctype=text/plain method=POST action=http://10.0.0.5:3000/api/colaboradores/ativacao> com name='{"colaboradorId":"<id>","ativo":false,"x":"' value='"}'. O corpo resultante é JSON válido, e o navegador da gestora envia o cookie.
- **Pré-condições:** O atacante controla conteúdo numa origem do mesmo site do SBP e um gestor ou operador logado visita essa página. Depende da topologia de implantação ainda não decidida (A46).
- **Impacto:** Ações de estado executadas com a identidade de gestor ou operador: desligar o acesso de colegas (os itens deles voltam ao grupo), redefinir habilitações, gravar escala, confirmar distribuição, cadastrar colaborador, resolver revisão (inclusive aprovar item marcado como conteúdo suspeito, se o id for conhecido). Os ids saem de graça para qualquer autenticado em /api/escala e /api/painel. A resposta não é legível do outro lado, então não há roubo de senha provisória, mas há escalada vertical de ação e integridade da trilha atribuída à gestora.
- **Causa raiz:** A proteção contra CSRF depende só do atributo do cookie. O servidor não confere nem Origin/Sec-Fetch-Site nem Content-Type nas rotas de escrita.
- **Correção sugerida:** Em rota() ou num helper chamado por toda rota não-GET: exigir Content-Type application/json e Sec-Fetch-Site 'same-origin' (com Origin igual ao host esperado como alternativa), reaproveitando ehPedidoDaPropriaTela. Atualizar a nota de DECISOES com a distinção site × origem.
- **Teste de regressão:** Chamar POST /api/colaboradores/ativacao com cookie de gestor válido, Content-Type text/plain e Sec-Fetch-Site same-site: deve responder 403 e o colaborador continuar ativo. Com application/json e same-origin: 200.
- **Evidência do auditor:** http.ts:318 `return await requisicao.json()` sem conferir cabeçalho; sessao.ts OPCOES_DO_COOKIE `sameSite: 'lax'`; grep por sec-fetch/origin em src/servidor só encontra acesso-local.ts.
- **Verificação (1 de 1 confirmaram):** Segui o caminho do pedido e o cenário acontece. Nenhuma camada confere a origem nas rotas autenticadas:
- **Middleware** (src/middleware.ts): só monta a CSP com nonce. A diretriz `form-action 'self'` vale para as páginas do próprio SBP e não impede a página de outra origem de enviar formulário.
- **next.config.ts**: só define cabeçalhos de resposta.
- **`rota()`** (http.ts:75): recebe apenas o handler, sem a requisição, e só trata erro.
- **`exigirAtor()`** (sessao.ts:249): só lê a sessão do cookie.
- **`corpoJson`** (http.ts:314): chama `requisicao.json()`, que interpreta o corpo sem olhar o Content-Type. Um formulário `enctype=text/plain` com o par nome/valor montado vira JSON válido e segue para o Zod e o serviço.
- **Única exceção**: a conferência de `Sec-Fetch-Site` e `Content-Type` existe só em `ehPedidoDaPropriaTela` (acesso-local.ts:77-78), usada apenas por /api/sessao/local.

O cookie é `sameSite: 'lax'` (sessao.ts:138). Lax bloqueia POST vindo de outro site, mas não de outra origem do mesmo site:
- Em endereço IP, o site é o próprio IP; por isso outra porta no mesmo IP conta como mesmo site.
- Com domínio, um subdomínio irmão do mesmo domínio registrável também conta como […]

### C-14 — Com PROXIES_CONFIAVEIS=1, o cliente escolhe a própria chave do limite por origem

**MÉDIO** · autenticacao/limite-de-taxa · `src/servidor/http.ts:235` · dimensão `autenticacao-sessao`

- **Descrição:** Com um proxy declarado, `x-real-ip` tem precedência sempre que a cadeia tiver até 1 entrada, e quem chega direto ao servidor escreve esse cabeçalho. Se o proxy não acrescenta nada ao XFF (o caso que o próprio comentário descreve), um XFF de 2 entradas enviado pelo cliente cai em `cadeia.length > proxies`, e a chave passa a ser um valor escolhido pelo atacante. O mapa de janelas também cresce sem limite enquanto as chaves estiverem dentro da janela: `TETO_DE_CHAVES` só apaga as expiradas (limite-de-taxa.ts).
- **Vetor:** `X-Real-IP: <aleatório>` a cada requisição (acesso direto), ou `X-Forwarded-For: 1.1.1.1, <aleatório>` (proxy que não acrescenta): cada tentativa de login ganha um balde novo. Resultado: pulverização de senhas por várias contas (1–4 palpites por conta, abaixo da trava por conta) sem teto por origem, e memória crescendo no processo.
- **Pré-condições:** PROXIES_CONFIAVEIS=1 e porta da aplicação alcançável sem passar pelo proxy, ou proxy que não reescreve XFF.
- **Impacto:** O limite por origem de /api/sessao e /api/sessao/senha deixa de existir, e sobra só a trava por conta (que tem a corrida do achado anterior). Também abre DoS de memória.
- **Causa raiz:** Cabeçalhos que o cliente pode escrever são tratados como confiáveis sem prova de que passaram pelo proxy.
- **Correção sugerida:** Usar `x-real-ip` só quando a cadeia estiver vazia E o endereço do socket for o do proxy (lista explícita `PROXIES_ENDERECOS`), ou remover o atalho. Documentar o firewall/bind que impede acesso direto. Em `verificarLimite`, impor teto rígido (descartar as mais antigas) quando `limparJanelasExpiradas` não reduzir o mapa.
- **Teste de regressão:** http.test.ts: com PROXIES_CONFIAVEIS=1, 25 requisições com `x-real-ip` diferentes e sem XFF de proxy devem cair no mesmo balde e ser recusadas depois do limite.
- **Evidência do auditor:** http.ts:219-238 `if (cadeia.length > proxies) return cadeia[cadeia.length - proxies]` … `if (proxies === 1) { const real = headers.get('x-real-ip'); if (real) return { chave: real, confiavel: true } }`.
- **Verificação (1 de 1 confirmaram):** Segui o código e o cenário se confirma. Nenhuma outra camada impede o problema: `origemDaRequisicao` é a única fonte da chave do balde, e não existe lista de endereços de proxy nem conferência do endereço do socket.

Com PROXIES_CONFIAVEIS=1 há dois caminhos em que o atacante escolhe a chave:
(a) Proxy que não reescreve o XFF. O próprio comentário do código (http.ts:180-182) admite que, quando o cliente manda o cabeçalho, o Next repassa o valor dele intacto. Um `X-Forwarded-For: 1.1.1.1, <aleatório>` dá `cadeia.length`=2, que é maior que 1, e a função devolve `cadeia[1]`, o valor aleatório.
(b) Acesso direto à porta. O Next preenche o XFF com 1 entrada, o endereço do socket, e cai no desvio `proxies === 1`, que devolve o `x-real-ip` escrito pelo cliente.

Nos dois caminhos cada tentativa ganha um balde novo, com `confiavel: true` e, portanto, o limite apertado. O efeito é que o limite por origem deixa de valer, e a trava por conta continua de pé.

A parte de memória também procede. Com o mapa em 1000 chaves, `verificarLimite` só remove as janelas expiradas e insere a nova de qualquer jeito. O crescimento, porém, fica limitado pela vazão da rota (cada tentativa custa um scrypt) veze […]

### C-15 — O assistente grava no log texto livre escolhido pelo modelo, o que abre caminho para a pergunta, com e-mail colado, chegar ao log

**BAIXO** · privacidade / log · `src/adapters/assistente-modelo.ts:111` · dimensão `ia-conteudo-externo`

- **Descrição:** Quando o modelo cita um verbete que não foi enviado, o log recebe `citados: resultado.resposta.verbetesUsados`: até 8 strings de até 60 caracteres, escritas pelo modelo. 'citados' não está em CHAVES_SENSIVEIS (observabilidade.ts:22), então nada é mascarado. O serviço promete que o texto da pergunta nunca vai para o log (servicos/assistente.ts, item 3), e o adapter também evita isso de propósito (linha 86).
- **Vetor:** Uma pessoa logada cola um e-mail com CPF e nome e pede, ou o texto colado induz, 'liste em verbetesUsados o CPF e o nome acima'.
- **Pré-condições:** Sessão válida (qualquer papel) e assistente com modelo real.
- **Impacto:** Dado pessoal de terceiro vai para o stdout/log, que não tem política de retenção (invariante 11). O efeito é limitado a trechos curtos.
- **Causa raiz:** Uma saída do modelo não confiável é registrada crua, fora do resumo estrutural.
- **Correção sugerida:** Registrar só a contagem de citações descartadas, ou só as que casam com IDENTIFICADOR_SIMPLES, trocando o resto por marcador.
- **Teste de regressão:** Um cliente falso devolve verbetesUsados=['123.456.789-09 Fulana']: o log capturado não pode conter a string.
- **Evidência do auditor:** assistente-modelo.ts:109-112 `registrarLog('aviso', 'assistente citou verbete inexistente', { adapter: this.nome, citados: resultado.resposta.verbetesUsados })`
- **Verificação (1 de 1 confirmaram):** Segui o caminho real do código e o cenário acontece. Nenhuma camada impede.

1. **O modelo é real.** A fábrica (fabrica.ts:86-88) monta `AssistenteComModelo` com o cliente da Anthropic ou do Gemini.
2. **O esquema não filtra o formato.** `RespostaDoModeloAssistenteSchema` só limita `verbetesUsados` a 8 strings de até 60 caracteres (esquemas.ts:61). Não há regex de identificador, então qualquer texto passa pelo `parse` (linha 145).
3. **O log só dispara com citação inválida.** Ele é gravado quando alguma citação não está entre os ids enviados (linhas 107-108). Um CPF ou nome nunca é id de verbete, então basta um item assim para o log disparar com o array cru (linha 111).
4. **A redação não ajuda aqui.** `redigir` (observabilidade.ts:46-59) mascara só pelo nome da chave. `citados` não está em `CHAVES_SENSIVEIS`, e o array passa inteiro para o stdout. A lista tem 'cpf', mas a redação não olha o conteúdo dos valores.

Isso contradiz o cuidado da linha 86, que evita pôr o texto da pergunta no log por falta de política de retenção.

A severidade continua BAIXO, pelos seguintes motivos:
- Exige sessão válida.
- O próprio usuário escolhe colar o dado.
- O modelo precisa obedecer a instruçã […]

### C-16 — Qualquer colaborador cria notas sem limite, e toda tela de trabalho carrega todas as notas gerais sem teto

**BAIXO** · consumo excessivo · `src/app/api/notas/route.ts:57` · dimensão `api-autorizacao`

- **Descrição:** POST /api/notas aceita todos os papéis e não chama limitar(). paraContexto (notas.ts:~335) busca no banco TODAS as notas vivas sem vínculo, sem take (o corte de LIMITE_DE_NOTAS_EXIBIDAS só acontece em memória, depois). O comentário que justifica a leitura sem teto supõe 'dezenas' de notas, e nada no servidor garante isso. GET ?todas=1&arquivadas=1 (listar) também não tem take e está aberto a todos os papéis.
- **Vetor:** Um colaborador autenticado roda um laço de POST /api/notas {"texto":"<1000 caracteres>"} sem categoria nem liga, dezenas de milhares de vezes. Não há limite de taxa nessa rota.
- **Pré-condições:** Qualquer sessão válida, inclusive de papel colaborador.
- **Impacto:** Cada carregamento das telas de trabalho, para toda a equipe, passa a ler e transferir todas essas linhas. Com 100 mil notas, são cerca de 100 MB lidos do MySQL por requisição, que viram 5 na resposta: amplificação que degrada ou derruba o servidor. Cada nota também grava uma linha em LogAuditoria, que é append-only e não pode ser limpa. A limpeza das notas exige o gestor arquivar uma a uma.
- **Causa raiz:** Rota de escrita barata sem teto por pessoa, somada a uma leitura cujo custo cresce com o volume que essa rota produz.
- **Correção sugerida:** limitar(`nota:${ator.colaboradorId}`, N, 60) no POST. take no findMany de paraContexto, com o corte declarado como em memoria.ts. take e paginação em listar.
- **Teste de regressão:** 21 POST seguidos da mesma pessoa em 60 s: o 21º recebe 429. paraContexto com LIMITE+50 notas gerais faz consulta com take limitado (espiar a chamada ao banco) e devolve no máximo o teto.
- **Evidência do auditor:** notas/route.ts POST: `exigirAtor()` e `registrar(...)` sem limitar; notas.ts paraContexto: `banco.nota.findMany({ where: {...}, select: CAMPOS, orderBy })` sem take; listar idem.
- **Verificação (1 de 1 confirmaram):** Segui o caminho do código e o cenário acontece. Nenhuma outra camada o impede.

1. **Escrita sem limite.** O POST /api/notas só chama `exigirAtor()` e depois `registrar()`. `registrar` aceita os três papéis (colaborador, operador e gestor). O texto passa por Zod com no máximo 1000 caracteres (`TAMANHO_MAXIMO_DA_NOTA = 1000`), e os vínculos são opcionais. Não há `limitar()` nessa rota. O middleware tem só um `matcher` e nenhum limite de taxa. Outras rotas de escrita usam `limitar` (distribuição, busca, ingestão, assistente), mas a de notas não.

2. **Leitura sem teto.** `paraContexto` roda `banco.nota.findMany` sem `take`. O `where` sempre inclui `{ categoriaId: null, ligaId: null }`, então toda nota geral viva vem do banco. O corte em 5 (`LIMITE_DE_NOTAS_EXIBIDAS`) só acontece em memória, dentro de `selecionarNotas`. `listar` também não tem `take` e fica aberto a qualquer sessão via `?todas=1`.

3. **Limpeza difícil.** `arquivar` trata uma nota por vez e não existe arquivamento em lote. Cada POST grava uma linha em `LogAuditoria`, que é só de acréscimo.

**Ressalva sobre decisão registrada.** O próprio código registra a falta de teto na leitura (notas.ts:304-310). A justificativa é […]

### C-17 — CSRF de login: outro site consegue deixar o navegador da vítima logado na conta do atacante. A única defesa CSRF das demais rotas é SameSite=Lax

**BAIXO** · sessao/csrf · `src/app/api/sessao/route.ts:146` · dimensão `autenticacao-sessao`

- **Descrição:** POST /api/sessao não confere Origin, Sec-Fetch-Site nem Content-Type, e `corpoJson` aceita qualquer corpo que o JSON.parse consiga ler. `CredenciaisSchema` não é `.strict()`. Um formulário `enctype=text/plain` de outro site monta JSON válido, e a resposta de uma navegação de topo grava o cookie. A decisão registrada (DECISOES.md linha 402, 'Resíduo conhecido') descarta o risco porque 'a de entrada com senha exige a senha'. A premissa é falsa: no CSRF de login quem digita a senha é o atacante, com a conta dele. O mesmo registro supõe que `sameSite=lax` fecha as rotas autenticadas. Lax só barra origens de OUTRO site: outra porta do mesmo host, ou outra aplicação em subdomínio do mesmo domínio registrável na intranet, é same-site e manda o cookie. Além disso, o nome do cookie não usa o prefixo `__Host-`, então um subdomínio irmão pode plantar um `sbp_sessao` com Path mais específico.
- **Vetor:** Um colaborador mal-intencionado publica uma página com `<form method=POST action=https://sbp.../api/sessao enctype=text/plain><input name='{"email":"atacante@x","senha":"MinhaSenha1' value='"}'>` (a senha do atacante termina em '='). A vítima abre a página e passa a operar dentro da conta do atacante: o que ela escrever em notas ou conclusões fica na conta dele e é lido por ele. Variante: uma aplicação vizinha same-site com XSS faz POST text/plain para as rotas autenticadas com o cookie anexado.
- **Pré-condições:** CSRF de login: o atacante tem conta no sistema. Variante same-site: existe outra origem no mesmo site (depende de onde o sistema for publicado, A46).
- **Impacto:** Ações e textos da vítima ficam atribuídos à conta do atacante, que também os vê. A sessão da vítima é substituída. Na variante same-site, qualquer mutação autenticada roda como gestor.
- **Causa raiz:** Nenhuma verificação de origem nas rotas que mudam estado. `corpoJson` ignora Content-Type. O modelo de ameaça confunde same-site com same-origin.
- **Correção sugerida:** Em `rota()`, ou num helper chamado por toda rota não-GET incluindo /api/sessao: exigir `Sec-Fetch-Site` igual a `same-origin` (ou Origin igual ao host publicado) e Content-Type `application/json` quando houver corpo. Reaproveitar `ehPedidoDaPropriaTela`. Renomear o cookie para `__Host-sbp_sessao` em produção. Corrigir a premissa registrada na linha 402 do DECISOES.
- **Teste de regressão:** Testes de rota: POST /api/sessao com `sec-fetch-site: cross-site` ou `content-type: text/plain` e credenciais válidas responde 403 sem Set-Cookie. O mesmo vale para uma rota autenticada (POST /api/colaboradores/destravar). O pedido com same-origin e JSON continua 200.
- **Evidência do auditor:** sessao/route.ts:143-152 `limitarPorOrigem` → `autenticar(obterPrisma(), await corpoJson(requisicao))` → `armazem.set(...)`; http.ts `corpoJson` = `requisicao.json()` sem olhar cabeçalho; esquemas.ts:699 `CredenciaisSchema = z.object({...})` sem .strict(); grep por origin/sec-fetch/csrf em src só acha acesso-local.ts.
- **Verificação (1 de 1 confirmaram):** O caminho acontece como o achado descreve. POST /api/sessao só passa por `limitarPorOrigem`, lê o corpo com `corpoJson` e grava o cookie com `armazem.set(OPCOES_DO_COOKIE)`. Nada nesse caminho confere Origin, Sec-Fetch-Site ou Content-Type. O middleware só monta a CSP e não bloqueia pedido de outro site. O `form-action 'self'` da nossa CSP vale para as nossas páginas, não para a página do atacante. `Request.json()` lê o corpo sem olhar o Content-Type, então um formulário `text/plain` chega como JSON válido. Como `CredenciaisSchema` não é `.strict()`, o atacante nem precisa de senha terminada em '=': basta um campo extra, por exemplo `"z":"="`. Na navegação de topo, o navegador aceita o Set-Cookie com SameSite=Lax na resposta. Assim, o cookie da vítima é trocado pelo do atacante.

A premissa do "Resíduo conhecido" em DECISOES.md (AT-17) está errada para o CSRF de login, porque quem digita a senha é o atacante. Portanto não é uma decisão que o código cumpre: é uma análise de risco com premissa falsa.

Rebaixo a severidade para BAIXO por quatro motivos:
- **Exige alguém de dentro:** o atacante precisa ter conta própria que não esteja com senha provisória. Conta com senha provisória só […]

### C-18 — A mensagem de conta bloqueada enumera contas ativas, e a premissa registrada no comentário está errada

**BAIXO** · autenticacao/enumeracao · `src/servicos/autenticacao.ts:91` · dimensão `autenticacao-sessao`

- **Descrição:** O comentário justifica a mensagem específica dizendo que 'só chega neste ponto quem já provou conhecer um e-mail válido'. Não é assim: o atacante não precisa saber. Basta mandar 6 tentativas para cada e-mail candidato. Conta ativa responde 'Muitas tentativas…' e e-mail inexistente ou inativo responde sempre 'E-mail ou senha incorretos.'. O piso de 250 ms, que existe para esconder isso pelo relógio, fica inócuo.
- **Vetor:** Para cada nome.sobrenome@dominio de uma lista: 6 POST /api/sessao. O texto da 6ª resposta diz se a conta existe e está ativa.
- **Pré-condições:** Nenhuma autenticação.
- **Impacto:** Lista de quem tem acesso ativo ao sistema. Cada conta real sondada também fica travada por 30 s ou mais (DoS colateral).
- **Causa raiz:** A decisão de UX foi tomada com uma premissa falsa sobre o que o atacante já sabe.
- **Correção sugerida:** Decisão do dono (§ H.4): manter a mensagem específica só para quem acabou de acertar a senha durante o bloqueio, ou responder com a mensagem genérica e tratar a orientação de 'espere' na tela depois de N falhas, sem depender da existência da conta. No mínimo, corrigir o comentário.
- **Teste de regressão:** autenticacao.test.ts: 6 tentativas contra e-mail inexistente e 6 contra conta ativa devem produzir mensagens iguais na 6ª (se o dono optar por isso).
- **Evidência do auditor:** autenticacao.ts:79-83 ramo inexistente/inativo sempre FALHA_DE_ENTRADA; :86-94 `Muitas tentativas. Esta conta volta a aceitar entrada em ${restante}s.` com comentário 'Só chega neste ponto quem já provou conhecer um e-mail válido'.
- **Verificação (1 de 1 confirmaram):** Segui o caminho real do código e o cenário acontece. POST /api/sessao chama `autenticar`. Nenhuma camada no meio troca a mensagem: `rota` devolve ao cliente a `message` do ErroDeNegocio, com status abaixo de 500.

Nos dois tipos de e-mail a sequência é esta:
- **E-mail inexistente, conta inativa ou sem senha:** o ramo das linhas 79-83 responde sempre `FALHA_DE_ENTRADA` e nunca incrementa contador nenhum.
- **Conta ativa:** cada erro incrementa `tentativasFalhas` (linha 107). Na 5ª falha, `segundosDeBloqueio(5)` passa a devolver 30 s, porque `TENTATIVAS_ANTES_DE_TRAVAR = 5` e `BLOQUEIO_BASE_SEGUNDOS = 30`, e o código grava `bloqueadoAte`. A 6ª tentativa cai na linha 91 e recebe "Muitas tentativas. Esta conta volta a aceitar entrada em Ns.".

A premissa do comentário (linhas 89-90) é falsa: o atacante não precisa saber antes que o e-mail é válido, é o próprio bloqueio que confirma isso.

Agravante que o achado não cita: o ramo de bloqueio responde sem chamar `esperarAtePisoDeEntrada`. O relógio também distingue a conta, e com isso a proteção dos 250 ms fica anulada nesse ponto.

A única defesa em outra camada é `limitarPorOrigem(requisicao, 'sessao:entrar', 20, 60)`. Ela só deixa a v […]

### C-19 — Tentativas contra e-mail inexistente, falhas na troca de senha e recusas por bloqueio não entram na trilha

**BAIXO** · registro/monitoramento · `src/servicos/autenticacao.ts:203` · dimensão `autenticacao-sessao`

- **Descrição:** Só a falha em conta ativa grava 'entrada_recusada'. O ramo de e-mail inexistente ou inativo (79-83), o ramo de conta bloqueada (86-94) e a senha atual errada em `trocarSenha` (203-218) não gravam nada. Nenhum alerta existe.
- **Vetor:** Pulverização de senhas contra e-mails inexistentes ou desativados (ex-colaboradores), ou alguém com cookie roubado adivinhando a senha atual em /api/sessao/senha: nada disso aparece na trilha nem na consulta de memória. Sobra só o contador em `Colaborador`, que é zerado.
- **Pré-condições:** Nenhuma.
- **Impacto:** Um ataque ativo não é detectado, e a investigação depois fica sem as tentativas contra contas desativadas, justamente as mais interessantes.
- **Causa raiz:** O registro está atrelado à existência de entidade para `entidadeId`.
- **Correção sugerida:** Gravar evento de falha de autenticação sem dado pessoal (hash do e-mail com BUSCA_SECRET ou só a contagem por janela) nos ramos silenciosos. Auditar 'troca_de_senha_recusada' e 'entrada_recusada_bloqueada'. Definir alerta por volume.
- **Teste de regressão:** autenticacao.test.ts: senha atual errada em trocarSenha gera uma linha de LogAuditoria com a ação de recusa, e tentativa com e-mail inexistente gera um EventoProcessamento sem o e-mail em claro.
- **Evidência do auditor:** autenticacao.ts:203-218 incrementa e lança sem `auditar`; :79-83 lança sem registrar; :91 lança sem registrar.
- **Verificação (1 de 1 confirmaram):** Segui o caminho real do código e o cenário se confirma. Em `autenticar`, o ramo de e-mail inexistente, inativo ou sem senha (linhas 79-83) e o ramo de conta bloqueada (86-94) lançam `ErroDeNegocio` sem chamar `auditar` nem `registrarEvento`. O único registro é o `auditar` de 'entrada_recusada', no ramo de senha errada em conta ativa. Em `trocarSenha`, a senha atual errada incrementa `tentativasFalhas`, pode gravar `bloqueadoAte` e lança sem auditar. O mesmo vale para a recusa por bloqueio nessa rota.

Nenhuma outra camada registra essas falhas. `rota()` em `src/servidor/http.ts` só registra log ou `EventoProcessamento` para `ErroOperacional` e para status >= 500. Um `ErroDeNegocio` (status < 500) passa direto por `responderErro`, sem registro. A rota POST /api/sessao só aplica `limitarPorOrigem` e não registra nada.

Resultado: pulverização de senhas contra contas desativadas ou inexistentes, e tentativas de adivinhar a senha atual com um cookie roubado, não deixam rastro em `LogAuditoria` nem em `EventoProcessamento`. Resta só o contador em `Colaborador`, que zera no próximo acerto.

Mantenho BAIXO pelos atenuantes:
- O bloqueio por conta e o limite por origem continuam funcionand […]

### C-20 — porCorrelacao contorna a lista fechada que tirou a trilha de Colaborador da consulta

**BAIXO** · autorizacao por objeto / vazamento lateral · `src/servicos/memoria.ts:233` · dimensão `api-autorizacao`

- **Descrição:** porEntidade recusa entidade='Colaborador' de propósito (ENTIDADES_CONSULTAVEIS), porque a trilha de uma pessoa 'carrega histórico de acesso'. porCorrelacao, porém, devolve todas as linhas de LogAuditoria da correlação, sem filtrar entidade. Há correlações que misturam linhas de Colaborador com entidades consultáveis. rodarLimpezaDiaria usa um correlacaoId para afastamento_motivo_expurgado (entidade Colaborador) e para conteudo_do_email_expurgado e dados_do_item_expurgados (Email e Item). definirAtivacao usa um só para acesso_desativado (Colaborador) e para os 'devolvido' dos itens.
- **Vetor:** Um operador chama GET /api/memoria?entidade=Item&id=<item expurgado> (ou entidade=Email), lê o correlacaoId da linha e chama GET /api/memoria?correlacao=<id>.
- **Pré-condições:** Papel operador ou gestor; existir limpeza diária que tenha expurgado motivo de afastamento no mesmo ciclo de algum e-mail ou item.
- **Impacto:** O operador recebe linhas da trilha de colegas que a correção anterior quis fechar. Ex.: afastamento_motivo_expurgado com colaboradorId, tipoQueFica ('ausente' indica que o motivo não era férias, ou seja, atestado, licença, falta ou outro), observacaoApagada e afastamentoId. Ou acesso_desativado com antes e depois. É inferência sobre ausência de saúde, com dado pouco granular.
- **Causa raiz:** A restrição por entidade foi aplicada em uma das duas portas de leitura da trilha.
- **Correção sugerida:** Aplicar o mesmo filtro em porCorrelacao: where: { correlacaoId, dominio, entidade: { in: [...ENTIDADES_CONSULTAVEIS] } } na tabela de auditoria.
- **Teste de regressão:** Rodar rodarLimpezaDiaria com um afastamento de atestado vencido e um e-mail vencido. porCorrelacao(operador) não deve conter nenhuma linha com entidade 'Colaborador'. Reverter o filtro e ver o teste falhar.
- **Evidência do auditor:** memoria.ts porCorrelacao: `banco.logAuditoria.findMany({ where: { correlacaoId, dominio } ...})` sem entidade; rotinas.ts:127-150 passa o mesmo correlacaoId a expurgarMotivosDeAfastamento, expurgarConteudoDosEmails e expurgarDadosDosItens; expurgo-lgpd.ts:114 `entidade: 'Colaborador'`.
- **Verificação (1 de 1 confirmaram):** Segui o caminho de ponta a ponta e o cenário acontece. Nenhuma camada impede a leitura.

1. A rota `GET /api/memoria` (`src/app/api/memoria/route.ts:32-35`) só exige um ator logado. Com `?correlacao=`, chama `porCorrelacao` direto.
2. `porCorrelacao` (`src/servicos/memoria.ts:215-247`) só confere o papel (operador ou gestor). A consulta usa `where: { correlacaoId, dominio }`, sem filtro de entidade. A lista fechada `ENTIDADES_CONSULTAVEIS` só vale em `porEntidade` (linha 265).
3. O primeiro passo do ataque é legítimo: `porEntidade('Item' | 'Email', id)` devolve o `correlacaoId` de cada linha (`daAuditoria`, linha 150).
4. A limpeza diária mistura entidades numa mesma correlação. `rodarLimpezaDiaria` (`src/servicos/rotinas.ts:127-156`) cria um único `correlacaoId` e o passa às três limpezas:
   - `expurgarMotivosDeAfastamento` grava `entidade: 'Colaborador'` e `afastamento_motivo_expurgado` (`expurgo-lgpd.ts:113-125`), com `afastamentoId`, `tipoQueFica`, `observacaoApagada` e `prazoEmDias` no campo `depois`.
   - `expurgarConteudoDosEmails` grava entidade `Email` (`expurgo-conteudo.ts:128-136`).
   - `expurgarDadosDosItens` grava entidade `Item` (`expurgo-dados-do-item.ts:201-215`). […]

### C-21 — GET /api/qualidade?dias=tudo lê todas as revisões resolvidas, para qualquer papel e sem limite de taxa

**BAIXO** · consumo excessivo · `src/servicos/qualidade.ts:123` · dimensão `api-autorizacao`

- **Descrição:** A rota exige só sessão. 'tudo' desliga o recorte, e medirQualidadeDaIa faz findMany sem take de todas as Revisao resolvidas (com sugestaoIa e valorFinal JSON), desserializando cada uma em memória. O teto de 1826 dias também cobre praticamente toda a vida do sistema.
- **Vetor:** Um colaborador dispara em paralelo muitas chamadas GET /api/qualidade?dias=tudo.
- **Pré-condições:** Qualquer sessão válida; o efeito cresce com o volume histórico.
- **Impacto:** Custo de CPU e memória que cresce com o tempo de vida do sistema (milhares de revisões por ano) e pode ser multiplicado por qualquer autenticado, degradando o servidor único.
- **Causa raiz:** Leitura analítica completa exposta como rota síncrona, sem papel nem limite.
- **Correção sugerida:** Limitar por pessoa (limitar) e/ou restringir 'tudo' a operador/gestor. Considerar agregação no banco em vez de carregar as linhas.
- **Teste de regressão:** 13ª chamada da mesma pessoa em 60 s recebe 429; colaborador com dias=tudo recebe a janela padrão ou 403, conforme a decisão.
- **Evidência do auditor:** qualidade/route.ts: `await exigirAtor()` sem exigirPapel/limitar; `if (pedido === 'tudo') return null`; qualidade.ts `banco.revisao.findMany({ where: {...}, select: {...} })` sem take.
- **Verificação (1 de 1 confirmaram):** Segui o caminho do código e o cenário se confirma. GET /api/qualidade só chama `exigirAtor()`: não há checagem de papel nem `limitar`. O middleware só aplica CSP e não limita taxa. Com `?dias=tudo`, `interpretarJanela` devolve null, e aí `medirQualidadeDaIa` fica sem `corte` e sem filtro de data. O `revisao.findMany` não tem `take` e traz `sugestaoIa`/`valorFinal` (JSON) de todas as revisões resolvidas. Em seguida, `lerMedida` processa cada linha em memória. Nenhuma outra camada impede o cenário.

Outras rotas caras têm limite por pessoa (busca, assistente, ingestão, distribuição), mas esta não tem. O próprio DECISOES (R-06) chama de defeito ler "a série inteira desde a fundação". A correção foi só na tela: a rota continua aceitando `tudo` de qualquer sessão.

A severidade continua BAIXO, pelos motivos abaixo:
- exige sessão válida;
- a rede é interna;
- o volume é modesto: milhares de revisões por ano, com JSON pequeno;
- são só três consultas por chamada, sem encadeamento com vazamento. A rota é agregada e não devolve dado pessoal (`resolvidoPor` fica de fora do select).

O efeito real é degradar o servidor único com muitas chamadas em paralelo, e ele cresce com o tempo de vida d […]

### C-22 — Resolução da mesma revisão por duas pessoas: a última sobrescreve em silêncio

**BAIXO** · concorrencia / integridade da trilha · `src/servicos/revisao.ts:148` · dimensão `api-autorizacao`

- **Descrição:** resolver confere `if (revisao.resolvidoEm)` numa leitura sem trava, e o tx.revisao.update seguinte não exige resolvidoEm: null. Duas resoluções simultâneas passam, e a segunda sobrescreve item (categoria, título, status), valorFinal, desfecho e resolvidoPor da primeira. (Itens extras de e-mail ficam protegidos pelo único (emailId, sequencia).)
- **Vetor:** Dois operadores abrem a fila de revisão e decidem o mesmo item ao mesmo tempo: um aprova em DOC_CADASTRO, o outro recusa. Ou um clique duplo com decisões diferentes em abas distintas.
- **Pré-condições:** Papel operador ou gestor; duas resoluções concorrentes.
- **Impacto:** A trilha fica com revisao_aprovada e revisao_recusada para o mesmo item, sem indicar qual valeu. O estado final é o da transação que gravou por último, não o de quem decidiu primeiro. A medida de acerto da IA (A23(c)) fica com a decisão sobrescrita.
- **Causa raiz:** Conferência 'já resolvida' feita fora da escrita.
- **Correção sugerida:** Usar updateMany({ where: { id: dados.revisaoId, resolvidoEm: null }, data }) como PRIMEIRA escrita da transação e abortar com ErroDeNegocio se count !== 1.
- **Teste de regressão:** Promise.all de duas chamadas resolver com decisões opostas: exatamente uma resolve e a outra recebe 'já foi resolvida'. A trilha tem uma só linha revisao_*.
- **Evidência do auditor:** revisao.ts:148 `if (revisao.resolvidoEm) throw ...` seguido de `tx.revisao.update({ where: { id: dados.revisaoId }, ...})` sem condição.
- **Verificação (1 de 1 confirmaram):** Não consegui refutar: o cenário acontece. A "linha 148" do achado está um pouco deslocada; a conferência real fica na linha 150 de `src/servicos/revisao.ts`. O caminho é este: a rota `src/app/api/revisao/resolver/route.ts:15` chama `resolver()`, que abre `banco.$transaction`. Essa transação não define `isolationLevel`, e não há `isolationLevel`, `Serializable` nem `FOR UPDATE` em nenhum lugar de `src/`. O banco é MySQL (`prisma/schema.prisma:41`), então vale o padrão do InnoDB, REPEATABLE READ.

Nesse modo, o `findUnique` da linha 144 é uma leitura de retrato e não trava nada. As duas transações veem `resolvidoEm = null` e passam pela linha 150. O `tx.item.update` (linha 187) da primeira trava a linha do item. A segunda espera essa trava e, quando a primeira grava, segue normalmente: no MySQL em REPEATABLE READ, um UPDATE lê a versão atual da linha e não dá erro de serialização. Em seguida, `tx.revisao.update` (linha 207) usa só `{ id }`, sem `resolvidoEm: null`, e sobrescreve `valorFinal`, o acerto da IA, `resolvidoPor` e `resolvidoEm`. O item também fica com a categoria, o título, o status e o `canceladoEm` da segunda transação.

`auditar` grava uma segunda linha (`revisao_aprova […]

### C-23 — Resolver revisão aceita categoria inativa, e o item aprovado some da distribuição e do painel

**BAIXO** · autorizacao por campo / validacao no servidor · `src/servicos/revisao.ts:152` · dimensão `api-autorizacao` (também: negocio-concorrencia)

- **Descrição:** resolver busca a categoria só pelo código e não confere `ativa`, ao contrário de registrarManual (itens.ts conferirDestino), que recusa categoria inativa com mensagem. carregarCategorias (distribuicao.ts:762) só planeja `ativa: true`, e porCategoria (painel.ts) só lista categorias ativas.
- **Vetor:** Um operador chama POST /api/revisao/resolver direto, com categoriaCodigo de uma categoria da lista classificável que foi desativada no banco (a tela só oferece as ativas via /api/categorias).
- **Pré-condições:** Papel operador ou gestor; existir categoria classificável inativa.
- **Impacto:** O item fica 'aprovado' numa categoria que nenhuma rodada recolhe e que o painel não mostra. O pedido do associado para de andar sem erro nem aviso.
- **Causa raiz:** A validação de 'categoria utilizável' existe num caminho de criação e falta no outro.
- **Correção sugerida:** Selecionar `ativa` e recusar com ErroDeNegocio quando falsa, como em conferirDestino.
- **Teste de regressão:** Desativar LIGANTE em sbp_teste e resolver uma revisão com categoriaCodigo LIGANTE: deve responder 422 e a revisão continuar pendente.
- **Evidência do auditor:** revisao.ts:152 `tx.categoria.findUnique({ where: { codigo: dados.categoriaCodigo }, select: { id: true } })` sem `ativa`.
- **Verificação (1 de 1 confirmaram):** O cenário acontece, mas só em condições bem limitadas. Segui o caminho de `resolver()` em src/servicos/revisao.ts. A função faz três checagens: o papel (operador ou gestor), o formato dos dados pelo Zod e se a categoria existe. Ela não confere se a categoria está ativa. O Zod também não barra: `ResolucaoRevisaoSchema.categoriaCodigo` usa `CategoriaClassificavelSchema`, que só olha se o código está na lista classificável, não o campo `ativa` no banco. Nenhuma camada impede o update: nem transação, nem constraint, nem middleware. Com isso o item fica com status 'aprovado' e com o id da categoria inativa.

O efeito descrito se confirma. `carregarCategorias` (distribuicao.ts:757-768) só planeja categorias com `ativa: true` e `entraNoRateio: true`. O painel (painel.ts:93 e 260) também filtra por `ativa: true`. O item então nunca é distribuído e não aparece no painel, sem erro nem aviso. Isso fere o invariante 7 (falhar alto). O outro caminho de criação, `conferirDestino` (itens.ts:59-64), recusa categoria inativa, então há inconsistência entre os dois.

A severidade fica BAIXO por dois motivos. Primeiro, nenhum código do sistema desativa categoria: não há `categoria.update`, `create` ne […]

### C-24 — Recusas de autorização (403/401/422) não deixam rastro em lugar nenhum

**BAIXO** · registro e monitoramento · `src/servidor/http.ts:92` · dimensão `api-autorizacao` (também: falhas-silenciosas)

- **Descrição:** Em rota(), todo erro com status < 500 (PermissaoNegadaError, SemSessaoError, ErroDeNegocio como 'Só o responsável ativo pode concluir') vira resposta sem registrarLog, sem registrarEvento e sem auditar. O roteiro (§17) pede que falha de autorização chegue à trilha.
- **Vetor:** Um colaborador varre as rotas administrativas (POST /api/colaboradores/senha, /ativacao, GET /api/rodadas/<id>, /api/memoria) ou testa ids de itens alheios em /api/itens/<id>/concluir, milhares de vezes.
- **Pré-condições:** Qualquer sessão válida.
- **Impacto:** A sondagem de escalada vertical ou horizontal fica invisível: não há linha em stdout, EventoProcessamento ou LogAuditoria, então ninguém consegue investigar nem gerar alerta depois.
- **Causa raiz:** O ramo de erros esperados foi desenhado para não poluir o log, e não separa 'erro do usuário' de 'tentativa negada'.
- **Correção sugerida:** Registrar ao menos PermissaoNegadaError (quem, papel, operação e caminho; nunca o corpo) com registrarLog e, de preferência, um EventoProcessamento de etapa 'autorizacao'.
- **Teste de regressão:** Chamar GET /api/colaboradores como colaborador e conferir que um registro de negação foi emitido com colaboradorId e operação, sem dado do corpo.
- **Evidência do auditor:** http.ts:92-95 `if (status !== null && status < 500) { ... return responderErro(mensagem, status) }` sem log.
- **Verificação (1 de 1 confirmaram):** Segui o caminho de ponta a ponta e o cenário acontece. Nas rotas administrativas (por exemplo GET /api/colaboradores), a checagem de permissão é `exigirPapel(ator, 'listar colaboradores', 'gestor')`. Quando o papel não é o permitido, `exigirPapel` (src/servidor/ator.ts:81-84) apenas lança `PermissaoNegadaError`, sem registrar nada. O erro sobe até `rota()`.

Em `rota()`, `statusDoErro` converte o erro em código de resposta: `PermissaoNegadaError` e `SenhaProvisoriaError` viram 403, `SemSessaoError` vira 401 e `ErroDominio` vira 422. O ramo `status < 500` (src/servidor/http.ts:101-104 nesta árvore; o achado cita 92, que hoje é o ramo de `ErroOperacional`) só monta a resposta e a devolve. Esse ramo não chama `registrarLog` nem `registrarEvento`. Só grava log o ramo de `ErroOperacional` e o dos erros 500.

O caso "Só o responsável ativo pode concluir" (src/servicos/fila.ts:136) também é um `ErroDeNegocio` lançado sem registro. Ele termina como 422 no mesmo ramo mudo.

Procurei outra camada que registrasse a recusa e não encontrei. O único middleware (src/middleware.ts) só aplica a política de segurança de conteúdo (CSP com nonce) e não registra nada. No diretório src/servidor, `regist […]

### C-25 — Com ANEXOS_SECRET vazio (padrão do .env.example), um único segredo forja sessão e decifra os anexos, e rotacioná-lo depois de um vazamento quebra os documentos

**INFORMATIVO** · segredos/acoplamento · `src/adapters/armazenamento-disco.ts:124` · dimensão `autenticacao-sessao`

- **Descrição:** Decisão registrada (AT-13). O efeito de segurança é que a resposta normal a um vazamento de SESSAO_SECRET (rotacionar) fica desencorajada, e o vazamento já entrega os documentos cifrados. Não há rotação com duas chaves (kid) para a sessão.
- **Vetor:** Vazamento do `.env` em que só SESSAO_SECRET está definido: o atacante monta um cookie de gestor válido e decifra os arquivos de `ARMAZENAMENTO_DIR`.
- **Pré-condições:** Vazamento do segredo e instalação sem ANEXOS_SECRET.
- **Impacto:** Os dois ativos caem juntos, e a rotação fica cara.
- **Causa raiz:** O fallback foi criado por compatibilidade.
- **Correção sugerida:** Tornar ANEXOS_SECRET obrigatório antes de haver dado real. Aceitar SESSAO_SECRET_ANTERIOR para rotação sem derrubar todo mundo.
- **Teste de regressão:** ambiente.test.ts: NODE_ENV=production sem ANEXOS_SECRET recusa subir.
- **Evidência do auditor:** armazenamento-disco.ts:124 `segredo = ambiente().ANEXOS_SECRET ?? ambiente().SESSAO_SECRET`.
- **Verificação (1 de 1 confirmaram):** O achado se confirma. Com ANEXOS_SECRET vazio ou comentado, a chave AES-256-GCM dos anexos é derivada de SESSAO_SECRET, e o mesmo SESSAO_SECRET é a única entrada do HMAC que assina o cookie. Não há rotação com duas chaves: o cookie é conferido só contra o segredo atual. O `.env.example` entrega ANEXOS_SECRET comentado, então esse é o caminho padrão de uma instalação nova.

Três ressalvas reduzem o cenário, e por isso a severidade fica em INFORMATIVO:
1. É a decisão AT-13, registrada, e o código a cumpre como escrita. O status dela ("a queda sai quando houver rotina de recifragem") continua pendente, então não há contradição entre decisão e código.
2. "Rotacionar quebra os documentos" está exagerado. Desde 10/09 a sentinela (`conferirChave`) faz a troca de chave falhar antes de gravar ou ler qualquer anexo, com mensagem que manda fixar ANEXOS_SECRET com o valor antigo. Rotacionar a sessão fixando antes ANEXOS_SECRET=valor antigo é barato e está documentado. O custo real é outro: depois de um vazamento, o valor antigo está comprometido e continua sendo a chave dos anexos. `scripts/recifrar-anexos.ts` só regrava anexos legados em texto puro; não troca a chave de anexos já cifrados. Nã […]

### C-26 — O limite de confirmação usa a data enviada no corpo e muda de balde a cada data

**INFORMATIVO** · limite de taxa · `src/app/api/distribuicao/confirmar/route.ts:38` · dimensão `api-autorizacao`

- **Descrição:** A chave é `distribuir:${colaboradorId}:${pedido.data}`. Variar a data (qualquer AAAA-MM-DD válida, passada ou futura) abre um balde novo. Cada chamada grava EventoProcessamento 'iniciado' e faz upsert em TravaDeDistribuicao para aquela data, mesmo sem nada a distribuir.
- **Vetor:** Um operador ou script itera datas em POST /api/distribuicao/confirmar.
- **Pré-condições:** Papel operador ou gestor.
- **Impacto:** O limite deixa de conter volume, e surgem linhas de trava e evento sem teto (evento é memória sem expurgo). O comentário da rota só promete conter o clique repetido, que continua contido.
- **Causa raiz:** A chave do limite inclui um campo controlado pelo cliente.
- **Correção sugerida:** Somar um balde por pessoa sem a data (ex.: 30/min) e, se fizer sentido para a operação, recusar datas futuras.
- **Teste de regressão:** 31 confirmações da mesma pessoa com datas distintas em 60 s: a 31ª recebe 429.
- **Evidência do auditor:** `limitar(`distribuir:${ator.colaboradorId}:${pedido.data}`, 10, 60)`; distribuicao.ts confirmar: registrarEvento + travaDeDistribuicao.upsert antes de saber se há o que distribuir.
- **Verificação (1 de 1 confirmaram):** O cenário acontece. A rota POST /api/distribuicao/confirmar valida o corpo com PedidoDistribuicaoSchema. O campo data usa DataIsoSchema, que só confere o formato AAAA-MM-DD e se a data existe no calendário. Não há limite de passado nem de futuro. Depois disso a rota chama limitar(`distribuir:${ator.colaboradorId}:${pedido.data}`, 10, 60), então cada data nova abre um balde novo com mais 10 chamadas por minuto. src/middleware.ts não tem outro limite de taxa, e limitar() só olha a chave que recebe. Em confirmar(), exigirPapel exige operador ou gestor. Depois disso, registrarEvento('iniciado') roda fora da transação, e o upsert em TravaDeDistribuicao roda antes de planejar. Assim, toda chamada autorizada grava uma trava (uma linha por data, com execucoes somado) e dois eventos ('iniciado' e o final), mesmo sem item a distribuir. Nenhuma camada impede isso. Ajustes: (1) a linha certa é 20, não 38. (2) Os eventos crescem sem teto mesmo com a data fixa (10 por minuto, sem parar). Variar a data só multiplica essa vazão, e as travas ficam limitadas ao número de datas válidas. (3) A promessa do comentário da rota, conter o clique repetido, continua valendo. É preciso estar logado como opera […]

### C-27 — Injeção que escapa dos dois detectores some com o trabalho ou passa aprovada; a lista de A34 ainda não existe

**INFORMATIVO** · ia / confianca-excessiva · `src/servicos/ingestao.ts:172` · dimensão `ia-conteudo-externo`

- **Descrição:** Risco residual do desenho, registrado para a conclusão. (a) Se uma paráfrase escapa da regex e o modelo também não levanta pareceInstrucao, a aprovação automática depende só da `confianca` que o próprio modelo declara (decidirRevisao). O item vai para a distribuição, possivelmente com a categoria errada. (b) Se o modelo devolve zero itens sem suspeita, o e-mail só entra numa contagem e o conteúdo sai em 7 dias (A20). (c) A lista de A34 para e-mails suspeitos sem item ainda não existe (AT-24 aponta para a fase 4). O próprio comentário na linha 165 ainda fala em 'decisão do dono (§ C)', mas A34 já respondeu.
- **Vetor:** Um e-mail com uma instrução parafraseada que não casa com PADROES_INJECAO e convence o modelo.
- **Pré-condições:** Modelo real. Remetente anônimo.
- **Impacto:** No máximo uma classificação errada ou um pedido que desaparece da fila, sem ninguém ver na hora. O invariante 2 limita o estrago: quem distribui continua sendo o algoritmo.
- **Causa raiz:** Decisões registradas (A34, AT-24) com a implementação ainda por fazer. A confiança vem do próprio modelo atacado.
- **Correção sugerida:** Entregar a lista de A34 e atualizar o comentário. Pensar em calibrar os limiares pela taxa de acerto medida (A30), e não pela confiança declarada.
- **Teste de regressão:** Depois de A34: uma IA falsa devolvendo itens=[] e conteudoSuspeito=true faz o e-mail aparecer na lista de Revisão para operador e gestor, e não para colaborador.
- **Evidência do auditor:** ingestao.ts:165 `a decisão de criar uma fila para estes casos é do dono do processo (DECISOES.md § C)`; DECISOES.md A34 e AT-24 (fase 4)
- **Verificação (1 de 1 confirmaram):** Segui o caminho no código e os três pontos do achado se confirmam. Nenhuma outra camada fecha esses caminhos, e eles decorrem de decisões registradas cuja implementação está incompleta.

(a) Aprovação automática com um só item. O sinal de suspeita é a regex OU `pareceInstrucao`, e ele vem do próprio modelo. Quando os dois são falsos e o e-mail gera um único item, sem anexo rejeitado e sem campo ausente, sobra só a confiança declarada pelo modelo. Se ela for maior ou igual ao limiar, `decidirRevisao` devolve null e o item passa aprovado. O desdobramento (mais de um item) sempre vai para revisão, então o caminho vale só para um item. Nenhuma checagem posterior revalida a categoria; o motor apenas distribui (invariante 2).

(b) Zero itens sem suspeita. O e-mail só incrementa `emailsSemItem` e gera um evento de falha. Pela `retencao.ts`, o prazo de expurgo passa a correr a partir do dia do recebimento. Isso é o que A20 e A34 mandam para resposta automática, mas uma injeção que escape das duas detecções segue o mesmo caminho.

(c) A lista de A34 não existe no código. Enquanto ela não chega, a mitigação de AT-24 funciona: `retencao.ts:145` devolve null para e-mail suspeito sem item, e el […]

## 5. Detalhe dos não verificados

### N-01 — A suíte de testes apaga e recria QUALQUER base que estiver em DATABASE_URL, sem conferir se é a base de teste

**ALTO** · perda-de-dados / configuracao · `src/testes/preparar-banco.ts:45` · dimensão `mysql-dados`

- **Descrição:** O globalSetup pega `process.env['DATABASE_URL'] ?? PADRAO_LOCAL` e roda `npx prisma migrate reset --force`. Ele só confere se o endereço começa com `mysql://`. Não confere o nome da base (`sbp_teste`) nem o host. Pior: a variável `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` vem preenchida no código, e com isso a trava que o próprio Prisma tem contra reset feito por agente fica desligada sempre. Depois, cada arquivo de teste chama `limparTudo` (src/testes/apoio.ts:26), que apaga LogAuditoria, Colaborador e o resto das tabelas pela mesma URL. O vitest.config.ts dá preferência de propósito à URL que já está no ambiente.
- **Vetor:** Operador ou agente roda `npm run verificar` / `npm test` num shell em que DATABASE_URL já aponta para outra base. Três casos: (a) `infisical run -- npm run verificar`, já que o plano do commit 06d8482 é o Infisical injetar DATABASE_URL no processo; (b) o servidor da associação com DATABASE_URL exportada no systemd ou no perfil; (c) o comando que o ESTADO.md ensina, `DATABASE_URL="mysql://.../sbp_teste" npm run verificar`, digitado com `/sbp` no lugar de `/sbp_teste`.
- **Pré-condições:** Acesso de shell a uma máquina com DATABASE_URL de outra base no ambiente. Não exige privilégio na aplicação.
- **Impacto:** O schema inteiro da base de desenvolvimento ou de produção é derrubado e recriado vazio: itens, atribuições, livro-razão de carga e a trilha append-only. Os invariantes 3, 11 e 14 somem de uma vez, e só volta o que houver em backup.
- **Causa raiz:** Uma operação destrutiva confia numa variável de ambiente que tem outros usos legítimos. O consentimento do Prisma virou constante no código.
- **Correção sugerida:** Antes do reset, extrair o nome da base da URL e recusar se não terminar em `_teste`, e recusar também host fora de uma lista (127.0.0.1/localhost, ou CI=true). Tirar a constante de consentimento e exigir uma variável própria (ex.: `SBP_BASE_DESCARTAVEL=sim`), definida no ci.yml e no vitest.config.ts. Pôr a mesma checagem em `limparTudo`, lendo `SELECT DATABASE()`, como segunda barreira.
- **Teste de regressão:** Teste unitário de `setup()` com DATABASE_URL=mysql://root@127.0.0.1:3307/sbp e `execSync` substituído por dublê: deve lançar erro sem chamar o dublê. Com `/sbp_teste`: deve chamar. Reverter a checagem e ver o teste falhar.
- **Evidência do auditor:** const url = process.env['DATABASE_URL'] ?? PADRAO_LOCAL ... if (!url.startsWith('mysql://')) ... execSync('npx prisma migrate reset --force', { env: { ...process.env, DATABASE_URL: url, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'base de teste descartavel, ...' } })

### N-02 — Anexo do Graph que não é arquivo (e-mail encaminhado como anexo, link do OneDrive) é descartado sem metadado, recusa ou log

**MÉDIO** · falha-silenciosa/perda-de-dado · `src/adapters/ingestao-graph.ts:330` · dimensão `falhas-silenciosas`

- **Descrição:** listarAnexos filtra `anexo.contentBytes !== undefined`. No Graph, itemAttachment (o 'Encaminhar como anexo' do Outlook) e referenceAttachment não têm contentBytes, então somem da lista. Não viram linha de Anexo, não entram em anexosRejeitados, não mandam o item para revisão e não geram log. O tipo AnexoDoGraph declara `contentBytes: string | null`, e o comentário diz 'Ausente em anexo que não é arquivo', ou seja, o descarte é conhecido, mas não é sinalizado. O resto do adapter faz o contrário: anexo grande entra com metadado e é recusado com motivo, para que 'uma pessoa fique sabendo'.
- **Vetor:** Associado ou colega encaminha um e-mail como anexo, ou manda um documento como link de nuvem anexado.
- **Pré-condições:** INGESTAO_ADAPTER=graph.
- **Impacto:** O item nasce só com o corpo do e-mail externo, e o pedido real, que estava no e-mail anexado, desaparece sem ninguém saber que existia.
- **Causa raiz:** Um filtro trata 'não sei baixar' como 'não existe'.
- **Correção sugerida:** Manter o metadado (nome, tipo, tamanho) de todo anexo, com conteudo ausente, para que validarAnexo e a ingestão o recusem com motivo e o item vá para revisão. Registrar em log o @odata.type descartado.
- **Teste de regressão:** ClienteDoGraph falso cuja listarAnexos devolve um anexo sem contentBytes: a ingestão precisa gravar Anexo com aceito=false e o item precisa ir para revisão.
- **Evidência do auditor:** ingestao-graph.ts:329-331 `.filter((anexo) => anexo.contentBytes !== undefined)`; ingestao-graph.ts:68 `/** ... Ausente em anexo que não é arquivo. */ contentBytes: string | null`

### N-03 — Caixa no celular esconde o remetente, a liga e o aviso de "texto apagado pelo prazo, original no Outlook"

**MÉDIO** · celular/informacao · `src/app/caixa/page.tsx:573` · dimensão `telas-frontend`

- **Descrição:** A coluna 'titulo' tem ocultarNoCartao: true, e tituloDoCartao devolve só item.titulo. Tudo o que essa coluna desenha fica fora do cartão do celular: o remetente, o botão da liga (que filtra a caixa) e a frase de textoDoConteudoRemovido, que diz que o original está no Outlook e quando chegou. As outras colunas não repetem essa informação.
- **Vetor:** Qualquer pessoa abre a Caixa, ou faz a busca por CPF, em tela com menos de 48rem (celular).
- **Pré-condições:** Tela estreita (useTelaLarga falso).
- **Impacto:** No celular não se sabe quem mandou o pedido nem de que liga ele é. Um item com texto já expurgado não diz onde achar o original, e a decisão A20 (a pessoa precisa saber que o original está no Outlook) deixa de valer no celular. O resultado da busca por CPF fica só com título e situação.
- **Causa raiz:** ocultarNoCartao foi pensado para não repetir o título, mas a célula carrega mais que o título, e o tituloDoCartao não reproduz o resto.
- **Correção sugerida:** Fazer o tituloDoCartao devolver o mesmo bloco da célula (título + remetente/aviso de expurgo + liga), extraindo-o para um componente usado nos dois lugares.
- **Teste de regressão:** Teste de componente com matchMedia falso (tela estreita): o cartão de um item com conteudoRemovidoEm mostra o texto de textoDoConteudoRemovido, e o de um item com remetente mostra o remetente.
- **Evidência do auditor:** chave: 'titulo', cabecalho: 'Item', ocultarNoCartao: true, conteudo: (item) => (... item.remetente ... textoDoConteudoRemovido ... item.ligaNome ...) ; tituloDoCartao={(item) => item.titulo}

### N-04 — "Concluir" na Minha fila: um toque, sem confirmação e sem desfazer, com botão de 36 px no celular

**MÉDIO** · logica-de-negocio/tela · `src/app/fila/page.tsx:225` · dimensão `telas-frontend`

- **Descrição:** O botão Concluir chama POST /itens/{id}/concluir no primeiro toque. O serviço grava Execucao e status 'concluido' e não existe rota, serviço ou tela para reabrir o item (git grep por 'reabrir' não acha nada). O item sai da lista na hora. O botão é Botao tamanho="pequeno" (min-h-9, 36 px, sem o reforço de 44 px no celular) e fica colado ao "Não é comigo". A tela de Revisão pede dois cliques em Descartar justamente porque 'não existe caminho de volta'. Concluir tem a mesma irreversibilidade e não tem a trava.
- **Vetor:** Colaboradora abre a Minha fila no celular (a tela foi feita para isso), mira em "Não é comigo" e toca em "Concluir" ao lado.
- **Pré-condições:** Sessão de colaborador com item na fila.
- **Impacto:** Um pedido de associado não atendido é dado como concluído e some de todas as filas (minhaFila só lista distribuido/em_andamento). O painel conta uma conclusão que não aconteceu. O relógio de retenção começa, e o texto do e-mail é apagado quando o prazo vence. Ninguém recebe aviso: é a falha silenciosa do invariante 7.
- **Causa raiz:** A confirmação em dois passos foi aplicada a Descartar (Revisão), Não aconteceu, Nova senha e encurtar prazo, mas não à ação irreversível mais frequente do sistema. A variante pequena do Botao não aumenta o alvo no celular.
- **Correção sugerida:** Aplicar o mesmo padrão de dois toques ("Confirmar: concluir") ou oferecer "Desfazer" por alguns segundos antes do POST. Dar ao Botao pequeno min-h-11 abaixo de sm, como já fazem os outros controles.
- **Teste de regressão:** Teste de componente: um clique em Concluir não chama api.enviar('/itens/x/concluir'). O segundo clique chama. Reverter a trava e ver o teste falhar.
- **Evidência do auditor:** <Botao variante="principal" tamanho="pequeno" onClick={() => concluir(item)} ...> (fila/page.tsx:225-234); servicos/fila.ts:140-150 cria Execucao e marca 'concluido' sem caminho inverso

### N-05 — Lista "Transferir para" inclui a própria pessoa e quem está afastado, e transferir para si mesma some com o item da tela sem aviso

**MÉDIO** · falha-silenciosa · `src/app/fila/page.tsx:276` · dimensão `telas-frontend`

- **Descrição:** A lista vem de /escala e é exibida inteira, sem tirar a própria pessoa e sem mostrar o campo 'afastamento' que a resposta já traz. Quando o destino é a própria pessoa, servicos/fila.ts:219 faz `if (atual.colaboradorId === entrada.paraColaboradorId) return` e a rota responde sucesso. A tela então remove o item da lista e fecha o formulário, como se a transferência tivesse acontecido. A data da escala também sai em UTC (`new Date().toISOString().slice(0,10)`, linha 103), diferente do hojeIso() que a Caixa e a Distribuição usam. Depois das 21h de Brasília, a lista mostra a escala e os afastamentos de amanhã.
- **Vetor:** (1) A colaboradora escolhe o próprio nome, que aparece na lista em ordem alfabética, e clica em Transferir. (2) Ela transfere para uma colega de férias, que aparece sem nenhuma marca. (3) Às 21h30 a tela consulta a escala do dia seguinte.
- **Pré-condições:** Colaborador com item na fila e pelo menos uma habilitação (senão não aparece na escala).
- **Impacto:** (1) A pessoa acha que passou o item adiante: ele some da tela, mas continua na fila dela, e ninguém o trata até ela recarregar a página. (2) O item fica parado na fila de quem está fora, justo o defeito que A10 existe para evitar na distribuição. (3) Os afastamentos mostrados podem ser os de outro dia.
- **Causa raiz:** O serviço trata auto-transferência como operação vazia, e a tela interpreta sucesso como 'saiu de mim'. A tela descarta 'afastamento' e 'disponivel' da escala. A data é calculada por um caminho diferente do hojeIso().
- **Correção sugerida:** Filtrar da lista o próprio colaboradorId (o id vem de /sessao) e marcar ou desabilitar quem tem afastamento. No servidor, recusar a auto-transferência com ErroDeNegocio em linguagem simples, em vez de `return`. Trocar a linha 103 por hojeIso().
- **Teste de regressão:** Serviço: transferir para si mesmo lança erro. Tela: o próprio nome não aparece nas opções, e uma pessoa com afastamento aparece marcada. Unitário: com o relógio fixo em 23h BRT, a data pedida à escala é a de hoje.
- **Evidência do auditor:** const hoje = new Date().toISOString().slice(0, 10) (fila:103); {equipe.map((pessoa) => (<option ...>{pessoa.nome}</option>))} (fila:276); if (atual.colaboradorId === entrada.paraColaboradorId) return (servicos/fila.ts:219)

### N-06 — Painel "Por pessoa" ignora o período escolhido e não avisa

**MÉDIO** · metrica-enganosa · `src/app/painel/page.tsx:489` · dimensão `telas-frontend`

- **Descrição:** O painel tem campos de período no topo, e as métricas por categoria os obedecem. A rota, porém, chama porPessoa(banco, ator) sem período (api/painel/route.ts:34): 'concluidos' conta todas as execuções desde sempre, e 'atribuidos'/'pendentes' são o estado de agora. A seção só diz 'Cada pessoa vê os próprios números...', sem avisar que o período não vale para ela. A lista ainda filtra atribuidos > 0, então quem não tem nada em aberto hoje some da tabela, por mais que tenha concluído.
- **Vetor:** A gestora escolhe 01/03 a 31/03 para comparar com a planilha e lê a coluna Concluídos de cada pessoa.
- **Pré-condições:** Qualquer papel. O efeito aparece ao escolher um período diferente do corrente.
- **Impacto:** A comparação lado a lado com a planilha, que é o critério do projeto, sai errada por pessoa, e alguém pode ser mal avaliado por números de outro período (invariante 10). Uma colaboradora que concluiu tudo e não tem nada em aberto não vê a própria linha.
- **Causa raiz:** porPessoa não recebe Periodo, e a tela não separa 'estado atual' de 'do período', como já faz nas colunas de categoria.
- **Correção sugerida:** Passar o período a porPessoa para os números de período, ou rotular explicitamente a seção ('desde o início / hoje'). Trocar o filtro para mostrar também quem tem concluídos, e sempre a linha da própria pessoa quando o papel é colaborador.
- **Teste de regressão:** Serviço: com execuções em fevereiro e março, porPessoa com o período de março conta só as de março. Tela: o rótulo da seção cita o período ou 'desde o início'.
- **Evidência do auditor:** porPessoa(banco, ator) (api/painel/route.ts:34) vs porCategoria(banco, periodo); linhas={dados.pessoas.filter((pessoa) => pessoa.atribuidos > 0)} (painel:493)

### N-07 — A trava do último gestor ativo não segura no MySQL: dois gestores podem desativar um ao outro ao mesmo tempo

**MÉDIO** · concorrencia / controle-de-acesso · `src/servicos/autenticacao.ts:409` · dimensão `mysql-dados`

- **Descrição:** A contagem `tx.colaborador.count({ papel: 'gestor', ativo: true, id: { not } })` é uma leitura sem trava. No InnoDB com REPEATABLE READ ela lê uma foto do banco e não bloqueia a escrita da outra transação. O próprio comentário diz que a garantia vinha do SQLite (um escritor por vez) e que ficava "registrado para a migração". O DECISOES § AT-28 item 4 manda usar `SELECT ... FOR UPDATE`, e o código não usa. Além disso, `colaborador.ativo` e `papel` são lidos fora da transação (linha 372).
- **Vetor:** Com exatamente dois gestores ativos, A desativa B e B desativa A em requisições simultâneas. Cada transação conta um gestor além do alvo, e as duas gravam.
- **Pré-condições:** Dois gestores autenticados agindo ao mesmo tempo, ou uma conta de gestor comprometida disparando as duas requisições.
- **Impacto:** Zero gestores ativos. Ninguém consegue cadastrar senha, destravar conta nem reativar acesso, e a recuperação só sai mexendo no banco na mão, que é exatamente o que a trava existe para evitar.
- **Causa raiz:** Uma premissa de isolamento do SQLite ficou no código depois da troca para MySQL (A42).
- **Correção sugerida:** Dentro da transação, travar as linhas de gestor antes de contar (`$queryRaw` com `SELECT id FROM Colaborador WHERE papel='gestor' AND ativo=1 FOR UPDATE`) ou usar isolamento Serializable nessa transação. Reler o alvo dentro da transação.
- **Teste de regressão:** Teste de integração em MySQL com dois gestores: `Promise.all([definirAtivacao(A→B), definirAtivacao(B→A)])`. Exatamente uma deve falhar e deve sobrar ≥1 gestor ativo. Rodar sem a correção e ver os dois passarem.
- **Evidência do auditor:** autenticacao.ts:404 "o SQLite admite um escritor por vez. Em PostgreSQL com READ COMMITTED isto sozinho não basta ... fica registrado para a migração"; DECISOES AT-28 item 4 "com SELECT ... FOR UPDATE"

### N-08 — Redefinição e troca de senha e destravamento gravam o fato e a trilha em escritas separadas; falha entre as duas deixa a mudança sem registro

**MÉDIO** · escrita-parcial/auditoria · `src/servicos/autenticacao.ts:288` · dimensão `falhas-silenciosas`

- **Descrição:** definirSenhaProvisoria (288 e 299), trocarSenha (227 e 239) e destravarConta (336 e 341) fazem colaborador.update e depois auditar(banco, ...) fora de transação. Se a gravação da auditoria falhar (conexão caída, timeout do pool, deadlock), a senha já mudou e a trilha não tem 'senha_redefinida_pelo_gestor'. É justamente o registro que DECISOES.md:1541 usa para dizer que a tomada de conta por um gestor 'fica reconstruível'. Em definirSenhaProvisoria, a rota ainda devolve 500 e o gestor nunca recebe a senha sorteada: a conta da pessoa fica com um hash que ninguém conhece e as sessões dela são derrubadas. Vizinho: em trocarSenha, a senha atual errada incrementa o contador, mas não gera 'entrada_recusada', ao contrário do login.
- **Vetor:** Falha transitória de banco entre as duas escritas. Não é disparável de forma confiável por um atacante, mas acontece em operação.
- **Pré-condições:** Instabilidade do MySQL. Papel gestor para a redefinição.
- **Impacto:** Mudança de credencial sem rastro, contrariando o invariante 14 ('gravado na mesma Transacao do fato, ou não é gravado'), e pessoa trancada fora sem que ninguém saiba a senha nova.
- **Causa raiz:** Os fluxos de autenticação foram escritos com o cliente raiz do Prisma, e não com $transaction, ao contrário de definirAtivacao no mesmo arquivo.
- **Correção sugerida:** Envolver update e auditar em banco.$transaction em definirSenhaProvisoria, trocarSenha, destravarConta e no ramo de sucesso e de falha de autenticar. Auditar a tentativa errada de senha atual em trocarSenha.
- **Teste de regressão:** Com banco-que-anota (src/testes/banco-que-anota.ts) fazendo logAuditoria.create lançar: depois de definirSenhaProvisoria rejeitar, senhaHash e senhaDefinidaEm precisam estar inalterados.
- **Evidência do auditor:** autenticacao.ts:288 `await banco.colaborador.update({ ... senhaHash: await gerarHash(senhaProvisoria), senhaDefinidaEm: new Date() ...` seguido de autenticacao.ts:299 `await auditar(banco, { ... acao: ... 'senha_redefinida_pelo_gestor' ...`

### N-09 — No InnoDB, a TravaDeDistribuicao serializa a escrita mas não a leitura: a segunda confirmação pode calcular com crédito antigo

**MÉDIO** · concorrencia / logica-de-negocio · `src/servicos/distribuicao.ts:399` · dimensão `mysql-dados`

- **Descrição:** O schema (linhas 416-426) diz que a trava existe para que duas confirmações do mesmo dia não leiam o crédito global uma da outra ainda não gravado. No MySQL, até onde consta na documentação do Prisma, o `upsert` não vira upsert nativo: o Prisma faz um SELECT antes e depois UPDATE ou INSERT. Esse SELECT sem trava cria o read view do REPEATABLE READ ANTES de a transação esperar pela trava da linha. Quando a primeira confirmação faz commit e a segunda ganha a trava, `planejar` e `carregarElegiveis` leem pela foto antiga. Não enxergam as atribuições nem os saldos recém-gravados. Resultado: ou a segunda aborta com erro genérico de unicidade/contagem (P2002 em SaldoCargaGlobal, ou falha de conservação), ou, quando os recebedores não se sobrepõem, decide o desempate com crédito global desatualizado. É o rateio injusto e silencioso que o comentário diz prevenir.
- **Vetor:** Operador e gestor confirmam, no mesmo instante, a distribuição de categorias diferentes do mesmo dia.
- **Pré-condições:** Duas sessões operador/gestor confirmando ao mesmo tempo, o que é uso legítimo.
- **Impacto:** Rateio com base obsoleta, sem erro, ou falha confusa para quem opera. A garantia documentada da trava não vale no banco adotado.
- **Causa raiz:** O desenho foi validado em SQLite/PostgreSQL. O momento em que o InnoDB cria o snapshot, e o upsert emulado do Prisma no MySQL, não foram considerados.
- **Correção sugerida:** Fazer da trava o primeiro comando e um comando de trava de verdade: `$executeRaw` `INSERT INTO TravaDeDistribuicao ... ON DUPLICATE KEY UPDATE execucoes = execucoes + 1` (ou `SELECT ... FOR UPDATE`) antes de qualquer leitura comum. Ou abrir a transação de `confirmar` com `isolationLevel: ReadCommitted`, em que cada leitura vê o que já teve commit.
- **Teste de regressão:** Teste de integração em MySQL: duas `confirmar` concorrentes, de categorias diferentes, com a mesma equipe. A segunda deve concluir e usar o crédito global gravado pela primeira (conferir `creditoAntes` no snapshot da rodada). Hoje ela aborta ou grava crédito divergente.
- **Evidência do auditor:** distribuicao.ts:399 `await tx.travaDeDistribuicao.upsert({ where: { data }, create..., update: { execucoes: { increment: 1 } } })` como primeiro comando; schema.prisma:425 "toma lock de linha no PostgreSQL e serializa a escrita no SQLite"

### N-10 — Item concluído pode voltar ao pool e ser distribuído de novo quando concluir e devolver (ou desativar o acesso) acontecem ao mesmo tempo

**MÉDIO** · concorrencia/transicao-de-estado · `src/servicos/fila.ts:332` · dimensão `negocio-concorrencia`

- **Descrição:** `concluir`, `devolver` e `transferir` seguem o padrão ler, conferir, gravar sem trava. Primeiro leem a atribuição e o status do item com um SELECT comum, que não trava nada. Depois gravam com `update({ where: { id } })`, sem exigir o status que foi lido. No MySQL (InnoDB, isolamento REPEATABLE READ) o UPDATE grava sobre a versão mais recente da linha, e a última escrita vence. Não existe máquina de estados no banco: `Item.status` é uma String livre.
- **Vetor:** A pessoa responsável clica em Concluir na tela da fila. No mesmo instante, a gestora clica em Devolver na caixa, ou desativa o acesso da pessoa (`autenticacao.ts:461`, mesmo padrão). As duas transações leem status `distribuido`. `concluir` grava a Execucao e o status `concluido` e confirma. `devolver` estava esperando a trava da linha do item e sobrescreve o status para `devolvido`. Também passa `ativa` para null.
- **Pré-condições:** Duas ações sobre o mesmo item quase ao mesmo tempo. Uma delas vem da responsável; a outra, de operador ou gestor, ou é a desativação do acesso. A trava da tela vale só para uma aba.
- **Impacto:** O item fica com Execucao `concluido` e status `devolvido`. A próxima rodada o redistribui. Resultado: trabalho feito duas vezes sobre dado de associado e carga cobrada duas vezes no crédito. Na ordem inversa, o item fica `concluido` sem responsável ativo. Com `transferir` no lugar de `devolver`, o item fica `concluido` com atribuição ativa para quem não o executou. É exatamente o estado que o comentário da linha 202 diz que não pode existir.
- **Causa raiz:** A conferência de estado é feita sobre uma leitura sem trava, e a escrita não repete essa condição. Falta compare-and-set ou trava da linha do item.
- **Correção sugerida:** A primeira instrução de cada transação deve ser a transição condicional sobre o item. Em `concluir`: `tx.item.updateMany({ where: { id, status: { in: ['distribuido','em_andamento'] } }, data: { status: 'concluido' } })`, e se `count !== 1`, recusar. Em `devolver` e na desativação: o mesmo, com o status de origem, e `atribuicao.updateMany({ where: { id: atual.id, ativa: true } })` conferindo `count === 1`. Em `transferir`: travar o item antes, com `SELECT ... FOR UPDATE` via `$queryRaw` ou com um `updateMany` condicional. Só depois criar Execucao e atribuições.
- **Teste de regressão:** Na base sbp_teste: disparar `concluir` e `devolver` do mesmo item com `Promise.all`, em conexões diferentes, repetindo N vezes. Esperado em todas as repetições: uma das duas é recusada, e nunca existe item com Execucao `concluido` e status diferente de `concluido`. Repetir com `transferir` e com `definirAtivacao`. Reverter a correção e ver o teste falhar.
- **Evidência do auditor:** fila.ts:129-150: `findFirst({ where: { itemId, ativa: true } })` e depois `tx.item.update({ where: { id: entrada.itemId }, data: { status: 'concluido' } })`. fila.ts:332: `tx.item.update({ where: { id: entrada.itemId }, data: { status: 'devolvido' } })`, sem condição de status.

### N-11 — Operações sensíveis sem nenhum teste negativo de papel: fila de outra pessoa, confirmar/prévia, resolver/aprovar revisão, habilitação

**MÉDIO** · cobertura-de-autorizacao · `src/servicos/fila.ts:49` · dimensão `testes-contratos`

- **Descrição:** Contei as chamadas nos testes e não há nenhuma que espere recusa para: minhaFila com colaboradorId alheio (GET /api/fila?colaborador=<id>, a guarda A24 fica só em fila.ts:49-51), confirmar e previa (distribuicao.ts, 64 e 10 chamadas, todas com operador), resolver e aprovarTodosPendentes (revisao.ts, todas com operador), definirHabilitacoes (só gestor, sem teste com operador). Em autorizacao-de-rotas.test.ts o cabeçalho fala em 'quatro' rotas protegidas só na rota, mas testa três. /api/diagnostico/origem (gestor) não é testada, o caso 401 cobre só 2 rotas e não há caso positivo de operador em /api/rodadas/[id] e /api/revisao. Em colaboradores.test.ts, 'só gestor' usa `.rejects.toThrow()` sem dizer qual erro.
- **Vetor:** Um refactor apaga `if (!ehOProprio(...)) exigirPapel(...)` em minhaFila ou o exigirPapel de confirmar/resolver/definirHabilitacoes. Com a suíte verde, um colaborador autenticado lê a fila de um colega trocando o id na query, confirma a distribuição do dia, aprova em massa revisões (inclusive de conteúdo suspeito) ou, como operador, altera habilitações.
- **Pré-condições:** Uma regressão, e depois uma sessão de colaborador ou de operador.
- **Impacto:** IDOR e escalada vertical nas operações que decidem a distribuição, sem alarme. A24 pede explicitamente 'conferir toda rota que um colaborador alcança'.
- **Causa raiz:** Os testes de serviço cobrem o caminho feliz com base.operador, e não existe matriz papel × operação.
- **Correção sugerida:** Criar um teste de tabela (operação × papel) que chama cada função de serviço com colaborador/operador/gestor e compara com a lista de permitidos de cada exigirPapel. Incluir minhaFila com id alheio e as rotas que guardam papel sozinhas (diagnostico/origem, 401 em rodadas).
- **Teste de regressão:** A matriz acima. Remover qualquer exigirPapel listado deve deixá-la vermelha.
- **Evidência do auditor:** fila.ts:49 `if (!ehOProprio(ator, colaboradorId)) { exigirPapel(ator, 'ver a fila de outra pessoa', 'operador', 'gestor') }`; git grep: todas as chamadas de minhaFila em teste usam `pessoa.id, pessoa.ator`

### N-12 — Conteúdo externo cria Liga sem limite, o índice único de Liga não protege nada e toda ingestão lê a tabela inteira de ligas

**MÉDIO** · integridade / consumo-de-recursos · `src/servicos/ingestao.ts:559` · dimensão `mysql-dados`

- **Descrição:** Primeiro: `resolverLiga` cria `Liga` com `{ nome }` apenas, e nenhum caminho do código grava `instituicao`, que fica sempre NULL. No MySQL, NULL é distinto dentro de índice único, então `@@unique([nome, instituicao])`, citado como a garantia de identidade do AT-10 e o motivo da migração de colação, nunca rejeita duplicata no caminho real. O índice em memória é montado por lote (linha 580), então duas sincronizações concorrentes, admitidas no comentário da linha 128, criam duas ligas com o mesmo nome. Os itens da mesma liga ficam com ligaId diferentes e podem ir para duas pessoas no mesmo dia, contrariando A4. Segundo: a liga nasce de `ligaMencionada`, texto que a IA tira do e-mail, até 500 por e-mail (LIMITE_ITENS_POR_EMAIL). Nasce antes da revisão humana, não tem retenção e nunca é removida. Terceiro: `indiceDeLigas` faz `tx.liga.findMany()` sem filtro nem limite dentro de CADA transação de ingestão, e `ligas.listar` devolve todas, também sem limite.
- **Vetor:** Remetente externo manda e-mails com listas de 'Liga Acadêmica de <aleatório>'. Cada e-mail pode gerar centenas de linhas permanentes em Liga. Ou: duas sincronizações simultâneas leem e-mails que citam a mesma liga nova.
- **Pré-condições:** Ingestão ativa. A IA precisa extrair o nome, o que é trivial para texto que parece liga.
- **Impacto:** A identidade de liga se divide sem nenhum erro no banco. A tabela Liga cresce sem controle, com texto de terceiro guardado para sempre. Cada ingestão fica mais lenta, segurando a transação de escrita, e a tela de escolha de liga incha.
- **Causa raiz:** A unicidade depende de uma coluna anulável que nunca é preenchida. A criação de entidade permanente ficou disponível para conteúdo não confiável, sem teto.
- **Correção sugerida:** Guardar a chave normalizada (`chaveDaLiga`) numa coluna NOT NULL com índice único e fazer `upsert` por ela, o que resolve a corrida no banco. Limitar quantas ligas novas um e-mail pode criar, ou criar liga só depois da revisão humana. Pôr `take`/paginação em `listar` e trocar a varredura por `findMany({ where: { chave: { in: chavesDoLote } } })`.
- **Teste de regressão:** Teste de integração: dois `criarItens` concorrentes, em transações separadas, com a mesma `ligaMencionada` nova devem resultar em uma só Liga. Teste que um e-mail com 500 ligas distintas não cria mais que o teto.
- **Evidência do auditor:** ingestao.ts:559 `tx.liga.create({ data: { nome: mencionada!.trim() } })`; ingestao.ts:580 `tx.liga.findMany({ select: { id: true, nome: true } })`; grep 'instituicao' em src/servicos: nenhum escritor

### N-13 — E-mail que a IA nunca consegue estruturar nunca chega a um humano e é cobrado de novo a cada sincronização

**MÉDIO** · falha-silenciosa/logica · `src/servicos/ingestao.ts:212` · dimensão `falhas-silenciosas`

- **Descrição:** Quando as duas tentativas do modelo falham na validação, ia-estruturada lança FalhaDeInterpretacao. O laço de sincronizar() conta a falha, grava evento 'reprocessavel' só com o nome da classe (mensagemPersistivel) e segue em frente. O e-mail não ganha processadoEm, Item nem Revisao. Na sincronização seguinte a mesma mensagem é interpretada de novo, com mais duas chamadas pagas, e falha de novo, sem limite. O CLAUDE.md (invariante 2) e o próprio scripts/experimentar-ia.ts:112 dizem que esse e-mail 'iria para a revisão humana', mas nenhum código faz isso. A tela mostra só 'N falharam e voltam na próxima busca', sem dizer qual e-mail.
- **Vetor:** E-mail com conteúdo que leva o modelo a devolver JSON fora do esquema nas duas tentativas: mais de 500 itens, título acima de 300 caracteres, resposta truncada em MAX_TOKENS ou texto adversarial.
- **Pré-condições:** IA real (anthropic ou gemini). Remetente externo, sem privilégio.
- **Impacto:** O pedido do associado fica invisível como trabalho: não entra em fila nem em revisão, e só aparece como um número agregado. O custo de IA cresce a cada busca (duas chamadas por e-mail envenenado, por sincronização), e o atacante controla esse custo.
- **Causa raiz:** 'Falhou a interpretação' foi tratado como falha transitória (reprocessável), sem distinguir falha de validação (permanente) de falha de transporte, e sem nenhum destino humano.
- **Correção sugerida:** Quando a falha for de validação, gravar o Email como processado e criar um item-sentinela em Revisao (categoria pendente, sem campos) com o motivo resumido, ou criar uma fila de 'não interpretados'. Guardar a contagem de tentativas por messageId e parar de repetir depois de N falhas. Deixar 'reprocessavel' só para a espécie 'transporte'.
- **Teste de regressão:** Pipeline com AiPort falso que sempre lança FalhaDeInterpretacao: depois de duas sincronizações, a IA precisa ter sido chamada uma única vez para aquele messageId e existir uma Revisao pendente apontando para ele.
- **Evidência do auditor:** ingestao.ts:212-227 `resumo.falhas += 1 ... situacao: 'reprocessavel' ... mensagem: mensagemPersistivel(erro)`; ia-estruturada.ts:155 `throw new FalhaDeInterpretacao(...)`; experimentar-ia.ts:112 `(em produção este e-mail iria para a revisão humana)`

### N-14 — A sincronização nunca informa 'desde': com mais de 200 mensagens na Inbox, toda busca pelo Graph falha para sempre

**MÉDIO** · falha-alta-sem-saida/disponibilidade · `src/servicos/ingestao.ts:76` · dimensão `falhas-silenciosas`

- **Descrição:** sincronizar() chama deps.ingestao.buscarNovos() sem argumento, então o Graph lista a Inbox inteira toda vez, inclusive mensagens já processadas, que continuam lá porque a caixa é só leitura. Quando a Inbox passa de 200 mensagens (TETO_POR_SINCRONIZACAO), buscarNovos lança IngestaoIndisponivelError em toda chamada. A mensagem manda 'escolher a data a partir da qual o sistema deve ler', mas nenhuma rota, variável de ambiente ou tela permite isso. Antes de chegar ao teto, cada busca também baixa de novo os bytes de todos os anexos já processados.
- **Vetor:** Uso normal: uma secretaria que recebe dezenas de e-mails por dia chega a 200 mensagens na Inbox em poucos dias.
- **Pré-condições:** INGESTAO_ADAPTER=graph.
- **Impacto:** A ingestão para por completo, com uma mensagem que promete um remédio que não existe. O operador não tem o que fazer além de pedir ao TI que esvazie a Inbox, o que conflita com A5.
- **Causa raiz:** O parâmetro 'desde' existe na porta (ports/ingestao.ts:16) e no cliente, mas nenhum chamador o calcula (por exemplo, a partir do maior Email.recebidoEm já gravado).
- **Correção sugerida:** Calcular 'desde' a partir do último recebidoEm processado (com margem para relógio) ou de uma data inicial configurada, e passar para buscarNovos. A mensagem de erro precisa corresponder a um mecanismo que exista.
- **Teste de regressão:** sincronizar() com IngestaoPort espião precisa receber um Date não nulo quando já existe Email gravado. Com ClienteDoGraph falso de 250 mensagens antigas e 3 novas, a busca deve trazer só as novas.
- **Evidência do auditor:** ingestao.ts:76 `const brutos = await deps.ingestao.buscarNovos()`; git grep mostra buscarNovos chamado só ali; ingestao-graph.ts:101-106 teto que lança erro com 'Escolha a data...'

### N-15 — Os testes de revogação de sessão não chamam perfilAtual: apagar a conferência em sessao.ts deixa a suíte verde

**MÉDIO** · teste-que-nao-prova / autenticacao · `src/servicos/revogacao-e-tempo.test.ts:123` · dimensão `testes-contratos`

- **Descrição:** Os testes 'cookie emitido antes do sair deixa de valer' e 'trocar a senha continua revogando' só comparam números dentro do próprio teste (`expect(conteudo.emitidoEm).toBeLessThan(colaborador.sessoesInvalidasAntes)` e `expect(antigo.senhaEm).not.toBe(...)`). Nenhum deles chama perfilAtual/exigirAtor, então nenhum exercita as linhas sessao.ts:202 (revogação por logout) e :197 (senha trocada). Também não há teste, para sessão comum (não local), de que desativar a pessoa (`!colaborador?.ativo`) derruba a sessão aberta, nem de que o papel é relido do banco (rebaixar gestor tem efeito imediato). O DELETE /api/sessao, que grava sessoesInvalidasAntes, também não tem teste.
- **Vetor:** Um refactor remove ou inverte `if (revogadasAte !== undefined && conteudo.emitidoEm < revogadasAte) return null`, ou passa a usar o papel do cookie. Com a suíte verde, um cookie copiado de uma máquina compartilhada continua válido depois do 'sair', e um gestor rebaixado mantém o poder até o cookie expirar.
- **Pré-condições:** Uma regressão no código de sessão. Explorar exige posse de um cookie antigo.
- **Impacto:** Regressões silenciosas em controles de autenticação (revogação, desativação, rebaixamento), sem nenhum teste vermelho.
- **Causa raiz:** Os testes reimplementam a regra em vez de chamar a função que a aplica.
- **Correção sugerida:** Reescrever os testes com o duble de next/headers já usado em autorizacao-de-rotas.test.ts: montar o cookie, gravar sessoesInvalidasAntes / trocar a senha / desativar / rebaixar, e esperar `perfilAtual()` null (ou papel novo) e `exigirAtor()` rejeitado com SemSessaoError.
- **Teste de regressão:** O próprio teste descrito. Comentar a linha 202 de sessao.ts deve fazê-lo falhar.
- **Evidência do auditor:** revogacao-e-tempo.test.ts:139-141 `const conteudo = lerCookie(cookie)! / expect(conteudo.emitidoEm).toBeLessThan(colaborador.sessoesInvalidasAntes!.getTime())`; sessao.ts:202 `if (revogadasAte !== undefined && conteudo.emitidoEm < revogadasAte) return null`

### N-16 — Uma única linha de Afastamento com tipo inválido suspende toda a limpeza diária (motivos, e-mails, dados de item, contagem), e a falha gravada diz só 'Error'

**MÉDIO** · falha-alta-mal-explicada/retencao · `src/servicos/rotinas.ts:133` · dimensão `falhas-silenciosas`

- **Descrição:** expurgarMotivosDeAfastamento roda numa transação única e chama lerDoBanco para cada ausência vencida (expurgo-lgpd.ts:103). Um tipo fora da lista lança Error comum e desfaz a transação inteira. Em rodarLimpezaDiaria, esse passo é o primeiro do mesmo try, então expurgarConteudoDosEmails, expurgarDadosDosItens e expurgarContagemDeBuscas nunca rodam. A mensagem gravada em ExecucaoDeRotina e EventoProcessamento é mensagemPersistivel(erro), que para Error comum devolve só 'Error'. A causa ('Valor inválido no banco em Afastamento.tipo') fica só no stderr. A gestora vê 'limpeza falhou' todos os dias (3 tentativas), sem saber por quê. Os outros expurgos foram escritos para isolar a linha ruim e seguir; este não.
- **Vetor:** Uma linha de afastamento com tipo digitado ou migrado errado (por exemplo 'atestado ' com espaço, ou um tipo removido do enum).
- **Pré-condições:** Dado corrompido em uma ausência já encerrada.
- **Impacto:** Dado de saúde, corpo de e-mail, anexos e CPF extraído deixam de ser apagados no prazo (invariantes 11 e LGPD) enquanto a linha não for achada, e a trilha operacional não aponta qual linha é.
- **Causa raiz:** Tudo ou nada numa transação por lote, somado ao encadeamento sequencial das quatro limpezas num único try e a uma mensagem persistível que descarta a causa de erro não-domínio.
- **Correção sugerida:** Isolar a ausência inválida como fazem os outros expurgos (continuar e falhar no fim nomeando o id), ou rodar cada limpeza em try próprio e agregar as falhas. Lançar ErroDeNegocio/ErroDominio com o id da linha, sem o valor, para que a mensagem persistida seja útil.
- **Teste de regressão:** Semear um Afastamento vencido com tipo 'xpto' e um e-mail vencido: depois de rodarLimpezaDiaria, o conteúdo do e-mail precisa ter sido expurgado e a mensagem da execução precisa citar o id do afastamento.
- **Evidência do auditor:** rotinas.ts:132-155 os quatro expurgos em sequência no mesmo try; rotinas.ts:182-183 `const mensagem = mensagemPersistivel(erro)`; observabilidade.ts `return erro instanceof Error ? erro.name : 'Erro inesperado'`; expurgo-lgpd.ts:103 `lerDoBanco(TipoDeAfastamentoGravadoSchema, afastamento.tipo, ...)` dentro de `banco.$transaction`

### N-17 — Ingestão e IA simuladas são o padrão também com NODE_ENV=production

**MÉDIO** · configuração insegura por padrão · `src/servidor/ambiente.ts:26` · dimensão `ingestao-anexos`

- **Descrição:** `INGESTAO_ADAPTER` e `IA_ADAPTER` usam `.default('mock')`, e não há trava de produção como a que existe para `ACESSO_LOCAL_SEM_SENHA` (linha 208). Se o servidor de produção subir sem essas variáveis, cada clique em 'sincronizar' injeta na base real e-mails e pedidos sintéticos, gerados por data e semente (a rota passa `sequenciaDeDatas(hoje,1)`). Eles são interpretados pela IA simulada, aprovados e distribuídos à equipe como trabalho real.
- **Vetor:** Implantação com `.env` incompleto ou com a variável esquecida no gestor de segredos.
- **Pré-condições:** Erro de configuração na implantação e um operador sincronizando.
- **Impacto:** Carga fictícia entra no rateio real, no saldo de carga e no painel, e a trilha append-only não pode ser limpa por UPDATE. Isso é decisão operacional errada e contamina métricas de forma permanente. A falha é silenciosa: a tela mostra 'N novos'.
- **Causa raiz:** Padrão 'seguro para desenvolvimento' sem guarda para produção.
- **Correção sugerida:** Em `ambiente()`, recusar subir com NODE_ENV=production quando `INGESTAO_ADAPTER` ou `IA_ADAPTER` forem `mock`, com a mesma mensagem nominal da trava de acesso local.
- **Teste de regressão:** Teste de `ambiente()` com NODE_ENV=production e sem INGESTAO_ADAPTER: precisa lançar erro citando a variável.
- **Evidência do auditor:** ambiente.ts:25-26 `IA_ADAPTER: z.enum([...]).default('mock')`, `INGESTAO_ADAPTER: ...default('mock')`; guarda de produção só em :208 para ACESSO_LOCAL_SEM_SENHA

### N-18 — SESSAO_SECRET e BUSCA_SECRET aceitam qualquer texto com 16 caracteres, inclusive os valores públicos do CI e do vitest, e produção não tem nenhuma checagem de entropia

**MÉDIO** · gestao-de-segredos · `src/servidor/ambiente.ts:61` · dimensão `supply-chain-config`

- **Descrição:** A única exigência é `.min(16)`. Um segredo fraco, escolhido à mão (por exemplo, 'sbp-segredo-2026'), passa. Os valores publicados no repositório também passam: `ci-nao-e-segredo-so-para-o-banco-efemero` e `ci-nao-e-segredo-so-para-cpf-sintetico` (ci.yml:61,64), e `teste-nao-e-segredo-so-para-cpf-sintetico` (vitest.config.ts:23). Todos têm 16 caracteres ou mais e sobem em produção sem aviso. O cookie de sessão é um HMAC-SHA256 sem estado (sessao.ts:72-74) e, sem ANEXOS_SECRET, a chave dos anexos vem do mesmo SESSAO_SECRET, por scrypt com sal fixo (armazenamento-disco.ts:96,124).
- **Vetor:** (a) O operador copia as variáveis do CI para o servidor. (b) Com um segredo humano curto, um operador autenticado usa o próprio cookie (carga e assinatura conhecidas) para descobrir SESSAO_SECRET por força bruta offline.
- **Pré-condições:** Operador reaproveita um valor público ou escolhe um segredo de baixa entropia.
- **Impacto:** Com SESSAO_SECRET conhecido, dá para decifrar todo anexo guardado em disco (documentos de associado) sempre que ANEXOS_SECRET não estiver definido, e dá para assinar cookies. Forjar a sessão de um gestor ainda exige o colaboradorId e o senhaDefinidaEm exato em milissegundos (sessao.ts:196), o que limita esse caminho. Com BUSCA_SECRET conhecido, o código de CPF guardado sem data de exclusão volta a ser o CPF por força bruta (cerca de 10^9 candidatos).
- **Causa raiz:** O tamanho mínimo é tratado como se fosse força do segredo, e nada impede reusar valores sabidamente públicos.
- **Correção sugerida:** Com NODE_ENV=production: exigir 32 bytes ou mais (em base64url/hex) nos três segredos; recusar os valores com prefixo `ci-nao-e-segredo`/`teste-nao-e-segredo` ou que estejam numa lista de valores conhecidos; exigir ANEXOS_SECRET definido e diferente de SESSAO_SECRET, pelo menos em instalação nova.
- **Teste de regressão:** Em ambiente.test, com NODE_ENV=production: `ambiente()` recusa SESSAO_SECRET='ci-nao-e-segredo-so-para-o-banco-efemero' e recusa 'aaaaaaaaaaaaaaaa'; aceita randomBytes(32).toString('base64url').
- **Evidência do auditor:** SESSAO_SECRET: z.string().min(16, ...) ; BUSCA_SECRET: z.string().min(16, ...) ; ci.yml: SESSAO_SECRET: ci-nao-e-segredo-so-para-o-banco-efemero

### N-19 — Trilha append-only e menor privilégio existem só por convenção: a aplicação conecta como root e nada no banco impede UPDATE/DELETE em LogAuditoria

**MÉDIO** · menor-privilegio / integridade-da-trilha · `src/servidor/prisma.ts:24` · dimensão `mysql-dados`

- **Descrição:** O único escritor de LogAuditoria é `auditar`/`auditarLote`, e isso é garantia de código, não do banco. Não há trigger, GRANT separado, usuário de migração separado, nem script de provisionamento no repositório. A aplicação usa uma única DATABASE_URL, que é root nas instruções (.env.example, ESTADO.md, ci.yml). Com isso o mesmo processo tem DDL, DROP, GRANT e FILE. A própria base de código já tem dois caminhos que apagam a trilha com essa credencial (scripts/limpar-transacional.ts:55 e src/testes/apoio.ts:42). A conexão também não pede TLS: `new PrismaMariaDb(url)` sem opção `ssl`. O roteiro do dono (seção 'Como se aplica') exige usuário próprio sem UPDATE/DELETE nas tabelas de memória antes de ir para a empresa.
- **Vetor:** Qualquer injeção futura, dependência comprometida no processo Node, ou um script rodado com a credencial da aplicação consegue reescrever ou apagar LogAuditoria e EventoProcessamento, ou derrubar o schema.
- **Pré-condições:** Execução de código no processo da aplicação ou acesso à DATABASE_URL. Hoje o banco é local (127.0.0.1) e os dados são sintéticos.
- **Impacto:** A trilha que prova quem distribuiu o quê pode ser alterada sem deixar rastro (invariante 14). O impacto de qualquer outro comprometimento vai de 'dados da aplicação' para 'servidor MySQL inteiro'.
- **Causa raiz:** A garantia append-only foi escrita como disciplina de código, e o provisionamento de produção ainda não existe (A46).
- **Correção sugerida:** Criar um script versionado de provisionamento: um usuário `sbp_migracao` com DDL, usado só em `migrate deploy`, e um usuário `sbp_app` com SELECT/INSERT/UPDATE/DELETE nas tabelas operacionais, só SELECT/INSERT em LogAuditoria e EventoProcessamento, e sem acesso a outros schemas. Opcionalmente, triggers BEFORE UPDATE/DELETE em LogAuditoria com SIGNAL. Exigir TLS (`ssl` no adapter, `REQUIRE SSL` no usuário) fora de 127.0.0.1. Fazer `ambiente.ts` recusar usuário `root` quando NODE_ENV=production.
- **Teste de regressão:** Teste de integração que conecta com o usuário da aplicação e confere que `UPDATE LogAuditoria` e `DELETE FROM LogAuditoria` falham com ER_TABLEACCESS_DENIED. Teste de `ambiente()` recusando `mysql://root@` em produção.
- **Evidência do auditor:** prisma.ts:24 `new PrismaMariaDb(ambiente().DATABASE_URL)`; ci.yml:40 `mysql://root@127.0.0.1:3306/sbp_teste`; limpar-transacional.ts:55 `auditoria: (await banco.logAuditoria.deleteMany()).count`; nenhuma ocorrência de TRIGGER/GRANT em prisma/migrations

### N-20 — Actions fixadas por tag mutável (inclusive a de terceiro gitleaks/gitleaks-action@v3, que recebe o GITHUB_TOKEN), checkout com credencial persistida e `npm ci` com scripts de instalação no job que só audita

**BAIXO** · ci-cd / integridade do pipeline · `.github/workflows/ci.yml:141` · dimensão `supply-chain-config`

- **Descrição:** Todas as actions usam tag (`actions/checkout@v7`, `actions/setup-node@v7`, `gitleaks/gitleaks-action@v3`, `github/codeql-action/*@v3`), sem SHA. O `actions/checkout` roda sem `persist-credentials: false`, então o token fica em .git/config e fica ao alcance dos scripts de instalação que o `npm ci` executa logo depois (protobufjs, prisma, @prisma/engines, better-sqlite3). O job `dependencias` roda `npm ci` completo só para chamar `npm audit`, que precisa apenas do lockfile.
- **Vetor:** A tag de uma action é movida para um commit malicioso (foi o caso tj-actions/changed-files, em 2025), ou um script de instalação comprometido lê o extraheader de .git/config.
- **Pré-condições:** Comprometimento de uma action de terceiro ou de um pacote npm com script de instalação.
- **Impacto:** Vazamento do GITHUB_TOKEN do job, com escopo `contents: read` e, no gitleaks, também `pull-requests: read`. Em repositório privado, isso é leitura do código e dos documentos de negócio enquanto o job roda. Hoje o pipeline não tem segredo de implantação nem escrita, o que limita o estrago.
- **Causa raiz:** Referência mutável a código de terceiros e credencial disponível em passos que não precisam dela.
- **Correção sugerida:** Fixar cada action por SHA completo, com a tag em comentário (o Dependabot de github-actions atualiza SHA). Usar `persist-credentials: false` nos checkouts. No job `dependencias`, trocar por `npm audit --audit-level=high --package-lock-only` sem `npm ci`, ou usar `npm ci --ignore-scripts`.
- **Teste de regressão:** Checagem no CI (por exemplo, um grep ou uma action de lint de workflow) que falha se houver `uses: .*@v[0-9]` sem SHA de 40 caracteres.
- **Evidência do auditor:** - uses: gitleaks/gitleaks-action@v3  env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} ; - uses: actions/checkout@v7 (sem persist-credentials) ; - run: npm ci ; - name: npm audit

### N-21 — @prisma/adapter-better-sqlite3 continua em `dependencies` sem uso e arrasta 40 pacotes transitivos, entre eles um script de instalação que baixa um binário fora do lockfile

**BAIXO** · cadeia-de-suprimentos / dependencia-desnecessaria · `package.json:42` · dimensão `supply-chain-config`

- **Descrição:** O banco migrou para MySQL (src/servidor/prisma.ts:1 importa só PrismaMariaDb) e nenhum arquivo .ts importa o adapter SQLite. Ele aparece só em package.json:42 e em next.config.ts:6 (serverExternalPackages). Pelo lockfile, puxa better-sqlite3@12.11.1, cujo `install` é `prebuild-install || node-gyp rebuild`, e outros 39 pacotes (prebuild-install, tar-fs, simple-get, rc, node-abi...). O prebuild-install baixa o .node dos releases do GitHub, e esse arquivo não tem hash no package-lock.
- **Vetor:** A cada `npm ci` (três jobs do CI e toda máquina de desenvolvimento) roda um script de instalação de pacote sem uso. Um comprometimento de qualquer um dos 40 pacotes, ou do artefato de release, executa código no CI e na máquina do desenvolvedor, e o `rc` ainda aceita trocar o host de download por variável `npm_config_*`.
- **Pré-condições:** Comprometimento de pacote transitivo ou do artefato de release.
- **Impacto:** Superfície de ataque de instalação sem ganho nenhum. A dependência também vai para a árvore de produção.
- **Causa raiz:** Sobra da migração SQLite para MySQL (A42).
- **Correção sugerida:** Remover @prisma/adapter-better-sqlite3 do package.json e de serverExternalPackages, e regenerar o lockfile. Conferir que better-sqlite3 e prebuild-install saíram da árvore.
- **Teste de regressão:** Passo de CI ou teste que falha se `package-lock.json` tiver `node_modules/better-sqlite3`; `npm ls better-sqlite3` vazio.
- **Evidência do auditor:** git grep 'adapter-better' -> só package.json:42 e next.config.ts:6; lock: node_modules/better-sqlite3 hasInstallScript, scripts.install='prebuild-install || node-gyp rebuild'

### N-22 — Chaves estrangeiras que apagariam ou desligariam histórico se um DELETE chegar ao banco

**BAIXO** · integridade-referencial · `prisma/schema.prisma:485` · dimensão `mysql-dados`

- **Descrição:** Hoje nenhum serviço apaga essas linhas, mas o banco não impede, e a credencial é root (ver achado de menor privilégio). Casos: `Atribuicao.rodada` fica SET NULL por padrão (migration.sql:473), então apagar uma RodadaDistribuicao, descrita como 'snapshot imutável', desliga as atribuições da decisão que as gerou. `Revisao.resolvidoPor` fica SET NULL (migration.sql:515). `Anexo` e `EmailConteudo` são CASCADE a partir de Email, e os metadados de Anexo são de retenção longa. `Item` → Atribuicao, Execucao e Revisao são CASCADE. `RegraDistribuicao` e `Habilitacao` são CASCADE a partir de Categoria. Um colaborador que só resolveu revisões, sem atribuição, saldo ou nota, pode ser apagado, e a autoria das revisões vira NULL.
- **Vetor:** Um DELETE manual, um script ou uma futura rota de remoção sobre Rodada, Colaborador, Item ou Categoria.
- **Pré-condições:** Escrita direta no banco ou código novo com delete.
- **Impacto:** Histórico operacional apagado ou desligado em silêncio, sem linha na trilha (invariante 11). É o mesmo raciocínio que levou SaldoCarga e Nota a Restrict.
- **Causa raiz:** O Restrict foi aplicado caso a caso, e não como regra para toda relação que aponta para histórico.
- **Correção sugerida:** Usar `onDelete: Restrict` em Atribuicao.rodada, Revisao.revisor, Atribuicao/Execucao/Revisao → Item, Anexo → Email e Habilitacao/RegraDistribuicao → Categoria. Manter Cascade só em EmailConteudo, que é expurgável por desenho, e JustificativaDeAtribuicao.
- **Teste de regressão:** Teste de integração: `rodadaDistribuicao.delete` com atribuições e `item.delete` com atribuição devem falhar com P2003.
- **Evidência do auditor:** migration.sql:473 `Atribuicao_rodadaId_fkey ... ON DELETE SET NULL`; :467 `Atribuicao_itemId_fkey ... ON DELETE CASCADE`; :452 `Anexo_emailId_fkey ... ON DELETE CASCADE`

### N-23 — db:limpar apaga Email (e Anexo em cascata) mas deixa os arquivos de anexo no disco, sem referência e fora de qualquer retenção

**BAIXO** · retencao / operacao · `scripts/limpar-transacional.ts:51` · dimensão `mysql-dados`

- **Descrição:** `banco.email.deleteMany()` leva junto, por `onDelete: Cascade`, as linhas de Anexo com `chaveArmazenamento`. Os bytes cifrados em ARMAZENAMENTO_DIR continuam lá. Sem a linha, o expurgo diário (`expurgo-conteudo.ts`, que parte de `anexo.chaveArmazenamento`) nunca mais os encontra. A trava do script é só o opt-in `PERMITIR_LIMPEZA=sim`, sem conferir o nome da base, e `ambiente()` carrega o `.env` da máquina.
- **Vetor:** Alguém roda `PERMITIR_LIMPEZA=sim npm run db:limpar` numa instalação com anexos gravados, ou numa base que não é de desenvolvimento, porque o .env aponta para ela.
- **Pré-condições:** Shell na máquina e o opt-in explícito.
- **Impacto:** Documentos de associado ficam órfãos no disco para sempre, contra o invariante 11 e a LGPD. Numa base errada, dados operacionais e a trilha somem.
- **Causa raiz:** A limpeza foi pensada só para o banco. O armazenamento é um segundo lugar de dados que o script não conhece.
- **Correção sugerida:** Antes de apagar, listar as `chaveArmazenamento` e removê-las pelo `ArmazenamentoPort`, ou esvaziar o diretório de desenvolvimento. Recusar quando `SELECT DATABASE()` não for de desenvolvimento, pela lista de nomes permitidos.
- **Teste de regressão:** Teste com dublê de armazenamento: após a limpeza, `remover` deve ter sido chamado para cada chave existente, e o script deve recusar base cujo nome não esteja na lista permitida.
- **Evidência do auditor:** limpar-transacional.ts:51 `emails: (await banco.email.deleteMany()).count`; schema.prisma:318 `email Email @relation(..., onDelete: Cascade)` em Anexo

### N-24 — 'anexos:conferir' responde '0 em texto puro' quando não consegue ler a pasta

**BAIXO** · falha silenciosa / cifra em repouso · `scripts/recifrar-anexos.ts:55` · dimensão `ingestao-anexos`

- **Descrição:** `chavesDeAnexo(raiz).catch(() => [])` engole qualquer erro: permissão negada (EACCES/EPERM) ou ARMAZENAMENTO_DIR apontando para lugar errado. O script imprime '0 anexo(s) no disco; 0 ainda em texto puro' e sai com código 0. É exatamente o defeito que `listarSeExistir` corrigiu no adapter (comentário das linhas 343-348). O script também deixa o `.recifrando` órfão quando a releitura lança erro (chave trocada) antes do `unlink`.
- **Vetor:** Operador roda a conferência com usuário sem permissão na pasta, ou com a variável errada.
- **Pré-condições:** Acesso ao servidor para rodar o script.
- **Impacto:** A cifragem em repouso é declarada completa enquanto documentos legados continuam legíveis com `cat` (backup exposto).
- **Causa raiz:** catch genérico.
- **Correção sugerida:** Tratar só ENOENT como vazio (e mesmo assim avisar que a raiz não existe). Qualquer outro erro sai com código 1. Pôr `unlink(temporario)` num `finally` quando a releitura falhar.
- **Teste de regressão:** Executar `chavesDeAnexo` com um `readdir` que lança EACCES: precisa falhar com código diferente de zero.
- **Evidência do auditor:** recifrar-anexos.ts:55 `const chaves = await chavesDeAnexo(raiz).catch(() => [])`

### N-25 — A chave do anexo usa o separador do sistema operacional, e numa migração Windows→Linux o expurgo 'apaga' o que não existe

**BAIXO** · retenção / portabilidade de caminho · `src/adapters/armazenamento-disco.ts:416` · dimensão `ingestao-anexos`

- **Descrição:** `guardar` monta a chave com `path.join`, então no Windows (a máquina atual) o banco recebe `ab\ab12….pdf`. No Linux (servidor provável, AT-32), `resolve(raiz, 'ab\ab12….pdf')` aponta para um arquivo com barra invertida no nome, na raiz. `remover` usa `rm(..., { force: true })`, que não acusa a ausência. O expurgo então carimba `bytesExpurgadosEm` e registra 'anexosRemovidos' enquanto o arquivo cifrado continua em `ab/`. O script de recifragem, por sua vez, usa `/` fixo, o que já mostra a inconsistência.
- **Vetor:** Levar a pasta de anexos e a base do protótipo em Windows para o servidor Linux da empresa.
- **Pré-condições:** Anexos gravados em Windows e servidos depois em Linux.
- **Impacto:** Documento de associado continua no disco depois do prazo, com a trilha afirmando que foi apagado, sem nenhum sinal. Isso viola o invariante 11 e contamina a prova de LGPD.
- **Causa raiz:** Chave lógica montada com API de caminho do sistema operacional, e remoção idempotente que não diferencia 'removi' de 'não havia'.
- **Correção sugerida:** Montar a chave com `/` fixo (`${pasta}/${nome}`) e, em `caminhoDe`, recusar chave que contenha `\`. No expurgo, registrar (ou contar) quando `remover` não encontrou o arquivo.
- **Teste de regressão:** `guardar` precisa devolver chave que casa com `^[0-9a-f]{2}/[0-9a-f]{32}(\.[a-z0-9]{1,10})?$` em qualquer plataforma. `caminhoDe('ab\\x.pdf')` precisa lançar.
- **Evidência do auditor:** armazenamento-disco.ts:416 `const chave = join(sorteio.slice(0, 2), ...)`; :452 `await rm(this.caminhoDe(chave), { force: true })`; scripts/recifrar-anexos.ts usa `` `${pasta.name}/${arquivo}` ``

### N-26 — Remetente vem do cabeçalho From sem nenhum sinal de autenticação, e a tela o mostra como fato

**BAIXO** · spoofing de remetente · `src/adapters/ingestao-graph.ts:121` · dimensão `ingestao-anexos`

- **Descrição:** O adapter pede só `from` e descarta `sender` e os cabeçalhos de autenticação (SPF/DKIM/DMARC, `Authentication-Results`). A Caixa, a Fila e a Revisão mostram `remetente` sem distinguir um endereço forjado. Hoje nada decide com base no remetente (liga e categoria vêm do texto), então o impacto é engenharia social. Um e-mail com From de um diretor ou de uma liga conhecida chega à equipe com a mesma aparência de um legítimo, e sem conteúdo suspeito ele é aprovado sem revisão.
- **Vetor:** E-mail externo com From forjado de um domínio que não publica DMARC restritivo, ou com um domínio parecido.
- **Pré-condições:** Nenhuma no sistema. Depende da política antispoofing do Exchange Online do tenant.
- **Impacto:** A equipe executa um pedido forjado atribuído a um remetente confiável (por exemplo, alteração cadastral).
- **Causa raiz:** Não há sinal de autenticidade na ingestão.
- **Correção sugerida:** Pedir `internetMessageHeaders` (ou só `Authentication-Results`) e gravar um veredito booleano. Quando SPF/DKIM/DMARC não passam ou From ≠ Sender, marcar para revisão e exibir o aviso na tela. Nunca usar o remetente como identidade.
- **Teste de regressão:** Dublê com `Authentication-Results: dmarc=fail`: o item precisa ir para revisão, com motivo visível.
- **Evidência do auditor:** ingestao-graph.ts:297 `$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,from,body`; :121 `remetente: mensagem.from?.emailAddress?.address`

### N-27 — O teto do anexo decide pelo tamanho declarado e não evita baixar os bytes grandes

**BAIXO** · upload / tamanho real · `src/adapters/ingestao-graph.ts:151` · dimensão `ingestao-anexos`

- **Descrição:** `validarAnexo` recebe `anexo.tamanho` (o `size` informado pela origem), nunca `conteudo.length`, e é esse valor que vai para `Anexo.tamanho`. No Graph, o `size` vem do servidor. Em qualquer outro adapter previsto (imap/gmail, que o port já aceita), ele vem da origem, e bytes maiores que o declarado seriam guardados. O comentário 'baixar 30 MB para descartar seria desperdício' também não confere: `GET /messages/{id}/attachments` já devolve `contentBytes` de todos os anexos no JSON, então os 30 MB são baixados e decodificados em `resposta.json()` antes do descarte.
- **Vetor:** Mensagem com vários anexos grandes, repetida em toda sincronização por causa da falta de cursor.
- **Pré-condições:** INGESTAO_ADAPTER=graph (memória), ou um adapter futuro que não confira o tamanho.
- **Impacto:** Pressão de memória no processo (base64 inteiro em memória) e registro de tamanho que pode não ser o real.
- **Causa raiz:** O tamanho declarado é tratado como fato, e a listagem não seleciona os campos.
- **Correção sugerida:** Em `processarUm`, quando houver `conteudo`, validar e gravar `conteudo.byteLength`. No Graph, listar com `$select=id,name,contentType,size` e baixar `/attachments/{id}/$value` só dos que cabem.
- **Teste de regressão:** Anexo com `tamanho: 10` e `conteudo` de 26 MB precisa ser recusado por tamanho.
- **Evidência do auditor:** servicos/ingestao.ts:281 `validarAnexo(anexo.nome, anexo.tamanho, ...)`; ingestao-graph.ts:326 lista `/attachments` sem `$select`

### N-28 — Mensagens em inglês, com ids internos e com notas de desenvolvimento na tela

**BAIXO** · texto-para-equipe · `src/app/acesso/page.tsx:133` · dimensão `telas-frontend`

- **Descrição:** (a) O Zod 4 está sem localização (nenhum z.config/errorMap em src), e a tela de Acesso e servidor/http.ts:63 mostram as issues como estão, por exemplo 'email: Invalid email address' e 'categorias.0: Invalid option'. (b) PermissaoNegadaError chega à tela como 'Papel "x" não pode executar "y". Permitidos: ...'. Erros de negócio mostram o id interno ('Item "<cuid>" não tem responsável ativo.'). (c) Há texto escrito para quem programa exibido à equipe: caixa:346 ('sem este aviso, a lista parecia completa e o número da pastilha parecia errado'), revisao:205 ('Sem este aviso, a tela diria ... para sempre enquanto a fila crescia atrás dela'), Distribuição ('pela mesma função', 'cadastro inválido no banco', 'cota justa · piso · resto'), Caixa ('o motor', 'porta lateral que este sistema existe para fechar') e Painel ('livro-razão').
- **Vetor:** A gestora digita um e-mail com erro no cadastro. Um colaborador clica numa ação que não é do papel dele. O operador lê o aviso de corte da Caixa ou da Revisão.
- **Pré-condições:** Nenhuma.
- **Impacto:** Contraria o pedido explícito do dono em A40 (frase curta, sem termo técnico, que diga o que houve e o que fazer). Mensagem em inglês ou com id não diz à pessoa o que fazer.
- **Causa raiz:** Não há camada de tradução de erros de validação e permissão para a equipe, e comentários de engenharia foram parar no texto da tela.
- **Correção sugerida:** Configurar mensagens em português no Zod (z.config com locale pt) ou mapear as issues para frases por campo. Dar a PermissaoNegadaError uma mensagemPublica simples ('Esta ação é de quem coordena o setor.'). Tirar ids das mensagens. Reescrever os avisos citados sem a justificativa de engenharia.
- **Teste de regressão:** Teste: CadastroDeColaboradorSchema com e-mail inválido produz mensagem sem 'Invalid'. Teste de rota: 403 de papel não contém 'Permitidos:'.
- **Evidência do auditor:** conferido.error.issues.map((problema) => `${problema.path.join('.')}: ${problema.message}`) (acesso:133); `Papel "${ator.papel}" não pode executar "${operacao}". Permitidos: ...` (servidor/ator.ts:65)

### N-29 — Senha provisória ainda não anotada é sobrescrita pela próxima, e "Desligar acesso" age com um clique

**BAIXO** · administracao · `src/app/acesso/page.tsx:147` · dimensão `telas-frontend`

- **Descrição:** O cartão da senha provisória guarda um único valor. 'Cadastrar pessoa' e 'Nova senha provisória' continuam ativos enquanto o cartão está aberto, e a segunda geração troca a primeira (linhas 110 e 147) sem aviso. O texto do cartão diz que a senha 'aparece uma única vez'. Já 'Desligar acesso' (linha 457-471) derruba na hora a sessão da pessoa, como a própria tela explica, com um clique só, ao lado de 'Nova senha provisória', que pede confirmação.
- **Vetor:** A gestora cadastra duas pessoas seguidas sem clicar em 'já anotei', ou erra o clique em 'Desligar acesso' no cartão de uma colega.
- **Pré-condições:** Sessão de gestor.
- **Impacto:** A senha da primeira pessoa se perde, e é preciso gerar outra. A colega que está trabalhando perde a sessão no meio do atendimento. Os dois casos têm volta, por isso a severidade é baixa.
- **Causa raiz:** O estado da senha é único, e a confirmação em dois passos não foi estendida a 'Desligar acesso'.
- **Correção sugerida:** Enquanto senhaGerada estiver aberta, desabilitar novas gerações e cadastros, ou acumular as senhas numa lista. Pedir o segundo clique em 'Desligar acesso', como já acontece em 'Nova senha provisória'.
- **Teste de regressão:** Teste de componente: com o cartão aberto, o botão 'Cadastrar e gerar senha' fica desabilitado. Um clique em 'Desligar acesso' não chama /colaboradores/ativacao.
- **Evidência do auditor:** setSenhaGerada({ nome: criado.nome, senha: criado.senhaProvisoria }) (acesso:147); onClick={() => agir(pessoa.id, async () => { await api.enviar('/colaboradores/ativacao', ...) })} (acesso:457-468)

### N-30 — Revisão diz "Nada aguardando" e "fila vazia" com revisões ainda pendentes além do corte

**BAIXO** · estado-da-tela · `src/app/revisao/page.tsx:194` · dimensão `telas-frontend`

- **Descrição:** A lista vem limitada a 200 (api/revisao/route.ts:12). Ao resolver, a tela tira o item de 'pendentes' (linha 168), mas nunca atualiza 'totalPendentes' nem recarrega. O cabeçalho continua dizendo 'N itens' com o total antigo enquanto a lista encolhe. Quando os 200 visíveis acabam, a tela mostra ao mesmo tempo 'Nada aguardando decisão humana.', 'Fila de revisão vazia / Todos os itens passaram do limiar' e o aviso 'N revisões pendentes, e esta tela mostra 0'.
- **Vetor:** Operador resolve todas as revisões visíveis num dia com mais de 200 pendentes.
- **Pré-condições:** Operador ou gestor, mais de 200 revisões pendentes.
- **Impacto:** Mensagens contraditórias na mesma tela, e as duas maiores dizem que acabou. O operador pode sair com itens parados em revisão, que não entram na distribuição.
- **Causa raiz:** O contador total é estado solto, que só se atualiza na carga inicial. O estado vazio olha só para a lista local.
- **Correção sugerida:** Decrementar totalPendentes ao resolver e, quando a lista local zerar com total > 0, recarregar /revisao em vez de desenhar o estado vazio.
- **Teste de regressão:** Teste de componente com total=201 e 1 item: depois de aprovar, a tela não mostra 'Nada aguardando' e pede a próxima página.
- **Evidência do auditor:** setPendentes((lista) => (lista ?? []).filter(...)) sem setTotalPendentes (revisao:168); pendentes.length === 0 ? 'Nada aguardando decisão humana.' (revisao:194)

### N-31 — Colaborador cai na Distribuição depois de trocar a senha e ao clicar no logotipo

**BAIXO** · autorizacao-na-tela/ux · `src/app/senha/page.tsx:59` · dimensão `telas-frontend`

- **Descrição:** Depois de trocar a senha, a tela sempre vai para /distribuicao, sem olhar o papel (entrar/page.tsx usa destinoDoPapel). O logotipo da barra também aponta para /distribuicao para qualquer papel (navegacao.tsx:75). A Distribuição carrega a escala, que GET /escala libera a todos, e mostra as caixas de plantão e os botões ativos. Qualquer clique volta 403 com a mensagem crua 'Papel "colaborador" não pode executar "definir escala". Permitidos: operador, gestor.'
- **Vetor:** Colaborador novo entra com a senha provisória, define a nova senha e é levado à Distribuição. Ou clica no logotipo em qualquer tela.
- **Pré-condições:** Sessão de colaborador.
- **Impacto:** O primeiro contato de toda pessoa nova é uma tela que não é dela, com controles que parecem funcionar e falham com texto técnico. O servidor recusa tudo, então não há escalada, mas a pessoa conclui que o sistema está quebrado.
- **Causa raiz:** O destino fixo foi escrito antes de destinoDoPapel existir, e a barra usa um href fixo.
- **Correção sugerida:** Usar o papel devolvido pela troca de senha (ou por /sessao) para escolher /fila ou /distribuicao, e apontar o logotipo para '/', que já redireciona por papel (app/page.tsx).
- **Teste de regressão:** Teste da tela de senha: com papel colaborador, navega para /fila. Teste da navegação: o href do logotipo é '/'.
- **Evidência do auditor:** navegador.push('/distribuicao') (senha:59); <Link href="/distribuicao" ...> (navegacao.tsx:75)

### N-32 — Aviso sempre com role="alert", campos sem rótulo e alvos de 36 px no celular

**BAIXO** · acessibilidade · `src/componentes/matrizes.tsx:228` · dimensão `telas-frontend`

- **Descrição:** (a) Aviso usa role="alert" para qualquer tom, inclusive informação e sucesso. Na Revisão, cada item com conteúdo suspeito cria um alerta ao carregar, e o leitor de tela anuncia todos como urgentes. O tom 'neutro', usado na Caixa, cai no verde de sucesso. (b) As duas datas do Painel (painel:297,307) não têm label nem aria-label, e só um <span> 'Período' e um 'até' soltos as acompanham. Os campos dos itens extras na Revisão só têm placeholder. (c) Botao tamanho='pequeno' tem min-h-9 em qualquer largura, e é o tamanho de Concluir, Transferir, Aprovar e Descartar no celular.
- **Vetor:** Uso com leitor de tela ou no celular.
- **Pré-condições:** Nenhuma.
- **Impacto:** Quem navega por áudio ouve alertas falsos e campos sem nome. No celular, os botões das ações irreversíveis são os menores da tela.
- **Causa raiz:** A matriz Aviso não separa 'status' de 'alert', e a variante pequena do botão não tem o reforço mobile que os outros controles têm.
- **Correção sugerida:** Usar role='alert' só para tom='alerta' e role='status' para os demais, e dar ao tom neutro a sua própria cor. Dar aria-label às datas do Painel ('Início do período', 'Fim do período') e aos campos extras. Usar min-h-11 sm:min-h-9 no Botao pequeno.
- **Teste de regressão:** Teste de componente: <Aviso tom="atencao"> tem role status. As datas do Painel são encontradas por getByLabelText.
- **Evidência do auditor:** <div role="alert" className={juntar('rounded-md border px-3 py-2 text-sm', fundo)}> (matrizes:228); tamanho === 'pequeno' ? 'min-h-9 px-2.5 text-xs'

### N-33 — Distribuição concorrente com a desativação de uma pessoa pode entregar itens a quem acabou de ser desligado, e eles ficam invisíveis

**BAIXO** · concorrencia/distribuicao · `src/servicos/distribuicao.ts:835` · dimensão `negocio-concorrencia`

- **Descrição:** `carregarElegiveis` filtra `colaborador: { ativo: true }` na foto da transação. `definirAtivacao` devolve ao pool só as atribuições que existiam quando ela rodou. Se a desativação confirma depois da foto da distribuição e antes das inserções dela, a verificação de chave estrangeira aceita a pessoa desativada (a FK não olha `ativo`), e as atribuições novas nascem depois da devolução.
- **Vetor:** A gestora desliga o acesso de uma colaboradora enquanto a operadora confirma a distribuição do dia.
- **Pré-condições:** As duas ações quase simultâneas, com perfis de gestor e operador.
- **Impacto:** Itens `distribuido` na fila de alguém que não consegue abrir sessão. Somem de 'Por pessoa' (que filtra `ativo: true`) e ninguém os recolhe. É o 'item some do mundo' que `transferir` e `definirAtivacao` foram corrigidos para evitar.
- **Causa raiz:** A elegibilidade é decidida sobre uma foto, sem trava sobre as linhas de `Colaborador` dos elegíveis.
- **Correção sugerida:** Dentro de `confirmar`, travar os colaboradores elegíveis (`SELECT … FROM Colaborador WHERE id IN (…) AND ativo = 1 FOR SHARE`) antes de gravar, e conferir que o conjunto não mudou. Outra opção: fazer `definirAtivacao` tomar a `TravaDeDistribuicao` do dia, depois de corrigida conforme o segundo achado.
- **Teste de regressão:** Na sbp_teste: distribuição com espera injetada depois de `planejar`, e desativação da pessoa nesse intervalo. Esperado: a distribuição aborta ou exclui a pessoa, e nenhuma atribuição ativa aponta para colaborador inativo.
- **Evidência do auditor:** distribuicao.ts:835: `colaborador: { ativo: true }` em `habilitacao.findMany`, sem trava. autenticacao.ts:437-461: a devolução percorre só as atribuições lidas naquele momento.

### N-34 — A fila de revisão carrega o corpo inteiro (LongText) de até 100 e-mails a cada abertura e não usa

**BAIXO** · desempenho / consumo-de-recursos · `src/servicos/revisao.ts:110` · dimensão `mysql-dados`

- **Descrição:** `listarPendentes` faz `include: { email: { include: { conteudo: true } } }`, o que traz `corpo` (até 200 mil caracteres, LongText) de cada e-mail. O mapeamento usa só `remetente` e `assunto`.
- **Vetor:** Remetente externo manda cerca de 100 e-mails com corpo de 200 mil caracteres e texto que marca conteúdo suspeito, o que força a revisão. Cada abertura da tela Revisão puxa da base, para o Node, até cerca de 80 MB.
- **Pré-condições:** Ingestão ativa. Nenhuma credencial.
- **Impacto:** Tela de revisão lenta ou fora do ar, consumo de memória no servidor e carga no MySQL, justamente na fila onde conteúdo suspeito deveria ser tratado.
- **Causa raiz:** `include` amplo em vez de `select` dos campos usados.
- **Correção sugerida:** Trocar por `email: { select: { conteudo: { select: { remetente: true, assunto: true } } } }`.
- **Teste de regressão:** Teste com banco anotador (src/testes/banco-que-anota.ts) conferindo que a consulta de `listarPendentes` não seleciona `corpo`.
- **Evidência do auditor:** revisao.ts:110 `email: { include: { conteudo: true } }` e o map só lê `conteudo?.remetente` / `conteudo?.assunto`

### N-35 — Payload ilegível vira padrão vazio na revisão e é sobrescrito, apagando campos da IA e liga mencionada sem log

**BAIXO** · valor-padrao-que-esconde-erro · `src/servicos/revisao.ts:174` · dimensão `falhas-silenciosas`

- **Descrição:** resolverRevisao lê o payload com desserializar(..., padrão vazio). desserializar (esquemas.ts:840-845) engole qualquer falha de JSON.parse ou de esquema. Com payload ilegível, a mesclagem parte de {campos: {}} e grava payloadFinal por cima: CPF, CRM, camposAusentes, ligaMencionada e observação extraídos somem, a chaveDeBusca é recalculada só com o que o humano enviou, e nada fica registrado. O próprio comentário da função diz que 'sobrescrever' era o defeito que ela corrigia. acertoDaRevisao, logo abaixo, registra aviso num caso análogo; aqui não há aviso.
- **Vetor:** Payload gravado por versão anterior com forma diferente, ou coluna alterada à mão, e depois uma revisão aprovada.
- **Pré-condições:** Dado inconsistente e papel com permissão de revisão.
- **Impacto:** Perda silenciosa e irreversível de dado extraído e da chave de busca por CPF do item.
- **Causa raiz:** Uso de um leitor com valor padrão num caminho que depois ESCREVE o valor.
- **Correção sugerida:** Usar lerDoBanco (falha alta, 500 com correlação) ou, no mínimo, registrar aviso com revisaoId e não sobrescrever campos quando o payload anterior não for legível.
- **Teste de regressão:** Item com payload '{"campos":5}': resolverRevisao precisa falhar com erro 5xx (ou registrar aviso) e o payload original precisa continuar no banco.
- **Evidência do auditor:** revisao.ts:174-180 `const payloadAnterior = desserializar(revisao.item.payload, PayloadDoItemSchema, { campos: {}, ... })`; esquemas.ts:840-845 `try { return esquema.parse(JSON.parse(texto)) } catch { return padrao }`

### N-36 — Hash de senha corrompido é tratado como 'senha errada' em silêncio e acaba bloqueando a conta

**BAIXO** · catch-que-engole · `src/servidor/credenciais.ts:115` · dimensão `falhas-silenciosas`

- **Descrição:** conferirSenha devolve false, sem nenhum registro, para hash com número de partes errado, parâmetros fora dos limites ou exceção do scrypt. autenticar() trata esse false como tentativa errada: incrementa tentativasFalhas, bloqueia a conta depois de 5 tentativas e audita 'entrada_recusada'. Não recusar em 500 para o cliente é decisão consciente (comentário das linhas 72-76), mas nada registra do lado do servidor que o defeito é do dado.
- **Vetor:** Hash gravado por formato futuro ou corrompido em migração ou restauração de backup.
- **Pré-condições:** Dado inconsistente na coluna senhaHash.
- **Impacto:** A pessoa legítima é trancada fora e o suporte investiga 'senha esquecida', quando o problema é a linha do banco. O gestor redefine a senha e o defeito fica sem diagnóstico.
- **Causa raiz:** Fail-closed sem observabilidade.
- **Correção sugerida:** Manter o false para o cliente, mas registrar registrarLog('erro', 'hash de senha ilegível', { colaboradorId }) nos ramos de formato inválido e no catch, com o id passado pelo chamador.
- **Teste de regressão:** conferirSenha('x', 'lixo') devolve false E emite um log de nível erro (espião em process.stderr).
- **Evidência do auditor:** credenciais.ts:83-84 `if (partes.length !== 6) return false`; credenciais.ts:115-117 `} catch { return false }`

### N-37 — O teto de chaves do limitador não limita: com mais de 1000 janelas ativas o mapa cresce sem fim, e não há teste

**BAIXO** · disponibilidade / sem-teste · `src/servidor/limite-de-taxa.ts:46` · dimensão `testes-contratos`

- **Descrição:** Quando `janelas.size >= TETO_DE_CHAVES`, a função só remove as janelas EXPIRADAS. Se as 1000 ainda estão vigentes, nada sai e a inserção acontece mesmo assim. Hoje há chaves com IP (limitarPorOrigem em /api/sessao, /api/sessao/senha e /api/sessao/local, quando PROXIES_CONFIAVEIS>0), então muitas origens distintas por minuto fazem o mapa crescer. Nenhum teste exercita TETO_DE_CHAVES nem limparJanelasExpiradas (sessao.test.ts cobre só contagem e reinício). O arquivo é um dos de cobertura baixa (72%).
- **Vetor:** Anônimo com muitas origens (IPv6, ou uma cadeia forjável se o proxy estiver mal configurado) chamando POST /api/sessao atrás de um proxy confiável declarado.
- **Pré-condições:** PROXIES_CONFIAVEIS>0 e volume de origens distintas dentro da janela de 60 s.
- **Impacto:** Crescimento de memória limitado pela taxa de origens novas por minuto. É baixo em rede interna.
- **Causa raiz:** O comentário descreve um teto, mas o código implementa só uma limpeza oportunista.
- **Correção sugerida:** Depois de limpar, se ainda estiver acima do teto, descartar as janelas mais antigas (o Map preserva a ordem de inserção) ou recusar a criação.
- **Teste de regressão:** Inserir 1001 chaves distintas com janela longa e esperar `size <= TETO_DE_CHAVES`, expondo o tamanho só para teste.
- **Evidência do auditor:** limite-de-taxa.ts:46 `if (janelas.size >= TETO_DE_CHAVES) limparJanelasExpiradas()` seguido de `janelas.set(...)` incondicional

**Na correção (PR #70), a revisão de segurança achou um efeito colateral, corrigido no mesmo PR:** com um mapa só, abrir espaço despejava a chave mais antiga de QUALQUER rota. Um colaborador logado inundava `distribuir:<id>:<data>` (a data vem do corpo) e expulsava `ingestao:<id>` — zerando o próprio limite de custo da IA — ou o balde de `sessao`. Agora há um mapa por compartimento (o trecho antes do primeiro `:`, sempre escrito no código), cada um com o seu teto; teste com as duas sabotagens vistas vermelhas.

**Resíduo aceito (BAIXO):** dentro de `distribuir`, um colaborador ainda pode despejar o contador de outro. O efeito é só o outro recomeçar a contar cliques repetidos; e a chave já aceita qualquer data do corpo, então o limite por data nunca foi barreira contra quem quer contorná-lo. Não vale mapa por pessoa agora. O bloqueio por tentativas de senha mora no banco e não é alcançado por nada disto.

### N-38 — O token de aplicativo `.default` alcança toda caixa que a permissão permitir, e o código não tem como limitar

**INFORMATIVO** · credencial do Graph / menor privilégio · `src/adapters/ingestao-graph.ts:176` · dimensão `ingestao-anexos`

- **Descrição:** Com `Mail.Read` de aplicativo e escopo `https://graph.microsoft.com/.default`, o token lê qualquer caixa do tenant, a menos que o TI aplique RBAC for Applications ou Application Access Policy. A restrição a uma caixa só existe se o TI a configurar. No código, a caixa lida é só o valor de `GRAPH_CAIXA`, vindo do ambiente. O pedido ao TI já menciona a restrição (ESTADO.md:25). Fica registrado como verificação obrigatória no dia da credencial. O código também não troca mensagem de erro com segredo: o corpo de erro da Microsoft (até 300 caracteres) volta ao operador, o que é intencional e não contém o `client_secret`.
- **Vetor:** Credencial vazada ou `GRAPH_CAIXA` alterado apontando para outra caixa.
- **Pré-condições:** TI conceder `Mail.Read` sem política de escopo.
- **Impacto:** Leitura de caixas de toda a organização.
- **Causa raiz:** Depende de configuração externa.
- **Correção sugerida:** No dia da credencial, provar com `Test-ApplicationAccessPolicy` (ou RBAC for Applications) que outra caixa responde 403. Preferir certificado a segredo de cliente e registrar a data de expiração.
- **Teste de regressão:** Checklist manual de implantação: chamada a uma segunda caixa com o token precisa dar 403.
- **Evidência do auditor:** ingestao-graph.ts:176 `const ESCOPO = 'https://graph.microsoft.com/.default'`; :305 `/users/${encodeURIComponent(config.caixa)}/mailFolders/inbox/messages`

### N-39 — Colaborador recebe números da equipe inteira por categoria, a qualidade da IA e a contagem de itens por liga

**INFORMATIVO** · recorte-A24 · `src/app/api/painel/route.ts:33` · dimensão `telas-frontend`

- **Descrição:** GET /painel devolve porCategoria(banco, periodo) sem recorte por papel. GET /qualidade e GET /ligas só exigem sessão. O colaborador vê abertos, concluídos e pendentes do setor por categoria, a taxa de aceite da IA por modelo e, no seletor de liga da Caixa, a contagem de itens de todo o setor, enquanto a lista embaixo mostra só os itens dele. A24 restringe 'os números de cada pessoa', e esses são agregados, por isso não é defeito comprovado. O seletor '· 47', seguido de uma lista com 3 itens, repete a confusão que a frase da Caixa tenta evitar.
- **Vetor:** Colaborador abre o Painel ou o seletor de liga da Caixa.
- **Pré-condições:** Sessão de colaborador.
- **Impacto:** Nenhum dado pessoal é exposto. A decisão sobre o alcance dos agregados não está escrita, e as contagens por liga não conferem com a lista.
- **Causa raiz:** A24 fala de números por pessoa e não decide sobre agregados do setor.
- **Correção sugerida:** Registrar em DECISOES § H.4 a pergunta objetiva: 'o colaborador vê os totais do setor por categoria e a qualidade da IA?'. Enquanto isso, fazer /ligas contar só os itens que o papel alcança, para o número bater com a lista.
- **Teste de regressão:** Se o dono restringir: teste de rota em que o colaborador recebe só os agregados dos próprios itens.
- **Evidência do auditor:** porCategoria(banco, periodo) (painel/route.ts:33); await exigirAtor() sem papel (qualidade/route.ts:18, ligas/route.ts:19)

### N-40 — A assinatura de .docx/.xlsx aceita qualquer ZIP, .txt/.csv não têm verificação e `hash` nunca é preenchido

**INFORMATIVO** · upload / defesa em profundidade · `src/core/seguranca/assinatura-de-arquivo.ts:43` · dimensão `ingestao-anexos`

- **Descrição:** A conferência de tipo real existe e é aplicada, mas é rasa: um `.jar`, um `.zip` com executável ou um `.docm` renomeado para `.docx` passam, porque só o prefixo `PK\x03\x04` é conferido. `.txt`/`.csv` aceitam HTML, SVG ou fórmula CSV. Não há antivírus. `Anexo.hash` ('para deduplicar e provar integridade', segundo o schema) é sempre `null` na ingestão do Graph e em nenhum lugar é calculado. É nome de proteção sem a proteção. Hoje não existe rota de download nem de exibição de anexo (`armazenamento.ler` não tem chamador em `src/app`), então nada disso é explorável agora. Vira superfície no dia da rota de download.
- **Vetor:** Anexo ZIP renomeado para .docx ou CSV com `=HYPERLINK(...)`, aberto por um colaborador depois que houver download.
- **Pré-condições:** Existir rota de download.
- **Impacto:** Hoje nenhum. No futuro, arquivo malicioso entregue à equipe com o selo 'aceito'.
- **Causa raiz:** Verificação limitada ao prefixo, e o campo `hash` sem produtor.
- **Correção sugerida:** Quando o download existir: conferir `[Content_Types].xml` do OOXML e recusar macro; servir sempre com `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` e o tipo derivado da extensão validada; calcular SHA-256 na ingestão; avaliar antivírus da empresa; aplicar o recorte `A24` e auditar cada download.
- **Teste de regressão:** ZIP qualquer chamado `laudo.docx` precisa ser recusado. `hash` precisa ser preenchido com 64 caracteres hexadecimais depois da ingestão.
- **Evidência do auditor:** assinatura-de-arquivo.ts:43 `'.docx': [{ prefixo: [0x50, 0x4b, 0x03, 0x04] }]`; ingestao-graph.ts:167 `hash: null`

### N-41 — O CPF protegido é um HMAC correto, mas um dump do banco junto com o BUSCA_SECRET revela todos os CPFs

**INFORMATIVO** · criptografia / dados-sensiveis · `src/servidor/cpf-protegido.ts:36` · dimensão `mysql-dados`

- **Descrição:** `cpfProtegido` é HMAC-SHA256 com segredo (A23(b)), sem o CPF em claro, e isso está certo. Só que o CPF tem cerca de 10^9 valores válidos. Quem obtiver um backup do MySQL E o BUSCA_SECRET recalcula todos os códigos em minutos e reverte a coluna inteira, que não tem data de exclusão. Até o expurgo, o CPF em claro também fica em `Item.payload` e `Revisao.sugestaoIa`, por decisão do A23.
- **Vetor:** Vazamento conjunto do backup e do .env ou do gestor de segredos, por exemplo backup do servidor inteiro com .env incluído.
- **Pré-condições:** Acesso ao dump e ao segredo.
- **Impacto:** Todos os CPFs de associados já atendidos ficam identificáveis.
- **Causa raiz:** O espaço de entrada é pequeno, próprio do dado. A proteção depende só de o segredo ficar longe do backup.
- **Correção sugerida:** Na implantação, guardar o BUSCA_SECRET só no gestor de segredos (Infisical), fora do disco e de backups do servidor. Documentar isso no plano de backup (A46).
- **Teste de regressão:** Não se aplica (controle operacional). Checklist de implantação: backup não contém .env.
- **Evidência do auditor:** createHmac('sha256', ambiente().BUSCA_SECRET).update(cpf).digest('hex')

## 6. Controles conferidos como sólidos, e o que cada auditor não olhou

### api-autorizacao

**Sólido, com evidência:**

- Inventário: 35 arquivos route.ts em src/app/api (afastamentos, afastamentos/[id], afastamentos/hoje, assistente, assistente/aviso, categorias, colaboradores, colaboradores/{ativacao,destravar,habilitacao,senha}, diagnostico/origem, distribuicao/{previa,confirmar}, escala, fila, ingestao, itens, itens/busca, itens/[id]/{concluir,devolver,transferir}, ligas, memoria, notas, notas/[id], painel, qualidade, retencao, revisao, revisao/resolver, rodadas/[id], sessao, sessao/local, sessao/senha). Todas passam por rota(). Todas, exceto sessao (GET/POST/DELETE), sessao/local e sessao/senha, começam com exigirAtor(). Não há server actions ('use server' ausente) e nenhuma page.tsx lê o banco ou chama serviço direto (grep obterPrisma/servicos em src/app/*.tsx vazio), então a API é a única porta de dados.
- Sessão (src/servidor/sessao.ts): cookie HMAC-SHA256 com timingSafeEqual, validade de 12h, emitidoEm obrigatório; perfilAtual relê papel, ativo, senhaDefinidaEm e sessoesInvalidasAntes no banco a cada requisição (rebaixar, desativar, trocar senha e sair têm efeito imediato); exigirAtor recusa senha provisória em toda rota; sessão local só vale com a flag ligada e conta @exemplo.test.
- Invariante 5: Ator é tipo marcado construído só por atorDaSessao/ATOR_SISTEMA (ator.ts); nenhum esquema de entrada tem autor (PedidoDistribuicaoSchema, ResolucaoRevisaoSchema, RegistroManualSchema, NotaEntradaSchema, AfastamentoEntradaSchema, EscalaEntradaSchema e DefinicaoDeSenhaSchema, este sem campo de senha); todos os auditar() usam ator.colaboradorId.
- Mass assignment: os esquemas Zod são z.object (strip), então campo extra é descartado; papel só entra em CadastroDeColaboradorSchema (rota exclusiva de gestor); não existe rota de troca de papel; senhaFixa de definirSenhaProvisoria é o 4º parâmetro, inalcançável por HTTP (autenticacao.ts:262); capacidadeRelativa travada em literal(1).
- Guardas de papel conferidas no serviço: definirSenhaProvisoria, destravarConta e definirAtivacao (gestor, com trava de último gestor na transação); criarColaborador e definirHabilitacoes (gestor); registrar, encerrar, cancelar e listar afastamento (gestor); listarPrazos e alterarPrazo (gestor, com confirmarEncurtamento exigido pelo servidor); avisoDoGestor e marcarAvisoComoVisto (gestor); previa, confirmar, resolver, registrarManual, definirEscala, sincronizar e porCorrelacao/porEntidade (operador\|gestor). Guardas na rota: GET /api/colaboradores (gestor, resposta campo a campo sem senhaHash), GET /api/revisao e /api/rodadas/[id] (operador\|gestor, cobertas por autorizacao-de-rotas.test.ts), /api/diagnostico/origem (gestor), /api/ingestao (operador\|gestor).
- Autorização por objeto em itens: concluir exige ehOProprio sobre a atribuição ativa lida no banco (fila.ts:147); transferir e devolver exigem ser o dono ou operador\|gestor; minhaFila com ?colaborador= alheio exige operador\|gestor; arquivar nota exige ser o autor ou gestor; transferir recusa destino inexistente ou inativo e item concluído.
- Recorte A24: recorteDaCaixa (caixa.ts) aplicado em listarCaixa e resumirCaixa, e herdado por buscarPorChave; porPessoa filtra id=ator para colaborador; escala e afastamentos/hoje redigem o motivo por papel no servidor (rotuloDeAfastamento); porCategoria e conferirConservacao abertos por decisão registrada (AT-29).
- Memória: porEntidade com lista fechada sem 'Colaborador' (testado em memoria.test.ts:252); a falha 500 grava mensagemPersistivel, sem a alocação (memoria.test.ts:180).
- Limites de listagem: GET /api/itens com LimiteDeListagemSchema 1..500 e teto duplo em listarCaixa; busca com take 200; revisão com take 200 e total real; memória com take 201 e 'truncado'; conferirConservacao com janela e agregação no banco.
- Limite de taxa presente e chaveado por pessoa onde a identidade é conhecida: assistente 12/min, busca 20/min (antes de ler o corpo), ingestão 5/min, distribuição 10/min por data; por origem em sessao (20/min), sessao/senha (10/min) e sessao/local; origemDaRequisicao não confia em x-forwarded-for sem PROXIES_CONFIAVEIS.
- Busca por CPF só por POST (corpo, fora da URL); CPF vira protegerCpf antes da consulta; contagem por pessoa gravada no serviço depois do recorte (A48).
- Erros: stack trace e mensagem de 500 nunca chegam ao cliente; ErroOperacional expõe só mensagemPublica (http.ts).
- Distribuição concorrente serializada por TravaDeDistribuicao.upsert antes de qualquer leitura de crédito e replanejada dentro da transação (distribuicao.ts:390).
- Sessão local: 404 quando desligada, fora de loopback, sem Sec-Fetch-Site same-origin e application/json, ou com conta não sintética; entrada auditada antes do cookie.

**Não auditado:**

- Comportamento em execução: por regra desta auditoria, nenhum teste nem servidor foi rodado. As corridas (achados 1 e 5) e o CSRF de mesmo site (achado 2) foram provados por leitura de código e pela semântica documentada de InnoDB e SameSite, não por exploração controlada contra sbp_teste.
- Topologia de implantação (A46): hostname, portas, outros serviços no mesmo host ou domínio, proxy e TLS. Isso define se o achado 2 é explorável.
- Conteúdo exato gravado em LogAuditoria/EventoProcessamento pela ingestão (servicos/ingestao.ts) e o que porCorrelacao expõe desse ciclo ao operador; ingestão e IA ficaram fora desta dimensão.
- Força bruta e bloqueio de conta como negação de serviço (5 erros travam a conta de qualquer e-mail conhecido, inclusive de gestores), credenciais.ts e política de senha: dimensão de autenticação.
- Telas (src/app/*/page.tsx e componentes): conferido só que não acessam o banco; não conferi se oferecem ações que a API recusa nem a renderização de texto de notas e e-mails (XSS).
- Serviços de expurgo, retenção e rotinas além do uso de correlacaoId; scripts/ (expurgo.ts, recifrar-anexos.ts, dev-local.ts), que não são rotas HTTP.
- Implementação de A18 (lançamento de compensação na transferência, aviso de destino afastado): não existe no servidor, e não avaliei se isso é pendência registrada ou defeito.
- Privilégios do usuário MySQL e proteção append-only da trilha no banco (a aplicação conecta como root em desenvolvimento, segundo o roteiro).

### autenticacao-sessao

**Sólido, com evidência:**

- sessao.ts:72-82: HMAC-SHA256 com comparação em tempo constante (timingSafeEqual, tamanho conferido antes); o conteúdo do cookie só é lido depois de validar a assinatura (lerCookie:111).
- sessao.ts:115-129: validade conferida no servidor (expiraEm), cookie sem emitidoEm recusado, e o papel do cookie passa pelo PapelSchema e é ignorado a favor do papel do banco (perfilAtual:170-204).
- sessao.ts:183/196/202: toda requisição reconfere no banco se a conta está ativa, se senhaDefinidaEm bate com o cookie (troca ou redefinição revoga) e sessoesInvalidasAntes (logout revoga em todos os dispositivos); as colunas são DATETIME(3) (migration inicial_mysql:11,15), então a comparação em ms é íntegra.
- sessao.ts:135-142: cookie httpOnly, SameSite=Lax, Path=/, maxAge de 12h; DELETE /api/sessao apaga o cookie (maxAge 0) além de revogar.
- sessao.ts:249-253 + script de contagem: das 35 route.ts, todas as que mudam estado chamam exigirAtor/exigirAtorParaTrocaDeSenha, exceto /api/sessao (login) e /api/sessao/local (travas próprias); senha provisória bloqueia toda a API em exigirAtor, não só a tela.
- Nenhum handler GET muda estado (varredura dos GET das route.ts), então o Lax não é contornado por navegação GET; não existe server action ('use server' ausente em src).
- credenciais.ts: scrypt N=16384, r=8, p=1, sal aleatório de 16 bytes, derivado de 64 bytes, parâmetros gravados no hash, rehash na entrada, tetos contra hash corrompido (N, r, p, memória 256 MB, keylen 256), NFKC, timingSafeEqual; senha provisória com 96 bits do CSPRNG; a senha provisória não é escolhida pelo gestor (DefinicaoDeSenhaSchema sem campo de senha).
- autenticacao.ts:79-83,132: mensagem única para inexistente/inativo/senha errada, com gastarTempoDeConferencia e piso de 250 ms nos dois ramos de recusa (exceto o ramo de bloqueio, ver achado).
- autenticacao.ts:107-111 e 204-208: incremento atômico de tentativasFalhas; bloqueio progressivo com teto de 15 min (core/autenticacao.ts:66-72); a mesma trava protege trocarSenha, que exige a senha atual e recusa senha nova igual à atual.
- core/esquemas.ts:685-688: política de senha com mínimo de 10 e máximo de 200 caracteres (no estilo NIST, limitando o custo do hash).
- ambiente.ts:176-181: SESSAO_SECRET obrigatório com no mínimo 16 caracteres, validado na partida; sessao.ts:59-69 confere de novo.
- middleware.ts: CSP com nonce por requisição e 'strict-dynamic', sem 'unsafe-inline'/'unsafe-eval' em script-src de produção, frame-ancestors 'none', form-action/base-uri 'self', object-src 'none'; next.config.ts: nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS, poweredByHeader false.
- acesso-local: desligado responde 404; recusa conta fora de @exemplo.test (domínio reservado); marca `local` dentro da carga assinada, e perfilAtual derruba a sessão quando o acesso é desligado; scripts/dev-local.ts escuta em 127.0.0.1 e não repassa argumentos; a entrada é auditada antes da emissão do cookie.
- componentes/api.ts: não há open redirect (401 manda sempre para '/entrar' fixo); /entrar e /senha não leem parâmetro de retorno.

**Não auditado:**

- Nada foi executado (restrição da rodada): o comportamento do navegador (gravação de cookie Lax em POST cross-site de topo) e a montagem de requisicao.url pelo Next foram inferidos pelo código em node_modules, sem medição.
- Infraestrutura real (TLS, proxy, firewall, bind da porta, HSTS efetivo, domínio e sites vizinhos que definem o que é same-site): não há máquina publicada (A46).
- Valores do .env (só os nomes foram considerados): não conferi se ACESSO_LOCAL_SEM_SENHA, ANEXOS_SECRET ou SESSAO_SECRET estão definidos, nem com que força.
- Autorização por objeto e por campo nas demais rotas (dimensão de autorização/A24), além de conferir que chamam exigirAtor.
- src/app/api/colaboradores/route.ts, ativacao e habilitacao: não li se há mudança de papel sem reautenticação além do visto em autenticacao.ts.
- MFA para conta privilegiada: não existe; é decisão pendente do dono segundo o roteiro, e não foi tratada como defeito.
- Sessão sem expiração por inatividade (12h absolutas): não classificado, falta decisão registrada.
- Testes existentes (sessao.test.ts, acesso-local.test.ts, autenticacao.test.ts): não li nem rodei, então não verifiquei se falham quando a proteção é revertida.

### ia-conteudo-externo

**Sólido, com evidência:**

- Três camadas no e-mail: ia-estruturada.ts:130-134 aplica prepararConteudoExterno sobre assunto + corpo antes de qualquer chamada. A detecção roda no texto inteiro, antes do corte (conteudo-nao-confiavel.ts:122-133).
- Três camadas na pergunta do assistente: assistente-modelo.ts:77 passa a pergunta por prepararConteudoExterno. A rota limita a pergunta a 500 caracteres antes (esquemas.ts:287-289, route.ts:40).
- Nome e conteúdo de anexo não entram no prompt. Só assunto e corpo vão ao modelo (ia-estruturada.ts:130). O nome passa por validarAnexo, que tira caminho, caracteres de controle e formatação bidi (conteudo-nao-confiavel.ts:251-282).
- Remoção de marcador forjado é feita na forma dobrada (sem acento e sem variantes de largura) com a mesma expressão da detecção, e o corte é feito no texto original (conteudo-nao-confiavel.ts:165-179).
- A repetição não devolve texto do remetente às instruções: resumoDeValidacao só envia código do problema e caminho, trocando chaves que não sejam identificador por marcador, com limite de 600 caracteres (resumo-de-validacao.ts:57-93). O Gemini monta o ZodError sem `input` (ia-gemini.ts:215-221).
- Toda saída passa pelo Zod antes de ter efeito: RespostaDoModeloSchema.parse (ia-estruturada.ts:203), InterpretacaoSchema.parse (158) e RespostaDoModeloAssistenteSchema.parse (assistente-modelo.ts:145). modelo e versaoPrompt ficam fora do esquema do modelo (ia-estruturada.ts:61-71).
- Suspeita é OU entre regex e modelo e força revisão acima de qualquer outro gatilho (ia-estruturada.ts:163; ingestao.ts decidirRevisao: conteudoSuspeito é o primeiro teste). Desdobramento sempre passa por uma pessoa.
- Invariante 2: a IA não escolhe quem recebe. AiPort só devolve Interpretacao e o único chamador é ingestao.ts:277, fora da transação. Categoria desconhecida aborta a transação em vez de descartar o item (ingestao.ts CategoriaDesconhecidaError).
- Invariante 13: RespostaDoModeloAssistenteSchema não tem campo de ação. telaSugerida é um enum fechado (telas.ts:20), conferido de novo por papel no servidor (servicos/assistente.ts:164-167). O serviço do assistente não abre transação.
- Material do assistente filtrado por papel em código antes do prompt (conhecimento.ts:337-339, prompt.ts:238-255). O nome de quem pergunta não é enviado, e o único dado vivo é a contagem da própria fila.
- Invariante 12: nenhum adapter de IA ou do assistente recebe Banco nem lê LogAuditoria, EventoProcessamento ou Nota. Os imports de assistente-busca.ts, assistente-modelo.ts e core/assistente/* confirmam.
- Saída do modelo na tela sem HTML: nenhum dangerouslySetInnerHTML em src (git grep). A resposta do assistente é renderizada como texto (componentes/assistente.tsx:328), e href só aceita valores do enum de telas relativas.
- Tempo limite em toda chamada externa: Anthropic com timeout 120000 e maxRetries 2 (ia-anthropic.ts:75); Gemini com httpOptions.timeout 120000 e sem retryOptions, logo sem repetição do SDK (conferido em @google/genai 2.21 dist/node/index.cjs apiCall); Graph com AbortSignal.timeout 60000.
- Tipos do SDK Anthropic 0.125 conferidos: OutputConfig.effort aceita 'low', 'claude-sonnet-5' consta em Model, AuthenticationError e PermissionDeniedError existem como estáticos do cliente.
- Credencial recusada para o lote inteiro e, no assistente, não mostra a causa crua a quem não é operador (ports/assistente.ts:297-299). O texto da pergunta não entra em evento nem em log (servicos/assistente.ts:186-199, assistente-modelo.ts:83-89).
- O corpo do Graph é pedido como texto (`prefer: outlook.body-content-type="text"`, ingestao-graph.ts:280), então HTML com texto escondido não chega ao modelo.

**Não auditado:**

- Nenhuma chamada real à Anthropic ou ao Gemini (auditoria só de leitura, sem rede). Não sei se a API da Anthropic aceita o schema com `campos` fechado vazio nem como o modelo se comporta com ele. O que está provado é a transformação local.
- Conteúdo exato das mensagens de erro (ApiError do Gemini, BadRequestError de saldo na Anthropic): se ecoam parte da requisição e qual texto vem em cada caso. A classificação de 'saldo esgotado' vem da documentação do fornecedor, não foi medida.
- Correção fina dos índices de dobra.ts (mapeamento início/fim usado em delimitar) e cobertura completa das variantes Unicode. Não rodei os testes (proibido nesta rodada).
- Implementação de limite-de-taxa.ts (memória local, reinício, várias instâncias) e se o limite de 5/min vale com mais de um processo.
- Telas de Revisão e Caixa além do grep por HTML inseguro: exibição de assunto, remetente e sugestaoIa, e se o texto do atacante aparece para o colaborador.
- Script `ia:experimentar` e a rotina agendada da A50 (fora de src/ e do repositório).
- Os achados de ingestão fora da dimensão IA (TETO_POR_SINCRONIZACAO de 200 contra a caixa inteira, download repetido de anexos) ficaram para a dimensão de ingestão.
- Esta worktree está no commit 5503ecd (branch chore/processo-de-verificacao). Confirmei com git diff que src/ é igual ao da branch docs/auditoria-rodada-seguranca-qualidade. O roteiro e as decisões A49-A54 foram lidos do checkout principal.

### ingestao-anexos

**Sólido, com evidência:**

- Graph só leitura: ingestao-graph.ts:227-291 só faz POST ao endpoint de token e GET em `${RAIZ}${caminho}`. Não existe PATCH, DELETE, move nem send no adapter (A5).
- Só a Inbox (AT-33): ingestao-graph.ts:305 usa `/mailFolders/inbox/messages`, com teste em ingestao-graph.test.ts:178.
- Paginação sem SSRF: ingestao-graph.ts:321 remove o prefixo do nextLink e reconcatena com `RAIZ` fixo. Mesmo com um nextLink de outro host, a URL resultante continua com host graph.microsoft.com, então o Bearer só vai para a Microsoft. Nenhum outro `fetch` no servidor (grep em src: só ingestao-graph.ts e componentes/api.ts, relativo). Links do corpo nunca são seguidos.
- Parâmetros do Graph codificados: `encodeURIComponent` em tenantId (:228), caixa (:305, :327) e id da mensagem (:327).
- Credenciais do Graph: falta de variável é acusada por nome (:194-204), só os NOMES aparecem na mensagem e nenhum valor é registrado em log. O cache do token tem margem de 60 s.
- Nome de anexo nunca vira caminho: armazenamento-disco.ts:414-416 sorteia 16 bytes aleatórios para a chave. A extensão só entra se casar `^\.[a-z0-9]{1,10}$`. validarAnexo (conteudo-nao-confiavel.ts:260) remove componentes de caminho e caracteres de controle ou invisíveis.
- Path traversal na leitura e na remoção: `caminhoDe` (armazenamento-disco.ts:129-140) resolve e exige prefixo `raiz + sep`, com teste em armazenamento.test.ts:71 (`'../../malicioso'`).
- Gravação sem sobrescrita: `writeFile(..., { flag: 'wx' })` em :423.
- Cifra em repouso AES-256-GCM com IV aleatório de 12 bytes por arquivo e tag de 16 bytes verificada (armazenamento-disco.ts:111-116, 181-195). Arquivo truncado falha com nome (:154).
- Sentinela da chave: conferência antes de qualquer gravação e leitura (:413, :434) e antes da primeira chamada de IA (servicos/ingestao.ts:97-112). A publicação é atômica via `link`, e a promessa é compartilhada contra corrida no mesmo processo.
- Allowlist por extensão + assinatura real: servicos/ingestao.ts:281-295. `tipoDeclarado` (MIME do cliente) nunca é usado para decidir, só é gravado. Anexo divergente ou recusado não vai para o disco (:300) e força revisão com motivo 'anomalia' (:615).
- Anexo acima do teto não derruba o e-mail: AnexoSchema sem `.max` em tamanho (esquemas.ts:323). O adapter entra só com o metadado (ingestao-graph.ts:151-168).
- Idempotência por messageId: checagem antes da IA (ingestao.ts:118), segunda checagem dentro da transação (:359) e índice único no banco. P2002 é contado como duplicado (:192). Colação `utf8mb4_0900_as_cs` aplicada a `Email` e `Anexo` pela migração 20260916170000 (linhas 24 e 26), então messageIds que só diferem em maiúsculas não colidem (AT-34).
- Identificador estável: `internetMessageId` em vez do `id` do Graph (ingestao-graph.ts:120), então mover a mensagem de pasta não a duplica.
- Autorização da sincronização: rota exige sessão e papel operador/gestor (app/api/ingestao/route.ts:24-25), com checagem repetida no serviço (servicos/ingestao.ts:58) e limite de 5 por minuto por colaborador.
- Mensagem de erro de armazenamento não vaza caminho do servidor (servidor/rota-armazenamento.test.ts).
- Expurgo de bytes: remove antes de carimbar e carimba em transação. Falha deixa o e-mail pendente e sobe erro nomeado (expurgo-conteudo.ts:107-157). A trilha não guarda nome de anexo (:132).
- Nome de anexo não entra no prompt da IA (grep em ia-estruturada.ts sem ocorrência), então essa superfície de injeção é nula hoje.

**Não auditado:**

- Controle de acesso ao download de anexo (A24) e sua trilha: não existe rota de download nem de exibição (`ArmazenamentoPort.ler` não tem chamador em src/app). Precisa ser auditado quando for criada.
- Conexão real com o Microsoft 365: escopo efetivo da permissão (Application Access Policy/RBAC), expiração do segredo, comportamento real de `size`, `contentBytes`, `hasAttachments` e anexos inline, limites reais de Message-ID e assunto no Exchange Online. Sem credencial (A47 pendente com o TI).
- Adapters imap e gmail: aceitos pelo esquema de ambiente, mas não implementados (fábrica lança AdapterIndisponivelError).
- Comportamento de `rota()` com ZodError vindo do adapter (qual status e texto chega ao operador): não li src/servidor/http.ts inteiro.
- Permissões do sistema de arquivos de ARMAZENAMENTO_DIR, backup da pasta, antivírus e isolamento no servidor real: infraestrutura inexistente (A46).
- Ramo legado em texto puro do `decifrar` (arquivo sem cabeçalho aceito como legítimo): é decisão registrada (DECISOES § C/AT-12), por isso não entrou como achado, mas significa que quem tem escrita no disco pode trocar um anexo cifrado por conteúdo arbitrário sem a GCM acusar.
- Não rodei testes nem consultas ao MySQL (regra da rodada). O P2000 do achado de messageId foi deduzido do DDL (VARCHAR(191)) e do sql_mode estrito padrão do MySQL 8, não reproduzido.
- Worktree auditado: .worktrees/processo (branch chore/processo-de-verificacao). Conferi que `src` e `prisma` são idênticos aos da branch docs/auditoria-rodada-seguranca-qualidade (git diff vazio).

### mysql-dados

**Sólido, com evidência:**

- src/servicos/painel.ts:431: a única consulta crua da aplicação usa `$queryRaw` em template e passa `${desde}` como parâmetro, sem concatenação. src/servidor/colacao.test.ts:51 também usa template. Nenhum `$queryRawUnsafe`/`$executeRawUnsafe`/`Prisma.raw` no código (grep).
- Colação AT-34: a migração 20260916170000 converte as 27 tabelas, ContagemDeBusca inclusive, para utf8mb4_0900_as_cs, e src/servidor/colacao.test.ts:49-60 varre information_schema e falha se alguma coluna escapar.
- Driver MySQL: package.json `overrides` força mariadb ^3.5.4, e package-lock resolve 3.5.4, fora da faixa dos GHSA do AT-31.
- Atribuição única ativa: `@@unique([itemId, ativa])`, com `ativa` NULL quando encerrada, garante no banco um responsável por item. Há teste em src/servicos/pipeline.test.ts:618.
- Idempotência: `Email.messageId @unique`, com checagem dentro da transação (ingestao.ts:360) e `ehViolacaoDeUnicidade` contando a corrida perdida como duplicado. `ExecucaoDeRotina @@unique([rotina, data])` impede limpeza dupla no mesmo dia. SaldoCarga, SaldoCargaGlobal e Escala têm únicos compostos.
- Livro-razão e memória: SaldoCarga, SaldoCargaGlobal, Nota, Afastamento, Execucao.colaborador e Item.email são RESTRICT na migração (linhas 446, 455, 482-503).
- Contador de tentativas de login é atômico: autenticacao.ts faz `update({ data: { tentativasFalhas: { increment: 1 } } })` e usa o valor devolvido, sem ler e depois escrever.
- ContagemDeBusca: `updateMany` com increment, `create` e retry em P2002/P2034 (contagem-de-buscas.ts). Nunca guarda o termo buscado. A limpeza apaga por `dia <= corte`.
- CPF: só o HMAC-SHA256 versionado (`v1:`) é gravado em `Item.cpfProtegido` (cpf-protegido.ts:36), e a busca usa o mesmo HMAC (caixa.ts:153) com `take` limitado (caixa.ts:70, máx. 500).
- Trilha sem dado pessoal nos caminhos conferidos: afastamento grava o tipo já reduzido (afastamentos.ts:134), os expurgos gravam só contagens (expurgo-conteudo.ts:131, expurgo-dados-do-item.ts:209, expurgo-lgpd.ts:112), a justificativa grava só que houve texto (fila.ts:273) e as notas gravam só o tamanho do texto (notas.ts:188).
- EventoProcessamento: `detalhe` passa por `redigir` recursivo (observabilidade.ts:103), e a mensagem de erro por `mensagemPersistivel`, que grava só o nome da classe para erro que não é de domínio.
- Expurgos não apagam dado operacional: expurgo-conteudo.ts apaga só EmailConteudo, anula `chaveArmazenamento` e carimba o Email. expurgo-dados-do-item.ts reescreve título e payload e apaga só JustificativaDeAtribuicao. expurgo-lgpd.ts só limpa observação e reduz o tipo. Cada item/e-mail tem sua transação, e a falha termina alta. `remover` do armazenamento é idempotente (`rm force`, armazenamento-disco.ts:452).
- limpar-transacional.ts recusa sem o opt-in explícito `PERMITIR_LIMPEZA=sim`, além de recusar NODE_ENV=production.
- Consultas de memória são limitadas e indexadas: memoria.ts:226-235 e :274 usam `take: LIMITE_POR_TABELA + 1` sobre os índices `[correlacaoId]` e `[entidade, entidadeId]`, com lista fechada de entidades consultáveis.
- Índices das consultas quentes existem: Item `[categoriaId, status, criadoEm]`, `[cpfProtegido]`, `[matricula]`, `[dadosExtraidosExpurgadosEm]`; Execucao `[resultado, concluidoEm]`; Afastamento `[motivoExpurgadoEm]`; SaldoCarga/SaldoCargaGlobal cobertos pelos únicos compostos usados em `findFirst ... orderBy data desc`.
- Nenhum segredo do .env foi lido. .env.example traz só nomes e comentários, e ci.yml usa valores públicos declarados para banco efêmero.

**Não auditado:**

- O MySQL em execução não foi consultado, por regra da rodada: privilégios reais do usuário, sql_mode (estrito ou não, o que muda o achado do messageId), colação efetiva das bases sbp/sbp_teste, lower_case_table_names, TLS e bind-address.
- O comportamento do `upsert` do Prisma 7 com PrismaMariaDb (nativo ou emulado com SELECT) não foi provado rodando. O achado da TravaDeDistribuicao está como plausível e precisa do teste concorrente descrito.
- Infraestrutura de produção (A46): backups, cifra em repouso do volume do MySQL, firewall/porta 3306, separação dev/teste/produção.
- scripts/recifrar-anexos.ts, scripts/demo.ts, scripts/dev-local.ts e prisma/seed.ts foram só varridos por grep, sem leitura integral.
- Autorização por papel e por objeto das rotas de API que chamam estes serviços (outra dimensão). Rotas de sincronização: não conferi se existe trava contra sincronizações concorrentes além do comentário em ingestao.ts:128.
- N+1 e desempenho sob volume real não foram medidos: carregarElegiveis faz 4 consultas por elegível por categoria, e aprovarTodosPendentes faz 2 updates por revisão numa só transação.
- O roteiro do dono só existe no branch docs/auditoria-rodada-seguranca-qualidade (lido por `git show`). O código auditado é o do worktree atual (branch chore/processo-de-verificacao, HEAD 5503ecd), que pode diferir do branch da rodada.

### negocio-concorrencia

**Sólido, com evidência:**

- schema.prisma:489 `@@unique([itemId, ativa])` com `ativa Boolean?`: o InnoDB aceita vários NULL, então o banco garante no máximo um responsável ativo por item. Duas `transferir` simultâneas terminam com P2002 na segunda, e não com dois responsáveis.
- distribuicao.ts:566-577: `item.updateMany` condicionado a `status in ['aprovado','devolvido']`, com conferência `gravadas.count === fatia.length && marcados.count === fatia.length`. O UPDATE lê a versão atual mesmo em REPEATABLE READ, então uma foto velha não redistribui item já distribuído: a transação aborta.
- distribuicao.ts:602-607: segunda trava de conservação (Σ atribuídos == quantidadeEntrada) sobre o que o banco confirmou ter gravado, dentro da transação. motor.ts:109-112: trava aritmética. motor.ts:236-261: grupos coerentes (soma, chave única, tamanho ≥ 1). motor.ts:272-280: ids únicos.
- distribuicao.ts:219-222: só `SemElegiveisError` vira resultado; `ConservacaoVioladaError` e os demais erros sobem, e http.ts:58 mapeia CONSERVACAO_VIOLADA para 500.
- distribuicao.ts:407: `confirmar` replaneja dentro da transação com a mesma função da prévia; tudo ou nada entre as categorias do dia.
- distribuicao.ts:665-698: `SaldoCarga` e `SaldoCargaGlobal` acumulam `recebido`, `cotaJusta` e `creditoGlobal` por incremento no banco, e não por ler-somar-gravar. distribuicao.ts:722-753: a distribuição retroativa propaga o delta para as datas posteriores.
- fila.ts:135 e rota concluir (CorpoSchema só com `observacao`): quem conclui vem do Ator, nunca do corpo (invariante 5). fila.ts:198-200 e 310-312: mexer em item alheio exige papel operador ou gestor.
- fila.ts:214 e 313: item com status `concluido` (lido) não é transferido nem devolvido fora de corrida. fila.ts:240: destino inativo é recusado.
- itens.ts:133-137: registro manual valida categoria, coerência rateio × responsável e responsável ativo antes de criar qualquer item, tudo numa transação só.
- revisao.ts:266-271 e schema `@@unique([emailId, sequencia])`: itens extras de item vindo de e-mail, criados em resoluções concorrentes, colidem e abortam (só o item manual escapa, ver achado).
- Ingestão idempotente: schema.prisma:239 `messageId @unique` e ingestao.ts:258-264, onde P2002 é reclassificado como duplicado.
- contagem-de-buscas.ts:36-70: trata corretamente P2002 e P2034 do InnoDB, com incremento no banco e novas tentativas limitadas.
- transferir e devolver não estornam crédito (decisão AT-07), o que impede usar a devolução para manipular a própria carga; o código cumpre a decisão.

**Não auditado:**

- Nenhuma prova empírica contra o MySQL: pela regra desta auditoria, não rodei testes nem capturei o SQL gerado. A afirmação de que o upsert do Prisma no MySQL é ler e depois gravar vem da ausência de 'ON DUPLICATE KEY' no compilador wasm de MySQL, da presença de 'ON CONFLICT' no de PostgreSQL e do comentário de contagem-de-buscas.ts. Confirmar com log de consultas na sbp_teste.
- Timeout padrão (5 s) da transação interativa do Prisma em `confirmar` com o volume real, com a trava do dia segurada, e deadlock (P2034) em `confirmar`, que não tem nova tentativa e cai como 500.
- Nível de isolamento efetivo do servidor MySQL de produção (pode não ser o padrão REPEATABLE READ) e parâmetros do pool do adapter mariadb: não há máquina (A46).
- Concorrência em escala.ts e afastamentos.ts (escala ou afastamento alterados durante a distribuição), em notas, expurgos e rotinas, e no painel (consulta crua de conservação).
- Rotas src/app/api/rodadas/[id] e src/app/caixa/page.tsx: li só o necessário para confirmar que expõem concluir, transferir e devolver.
- Histórico de habilitação: `vigenciaFim` nunca é gravado e o desligamento é um flag, então a distribuição retroativa usa a habilitação atual, não a do dia. Não virou achado por falta de decisão registrada que diga o contrário.
- Cobertura de teste real da trava do dia sob MySQL: o teste existente confere só a ordem das chamadas na API.

### falhas-silenciosas

**Sólido, com evidência:**

- src/servidor/http.ts:78-170 — rota(): erro inesperado vira 500 com mensagem genérica e correlacaoId; a pilha vai só para registrarLog (stderr); o evento da falha é gravado com mensagemPersistivel e tem try/catch próprio que não substitui o erro original; a mensagem ao usuário muda quando o registro falha (sem promessa falsa de rastreabilidade).
- src/servidor/http.ts:57-59 e observabilidade.ts (mensagemPersistivel) — ConservacaoVioladaError vai para 500 e não expõe a alocação nem ao cliente nem à memória consultável.
- src/core/erros.ts:62 — ErroOperacional.statusHttp é do tipo 422 \| 503, o que impede por tipo uma subclasse de 500 atravessar rota() sem correlação; ports/armazenamento.ts:58 FalhaDeArmazenamento.mensagemPublica esconde o caminho absoluto do servidor.
- src/servidor/observabilidade.ts:39-55 — redigir() é recursivo (até 6 níveis) e cobre senha, token, apikey, secret, cpf, crm e corpo, inclusive em EventoProcessamento.detalhe. Limite: a redação é por nome de chave e não alcança PII dentro de uma string de mensagem.
- src/servidor/http.ts:311-356 — corpoJson e corpoJsonOpcional registram corpo ilegível em vez de engolir.
- src/servicos/ingestao.ts:96-111 — a chave dos anexos é conferida antes de qualquer chamada de IA; ingestao.ts:196-209 — InterpretacaoIndisponivelError para o lote em vez de repetir; P2002 é contado como duplicado; ingestao.ts:326-347 e 436-438 — desfazerArquivos na transação abortada, com log do órfão se a remoção falhar.
- src/adapters/ia-estruturada.ts:204-243 — falha de validação é registrada e reenviada ao modelo só como resumo estrutural (sem texto do e-mail); credencial recusada vira InterpretacaoIndisponivelError; ia-gemini.ts:187-217 — resposta vazia e JSON inválido viram erro explícito, sem ecoar a resposta crua.
- src/servicos/distribuicao.ts:205-222 — só SemElegiveisError vira resultado; ConservacaoVioladaError e outros defeitos são relançados; distribuicao.ts:796-803 — categoria com cadastro inválido sai nomeada no log, na tela e no evento, sem derrubar as outras.
- src/servicos/expurgo-conteudo.ts:106-162 e expurgo-dados-do-item.ts:225-240 — laço por item com log por falha e erro final que conta o que ficou; bytes removidos antes da transação são idempotentes na nova tentativa (remover usa force).
- src/adapters/armazenamento-disco.ts:337-373 e 428-445 — ENOENT é o único caso tratado como ausência; qualquer outra falha sobe como FalhaDeArmazenamento; o .tmp da sentinela é apagado em finally, com aviso se falhar.
- src/servicos/contagem-de-buscas.ts:49-58 — repete só em deadlock P2034, no máximo 3 vezes, e depois falha alto; a busca espera a contagem com await (caixa.ts:162).
- src/servidor/sessao.ts:113-133 e 160-213 — cookie ilegível, sem emitidoEm, com senha trocada, revogado, de conta inativa ou de sessão local fora das condições devolve null (fail-closed); exigirAtor bloqueia senha provisória em toda rota.
- src/core/lido-do-banco.ts:16-23 — valor de domínio inválido lido do banco vira Error comum (500 com correlação), e não ZodError/400; usado em distribuicao, aviso-do-gestor e expurgo-lgpd.
- src/servidor/ambiente.ts — segredos sem valor padrão (BUSCA_SECRET com mínimo de 16); src/app/api/ingestao/route.ts usa a fábrica, e adapter inexistente lança AdapterIndisponivelError em vez de cair no mock em silêncio.
- src/instrumentation-node.ts:40-80 e servicos/rotinas.ts:70-110 — a limpeza agendada nunca derruba o servidor, registra em log a falha de carga e de início, e usa uma linha única (rotina, data) com contagem de tentativas e detecção de execução abandonada.
- src/servicos/assistente.ts:111-132 — o único catch que engole no serviço registra a falha em log de nível erro e está justificado (registro de uso não bloqueia a resposta).
- git grep: nenhuma chamada a registrarEvento, auditar, auditarLote, contarBusca, guardar, remover ou conferirChave sem await/return em src/ e scripts/; nenhuma rota de API tem try/catch próprio (todas passam por rota()).
- scripts/limpar-transacional.ts:28-39 — trava por opt-in explícito (PERMITIR_LIMPEZA=sim), além de recusar em NODE_ENV=production.

**Não auditado:**

- Não rodei testes, servidor nem banco (regra da rodada). Todo cenário acima foi provado só por leitura de código; nenhum foi reproduzido.
- Conteúdo real das mensagens de erro do Prisma 7 e dos SDKs Anthropic e Gemini (se trazem valores de coluna ou trechos do pedido), que entram em log por mensagemDoErro nos ramos 500 e de transporte.
- Comportamento do Next 16 quando instrumentation.register rejeita, e se o setInterval da limpeza sobrevive a recargas em produção.
- Serviços itens.ts, fila.ts (concluir, transferir, devolver), afastamentos.ts, notas.ts, colaboradores.ts, escala.ts, retencao.ts, painel.ts e memoria.ts: só amostrados quanto a catch e escrita fora de transação; não li cada caminho de falha no meio.
- ehCredencialRecusada de ia-anthropic.ts e ia-gemini.ts (a classificação errada de um erro de credencial como transporte geraria repetição por e-mail).
- Telas em src/app/*/page.tsx e componentes: vi só os catch da caixa, da distribuição e do cliente api.ts; não conferi cada .catch(() => ...) de UI (por exemplo, notas.tsx:157 e caixa.tsx:162, que degradam para vazio).
- Não há regra de lint no-floating-promises configurada; a ausência de promessa sem await foi conferida por grep nas funções principais, não por ferramenta.
- Retenção, rotação e destino dos logs de stdout e stderr (infraestrutura inexistente, A46).
- scripts/demo.ts e scripts/dev-local.ts não foram lidos por inteiro.

### supply-chain-config

**Sólido, com evidência:**

- package-lock.json (lockfileVersion 3): todo `resolved` aponta para https://registry.npmjs.org/. Nenhum registro não oficial. Todos os pacotes têm `integrity`, exceto 6 pacotes embutidos (bundled) de @tailwindcss/oxide-wasm32-wasi, o que é normal nesse caso.
- Override AT-31 aplicado: package.json:overrides força mariadb ^3.5.4, e o lockfile resolve node_modules/mariadb 3.5.4, fora da faixa 3.4.0–3.4.5 do GHSA-cqhc-2h57-wpxf. Também resolve deepmerge-ts 8.0.2 e mysql2 3.24.3.
- Scripts de instalação no lockfile: só @google/genai (preinstall que não faz nada), @prisma/engines, prisma, protobufjs, esbuild, fsevents e better-sqlite3. package.json não tem pre/postinstall próprio.
- ci.yml: `permissions: contents: read` no topo. Só o job de gitleaks sobe para `pull-requests: read`. Os gatilhos são `push` e `pull_request` para a main, sem `pull_request_target` e sem uso de `github.event.*` em `run:`, o que descarta injeção de script por título ou branch.
- ci.yml: o MySQL do CI é um serviço efêmero, com root sem senha, sem porta exposta além do runner. DATABASE_URL/SESSAO_SECRET/BUSCA_SECRET do CI são valores declaradamente públicos, e não segredos do repositório.
- codeql.yml: desarmado (só workflow_dispatch), com o motivo registrado (plano free). Permissões mínimas por job.
- dependabot.yml: cobre npm (semanal) e github-actions (mensal).
- Histórico git (87 commits, `git log --all -p`): nenhuma credencial real nos padrões AIza, sk-ant-, ghp_/gho_/github_pat_, AKIA, BEGIN PRIVATE KEY, xox*, e nenhuma connection string com senha. Só aparecem os placeholders `mysql://usuario:****@`. `.env`, `*.db`, `*.pem` e `armazenamento/` nunca entraram no histórico.
- .gitignore: ignora .env e .env.* (com exceção de !.env.example), *.pem/*.key/*.p12/*.pfx, *.db*, armazenamento/, src/generated/, coverage/ e .worktrees/. `git ls-files` não lista nenhum desses; `git check-ignore` confirma dev.db e .worktrees.
- .env.example: todos os segredos estão vazios (ANTHROPIC_API_KEY, GOOGLE_AI_KEY, GRAPH_CLIENT_SECRET, SESSAO_SECRET, BUSCA_SECRET), e a DATABASE_URL usa só os literais usuario:senha. Com SESSAO_SECRET/BUSCA_SECRET vazios, o sistema não sobe (ambiente.ts:61,125).
- ambiente.ts: validação Zod na partida, com erro claro (linhas 197-203). Os segredos obrigatórios não têm valor padrão. Um adapter real de IA sem chave recusa subir (linhas 222-230). ACESSO_LOCAL_SEM_SENHA=1 com NODE_ENV=production recusa subir (linha 208), e acesso-local.ts:45 confere de novo. ARMAZENAMENTO_DIR vazio é recusado (linha 83). ANEXOS_SECRET vazio equivale a ausente (linha 106). A variável aceita só '0' ou '1', e um valor torto falha alto.
- Nomes das variáveis no .env local (valores não lidos): DATABASE_URL, IA_ADAPTER, GOOGLE_AI_KEY, ANTHROPIC_API_KEY, IA_MODELO, INGESTAO_ADAPTER, ARMAZENAMENTO_DIR, PROXIES_CONFIAVEIS, SESSAO_SECRET, BUSCA_SECRET.
- scripts/dev-local.ts: sobe o Next com `--hostname 127.0.0.1`, sem shell e sem repassar argv, o que impede reabrir em 0.0.0.0 com `-- --hostname`.
- scripts/limpar-transacional.ts:29-39: recusa rodar em produção e exige o opt-in explícito PERMITIR_LIMPEZA=sim.
- prisma/seed.ts:68-132: a senha provisória é sorteada a cada execução e não fica no repositório. Quem já tem senha não é tocado.
- next.config.ts: poweredByHeader:false; nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy e HSTS em todas as rotas. src/middleware.ts aplica CSP com nonce e 'strict-dynamic', sem 'unsafe-inline' em script-src em produção. O .next/server/middleware-manifest.json confirma que o middleware está ativo no build (Next 16.3.5).
- sessao.ts:140: cookie `secure` quando NODE_ENV=production. A assinatura é conferida em tempo constante, e senhaEm/sessoesInvalidasAntes são conferidos no banco (linhas 196-201).

**Não auditado:**

- Configurações do GitHub fora do repositório: proteção da main, obrigatoriedade de revisão do CODEOWNERS (hoje com um dono só, que não aprova o próprio PR), alertas e atualizações de segurança do Dependabot, secret scanning e push protection.
- Se as tags actions/checkout@v7, actions/setup-node@v7 e gitleaks/gitleaks-action@v3 existem e para qual commit apontam hoje (sem acesso de rede nesta auditoria).
- Resultado atual do `npm audit` e das vulnerabilidades transitivas: não rodei comandos npm, por regra. Também não verifiquei se node_modules bate com o lockfile.
- Conteúdo de .claude/reviews/ (não rastreado e fora do .gitignore), de .worktrees/processo e dos artefatos em .next/ e coverage/.
- Privilégios do usuário MySQL de produção e TLS na conexão (DATABASE_URL sem parâmetros de SSL; depende da infraestrutura real, A46).
- Se senhaDefinidaEm ou colaboradorId aparecem em alguma resposta de API (define até onde vai o forjamento de cookie no achado de segredo fraco). Pertence à dimensão de API/sessão.
- Comportamento do ia-mock com texto real (qual classificação ele devolve) e se alguma tela mostra o adapter em uso.
- Configuração do gitleaks: não há .gitleaks.toml, então valem as regras padrão. Não confirmei se o job pega o valor de teste do vitest nem se há supressões.

### testes-contratos

**Sólido, com evidência:**

- CI (.github/workflows/ci.yml) roda tudo que `npm run verificar` roda (typecheck + npm test), e mais: prisma migrate diff --exit-code, next build, gitleaks e npm audit --audit-level=high, com MySQL 8.4 e a colação utf8mb4_0900_as_cs da implantação.
- vitest.config.ts: fileParallelism:false (base compartilhada), DATABASE_URL do ambiente com precedência, BUSCA_SECRET público só para teste; o include cobre src e scripts, e não existem arquivos .test.tsx fora do include.
- tsconfig.json: strict, noUncheckedIndexedAccess e exactOptionalPropertyTypes. Não há `any` explícito em código de produção; os `as` de fronteira são poucos (sessao.ts:114 só depois do HMAC em tempo constante, com o papel revalidado por PapelSchema).
- src/core/pureza.test.ts: guarda de dependências do núcleo em allowlist (só zod; nos testes, vitest e 3 builtins nomeados), e varre a si mesmo.
- Motor: motor.test.ts cobre borda (Q=0, n=1, Q=1, indivisível), determinismo e soma de créditos ≈ 0; simulacao.test.ts faz 1000 casos com seed fixa para conservação, 5000 rodadas sem drift e 30 dias de balanceamento. ordenacao.ts termina o desempate por colaboradorId (ordem total).
- conservacao-na-escrita.test.ts sabota a alocação e prova que a transação aborta antes do commit; pipeline.test.ts:618 prova, no banco, que o mesmo item não fica com dois responsáveis ativos.
- sessao.ts: HMAC com timingSafeEqual, recusa de cookie sem emitidoEm, papel/ativo/senha relidos do banco a cada requisição (sessao.ts:176-204). O código está correto, a lacuna é de teste (achado acima).
- exigirAtor (sessao.ts) bloqueia senha provisória em toda rota; toda rota em src/app/api chama exigirAtor/atorAtual, exceto sessao (login/local), que usa limitarPorOrigem.
- ia-gemini.ts:196-215: SyntaxError vira ZodError sem `input`; vazamento-na-repeticao.test.ts prova que texto de fora não volta às instruções no caminho do núcleo.
- fronteira-do-fornecedor.test.ts: só a fábrica importa ia-<nome>.ts; fabrica.ts falha alto para adapter desconhecido (AdapterIndisponivelError).
- http.ts origemDaRequisicao: http.test.ts cobre cabeçalho forjado sem proxy, 1 e 2 saltos, x-real-ip e cadeia curta.
- FalhaDeInterpretacao é ErroOperacional, não ErroDominio, então mensagemPersistivel grava só o nome da classe em EventoProcessamento (observabilidade.ts:125-130). A causa crua não chega à memória permanente.
- Datas fixas conferidas (painel-periodo, contagem-de-buscas, retencao, aviso-do-gestor): o 'hoje' é injetado por parâmetro, sem bomba-relógio encontrada; os casos antigos (conservacao-nao-e-ruido, liga-nao-se-parte) já foram trocados por hojeIso().

**Não auditado:**

- Não executei a suíte nem a cobertura (proibido nesta rodada). As afirmações sobre cobertura vêm de leitura e contagem de chamadas, não de relatório v8.
- A forma exata do upsert do Prisma 7.10 em MySQL (motor em wasm) não foi confirmada. O achado da trava do dia está marcado como PLAUSÍVEL e precisa de um teste concorrente no MySQL.
- O comportamento real da decodificação restrita da Anthropic com chaves > 60 caracteres em `campos` não foi medido (sem chave, sem gasto).
- Componentes React (src/componentes, src/app/**/page.tsx): não há testes, e não verifiquei XSS nem exposição na tela.
- scripts/ (expurgo, recifrar-anexos, dev-local, experimentar-ia) e scripts/processo/conferir-pr.ts: só constatei que existe nivel-de-risco.test.ts.
- ingestao-graph.ts, armazenamento-disco.ts e assistente-modelo.ts: não revisei a fundo os testes dessas fronteiras.
- Uso de CSRF por Content-Type (corpoJson aceita text/plain) com cookie SameSite=lax: cabe a outra dimensão; não conferi a proteção por Origin fora de /api/sessao/local.
- Infraestrutura real (TLS, proxy, usuário MySQL), por não haver máquina (A46).

### telas-frontend

**Sólido, com evidência:**

- Nenhum dangerouslySetInnerHTML, innerHTML, eval, window.open, target=_blank ou href com 'javascript:' em src/: git grep só achou uma menção em comentário (notas.tsx:27). E-mail, nota, resposta da IA e justificativa são renderizados como texto do React.
- O único href com valor vindo de dados é assistente.tsx:333 (telaSugerida). Ele é fechado por z.enum(TELAS) em core/assistente/esquemas.ts:62 e passa pela conferência de papel papelAlcancaTela em servicos/assistente.ts:89-92. A busca local usa verbete.tela, tipado como Tela (conhecimento.ts:61).
- Nenhum localStorage, sessionStorage, document.cookie ou variável NEXT_PUBLIC_ em src/. A conversa do assistente vive só no estado do componente (assistente.tsx:97).
- CSP com nonce por requisição e 'strict-dynamic', sem 'unsafe-inline' em script-src, e 'unsafe-eval' só fora de produção (middleware.ts:37-53). Também presentes frame-ancestors 'none', object-src 'none', base-uri e form-action 'self'. Em next.config.ts: X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy e poweredByHeader desligado.
- Busca por CPF: o campo não está dentro de <form>, e o texto vai só no corpo de POST /itens/busca (caixa/page.tsx:250 e 304-321). Nada vai para a URL, e o campo tem autoComplete=off.
- Tela de entrada: os inputs não têm atributo name (entrar/page.tsx:131-150), então um envio nativo antes da hidratação não põe e-mail nem senha na query string.
- Métrica não é digitável: Metrica desenha <p> (matrizes.tsx, bloco Metrica). O Painel só tem inputs de data para o período, e as rotas /painel e /qualidade só exportam GET.
- Os botões escondidos na tela são conferidos no servidor: registrarManual (servicos/itens.ts:129), prévia e confirmação (servicos/distribuicao.ts:357,381), prazos (servicos/retencao.ts:40,78), aviso do gestor (servicos/aviso-do-gestor.ts:122,179), afastamentos (servicos/afastamentos.ts:66,177,231,312), memória (servicos/memoria.ts:221,263) e GET /revisao (api/revisao/route.ts:10).
- A24 no Painel por pessoa: servicos/painel.ts:301 filtra por ator.colaboradorId quando o papel é colaborador, no serviço e não na tela.
- O motivo do afastamento é redigido no servidor conforme o papel (servicos/escala.ts:63). A tela só traduz os rótulos.
- A senha provisória é sorteada no servidor, e o corpo do POST não leva senha (acesso/page.tsx:104-108). O cartão tem role=status e rola até ficar visível.
- Sair não afirma sucesso sem a confirmação do servidor: navegacao.tsx:56-69 e senha/page.tsx:36-45 mostram a falha e mantêm o aviso 'Você continua conectado'.
- Erros 5xx não vazam detalhes: servidor/http.ts devolve a mensagem genérica com correlacaoId, e ErroOperacional usa mensagemPublica.
- O cliente da API é o único ponto de fetch, com credentials same-origin. O 401 redireciona para /entrar sem laço, porque confere o pathname (componentes/api.ts:167-171).
- Transferir para colaborador desativado é recusado no servidor com uma frase clara (servicos/fila.ts:236-244). Encerrar afastamento com volta anterior ao início também é recusado (servicos/afastamentos.ts:196).
- Encurtar prazo de retenção pede dois cliques na tela, e o servidor exige confirmarEncurtamento (prazos-de-retencao.tsx:141-153).

**Não auditado:**

- Nada foi verificado com a aplicação rodando, por regra desta auditoria (sem npm run e sem banco). A CSP com nonce em tempo de execução, a hidratação e o layout real no celular não foram conferidos.
- O roteiro docs/auditoria/roteiro-da-auditoria-de-seguranca.md não existe neste worktree (commit 7f95cbb). Ele foi lido do checkout principal.
- O acesso local sem senha (servidor/acesso-local.ts) é da dimensão de autenticação. Não confirmei se requisicao.url/hostname e x-forwarded-for podem ser forjados por outra máquina da rede com o servidor de desenvolvimento do Next.
- O recorte A24 de GET /api/itens e de /api/itens/busca (servicos/caixa.ts, servicos/busca) não foi lido. Considerei apenas o que a tela recebe.
- Conteúdo de sugestaoIa, que vai inteiro ao cliente na Revisão, e se ele sai no prazo de retenção: não conferido.
- src/componentes/marca.tsx não foi lido em detalhe (é SVG decorativo).
- globals.css: não confirmei se @theme aninhado em @media prefers-color-scheme compila no Tailwind v4, nem o contraste real do tema escuro.
- Os invariantes 12 e 13 no caminho do prompt do assistente (montarMaterial e conteudo-nao-confiavel) são de outra dimensão.
