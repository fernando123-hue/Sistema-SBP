# Instalação no servidor da empresa

Roteiro para o TI instalar o SBP num servidor Linux da associação. É o passo
V3 do `A74`: antes, o sistema é validado na máquina do dono (V1 e V2) e só
depois entregue.

**Como ler.** Cada passo diz o que fazer e o que conferir. Há duas marcas:

- **(ensaiado)**: o passo foi executado de verdade em 01/10/2026, numa base
  nova num MySQL 8.4.11 com binlog ligado (o padrão), e com `next start` em
  produção. Ver `DECISOES.md § AT-66` e `§ AT-67`.
- **(a conferir pelo TI)**: o passo depende do servidor e não foi executado
  aqui. O roteiro diz isso em vez de prometer.

**Nunca rode no servidor** `npm run db:seed` nem `npm run demo`. Eles criam a
equipe fictícia e aprovam revisões em massa. Recusam uma base que já tenha
dado da operação (`AT-60`), mas não distinguem uma base nova e vazia de uma
de desenvolvimento. Por isso a regra está escrita aqui.

---

## 1. O que o servidor precisa

- **Node 22**, a versão do CI, e `npm`.
- **MySQL 8.4**, de preferência **na mesma máquina** que o SBP.
- **Proxy reverso com HTTPS** (nginx, Caddy ou o que o TI já usa) e um
  certificado para o nome que a equipe vai digitar.

  Isso é **obrigatório**. Fora do `localhost`, o cookie de sessão só é aceito
  em HTTPS, e o sistema pede ao navegador que exija HTTPS por um ano (HSTS).
  Por HTTP, o login não se mantém.
- **A IA local (Ollama)** alcançável pelo servidor: na mesma máquina, ou na
  rede interna atrás de firewall. Um endereço público é recusado na subida
  (`A56`).

## 2. Código e dependências

```bash
git clone <repositório> /opt/sbp && cd /opt/sbp
npm ci
```

Rode o sistema com um usuário próprio, por exemplo `sbp`, sem shell de login.
A pasta dos anexos (`ARMAZENAMENTO_DIR`) e o arquivo de segredos pertencem a
ele.

## 3. Banco de dados

**Duas credenciais, e só duas:**

- **A conta administradora do MySQL** (a `root` local). Cria a base e os
  usuários, roda as migrações e aplica as permissões. Só é usada nesses
  momentos e **nunca** entra no arquivo de segredos da aplicação.
- **O usuário da aplicação** (`sbp_app`), com o mínimo de permissões.

**Por que a administradora, e não um usuário "de manutenção" mais estreito
(ensaiado):**

- com binlog ligado, criar a trigger da trilha exige `SUPER` (`ERROR 1419`);
- aplicar as permissões exige `GRANT OPTION`;
- a trigger roda como quem migrou (`DEFINER`), e a `root@localhost` existe em
  qualquer servidor, então uma restauração em outra máquina continua com a
  trava funcionando (`AT-66`).

Um usuário com tudo isso já é, na prática, administrador.

1. **A base, com a colação certa.** Sem ela, duas grafias da mesma liga viram
   uma só, sem erro (`AT-10`, `AT-34`):
   ```sql
   CREATE DATABASE sbp CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs;
   CREATE USER 'sbp_app'@'localhost' IDENTIFIED BY '<senha gerada no servidor>';
   ```
2. **As migrações**, com a conta administradora **(ensaiado)**:
   ```bash
   DATABASE_URL="mysql://root:<senha>@127.0.0.1:3306/sbp?allowPublicKeyRetrieval=true" npx prisma migrate deploy
   ```
   Aplique só assim, nunca com `mysql < migration.sql`. Com `--force`, esse
   comando deixa a trilha sem trava (`AT-66`).
3. **Conferir a trava da trilha**, com a mesma conta **(ensaiado)**:
   ```bash
   DATABASE_URL="<a mesma>" npm run db:conferir-trilha
   ```
   A resposta tem de ser "OK: as triggers de LogAuditoria e
   EventoProcessamento estão presentes…". Qualquer outra resposta sai com
   código 1 e diz o que fazer.
4. **As permissões mínimas do usuário da aplicação**, geradas da base que
   existe **(ensaiado)**:
   ```bash
   DATABASE_URL="<a mesma>" npm run -s db:sql-privilegios -- --usuario sbp_app --host localhost > concessoes.sql
   mysql -u root -p sbp < concessoes.sql
   ```
   A trilha de auditoria recebe só `SELECT, INSERT`. Com isso, o próprio
   MySQL recusa apagar, alterar ou derrubar a trigger ou a tabela da trilha
   (`ERROR 1142`). Toda migração nova que cria tabela pede gerar e aplicar de
   novo. Detalhes em `03-SPEC.md § 14` e no `AT-64`.
5. **A `DATABASE_URL` da aplicação** leva `?allowPublicKeyRetrieval=true`
   quando o banco está na mesma máquina e sem TLS **(ensaiado: sem isso, o
   sistema não conecta)**:
   ```
   mysql://sbp_app:<senha>@127.0.0.1:3306/sbp?allowPublicKeyRetrieval=true
   ```
   No `mysqld`, use `bind-address=127.0.0.1`. Um banco em outra máquina usa
   TLS e `REQUIRE SSL`, não esta opção.
6. **Conferir as permissões**, já com a credencial da aplicação **(ensaiado)**:
   ```bash
   EXIGIR_PRIVILEGIO_MINIMO=sim npm run db:privilegios
   ```
   A resposta tem de ser "OK: nada nas concessões deste usuário alcança
   LogAuditoria nem EventoProcessamento".

Se o MySQL roda com `skip_name_resolve`, `'localhost'` não casa com uma
conexão por `127.0.0.1`. Nesse caso, crie o usuário com `@'127.0.0.1'` e gere
as permissões com `--host 127.0.0.1`.

## 4. Segredos

Os segredos seguem a prática que o TI já usa (`A73`): ficam num arquivo
próprio, por exemplo `/etc/sbp/sbp.env`, com backup num local criptografado.
Quatro cuidados fazem diferença:

1. **Gerados no servidor**, um por variável, nunca copiados de outra máquina:
   ```bash
   node -e "console.log(crypto.randomUUID())"
   ```
2. **Legíveis só pelo usuário `sbp`** (`chown sbp`, `chmod 600`).
3. **O backup do banco nunca leva este arquivo junto.** O `BUSCA_SECRET`
   impede descobrir CPF pela busca, e banco e chave juntos devolvem os CPFs.
4. **O `ANEXOS_SECRET` está nele.** Sem ele, um backup restaurado não lê os
   anexos cifrados.

O `.env.example` explica cada variável. As de produção:

| Variável | Observação |
|---|---|
| `NODE_ENV=production` | |
| `DATABASE_URL` | a da aplicação (passo 3.5) |
| `SESSAO_SECRET`, `BUSCA_SECRET`, `ANEXOS_SECRET` | três valores diferentes, gerados no servidor |
| `IA_ADAPTER=local`, `IA_LOCAL_URL`, `IA_MODELO` | as três juntas; sem `IA_MODELO` o servidor não sobe. O Gemini gratuito é recusado em produção (`AT-63`) |
| `CLASSIFICADOR_ADAPTER=local`, `CLASSIFICADOR_MODELO` | opcional: a segunda opinião em modo sombra, no mesmo servidor de modelo (`A70`); com o adapter ligado, o modelo é obrigatório |
| `INGESTAO_ADAPTER`, `GRAPH_*`, `GRAPH_LER_DESDE` | a caixa real; depende do registro no Microsoft 365, feito pelo TI, e das decisões do dono |
| `ARMAZENAMENTO_DIR` | caminho absoluto, fora do repositório |
| `PROXIES_CONFIAVEIS=1` | quando o SBP está atrás do proxy do passo 6 |

**Não deixe um `.env` em `/opt/sbp`.** O sistema lê esse arquivo se ele
existir, e um `.env` de desenvolvimento esquecido completaria as variáveis
que faltam. As variáveis vêm só do arquivo de segredos.

**Comandos de terminal** (`db:preparar`, `db:privilegios`, `db:expurgar`)
precisam das mesmas variáveis que o serviço. Rode-os como o usuário `sbp`,
assim **(ensaiado)**:
```bash
set -a; . /etc/sbp/sbp.env; set +a
npm run db:privilegios
```

**Uma configuração errada impede a subida (ensaiado).** O processo escreve "O
servidor NÃO subiu: a configuração está errada. <motivo>" e sai com código 1
(`AT-65`). O motivo nunca traz o valor de um segredo.

## 5. A primeira pessoa gestora

```bash
npm run db:preparar -- --nome "Nome Completo" --email pessoa@dominio-da-associacao
```

O comando cria as categorias e **uma** gestora real **(ensaiado)**. A senha
provisória aparece uma única vez, e a troca é obrigatória no primeiro acesso.
Rode num **terminal**, não como serviço: a senha sai na tela, e um log
persistente a guardaria. Rodar de novo não cria ninguém. O resto da equipe é
cadastrado pela gestora, na tela *Acesso e cadastro* (`AT-61`).

## 6. Rodar o serviço

```bash
npm run build
npx next start -H 127.0.0.1 -p 3000
```

O `-H 127.0.0.1` faz com que só o proxy fale com o SBP. Sem ele, o SBP escuta
em todas as interfaces. Uma máquina da rede poderia falar direto com a porta
3000, forjar a origem e escapar do limite de tentativas de login.

**Ensaiado com o usuário mínimo do banco:**
- `next start` em produção;
- entrada da gestora, troca da senha provisória;
- busca de e-mails fictícios em segundo plano, gravando na trilha.

**Serviço (systemd) (a conferir pelo TI):**
- `WorkingDirectory=/opt/sbp` e `User=sbp`;
- o arquivo de segredos como `EnvironmentFile`;
- `Restart=on-failure`;
- o log no journald, com retenção definida.

O log sai em JSON, uma linha por evento.

**Proxy (a conferir pelo TI):**
- HTTPS com o certificado;
- repassar o `Host` original e o `X-Forwarded-For`;
- prazo de leitura padrão.

A busca de e-mails roda no servidor e não segura a requisição (`AT-62`).
Depois de publicar, entre como gestora em **dois** computadores e compare o
campo `chave` de `GET /api/diagnostico/origem`. Valores diferentes mostram que
cada pessoa tem o seu próprio limite.

## 7. Backup e restauração

**O que entra:**
- o banco: `mysqldump --single-transaction sbp`, com a conta administradora;
- a pasta `ARMAZENAMENTO_DIR`, com os anexos já cifrados.

**O que não entra no mesmo backup:** o arquivo de segredos (passo 4).

**Restaurar (ensaiado no banco; os anexos ficam a conferir pelo TI).** Sempre
numa base **nova**, com a conta administradora, e conferir antes de apontar o
sistema para ela:
```bash
mysql -u root -p -e "CREATE DATABASE sbp_restaurada CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs"
mysql -u root -p sbp_restaurada < backup.sql
DATABASE_URL="<conta administradora>/sbp_restaurada…" npm run db:conferir-trilha
```
Uma restauração com credencial sem `SUPER` para no meio, com erro na tela.
Uma restauração que não chega ao fim pode devolver a trilha sem trava, e a
conferência acusa isso (`AT-66`).

**Restaure uma vez para provar**, numa máquina de teste: suba o sistema com o
backup e os segredos, entre e abra um item com anexo.

## 8. O que o servidor faz sozinho

A limpeza diária roda dentro do próprio servidor, uma vez por dia. Ela apaga o
conteúdo que tem prazo de retenção, nos prazos que a gestão define na tela. Se
o servidor fica desligado à noite, agende `npm run db:expurgar`, que faz a
mesma limpeza e não a repete no mesmo dia.

## 9. No dia de ligar a caixa real

Siga a lista do `DECISOES.md § AT-47`. Antes dela vêm as decisões do dono que
bloqueiam o e-mail real:
- liberar e-mail real na IA local (`A56 (e)`);
- a data de `GRAPH_LER_DESDE`;
- o registro do aplicativo no Microsoft 365.
