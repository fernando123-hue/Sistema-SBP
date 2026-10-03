# Instalação no servidor da empresa

Roteiro para o TI instalar o SBP num servidor Linux da associação. É o passo
V3 do `A74`: o sistema é validado antes na máquina do dono (V1 e V2) e
entregue já validado.

**Como ler.** Cada passo diz o que fazer e o que conferir.

- **(ensaiado)**: o passo foi executado ao pé da letra em 02/10/2026, nas
  seguintes condições:
  - a partir de `git clone` numa pasta vazia;
  - com um usuário `sbp` de sistema;
  - com o arquivo de segredos fora do repositório;
  - sem nenhum `.env`;
  - num MySQL 8.4.11 com binlog ligado, que é o padrão.

  **O que mudou no ensaio, e só isto.** O MySQL rodava num container,
  então:
  - a porta foi 3307;
  - as contas foram criadas com `@'%'`, e não com `@'localhost'` (ver o
    passo 4.1);
  - os nomes foram `sbp_ens` e `sbp_ens_app`, porque `sbp` já existia ali.

  Além disso, a IA ficou em `mock`, porque não havia Ollama, e o `npm` do
  usuário `sbp` precisou do proxy daquela rede.

  Um primeiro ensaio, feito numa pasta de desenvolvimento, escondeu
  defeitos que a revisão do PR #185 achou. Este é o segundo, nas condições
  acima.
- **(a conferir pelo TI)**: depende do servidor e não foi executado aqui.

**O que nunca roda no servidor:** `npm run db:seed` e `npm run demo`. Eles
criam a equipe fictícia e aprovam revisões em massa. Recusam uma base que já
tenha dado da operação (`AT-60`), mas uma base nova e vazia eles não sabem
distinguir de desenvolvimento. Por isso a regra está escrita aqui.

---

## 1. O que o servidor precisa

- **Node 22** (22.12 ou mais novo), a versão do CI, com `npm`. O `node` precisa estar num
  caminho do sistema, como `/usr/bin`, para o `sudo -u sbp` encontrar.
- **MySQL 8.4**, de preferência **na mesma máquina** que o SBP, em **modo
  estrito** (`sql_mode` com `STRICT_TRANS_TABLES`, que é o padrão do 8.4).
  Não ponha `sql_mode=` no `my.cnf` sem esse item, nem `init_connect` que o
  mude: sem modo estrito, o MySQL grava texto cortado e linha sem domínio com
  um aviso, em vez de recusar (#199). `SET GLOBAL` não sobrevive a reiniciar;
  o que persiste é o `my.cnf` ou `SET PERSIST`. Depois de mudar, reinicie o
  MySQL e o SBP (as conexões já abertas guardam o modo antigo).
- **Proxy reverso com HTTPS** (nginx, Caddy ou o que o TI já usa) e um
  certificado para o nome que a equipe vai digitar. **Obrigatório.** Fora do
  `localhost`, o cookie de sessão só é aceito em HTTPS. O sistema também
  manda o navegador exigir HTTPS por um ano, **incluindo subdomínios**
  (HSTS com `includeSubDomains`). Publique o SBP num nome próprio, como
  `sbp.<domínio>`, nunca no domínio raiz da associação: no raiz, todos os
  subdomínios passariam a exigir HTTPS.
- **A IA local** (Ollama) alcançável pelo servidor, **por endereço IP**: na
  mesma máquina (`127.0.0.1`) ou na rede interna (`10.x`, `172.16–31.x`,
  `192.168.x`). Nome de máquina (`http://ollama.interno`) e endereço público
  são recusados na subida (`A56`).

## 2. Usuário, código e dependências **(ensaiado)**

O sistema roda como um usuário próprio, sem shell de login. Os comandos
abaixo rodam como `root`:

```bash
useradd --system --create-home --home-dir /var/lib/sbp --shell /usr/sbin/nologin sbp
mkdir /opt/sbp && chown sbp:sbp /opt/sbp
sudo -u sbp git clone <repositório> /opt/sbp
cd /opt/sbp
sudo -u sbp npm ci
sudo -u sbp npx prisma generate
```

- **`prisma generate` é obrigatório.** O cliente do banco é gerado, não
  versionado. Sem ele, nenhum comando e nenhum build funcionam ("Cannot find
  module").
- **Não deixe `NODE_ENV=production` exportado durante o `npm ci`.** Com ele,
  o npm pula as dependências de desenvolvimento, e somem `tsx`, `prisma` e
  `typescript`, de que os comandos e o build dependem.

## 3. Segredos **(ensaiado)**

Os segredos ficam num arquivo próprio, fora do repositório:
`/etc/sbp/sbp.env`. O TI faz o backup dele num local criptografado, como já
faz hoje (`A73`). Quatro cuidados fazem diferença:

1. **Gerados no servidor**, um por variável, nunca copiados de outra
   máquina:
   ```bash
   node -e "console.log(crypto.randomUUID())"
   ```
   O resultado tem só letras, números e hífen. Assim o valor vale igual
   lido pelo shell, pelo systemd e dentro de uma URL. **Gere também as
   senhas do banco assim**, porque `$`, aspas e `@` quebram um dos três
   jeitos de ler.
2. **Legível só pelo `sbp`:** `chown sbp:sbp /etc/sbp/sbp.env` e
   `chmod 600 /etc/sbp/sbp.env`.
3. **O backup do banco nunca leva este arquivo junto.** O `BUSCA_SECRET` é o
   que impede descobrir CPF pela busca; banco e chave juntos devolvem os
   CPFs.
4. **O `ANEXOS_SECRET` está nele.** Sem ele, um backup restaurado não lê os
   anexos cifrados.

O conteúdo, uma variável por linha, no formato `NOME="valor"`. Cada
variável está explicada no `.env.example`.

| Variável | Observação |
|---|---|
| `NODE_ENV="production"` | |
| `DATABASE_URL` | a da aplicação (passo 4.6) |
| `SESSAO_SECRET`, `BUSCA_SECRET`, `ANEXOS_SECRET` | três diferentes, gerados no servidor |
| `IA_ADAPTER="local"`, `IA_LOCAL_URL`, `IA_MODELO` | as três juntas; sem `IA_MODELO` o servidor não sobe. O Gemini gratuito é recusado em produção (`AT-63`) |
| `CLASSIFICADOR_ADAPTER="local"`, `CLASSIFICADOR_MODELO` | opcional: a segunda opinião em modo sombra, no mesmo servidor de modelo (`A70`); com o adapter ligado, o modelo é obrigatório |
| `INGESTAO_ADAPTER`, `GRAPH_*`, `GRAPH_LER_DESDE` | a caixa real; depende do registro no Microsoft 365, feito pelo TI, e das decisões do dono (passo 10) |
| `ARMAZENAMENTO_DIR` | caminho absoluto, fora do repositório, do `sbp` |
| `PROXIES_CONFIAVEIS="1"` | atrás do proxy do passo 7 |

**Nenhum arquivo `.env*` na pasta `/opt/sbp`**: nem `.env`, nem
`.env.local`, nem `.env.production`. O sistema lê esses arquivos se
existirem. Um `.env` de desenvolvimento esquecido completaria as variáveis
que faltam, em silêncio.

### Como rodar um comando do sistema

Todo comando que usa o banco precisa das variáveis do arquivo. Há dois
jeitos, e o roteiro usa sempre os mesmos dois.

**Como a aplicação** (usuário `sbp`, credencial mínima):
```bash
sudo -u sbp bash -c 'cd /opt/sbp && set -a && . /etc/sbp/sbp.env && set +a && npm run db:privilegios'
```

**Como administrador do banco** (passos 4, 8 e 9). Rode como `root`, num
subshell que não guarda a senha no histórico:
```bash
cd /opt/sbp
( read -rsp 'Senha da conta administradora do MySQL: ' SENHA; echo
  set -a; . /etc/sbp/sbp.env; set +a
  export DATABASE_URL="mysql://sbp_admin:${SENHA}@127.0.0.1:3306/sbp?allowPublicKeyRetrieval=true"
  npx prisma migrate deploy
  npm run db:conferir-trilha )
```
O `DATABASE_URL` exportado depois do arquivo vence o do arquivo. Os
comandos dentro dos parênteses mudam conforme o passo.

## 4. Banco de dados

**Duas contas, e só duas:**

- **A conta administradora** (`sbp_admin`). Cria a base, migra e aplica as
  permissões. Só é usada nesses momentos e **nunca** entra no arquivo de
  segredos.
- **O usuário da aplicação** (`sbp_app`), com o mínimo de permissões.

**Por que uma administradora, e não um usuário "de manutenção" estreito
(ensaiado):**
- com binlog ligado, criar a trigger da trilha exige `SUPER` (`ERROR 1419`);
- aplicar as permissões exige `GRANT OPTION`.

Um usuário com as duas já é administrador na prática (`AT-67`).

1. **A base e as contas**, no cliente `mysql`, como `root` do MySQL
   **(ensaiado)**. A colação é a certa: sem ela, duas grafias da mesma liga
   viram uma só, sem erro (`AT-10`, `AT-34`).
   ```sql
   CREATE DATABASE sbp CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
   CREATE USER 'sbp_admin'@'localhost' IDENTIFIED BY '<gerada no servidor>';
   GRANT ALL PRIVILEGES ON sbp.* TO 'sbp_admin'@'localhost' WITH GRANT OPTION;
   GRANT SUPER ON *.* TO 'sbp_admin'@'localhost';
   CREATE USER 'sbp_app'@'localhost' IDENTIFIED BY '<gerada no servidor>';
   ```
   O MySQL avisa que `SUPER` está obsoleto. Com binlog ligado, ele ainda é o
   que libera criar trigger.

   **Sobre `'localhost'` (a conferir pelo TI):** a conexão é por
   `127.0.0.1`. Se o MySQL roda com `skip_name_resolve`, `'localhost'` não
   casa com ela. Nesse caso, use `@'127.0.0.1'` nas duas contas e
   `--host 127.0.0.1` no passo 4.4. Para conferir: depois de conectar,
   `SELECT CURRENT_USER();` tem de mostrar a conta que você criou.
2. **As migrações**, como administrador (o bloco do passo 3, com
   `npx prisma migrate deploy`) **(ensaiado)**. Aplique só assim, nunca com
   `mysql < migration.sql`: com `--force`, esse caminho deixa a trilha sem
   trava (`AT-66`).
3. **Conferir a trava da trilha**, no mesmo bloco:
   `npm run db:conferir-trilha` **(ensaiado)**. A resposta tem de ser "OK: as
   triggers de LogAuditoria e EventoProcessamento estão presentes, com o
   corpo exato da migração (AT-66), e o MySQL está em modo estrito." Qualquer
   outra resposta sai com código 1 e diz o que fazer — inclusive quando a
   trava está certa mas o `sql_mode` global não é estrito (veja a seção 1).
   O `npm run db:privilegios`, com o `sbp_app`, confere o modo da SESSÃO da
   aplicação, que é o que vale (um `init_connect` não aparece para o
   administrador).

   A trigger roda como quem migrou (o `DEFINER`, que `SHOW TRIGGERS FROM sbp`
   mostra). Por isso o passo 8 manda recriar `sbp_admin` antes de restaurar
   em outra máquina.
4. **As permissões mínimas do `sbp_app`**, geradas a partir das tabelas que
   existem, no mesmo bloco de administrador **(ensaiado)**:
   ```bash
   umask 077
   npm run -s db:sql-privilegios -- --usuario sbp_app --host localhost > /root/concessoes.sql && test -s /root/concessoes.sql && echo "gerado" || echo "VAZIO: pare aqui"
   ```
   Essas linhas vão dentro dos parênteses do bloco, no lugar dos dois
   comandos de exemplo. Depois, aplique **em lote**, fora do bloco:
   ```bash
   mysql -u sbp_admin -p < /root/concessoes.sql; echo "código: $?"
   ```
   O código tem de ser 0. Se o arquivo sair vazio, nada é concedido, e o
   passo 4.7 responderia OK sem que a aplicação funcione: por isso o
   `test -s`.

   **Nunca aplique com `SOURCE` no cliente interativo.** Ele mostra o erro e
   **continua** com as linhas seguintes, como o `--force`. Em lote, o `mysql`
   para no primeiro erro com código diferente de zero (ensaiado).

   A trilha de auditoria recebe só `SELECT, INSERT`. Com isso, o próprio
   MySQL recusa apagar, alterar ou derrubar a trigger ou a tabela da trilha
   (`ERROR 1142`; `AT-64`, `03-SPEC.md § 14`). Toda migração nova que cria
   tabela pede gerar e aplicar de novo (passo 9).
5. Apague `/root/concessoes.sql` depois de aplicar.
6. **A `DATABASE_URL` da aplicação**, no arquivo de segredos
   **(ensaiado)**:
   ```
   DATABASE_URL="mysql://sbp_app:<senha>@127.0.0.1:3306/sbp?allowPublicKeyRetrieval=true"
   ```
   **Não tire o `allowPublicKeyRetrieval=true`, mesmo que funcione sem
   ele.** Medido no ensaio:
   - sem a opção, a **primeira** conexão depois de o MySQL reiniciar
     falha;
   - depois que alguém conecta com a opção, o MySQL guarda a senha em
     cache, e a conexão sem ela passa a funcionar.

   Ou seja, uma instalação sem a opção funciona até o primeiro reboot do
   servidor e para de funcionar depois dele.

   No `mysqld`, use `bind-address=127.0.0.1`. Um banco em outra máquina usa
   TLS e `REQUIRE SSL`, não esta opção.
7. **Conferir as permissões**, agora como a aplicação **(ensaiado)**:
   ```bash
   sudo -u sbp bash -c 'cd /opt/sbp && set -a && . /etc/sbp/sbp.env && set +a && EXIGIR_PRIVILEGIO_MINIMO=sim npm run db:privilegios'
   ```
   A resposta tem de ser "OK: nada nas concessões deste usuário alcança
   LogAuditoria nem EventoProcessamento." e nada mais. Se ela disser que a
   sessão não está em modo estrito, o comando sai com 1 mesmo com as
   concessões certas: veja a seção 1 (`sql_mode` e `init_connect`).

## 5. A primeira pessoa gestora **(ensaiado)**

```bash
sudo -u sbp bash -c 'cd /opt/sbp && set -a && . /etc/sbp/sbp.env && set +a && npm run db:preparar -- --nome "Nome Completo" --email pessoa@dominio-da-associacao'
```

Um nome com apóstrofo (`D'Ávila`) quebra as aspas simples do `bash -c`.
Escreva-o como `D'\''Ávila`.

O comando cria as categorias e **uma** gestora real. A senha provisória
aparece uma única vez, e a troca é obrigatória no primeiro acesso.

- Rode num **terminal**, não como serviço: a senha sai na tela, e um log
  persistente a guardaria.
- Rodar de novo não cria ninguém.
- O resto da equipe é cadastrado pela gestora na tela *Acesso e cadastro*
  (`AT-61`).

## 6. Construir e subir **(ensaiado)**

```bash
sudo -u sbp bash -c 'cd /opt/sbp && set -a && . /etc/sbp/sbp.env && set +a && npm run build'
sudo -u sbp bash -c 'cd /opt/sbp && set -a && . /etc/sbp/sbp.env && set +a && npx next start -H 127.0.0.1 -p 3000'
```

`-H 127.0.0.1` faz o SBP escutar só no próprio servidor, e só o proxy fala
com ele. Sem isso, outra máquina da rede falaria direto com a porta 3000,
forjaria a origem e escaparia do limite de tentativas de login.

**Configuração errada não sobe.** O processo escreve "O servidor NÃO subiu: a
configuração está errada. <motivo>" e sai com código 1 (`AT-65`). O motivo
nunca traz o valor de um segredo.

**Não clique em "Buscar e-mails" antes do dia da caixa real.** Com
`INGESTAO_ADAPTER` no padrão (`mock`), a busca grava e-mails **fictícios** na
base da operação, e a trilha não permite apagá-los. É o mesmo motivo de
nunca rodar o seed. A busca em segundo plano foi ensaiada numa base
descartável.

## 7. Serviço e proxy **(a conferir pelo TI)**

**Serviço (systemd):**
- `User=sbp`;
- `WorkingDirectory=/opt/sbp`;
- `EnvironmentFile=/etc/sbp/sbp.env`;
- `ExecStart=` com o `npx next start -H 127.0.0.1 -p 3000` do passo 6 (o
  caminho do `npx` sai de `which npx`);
- `Restart=on-failure`, com `RestartSec=30` e, em `[Unit]`,
  `StartLimitIntervalSec=300` e `StartLimitBurst=5`. A subida do SBP encerra
  de propósito com configuração errada ou com o MySQL fora do modo estrito;
  sem a espera, o padrão do systemd (100 ms) reinicia em laço sem fim, porque
  cada partida leva mais que o limite. **"O servidor NÃO subiu: …" no journal
  pede corrigir o que a mensagem diz, não reiniciar.** Se o MySQL subir
  depois do SBP, não há laço: o SBP sobe, avisa que não conseguiu conferir o
  modo e confere de novo a cada 30 s. Ele também reconfere o modo a cada 15
  minutos, de propósito: **um `SET GLOBAL sql_mode` não estrito para
  manutenção (importar um dump, por exemplo) tira o SBP do ar** em até 15
  minutos, e depois de 5 tentativas o systemd para de reiniciar. Volte o modo
  e rode `systemctl reset-failed <serviço do SBP>` e `systemctl start <serviço do SBP>`;
- log no journald, com retenção definida. O log sai em JSON, uma linha por
  evento.

**Proxy:**
- HTTPS com o certificado;
- repassar o `Host` original (o sistema confere que ele bate com a origem do
  navegador) e o `X-Forwarded-For`;
- prazo de leitura padrão: a busca de e-mails roda no servidor e não segura
  a requisição (`AT-62`).

Depois de publicar, entre como gestora em **dois** computadores e compare o
campo `chave` de `GET /api/diagnostico/origem`. Valores diferentes mostram
que cada pessoa tem o seu limite.

## 8. Backup e restauração

**O que entra no backup:**
- o banco, como administrador, gravado **fora de `/opt/sbp`**:
  ```bash
  ( umask 077; mkdir -p /var/backups/sbp
    ARQ=/var/backups/sbp/sbp-$(date +%F-%H%M%S).sql
    mysqldump --single-transaction --no-tablespaces -u sbp_admin -p sbp > "$ARQ.parcial" \
      && mv "$ARQ.parcial" "$ARQ" && echo "pronto: $ARQ" \
      || { echo "FALHOU: o backup anterior continua intacto"; rm -f "$ARQ.parcial"; } )
  ```
  O arquivo tem o texto dos e-mails (nomes e CPFs que vieram no corpo) e os
  hashes de senha. Ele recebe o mesmo cuidado do arquivo de segredos: fica
  legível só pelo `root` e tem cópia num destino criptografado. **(Ensaiado:**
  - com a senha certa, sai `-rw-------`;
  - com a senha errada, aparece "FALHOU", não sobra arquivo parcial e o
    backup anterior fica intacto;
  - o `umask` do terminal não muda, porque tudo roda entre parênteses.)

  O nome leva data e hora, e o arquivo só ganha o nome final se o
  `mysqldump` terminar bem: um nome fixo seria esvaziado pela própria
  execução que falhou.
  **O `--no-tablespaces` é obrigatório.** Sem ele, a conta administradora
  (que não tem `PROCESS`) recebe "Access denied … PROCESS privilege …
  tablespaces". O `mysqldump` mesmo assim **sai com código 0**, e um backup
  agendado esconderia esse erro. O SBP não usa tablespaces, e o arquivo
  leva as tabelas e as triggers (ensaiado). Num backup agendado, a senha
  não pode ser digitada (`-p` pede no terminal). O jeito de entregar a
  credencial ao agendamento é do TI **(a conferir pelo TI)**: ela nunca vai
  na linha de comando;
- a pasta `ARMAZENAMENTO_DIR`, com os anexos já cifrados.

**O que não entra no mesmo backup:** o arquivo de segredos (passo 3).

**Restaurar (ensaiado no banco; os anexos ficam a conferir pelo TI).**
Sempre numa base **nova** e como administrador. Em outra máquina, faça os
passos 1 a 3 e crie as duas contas (4.1) **antes**: a trigger precisa do
`DEFINER`. Sem ele, ela continua recusando, mas com outra mensagem
(`ERROR 1449`; `AT-66`).

1. Criar a base, no cliente `mysql`, como `root` do MySQL:
   ```sql
   CREATE DATABASE sbp_restaurada CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
   GRANT ALL PRIVILEGES ON sbp_restaurada.* TO 'sbp_admin'@'localhost' WITH GRANT OPTION;
   ```
   E restaurar **em lote**, no terminal:
   ```bash
   mysql -u root -p sbp_restaurada < /var/backups/sbp/sbp-<data>.sql; echo "código: $?"
   ```
   O código tem de ser 0. Nunca use `SOURCE` no cliente interativo: ele
   continua depois de um erro e deixa a base pela metade sem avisar (passo
   4.4).
2. Conferir a trava, no bloco de administrador com a URL apontando para
   `sbp_restaurada`: `npm run db:conferir-trilha`. Uma restauração
   interrompida pode devolver a trilha sem trava, e é aqui que isso aparece.
3. **As permissões do `sbp_app` são por base**, e o backup não as leva. No
   mesmo bloco, gere e aplique de novo (4.4) para `sbp_restaurada`.
4. Troque a `DATABASE_URL` da aplicação para `sbp_restaurada`, rode o 4.7 e
   só então suba o sistema.

No ensaio, a base restaurada voltou com as 29 tabelas, as mesmas linhas na
trilha e a trava conferida. Com as permissões regeneradas, a aplicação leu a
base restaurada. Antes de regenerar, o `SHOW GRANTS` do usuário da aplicação
só listava a base original.

**Restaure uma vez para provar**, numa máquina de teste: suba o sistema com o
backup e os segredos, entre, abra um item com anexo.

## 9. Atualizar para uma versão nova

**Ensaiado sem migração nova pendente.** Com migração nova, o passo é o
mesmo, mas aquela execução não foi vista aqui.

Primeiro, **pare o serviço**: `npm ci` apaga as dependências e `npm run
build` reescreve o sistema compilado, e um serviço no ar, ou reiniciado
sozinho no meio, rodaria uma mistura das duas versões.

```bash
systemctl stop <serviço do SBP>
cd /opt/sbp
sudo -u sbp git pull
sudo -u sbp npm ci
sudo -u sbp npx prisma generate
```

Depois:
1. no bloco de administrador: `npx prisma migrate deploy` e
   `npm run db:conferir-trilha`;
2. gerar e aplicar as permissões (4.4), porque migração nova pode ter criado
   tabela;
3. `npm run build`, como a aplicação;
4. `systemctl start <serviço do SBP>`.

## 10. O que o servidor faz sozinho

A limpeza diária roda dentro do próprio servidor. Ela tenta na subida e
depois em intervalos, e faz uma limpeza por dia: apaga o conteúdo com prazo
de retenção vencido, nos prazos que a gestão define na tela. Só se o servidor
ficar **um dia inteiro** desligado vale agendar `npm run db:expurgar` pelo
mesmo jeito do passo 3 (como a aplicação). O agendamento carrega o arquivo de
segredos, e o comando não repete a limpeza no mesmo dia.

## 11. No dia de ligar a caixa real

A lista do `DECISOES.md § AT-47`. Antes dela, as decisões do dono que
bloqueiam o e-mail real:
- liberar e-mail real na IA local (`A56 (e)`);
- a data de `GRAPH_LER_DESDE`;
- o registro do aplicativo no Microsoft 365.
