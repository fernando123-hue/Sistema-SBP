# Máquina da IA local — estado, direção e como medir

Registro de 24/09/2026. Tudo o que até aqui só existia em conversa sobre a máquina que o dono conseguiu para a IA local (`DECISOES.md § A56 (d)`). Quem abrir uma sessão nova sem memória nenhuma deve conseguir continuar só com este arquivo e com `ESTADO.md`.

## 1. O que é a máquina

- **Debian**, kernel `6.1.187-1` (provavelmente Debian 12). Acesso **só por terminal**, remoto; não há navegador nela.
- Pela decisão registrada em `A56 (d)`: fraca, **cerca de 8 GB de RAM**, sem GPU garantida. Só cabe modelo pequeno (1 a 4 bilhões de parâmetros, quantizado), em CPU.
- **O Claude Code foi instalado nela** pelo dono, com login pelo fluxo manual (URL aberta em outro aparelho). Ali roda uma sessão própria, que o dono acompanha pelo app via Remote Control.
- **As sessões na nuvem (como a que escreveu este arquivo) não alcançam essa máquina.** São ambientes separados. A ponte é o dono levando texto de uma conversa para a outra.

> **Regra do dono (23/09/2026): o link do Remote Control nunca é escrito em lugar nenhum** — nem neste repositório, nem em resposta, nem em prompt. Se ele aparecer na conversa, não repita. Também não entregue comandos de terminal ao dono para a máquina: escreva **direcionamento em linguagem natural** para a sessão de lá, que tem acesso real e escolhe os comandos sozinha.

## 2. O que a sessão de lá já fez (até 23/09, noite)

Segundo o que o dono trouxe daquela conversa:

- Ollama instalado e servindo em `127.0.0.1:11434` (API compatível com OpenAI em `/v1`).
- Modelos pequenos baixados (candidatos sugeridos: `qwen2.5:3b`, `llama3.2:3b`, `gemma2:2b`; menores se a RAM apertar: `qwen2.5:1.5b`, `llama3.2:1b`). **Não está registrado aqui quais foram de fato baixados** — pergunte ou peça à sessão de lá.
- Sistema-SBP clonado e o gabarito (`npm run ia:avaliar`) rodando contra o Ollama.
- Parou no meio de *"repetindo 6 casos que falharam"*, de 17, porque **a máquina ficou inalcançável** — não por erro de lógica.

**Aquelas 6 falhas não servem para escolher modelo.** O clone de lá era anterior ao PR #86: sem MySQL de pé, a leitura da contagem do teto diário derrubava a chamada (`DECISOES.md § AT-42`). Reproduzido aqui: 17 falhas de 17 sem banco, 0 de 17 com o #86. A rodada tem de ser refeita com a `main` atual.

## 3. Direcionamento para a sessão da máquina (texto pronto para o dono colar)

Atualizado depois do #86. Sem comandos — a sessão de lá decide como fazer.

---

Vamos retomar a avaliação do modelo de IA local para o **Sistema-SBP** (repositório público `fernando123-hue/Sistema-SBP`). O contexto completo está em `docs/maquina-da-ia-local.md` e em `docs/DECISOES.md § A56` e `§ AT-42` desse repositório — leia antes.

1. **Atualize o clone do Sistema-SBP** para a `main` mais recente e reinstale as dependências. Isso é obrigatório: a rodada anterior foi feita antes de uma correção (PR #86) que mudou o resultado — sem ela, a falta de banco de dados derrubava as chamadas de IA e parecia culpa do modelo.
2. **Confira que o servidor de modelo continua de pé só em loopback** (`127.0.0.1`), e liste os modelos baixados.
3. **Rode o gabarito (`npm run ia:avaliar -- --json`) contra cada modelo**, um de cada vez, com `IA_ADAPTER=local`, `IA_LOCAL_URL` apontando para a raiz da API compatível com OpenAI do servidor (no Ollama, termina em `/v1`) e `IA_MODELO` com o nome exato do modelo. Não precisa montar banco de dados: sem banco, o teto diário fica sem valer e o script segue. Use só os e-mails sintéticos do próprio gabarito.
4. **Se ainda houver falhas, investigue a causa antes de culpar o modelo.** Suspeita principal, ainda não verificada: o prompt de sistema do interpretador tem cerca de 9,6 mil caracteres mais o esquema JSON, e servidores locais costumam vir com janela de contexto curta (às vezes 4096 tokens). Truncamento aparece como "resposta truncada". Se for isso, aumente a janela de contexto no servidor e rode de novo — e diga qual valor usou.
5. **No fim, escreva um resumo em português:** hardware medido (CPU, núcleos, RAM, disco, GPU), modelos testados, nota geral e por dimensão de cada um, tempo aproximado por caso, janela de contexto usada, qual recomenda e por quê, e qualquer erro relevante com a mensagem exata. Vou levar esse resumo para a conversa onde o projeto é desenvolvido.

Pode decidir os comandos sozinho. Só pare e me avise se algo exigir decisão que não é técnica (por exemplo, a máquina não aguentar nem o menor modelo). Nunca exponha nenhuma porta para fora da máquina.

**Opcional, só se sobrar tempo:** o Odysseus (`odysseus-dev/odysseus`, licença AGPL-3.0), seguindo o guia oficial de instalação nativa em Linux (`website/setup.md` do repositório dele), só em loopback, com `AUTH_ENABLED` e `LOCALHOST_BYPASS` nos padrões seguros, sem acesso ao socket do Docker, e sem copiar nenhum código dele para outro projeto.

---

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

1. Registrar em `DECISOES.md § A56` o modelo escolhido, com as notas, o hardware e a janela de contexto.
2. **C-05** (máscara de CPF de `A52`) depende desta medição: medir com o gabarito antes e depois da máscara.
3. `IA_PARA_DADO_REAL.local` continua `false` até decisão do dono depois do gabarito (`A56 (e)`).
