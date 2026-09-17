# Auditoria de segredos e dados sensíveis — 16/09/2026

Pedido do dono: identificar segredo ou dado sensível no código, nos arquivos e no histórico do Git/GitHub, e preparar o projeto para o **Infisical** — sem migrar, sem apagar nada sem entender, sem reescrever histórico.

**Resultado: nenhum segredo real encontrado no repositório, nem no histórico.** Nenhuma credencial precisa ser revogada por causa do Git. Duas ações de cuidado ficam com o dono (seção 7).

> Nenhum valor de segredo aparece neste arquivo. As buscas mostraram só nomes, contagens e os primeiros caracteres de *placeholders*.

## 1. Como foi feito

| Método | Alcance |
|---|---|
| **Busca por padrões** de credencial real: chave Google (`AIza…`), Anthropic (`sk-ant-…`), GitHub (`ghp_`, `gho_`, `github_pat_`), AWS (`AKIA…`), chave privada (`BEGIN … PRIVATE KEY`), JWT, segredo de cliente da Microsoft, connection string com senha (`mysql://`, `postgresql://`) | `git log --all -p` — **todo o histórico, as 83 revisões**, depois de `git fetch --all`, incluindo as branches que só existiam no GitHub |
| **Busca por atribuição** (`SECRET`, `KEY`, `TOKEN`, `PASSWORD`, `SENHA` seguidos de valor longo) | mesmo alcance |
| **Arquivos sensíveis** já rastreados ou que passaram por algum commit (`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, nomes com *credential*/*secret*) | `git ls-files` e `git log --all --diff-filter=AD` |
| **Segredo com valor padrão no código** (`SECRET ?? '…'`) | `src/`, `scripts/`, `prisma/` |
| **Dado pessoal:** e-mails fora dos domínios sintéticos, CPFs formatados | arquivos atuais e histórico |
| **Scanner no CI:** `gitleaks` roda em todo push e PR (`.github/workflows/ci.yml`, job *Varredura de segredos*); os três últimos CI da `main` estão verdes | contínuo |
| **Fora do repositório:** revisões locais não versionadas (`.claude/reviews/`) e a tarefa agendada `sbp-teste-ia-gemini` | padrões acima |

Nenhum *scanner* dedicado (gitleaks, trufflehog, detect-secrets) está instalado nesta máquina; instalar é baixar programa, que pede o ok do dono. O `gitleaks` do CI cobre essa lacuna a cada envio.

## 2. O que foi encontrado

| Ocorrência | Onde | Classificação | Por quê |
|---|---|---|---|
| `mysql://usuario:senha@…` e `postgresql://usuario:senha@…` | `.env.example` e documentos, em várias versões | **BAIXO — placeholder** | usuário e senha são as palavras literais "usuario" e "senha" |
| `SESSAO_SECRET` e `BUSCA_SECRET` com valor | `.github/workflows/ci.yml` | **BAIXO — valor de teste** | valores começam com `ci-nao…` e existem só para a suíte rodar no CI; não protegem nada real. O próprio arquivo explica |
| `BUSCA_SECRET` com valor | `vitest.config.ts` | **BAIXO — valor de teste** | começa com `teste-nao…`; protege CPF sintético de uma base que a suíte cria e apaga. O comentário ao lado diz que é público de propósito |
| `DATABASE_URL: mysql://root@127.0.0.1…` | `.github/workflows/ci.yml` | **BAIXO — configuração** | banco descartável do CI, sem senha, só dentro da máquina do GitHub |
| `.env.example` | versionado desde o primeiro commit | **BAIXO — esperado** | todo segredo está vazio (`""`); é o modelo de configuração |
| e-mails `@exemplo.test`, `@teste.local`, `pessoa@associacao.org(.br)`, `fulano@x.com` | testes, telas, comentários | **BAIXO — sintético** | nomes genéricos; o de `associacao.org.br` é usado justamente para provar que conta **não** sintética é recusada no acesso local |
| CPFs `000.000.000-00`, `111.444.777-xx`, `529.982.247-25` | testes | **BAIXO — sintético** | números de exemplo conhecidos para testar dígito verificador |
| **Nomes reais da equipe do cliente** | documentos de origem (`CONTEXTO.md`, `ENGENHARIA_REVERSA…`) | **MÉDIO — dado pessoal, não credencial** | já tratado: o repositório virou **privado** em 12/09/2026 por isso (`DECISOES.md § A38`). Estiveram públicos antes dessa data — ver seção 6 |
| Segredo com valor padrão no código | — | nenhum | `src/servidor/ambiente.ts` valida cada variável com Zod na partida |

**Nada classificado como CRÍTICO ou ALTO.**

## 3. O que é realmente sensível — e onde mora hoje

Só no arquivo `.env` desta máquina, que **nunca foi versionado** (`.gitignore` cobre `.env` e `.env.*`, exceto `.env.example`):

| Variável | Hoje nesta máquina | Natureza |
|---|---|---|
| `GOOGLE_AI_KEY` | preenchida — **chave real** da camada gratuita | segredo |
| `SESSAO_SECRET` | preenchida | segredo (assina a sessão) |
| `BUSCA_SECRET` | preenchida | segredo (protege a chave de busca do CPF) |
| `DATABASE_URL` | preenchida, `root` sem senha, só `127.0.0.1` | configuração hoje; **segredo em produção** (terá senha) |
| `ANTHROPIC_API_KEY` | vazia | segredo, quando existir |
| `ANEXOS_SECRET` | não definida (usa `SESSAO_SECRET`) | segredo |
| `GRAPH_CLIENT_SECRET` | não definida | segredo, quando o TI entregar |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CAIXA` | não definidas | configuração sensível — não dão acesso sozinhas, mas não devem ser públicas |
| `IA_ADAPTER`, `IA_MODELO`, `INGESTAO_ADAPTER`, `ARMAZENAMENTO_DIR`, `PROXIES_CONFIAVEIS`, `NODE_ENV`, `ACESSO_LOCAL_SEM_SENHA` | — | configuração, não segredo |

## 4. O que foi alterado

1. **`.gitignore`** passa a recusar `*.pem`, `*.key`, `*.p12` e `*.pfx`. Nenhum desses existe hoje; o motivo é concreto: o Microsoft Entra aceita **certificado** no lugar de segredo para o Graph (`A47`), e um MySQL de produção com TLS usa chave e certificado. O dia em que um deles chegar, o Git já recusa.
2. Este relatório.

Nada mais foi alterado: não havia segredo no código para retirar, nem valor real em exemplo.

## 5. O que NÃO foi alterado, e por quê

- **O `.env` local** continua como está — é o que faz o sistema rodar aqui, e não está no Git.
- **Nenhuma chave foi trocada.** Nenhuma apareceu no histórico.
- **O histórico não foi reescrito** e nada foi enviado à força.
- **Infisical não foi configurado:** não existe no projeto, e uma migração pela metade seria pior que nenhuma.

## 6. Histórico do Git

- **Nenhum segredo real apareceu em nenhum commit**, em nenhuma branch, local ou remota.
- **Dado pessoal apareceu:** nomes reais da equipe estiveram no repositório enquanto ele era **público** (até 12/09/2026). Isso não é credencial e não se "revoga"; o que já foi copiado por terceiros não volta. Reescrever o histórico não desfaz uma cópia já feita, e quebraria todas as branches e PRs — **não recomendo** sem motivo novo. Fica registrado como risco aceito, de decisão do dono.

## 7. Ações necessárias

1. **Restringir a chave do Google** no console do Google AI Studio / Cloud: só a *Generative Language API* e, se possível, só a partir deste IP. Ela está em texto puro no `.env` desta máquina. *(dono)*
2. **Não colar chave em conversa**, nem com agente: vai para o `.env` direto. *(regra já registrada em `ESTADO.md`)*
3. **Na implantação (`A46`):** usuário MySQL próprio com senha e menor privilégio (achado do roteiro de segurança); `SESSAO_SECRET`, `ANEXOS_SECRET` e `BUSCA_SECRET` **novos**, gerados lá, nunca copiados desta máquina.
4. **Plano do GitHub:** *secret scanning* com bloqueio no envio exige GitHub Pro ou Team em repositório privado (`DECISOES.md`, "Limites do plano do GitHub"). Até lá, o `gitleaks` do CI avisa **depois** do envio, não impede.

## 8. Infisical — o que deverá ir para ele

Segredos: `ANTHROPIC_API_KEY`, `GOOGLE_AI_KEY` (só se ainda usada), `GRAPH_CLIENT_SECRET` (ou o certificado), `SESSAO_SECRET`, `ANEXOS_SECRET`, `BUSCA_SECRET`, `DATABASE_URL` (com senha).
Configuração sensível, no mesmo cofre por conveniência: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CAIXA`.
Separação por ambiente: **desenvolvimento** (esta máquina, dados sintéticos), **teste** (CI, valores `ci-nao…`, pode continuar no workflow) e **produção** (valores próprios, gerados lá).

**Encaixe no código:** nenhum. `src/servidor/ambiente.ts` lê de `process.env`; o Infisical injeta as variáveis no processo (`infisical run -- npm start`). Por isso a migração, quando vier, é de operação, não de código.

## 9. Validação

- Varredura repetida depois da mudança: sem ocorrência nova.
- `.gitignore` conferido com `git check-ignore` para os quatro padrões novos.
- A mudança não toca código; `npm run verificar` roda antes do PR, como todo PR.
