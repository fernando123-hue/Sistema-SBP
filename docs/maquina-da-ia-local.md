# Máquina da IA local — estado, direção e como medir

Registro de 24/09/2026, atualizado em 25/09/2026 com a medição (`DECISOES.md § A59`). Tudo o que até aqui só existia em conversa sobre a máquina que o dono conseguiu para a IA local (`DECISOES.md § A56 (d)`). Quem abrir uma sessão nova sem memória nenhuma deve conseguir continuar só com este arquivo e com `ESTADO.md`.

## 1. O que é a máquina

- **Debian**, kernel `6.1.187-1` (provavelmente Debian 12). Acesso **só por terminal**, remoto; não há navegador nela.
- Pela decisão registrada em `A56 (d)`: fraca, **cerca de 8 GB de RAM**, sem GPU garantida. Só cabe modelo pequeno (1 a 4 bilhões de parâmetros, quantizado), em CPU.
- **O Claude Code foi instalado nela** pelo dono, com login pelo fluxo manual (URL aberta em outro aparelho). Ali roda uma sessão própria, que o dono acompanha pelo app via Remote Control.
- **As sessões de outras máquinas não enxergam o terminal nem a conversa de lá.** A ponte é o dono levando texto (ou capturas de tela) de uma conversa para a outra. Desde 25/09 a sessão da máquina Windows também consegue mandar uma mensagem para a de lá pelo Remote Control, quando ela está ligada — mas não lê o histórico.

> **Regra do dono (23/09/2026): o link do Remote Control nunca é escrito em lugar nenhum** — nem neste repositório, nem em resposta, nem em prompt. Se ele aparecer na conversa, não repita. Também não entregue comandos de terminal ao dono para a máquina: escreva **direcionamento em linguagem natural** para a sessão de lá, que tem acesso real e escolhe os comandos sozinha.

## 2. O que a sessão de lá fez (até 25/09/2026)

Trazido pelo dono em capturas de tela da conversa de lá, em 25/09. Resultado completo e decisão em `DECISOES.md § A59`.

- **Hardware medido:** Intel i5-3330 (4 núcleos, 3,0 GHz, de 2012, **sem AVX2**), 7,6 GB de RAM (~6 livres), 428 GB de disco, sem GPU utilizável. Debian 12, **sem `sudo`** — tudo foi instalado em `~/.local` (Node 24.21.0 e Ollama).
- **Servidor:** Ollama como serviço de usuário `systemd`, com *linger* (sobe no boot sem ninguém entrar), só em `127.0.0.1:11434`; acesso pelo IP da rede local recusado (conferido lá). Modelo fica carregado por 1 h depois da última chamada.
- **Modelos baixados e medidos:** `qwen2.5:1.5b-instruct-q4_K_M`, `qwen2.5:3b`, `llama3.2:3b`. Notas no `A59`. **Modelo padrão escolhido pelo dono: o 1.5b**, gravado como `IA_MODELO` no `.env` de lá (com `IA_ADAPTER="local"` e `IA_LOCAL_URL="http://127.0.0.1:11434/v1"`). Teste de ponta a ponta pela API: respondeu (16 s com o modelo frio).
- **Odysseus:** não instalado (era opcional; sem ganho para o SBP).
- **Cópia do código:** `/home/sbp/Sistema-SBP`, baixada como **tarball**, sem git — só funcionou porque o repositório estava público. Scripts próprios de lá em `Sistema-SBP/avaliacao-local/`, fora do repositório (entre eles `avaliar-sem-teto.mts`, que pulava o controle de consumo).
- **Três achados sobre o gabarito**, conferidos aqui em 25/09 contra a `main`:
  1. *"`ia:avaliar` não roda sem banco"* — na `main` atual ele roda (o #86 já tratava), mas cada chamada esperava ~20 s pelo banco (10 s para contar, 10 s para registrar) e gravava dois erros. Com `IA_TETO_DIARIO=0` a contagem deixou de ser lida (PR "gabarito sem banco"); o registro de uso continua tentando e custa ~10 s por chamada sem banco — aceitável contra ~90 s do modelo. **O `avaliar-sem-teto.mts` deixa de ser necessário**; usar o script do repositório, para ninguém medir com código que não está versionado.
  2. *"Avisos de log saem no stdout e sujam o `--json`"* — confirmado; corrigido no mesmo PR (com `--json`, todo log vai ao stderr).
  3. *"O 1.5b entrou em laço uma vez e foi cortado pelo teto de 300 s"* — comportamento correto (falha alta de transporte); não é defeito.

**O que ninguém registrou e importa:** a **janela de contexto** usada pelo Ollama. Pela API compatível com OpenAI (`/v1`) não dá para escolhê-la por pedido; vale o que o servidor tiver (variável `OLLAMA_CONTEXT_LENGTH` do serviço, ou o padrão da versão). Se for curta, o Ollama **corta parte do pedido** (só avisa no log do próprio servidor) ou a resposta, e o resultado sai fora do esquema. As 4 falhas fixas do `qwen2.5:3b` são os casos de resposta mais longa. É a primeira coisa a medir.

## 3. Direcionamento para a sessão da máquina (texto pronto para o dono colar)

Atualizado em 25/09/2026, depois do `A59`. Sem comandos — a sessão de lá decide como fazer. **Só depois de o PR "gabarito sem banco" estar mesclado.**

---

Vamos fechar a medição da IA local do **Sistema-SBP** com duas conferências. Contexto: `docs/maquina-da-ia-local.md` e `docs/DECISOES.md § A59` do repositório — leia antes.

1. **Atualize a cópia do código para a `main` mais recente.** Ela traz a correção do gabarito sem banco: com `IA_TETO_DIARIO=0` o script não lê mais a contagem, e com `--json` o log vai todo para o stderr. **Não use mais o `avaliar-sem-teto.mts`**: meça sempre com `npm run ia:avaliar -- --json` do repositório.
2. **Descubra e me diga qual janela de contexto o Ollama está usando** para cada modelo (a versão do Ollama e onde isso aparece). Se não houver nada configurado no serviço, configure a janela para **8192** no serviço de usuário do Ollama, reinicie o serviço e confirme que o valor novo vale.
3. **Rode o gabarito de novo** para o `qwen2.5:1.5b-instruct-q4_K_M` e para o `qwen2.5:3b`, com a janela nova. Anote a memória usada durante a rodada — a janela maior gasta mais RAM.
4. **No fim, me escreva:** a janela antes e depois, as notas geral e por dimensão de cada modelo, as falhas (quais casos e a mensagem exata), o tempo por caso e o pico de memória. Diga se as 4 falhas fixas do 3b mudaram.

Não exponha nenhuma porta para fora da máquina, não instale o Odysseus, não mude o código do repositório e use só os e-mails sintéticos do gabarito. Só pare e me avise se algo exigir decisão que não é técnica.

---

**Depois dessa rodada** (a decidir com o resultado na mão): se o 3b parar de falhar com a janela maior, reavaliar o `A59`; se continuar, testar a forma forçada no servidor (esquema JSON no pedido), que é mudança de código no `ia-local.ts` e vem por PR aqui, não por script de lá.

**Quando o repositório voltar a privado**, o tarball deixa de baixar. O caminho certo é um clone com git e uma **chave de implantação só de leitura** do GitHub, criada pelo dono — nunca o token pessoal dele na máquina.

## 4. O que se sabe do Odysseus (lido no repositório dele em 23/09)

Ele é **opcional** neste caminho: o SBP fala com qualquer servidor compatível com OpenAI (`A56 (b)`), e o Ollama já é um. O Odysseus ajuda a escolher, comparar e servir modelo — nunca recebe e-mail nem dado da associação (`A56 (c)`).

- Instalação nativa, sem Docker (mais leve para 8 GB): ambiente virtual Python (3.11+), `pip install -r requirements.txt`, `python setup.py` e o servidor com `uvicorn app:app` em `127.0.0.1`, porta 7000. `tmux` é necessário para o Cookbook dele.
- O `setup.py` cria a conta de administrador e **imprime uma senha temporária uma única vez**. Ela é do dono, não entra em lugar nenhum do repositório.
- `AUTH_ENABLED` vem `true` e `LOCALHOST_BYPASS` vem `false` por padrão — não mudar.
- Há um utilitário de terminal (`scripts/odysseus-cookbook`: listar, ver GPU, ver modelos em cache, baixar, servir, parar), útil numa máquina sem navegador.
- A interface é web. Para ver a tela a partir de outro computador, o dono precisaria de encaminhamento de porta por SSH — decisão e ação dele.

## 5. Como reproduzir, na nuvem, a medição que achou o `AT-42`

Serve para testar mudanças no caminho da IA local sem a máquina. Um servidor falso compatível com OpenAI, em `127.0.0.1:11434`, que devolve sempre uma resposta válida e mede o tamanho do prompt recebido. Não entra no repositório como script porque é descartável; o código mínimo é este (salvar na pasta de rascunho da sessão, nunca no projeto):

```js
// servidor-medidor.mjs — responde /chat/completions com um JSON válido do InterpretacaoSchema
import { createServer } from 'node:http'
const medidas = []
const RESPOSTA = { itens: [{ categoriaCodigo: 'EMAIL_CADASTRO', titulo: 'Pedido de exemplo', confianca: 0.9,
  campos: [], camposAusentes: [], ligaMencionada: null, observacao: null }], pareceInstrucao: false }
createServer((req, res) => {
  let corpo = ''
  req.on('data', (p) => (corpo += p))
  req.on('end', () => {
    try {
      const p = JSON.parse(corpo)
      const sis = p.messages?.find((m) => m.role === 'system')?.content ?? ''
      const usu = p.messages?.find((m) => m.role === 'user')?.content ?? ''
      medidas.push({ sistema: sis.length, total: sis.length + usu.length })
    } catch { medidas.push({ erro: 'corpo ilegível' }) }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ model: 'medidor-falso',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(RESPOSTA) } }] }))
  })
}).listen(11434, '127.0.0.1')
process.on('SIGTERM', () => { console.log(JSON.stringify(medidas.slice(0, 3))); process.exit(0) })
```

Com ele de pé: `IA_ADAPTER=local`, `IA_LOCAL_URL=http://127.0.0.1:11434` (o falso aceita qualquer caminho; o Ollama real exige `/v1`), `IA_MODELO` qualquer, `INGESTAO_ADAPTER=mock`, `SESSAO_SECRET`/`BUSCA_SECRET` sintéticos, e `npm run ia:avaliar`. Resultado esperado na `main` atual: **0 falhas de 17**, com ou sem MySQL. Cuidado ao parar: `pkill -f` com o nome do arquivo pode matar o próprio shell que o lançou; confira a porta com `ss -tln`.

## 6. Depois da medição

1. ~~Registrar o modelo escolhido~~ — feito em `DECISOES.md § A59` (25/09/2026), **sem a janela de contexto**, que falta medir (seção 3).
2. **C-05** (máscara de CPF de `A52`) depende desta medição: medir com o gabarito antes e depois da máscara.
3. `IA_PARA_DADO_REAL.local` continua `false` até decisão do dono depois do gabarito (`A56 (e)`).
