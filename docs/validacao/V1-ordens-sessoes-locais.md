# V1: ordens para as sessões locais (revisão de 02/10/2026)

Este arquivo é mantido pela sessão da nuvem que coordena o projeto. Ela não alcança as sessões que rodam na máquina do dono, então **o dono cola cada bloco na sessão indicada e devolve a resposta à sessão da nuvem**. Esta revisão substitui todas as anteriores. Se uma sessão local já tinha recebido um bloco antigo e terminou a medição do classificador, ela segue direto para a parte nova.

Os resultados alimentam o `docs/ESTADO.md` e viram PRs, um por defeito. Antes de mandar um bloco de novo, confira no `ESTADO.md` se ele já foi feito.

Contexto para as duas (decisão do dono, `A74`): o sistema é validado **na máquina do dono** antes de ir para o servidor da empresa. A V1 usa só e-mails **fictícios**.

---

## Para "Projeto SBP local setup"

Ordem da sessão da nuvem que coordena o SBP (o Fernando a pôs como líder das sessões). **Não abra PR, não faça push e não edite `docs/`**: eu registro tudo. Se achar defeito, me descreva com o arquivo e a linha; eu corrijo na nuvem.

**Parte 1 — classificador local (P1 do `A70`), se ainda não fez.**
Na `main` atualizada (`git checkout main && git pull`), com o Ollama no ar, no PowerShell:
```
$env:CLASSIFICADOR_ADAPTER="local"; $env:IA_LOCAL_URL="http://127.0.0.1:11434/v1"; $env:CLASSIFICADOR_MODELO="qwen2.5:1.5b-instruct-q4_K_M"; $env:IA_TETO_DIARIO="0"; npm run classificador:avaliar -- --json
```
Rode também sem `--json`. Me devolva:
- a saída inteira das duas execuções;
- se vieram `logprobs` (sem eles, a falha diz `logprobs: invalid_type`);
- se alguma probabilidade saiu diferente de 0 e de 1;
- quantas perguntas falharam com `opcao: custom`;
- o tempo por pergunta;
- a saída de `ollama -v` e de `ollama list`.

**Se você JÁ fez a Parte 2 antes desta revisão:** a base `sbp_validacao` está com a trava antiga da trilha, e um backup dela não restaura (`AT-66`). Em `C:\sbp-validacao`: `git pull`, `npm ci`, e então os passos 5 e 5b abaixo, seguidos de `npm run build`. Me devolva a saída dos dois.

**Parte 2 — V1: o sistema rodando como produção, numa pasta separada.**
Não use a pasta de desenvolvimento: produção lê outro `.env`, e misturar os dois é como um erro passa despercebido.
1. `git clone https://github.com/fernando123-hue/Sistema-SBP C:\sbp-validacao`, depois `cd C:\sbp-validacao` e `npm ci`.
2. No MySQL da máquina: `CREATE DATABASE sbp_validacao CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;`
3. Gere **três segredos diferentes**, um por linha. Não copie nenhum do `.env` de desenvolvimento:
   `node -e "console.log(crypto.randomUUID())"`
4. Crie `C:\sbp-validacao\.env` com:
   ```
   NODE_ENV=production
   DATABASE_URL="mysql://<usuario>:<senha>@127.0.0.1:<porta>/sbp_validacao?allowPublicKeyRetrieval=true"
   SESSAO_SECRET=<segredo 1>
   BUSCA_SECRET=<segredo 2>
   ANEXOS_SECRET=<segredo 3>
   INGESTAO_ADAPTER=mock
   IA_ADAPTER=local
   IA_LOCAL_URL=http://127.0.0.1:11434/v1
   IA_MODELO=qwen2.5:1.5b-instruct-q4_K_M
   CLASSIFICADOR_ADAPTER=local
   CLASSIFICADOR_MODELO=qwen2.5:1.5b-instruct-q4_K_M
   ```
   O `?allowPublicKeyRetrieval=true` é necessário com usuário de senha no MySQL 8.4. Sem ele, a conexão falha depois que o MySQL reinicia, e antes disso pode parecer que funciona (`docs/INSTALACAO.md`, passo 4.6).

   Um `.env` na pasta é aceitável **só aqui**, na validação no Windows, numa pasta separada da de desenvolvimento. No servidor da empresa, o roteiro proíbe `.env` e usa o arquivo de segredos em `/etc/sbp` (`docs/INSTALACAO.md`, passo 3).

   Se `ambiente()` recusar subir, **copie a mensagem exata**. Ela diz o que falta, e isso também é resultado da validação.
5. As migrações, **com a conta administradora do MySQL (a `root`)**. Com binlog ligado, que é o padrão, só ela cria a trava da trilha:
   ```
   $env:DATABASE_URL="mysql://root:<senha da root>@127.0.0.1:<porta>/sbp_validacao?allowPublicKeyRetrieval=true"; npx prisma migrate deploy
   ```
   Se parar com `P3018`, a trava antiga continua de pé. Rode `npx prisma migrate resolve --rolled-back 20261001220000_trilha_restauravel_do_backup` e repita com a root.
5b. Com a mesma variável: `npm run db:conferir-trilha`. Tem de dizer `OK: as triggers de LogAuditoria e EventoProcessamento estão presentes…`. Depois, `Remove-Item Env:DATABASE_URL` para voltar à URL do `.env`. Me devolva também a saída de `SELECT @@lower_case_table_names;` no MySQL: no Windows deve ser 1, e a conferência foi feita para isso.
6. `npm run db:preparar -- --nome "Fernando" --email <o e-mail do Fernando>`. Guarde a senha provisória para entregar a ele. **Não rode o seed nem a demo nesta pasta.** Se rodar, eles devem recusar; se não recusarem, é defeito, e eu quero saber.
7. `npm run build`. Depois `npm start`, que é o `next start`, na porta 3000.
8. Abra `http://localhost:3000`. Entre com o e-mail do Fernando e a senha provisória. O sistema tem de pedir a troca de senha antes de qualquer tela.
9. Me devolva:
   - cada passo que deu erro, com a mensagem exata;
   - o tempo do `npm run build`;
   - se o login e a troca de senha funcionaram.

   O teste de tela é do Fernando: cadastrar 2 ou 3 colaboradores fictícios em "Acesso e cadastro", marcar o plantão, "Buscar e-mails", Revisão, Distribuição, Minha fila e Painel. A busca roda no servidor e a tela mostra "lendo N de M" (`AT-62`). Anote quanto tempo ela leva, quantos e-mails trouxe e se o "lendo N de M" avançou na tela.
10. **Ensaio de backup (`AT-66`), depois do teste de tela.** Com a root:
    - `mysqldump -u root -p --single-transaction sbp_validacao > C:\sbp-validacao\backup.sql`
    - `mysql -u root -p -e "CREATE DATABASE sbp_restaurada CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs"`
    - `mysql -u root -p sbp_restaurada < C:\sbp-validacao\backup.sql`
    - `npm run db:conferir-trilha`, com a `DATABASE_URL` da root apontando para `sbp_restaurada`.

    Me devolva: se a restauração terminou sem erro, a saída da conferência, e a contagem de tabelas nas duas bases (`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='sbp_validacao'`, e o mesmo para `sbp_restaurada`). Depois apague `sbp_restaurada` e o `backup.sql`: ele tem o dado da V1.

Nunca rode `vitest` ou `npm run verificar` enquanto a outra sessão local estiver rodando a suíte.

---

## Para "Fix TLS scan test failing on Windows CRLF"

Ordem da sessão da nuvem que coordena o SBP. **Não abra PR e não faça push.** Sua tarefa é provar que a `main` passa no Windows, porque o CI só roda em Linux.

1. **Espere a sessão "Projeto SBP local setup" terminar a Parte 1.** As duas usam o mesmo MySQL, e cada `vitest` apaga e recria `sbp_teste`. A Parte 2 dela usa outra base (`sbp_validacao`) e não conflita.
2. Na pasta de desenvolvimento: `git fetch origin && git checkout main && git pull`. O `HEAD` precisa conter o #184 ("backup do banco restaura e a trava da trilha é conferida"). Esse PR tem um teste de banco que só foi visto passar num MySQL Linux configurado como o do Windows. Rodar no Windows de verdade é a prova que falta.
3. `npm run verificar` inteiro.
4. Me devolva:
   - o total de arquivos e de testes;
   - cada falha, com o nome do teste e a mensagem exata;
   - a sua avaliação: a falha é só do Windows (CRLF, `\` no caminho, fuso, locale) ou também aconteceria no Linux?
   - a saída de `git config core.autocrlf`;
   - a saída de `SELECT @@lower_case_table_names;` no MySQL usado pela suíte;
   - o resultado de `src/servicos/trilha-append-only.test.ts` e de `src/servidor/privilegios-trava.test.ts`, mesmo que passem.

   Não corrija nada: eu abro o PR a partir do seu relatório.
