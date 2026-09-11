# Achados em aberto — auditoria de 08/09/2026

As sete dimensões que faltavam rodaram em 08/09/2026 (`ui-ux`, `fluxos-incompletos`,
`testes`, `performance`, `tipos-contratos`, `config-dependencias`, `documentacao`),
fechando as dezesseis da auditoria profunda. **O que elas acharam e foi corrigido
está na tabela do `ESTADO.md`; o que ficou em aberto está aqui**, com detalhe
suficiente para agir sem precisar reabrir nada.

> **Por que este arquivo existe.** Os relatórios completos viviam só no transcript
> da sessão. Um achado que só existe numa conversa é um achado que se perde — é a
> mesma perda silenciosa que o sistema inteiro foi construído para eliminar.

Cada item traz: onde, o que acontece, o cenário concreto, e a correção sugerida.

## Situação em 10/09/2026

Trabalhados na branch `maturacao/achados-em-aberto`. **Corrigido** quer dizer
corrigido e provado: cada teste novo foi visto falhando contra uma sabotagem do
código que ele guarda, e a sabotagem desfeita. O texto original de cada achado,
abaixo, ficou como estava — é o registro do que foi encontrado.

| # | Situação |
|---|---|
| 1, 2, 3 | ✅ corrigido — conservação agregada no banco (zero linhas no caso normal), rodada gravada em lote, uma variante da lista por vez |
| 4, 5, 6 | ✅ corrigido — `select` na fila, efeitos do painel separados, `escopo` explícito em `porPessoa` |
| 7 a 17 | ✅ testes escritos — trava, `rota()`, assistente, `definirEscala`, datas, `limitarPorOrigem`, `delimitar`, fronteira dos 40 bytes, `NaRede`, `DataIsoSchema`. O **14** também mudou código: a detecção passou a ver texto ofuscado (`core/seguranca/dobra.ts`) |
| 18, 19, 20 | ✅ corrigido — `statusHttp: 422 \| 503`, código de categoria preso ao enum, `core/telas.ts` como fonte única |
| 21 | ✅ corrigido — o segundo passo de "Não vale mais" pede o porquê (opcional), `api.remover` aceita corpo, e a rota usa `corpoJsonOpcional`: arquivar sem motivo deixou de gravar aviso de JSON inválido. **O motivo ainda não é exibido**: não existe tela de notas arquivadas; ele fica no banco e em `?todas=1` |
| 22 | ✅ o elo mais fraco fechou — `GET /api/categorias` tipado por `CategoriaDisponivel`, lido pela rota, pela Caixa e pelo Acesso (renomear campo do `select` deixou de compilar, provado). As outras formas redigitadas continuam registradas na `H-D7`, sem divergência hoje |
| 23 | ✅ corrigido — `lerDoBanco` em frente, grupo, tipo de afastamento e papel (falha como 500, não como 400) |
| 24, 25, 30, 31 | ✅ corrigido na tela — **tipos e build conferidos; ver rodando exige login, e isso é do dono** |
| 26, 27, 28 | ❓ viraram pergunta: `DECISOES.md § H.4` itens 16, 17 e 18. O comentário do 28 foi corrigido |
| 29 | ➖ **não mudado, e é deliberado.** `pipeline.test.ts` exige `motivo = 'devolucao'` na atribuição encerrada, e a desativação de colaborador grava o mesmo: hoje `Atribuicao.motivo` registra como a atribuição *terminou*. Guardar também como começou pede coluna nova; o dano é contido, porque nada lê o campo — e a devolução, com justificativa, está na trilha |
| 32 | ➖ registro, não defeito — a decisão sobre o CodeQL segue válida |
| 33 | ✅ corrigido — `adapters/fronteira-do-fornecedor.test.ts`, inclusive `import()` com crase, que a revisão pegou escapando |
| 34 | ✅ corrigido — sentinela cifrada na raiz do armazenamento, conferida antes da primeira leitura ou gravação de cada processo; instalação sem sentinela testa a chave contra um anexo existente antes de adotá-la; sentinela em texto puro não confirma nada; primeiras gravações simultâneas não se acusam mutuamente (a revisão reproduziu essa corrida na primeira versão); falha de disco não deixa temporário órfão, e `EPERM` não degrada calado para a publicação não atômica (segunda revisão). Oito sabotagens, oito falhas. **Não é na partida do servidor** — ver `DECISOES.md § AT-13` |
| 35, 36 | ✅ corrigido — a saída do Prisma aparece quando a migração falha; `prisma.config.ts` não inventa mais `DATABASE_URL` (provado sem `.env`: `validate` passa, `migrate status` recusa) |

**Nenhum achado ficou sem destino.** Os três que fecharam por último foram o 21, o 22 e o 34. O que continua aberto é decisão (`§ H.4` itens 15 a 18) ou limite registrado — as telas não vistas rodando, o motivo de arquivamento que não é exibido, e o resto da `H-D7`.

---

## Performance

### 1. `conferirConservacao` traz ~5.600 linhas por carregamento do painel

`src/servicos/painel.ts` — a conferência materializa **uma linha de `Atribuicao`
por item da janela de 90 dias** para produzir ~530 contagens. O `distinct` do
Prisma é aplicado pelo engine, não pelo banco, então as linhas atravessam a
fronteira de qualquer jeito.

- **Escala medida:** 90 dias × 62 itens/dia ≈ 5.580 linhas por carregamento, mais
  um `IN` de ~530 ids de rodada. É, de longe, a maior resposta do sistema, na tela
  mais visitada, e o `useEffect` a redispara a cada mudança de período.
- **Hoje:** 20–40 ms em SQLite in-process. **Em PostgreSQL:** é a maior regressão
  de rede da migração.
- **Correção:** agregar no banco — `SELECT rodadaId, COUNT(DISTINCT itemId) …
  GROUP BY rodadaId` devolve 530 linhas em vez de 5.580. Se `$queryRaw` for
  indesejável na fronteira, reduzir a janela padrão do painel e deixar 90 dias
  para relatório sob demanda.

### 2. Escrita item a item em `gravarRodada`, dentro da trava do dia

`src/servicos/distribuicao.ts` — o laço faz `atribuicao.create` + `item.update`
por item, sequencialmente. `auditarLote`, na mesma função, já usa `createMany`: a
técnica está no arquivo e não foi aplicada aqui.

- **Contagem completa da transação de `confirmar`** (6 categorias, 3 pessoas de
  plantão, 62 itens): ~288 consultas sequenciais com a trava segurada — 96 do
  planejamento, **124 do laço de escrita**, 66 do resto.
- A metade que **cresce com o volume da associação** é o bloco de 124;
  `carregarElegiveis` escala com pessoas (4–7, fixo por anos).
- **Hoje:** ~15 ms. **Em PostgreSQL com 3 ms de RTT:** ~0,9 s de trava por
  confirmação.
- **Correção:** `createMany` para as atribuições da fatia e `updateMany` para o
  status. A conferência `atribuidos !== quantidadeEntrada` continua valendo e fica
  **mais forte**: passa a comparar o que o banco confirmou ter escrito.

### 3. `ListaResponsiva` renderiza cada lista duas vezes

`src/componentes/matrizes.tsx` — emite uma `<table>` (`hidden md:block`) **e** uma
lista de cartões (`md:hidden`), e esconde metade com CSS. Os dois laços percorrem
todas as linhas e invocam `coluna.conteudo(linha)`.

- **Na Caixa:** 200 linhas × 5 colunas + 200 cartões × 4 campos ≈ 10.000 nós de
  DOM, metade nunca vista, e ~1.800 invocações por render.
- **Correção:** escolher a variante em tempo de execução com
  `useSyncExternalStore` sobre `matchMedia('(min-width: 768px)')`. Todos os
  consumidores já são `'use client'` com dados de `useEffect`, então não há
  conteúdo de servidor a preservar.

### 4. `minhaFila` carrega o corpo inteiro do e-mail para mostrar remetente e assunto

`src/servicos/fila.ts` — `include: { conteudo: true }` traz `EmailConteudo.corpo`
(texto livre, sem teto) para cada item da fila; o mapeamento usa só `remetente` e
`assunto`. `listarCaixa` faz certo no mesmo cenário: `select` explícito.

- **Cenário:** fila de 40 itens × ~3 KB ≈ 120 KB lidos e descartados por
  carregamento, na tela declaradamente mobile-first. Os dados sintéticos têm 148
  caracteres de corpo, o que **esconde** o problema em teste.
- **Correção:** `select` explícito, copiando `listarCaixa`; considerar um `take`.

### 5. O `useEffect` do painel refaz três requisições quando só uma depende do período

`src/app/painel/page.tsx` — dependência `[de, ate]` dispara `/painel`,
`/qualidade` (janela própria) e `/afastamentos/hoje` (estado atual). Ajustar as
duas pontas de um período custa 8 consultas desnecessárias.

- **Correção:** dois efeitos — um com `[de, ate]`, outro com `[]`.

### 6. Aviso para quem executar o plano `H-D8`

`painel.porPessoa` lê `saldoCargaGlobal.findFirst` **sem filtrar `escopo`**,
pegando a linha mais recente entre `CADASTRO` e `TITULOS` indistintamente. O
comentário do próprio modelo diz que somar os dois razões faz o crédito perder
significado. Hoje só existe `CADASTRO`, então não aparece — a reescrita em lote
vai cimentar o comportamento se ninguém olhar.

---

## Testes que faltam

### 7. A trava de distribuição não tem teste nenhum

`travaDeDistribuicao` não aparece em nenhum arquivo de teste. O schema dedica seis
linhas ao motivo dela existir: duas confirmações concorrentes do mesmo dia leem o
crédito uma da outra e desempatam com dado obsoleto.

- **Risco:** alguém remove o `upsert` (parece escrita inútil — nada lê `execucoes`)
  e a suíte inteira passa.
- **Testes:** `'confirmar registra a trava do dia e conta as execuções'` (confirmar
  duas vezes, asseverar `execucoes === 2`); e `'a trava é tomada ANTES de qualquer
  leitura de crédito'` — envolver `tx` num proxy que registra a ordem. Concorrência
  real não é observável sob better-sqlite3 síncrono; a **ordem** é.

### 8. `rota()` só tem prova do ramo 500

`src/servidor/http.ts` — não há teste de `SemSessaoError → 401`,
`SenhaProvisoriaError → 403`, `PermissaoNegadaError → 403`, `ZodError → 400`,
`ErroDominio → 422`, nem do ramo `ErroOperacional`, cujo comentário diz que sem
ele "seis classes com mensagem escrita para humano chegavam à tela como Erro
interno". `mensagemPublica` não é mencionada em teste nenhum.

- **Teste:** `it.each` sobre os pares erro→status, asseverando o status **e** que a
  mensagem chega inteira nos `< 500`; e que `ErroOperacional` devolve
  `mensagemPublica` sem a causa crua.

### 9. `perguntarAoAssistente` não tem arquivo de teste

`src/servicos/assistente.ts` — as duas garantias que o serviço declara em prosa não
têm prova: a **segunda** conferência de papel sobre a saída do modelo, e "o texto
da pergunta não é persistido, nem na trilha, nem no evento, nem no log".

- **Testes:** duble devolvendo `telaSugerida` fora do papel de quem perguntou →
  `null`; pergunta com texto-sentinela → varrer `EventoProcessamento` e
  `LogAuditoria` inteiros e asseverar que a sentinela não aparece; falha ao
  registrar o uso não derruba a resposta.

### 10. `definirEscala` — a porta que decide quem recebe trabalho — não é chamada por teste

`src/servicos/escala.ts`. Zero ocorrências de `definirEscala` e de
`capacidadeRelativa` em testes. Sem cobertura: a checagem de papel, o upsert, a
auditoria e a trava `z.literal(1)`.

- **Cenário:** alguém troca `z.literal(1)` por `z.number().min(0).max(2)` para
  "liberar meio período", esquece o motor, e o defeito que o comentário descreve
  volta idêntico — com a suíte verde.
- **Testes:** colaborador não define escala; capacidade parcial é recusada
  enquanto o motor não a lê; redefinir o mesmo dia sobrescreve e deixa
  antes/depois na auditoria; quem não tem linha de escala não entra no rateio.

### 11. `core/util/datas.ts` não tem teste — inclusive o fuso

O comentário do arquivo descreve o defeito: com `toISOString()`, "a partir das 21h
o sistema achava que já era o dia seguinte". Nenhum teste chama `paraDataIso`,
`fimDoDia`, `inicioDoDia`, `inicioDoMes` ou `diasEntre` com valor fixo.

- **Testes:** `paraDataIso(new Date('2026-09-07T01:30:00.000Z')) === '2026-09-06'`;
  `fimDoDia('2026-09-07').toISOString() === '2026-09-08T02:59:59.999Z'`;
  `deslocarDias('2026-03-01', -1) === '2026-02-28'`; `diasEntre` contando dias de
  calendário; `inicioDoMes`.

### 12. `limitarPorOrigem` e `FATOR_SEM_ORIGEM` sem teste

`src/servidor/http.ts` — as duas metades são testadas isoladamente; a função que as
junta, não. É um ternário, e a leitura invertida é fácil: com ela, o balde global
ganha o teto apertado e **um visitante tranca a equipe inteira fora de
`/api/sessao`**.

- **Testes:** origem indistinguível afrouxa o teto em `FATOR_SEM_ORIGEM`; origem
  confiável usa o teto apertado, com 429 e `Retry-After`.

### 13. A regressão que o comentário de `delimitar` descreve não tem teste

`src/core/seguranca/conteudo-nao-confiavel.ts` — quinze linhas de comentário
registram que a remoção fazia `replaceAll` de string exata, e o marcador em
minúsculas **sobrevivia** à camada 3. O teste que guarda a correção usa caixa
exata: **passa nas duas implementações**.

- **Teste:** `it.each` sobre variantes de caixa e espaço, asseverando que
  `delimitar(ataque)` contém exatamente um marcador de fim (o nosso) e que a
  variante forjada não aparece.

### 14. `analisarConteudo` não normaliza o texto

`removerCaracteresDeControle` é aplicado **só a nome de anexo**; o corpo vai cru
para as regexes. Verificado: `Ignore​ as instruções` é detectado, mas
`Ign​ore as instruções` **não**, e o homóglifo cirílico também não.

- **Consequência:** `conteudoSuspeito` volta `false`, o item não vai para revisão
  por `conteudo_suspeito`, e a aprovação em massa deixa de recusá-lo.
- **Correção:** normalizar (NFKC + as mesmas faixas de formatação) antes de
  aplicar os padrões. **Se a decisão for não normalizar**, o teste deve inverter e
  documentar o limite — hoje o comentário do módulo promete mais do que entrega.

### 15. O fallback de anexo legado transforma arquivo truncado em bytes válidos

*(A metade com cabeçalho mágico foi corrigida em 08/09.)* Falta o teste do outro
lado: arquivo **sem** cabeçalho e curto demais continua sendo aceito como legado.

- **Teste:** `'arquivo com cabeçalho mágico mas payload vazio é decifrado como
  vazio, não recusado'`, fixando a fronteira dos 40 bytes.

### 16. `NaRede<T>` não tem prova de tipo nem de runtime

`src/core/tipos.ts` — não existe `expectTypeOf`/`assertType` no repositório.

- **Testes:** `expectTypeOf<NaRede<ItemDaCaixa>['recebidoEm']>().toEqualTypeOf<string | null>()`;
  `Date` dentro de array de objeto; e um teste de runtime sobre
  `JSON.parse(JSON.stringify(dto))`.
- **Limite conhecido:** `NaRede` deforma `Map`, `Set`, tuplas e funções — nenhum
  aparece nos DTOs hoje, e nenhum sobrevive a JSON. Um `V extends Function | Map |
  Set ? never : …` transformaria a mentira em erro de compilação.

### 17. O `refine` de calendário de `DataIsoSchema` não tem teste

Recusa `2026-02-30` e `2026-13-01`; nenhum teste passa data inexistente.

- **Cenário:** o `refine` sai num refactor (parece redundante depois da regex), e
  `2026-02-30` entra como `Afastamento.inicio` — a comparação de cobertura é
  textual, então a chave torta cobre uma faixa que não é dia nenhum.
- **Teste:** `it.each(['2026-02-30','2026-13-01','2026-00-10','2027-02-29'])` recusa,
  e `it.each(['2024-02-29','2026-12-31'])` passa.

---

## Tipos e contratos

### 18. `ErroOperacional.statusHttp` é `number` e aceitaria 500

`src/core/erros.ts` — `rota()` trata `ErroOperacional` **antes** de `statusDoErro` e
devolve `mensagemPublica` sem passar pelo portão `status < 500`. O comentário logo
abaixo declara a regra oposta com ênfase: "daqui para baixo é falha do servidor…
SEM EXCEÇÃO".

- **Cenário:** uma subclasse nova com `statusHttp = 500` e `message` construída a
  partir do erro cru do Prisma (que costuma carregar e-mail e id) devolve tudo ao
  cliente, sem correlação e sem passar pelo registro.
- **Correção:** `abstract readonly statusHttp: 422 | 503` — os dois valores que a
  docstring do campo já enumera. A regra vira erro de compilação.

### 19. Os oito códigos de categoria existem duas vezes, sem vínculo

`src/core/esquemas.ts` (`CategoriaCodigoSchema`) e `src/core/config.ts`
(`DEFINICOES`, que semeia o banco).

- **Cenário:** acrescentar `ANUIDADE` em `DEFINICOES` e rodar o seed funciona; a
  tela oferece a caixa; marcar responde `400 categorias.3: Invalid option`. A
  categoria fica visível e inutilizável, e o erro aparece três telas depois da
  causa.
- **Correção:** tipar `DefinicaoCategoria['codigo']` como
  `z.infer<typeof CategoriaCodigoSchema>` — `import type` entre dois arquivos do
  núcleo não fere a pureza.

### 20. `PAPEIS_DA_TELA` espelha `DESTINOS` à mão, e o assistente lê a cópia

`src/core/assistente/conhecimento.ts` × `src/componentes/navegacao.tsx`. A segunda
conferência de papel sobre a saída do modelo lê a cópia.

- **Cenário:** colaborador passa a ver a Revisão; alguém muda `DESTINOS` e esquece
  `PAPEIS_DA_TELA`. O link aparece e a tela funciona, mas o assistente apaga a
  sugestão e grava `aviso: assistente sugeriu tela fora do papel` a cada pergunta
  — poluindo o sinal que existe para detectar modelo escorregando. No sentido
  inverso, o assistente manda a pessoa para uma tela que responde 403.
- **Correção:** `PAPEIS_DA_TELA` no núcleo vira fonte única, e `navegacao.tsx`
  deriva `DESTINOS` dela. A seta continua apontando para dentro.

### 21. `Nota.motivoArquivo` é um campo que ninguém consegue escrever

O Zod aceita, o serviço grava, o DTO leva à tela — mas o único caminho de
arquivamento é `api.remover`, cuja assinatura **não aceita corpo**, e `notas.tsx`
declara o campo sem nunca renderizá-lo. `motivoArquivo` é `null` em 100% das
linhas, por construção.

- **Efeito colateral:** `DELETE` sem corpo faz `corpoJson` estourar e gravar
  `aviso: corpo da requisição não é JSON válido` **a cada arquivamento legítimo**.
- **Correção:** `remover` passa a aceitar corpo opcional; o motivo vem do diálogo
  de confirmação que a tela já tem; exibir na lista de arquivadas. Ou tirar o
  campo do DTO e do esquema — campo que só existe no tipo é a doença que o sistema
  veio curar.

### 22. `H-D7` residual: oito formas ainda redigitadas à mão

`ItemDaFila`, `NotaDoSetor`, `Fatia`/`LinhaDaPrevia`/`Narrativa`/`Resumo`,
`Qualidade`/`LinhaDeAcerto`, `Categoria` (duas cópias), `Liga`, `Entrada`.
**Nenhuma diverge hoje** — o que existe é o mecanismo que produziu a divergência
anterior, agora com a correção (`NaRede<T>`) disponível e não aplicada.

- **Elo mais fraco:** `GET /api/categorias` é a única rota consumida por duas telas
  **sem nenhuma interface nomeada em lugar nenhum** — o `select` do Prisma é o
  contrato inteiro. Renomear `entraNoRateio` ali faz o `<select>` de responsável
  sumir da Caixa, três arquivos depois.

### 23. Asserções de `string` do banco para união fechada, sem revalidação

`afastamento-visivel.ts`, `afastamentos.ts`, `colaboradores.ts`, `distribuicao.ts`
(`registro.frente as Categoria['frente']`), `caixa.ts` (`JSON.parse(...) as …`).

- **O de maior consequência é `frente`:** ele vira `SaldoCargaGlobal.escopo`. Uma
  linha semeada com `'CADASTROS'` (plural) cria um segundo escopo de razão global —
  o crédito passa a ser somado em dois livros que nunca se encontram, e o
  desempate enxerga metade da história. Nada acusa.
- **Correção:** `parse` do Zod nos pontos de leitura, como `perfilAtual` já faz.

---

## Interface e fluxo

### 24. A prévia da distribuição envelhece na tela

`src/app/distribuicao/page.tsx` — `confirmar` manda só `{data, categorias}`; o
servidor recalcula. A tela afirma: "o que aparece aqui é exatamente o que será
gravado". A função é a mesma; a **entrada**, não.

- **Cenário:** prévia calculada às 9h20 com 38 itens; outro operador roda "Buscar
  e-mails" e entram 27; às 14h a tela ainda mostra 38 e o botão segue habilitado.
- **Correção:** carimbar a prévia com o horário e exigir recálculo depois de N
  minutos, ou avisar que a distribuição será recalculada com os dados de agora.

### 25. A caixa de plantão não responde ao clique até o servidor responder

`src/app/distribuicao/page.tsx` — `alternar` faz o `PUT` e só atualiza depois; a
caixa não é desabilitada e não há indicador perto dela.

- **Cenário:** segunda-feira, cinco pessoas para marcar; a operadora clica três
  vezes achando que não pegou, as respostas chegam fora de ordem, e ela clica em
  "Calcular prévia" com a escala que **acha** que marcou.
- **Correção:** desabilitar a linha enquanto o `PUT` está em voo, ou atualizar de
  forma otimista e reverter na falha.

### 26. Não existe como cancelar um item depois de distribuído

Só há caminho para `cancelado` a partir da fila de revisão. Item que a IA aprovou
com confiança alta nunca passa por lá.

- **Cenário:** o mesmo pedido chega duas vezes, de endereços diferentes
  (`messageId` distinto, idempotência não pega). Os dois viram itens e são
  distribuídos. Quem descobre a duplicata tem três saídas, e **cada uma corrompe
  uma métrica**: concluir (grava trabalho que não existiu), devolver (volta ao pool
  para outra pessoa descobrir de novo) ou deixar parado (engorda pendente e atraso
  para sempre).
- **Correção:** operação `cancelar item` para operador/gestor, com justificativa,
  encerrando a atribuição ativa e gravando `canceladoEm`. O painel já sabe
  descontar `canceladoNoPeriodo`.

### 27. `em_andamento` e `novo` estão no enum e nenhum código os produz

Sete ocorrências de `em_andamento`, todas de leitura. `LinhaPainel.emAndamento` é
sempre `0` e é devolvido pela API a cada carregamento. Idem `Execucao.resultado`,
que promete `concluido | devolvido | cancelado` e só grava o primeiro.

- **Correção:** decidir e registrar — implementar o "iniciar item" que
  `Execucao.iniciadoEm` já espera, ou remover os valores do enum, das consultas e
  do DTO.

### 28. Liga duplicada não tem caminho de correção

`core/ligas.ts` justifica a comparação exata dizendo que "o operador VÊ a repetição
e corrige". A segunda metade não existe: não há renomear, fundir nem arquivar
liga, e `Liga.status` nunca muda de valor.

- **Correção:** implementar a fusão (reapontar `Item.ligaId` e `Nota.ligaId`,
  marcar a absorvida, auditar) — **ou** corrigir o comentário, que hoje justifica
  uma decisão de desenho com uma capacidade que o sistema não tem.

### 29. `devolver` sobrescreve o motivo da atribuição original

`src/servicos/fila.ts` — o `update` troca `motivo` por `'devolucao'`, enquanto
`transferir`, na mesma classe de operação, encerra a linha antiga sem tocá-la e
cria uma nova, com o docstring declarando "o histórico é imutável".

- **Dano hoje é contido:** `Atribuicao.motivo` não é lido em lugar nenhum. Mas ao
  investigar por que uma liga foi partida, todas as encerradas dizem `devolucao`, e
  não dá para distinguir "recebeu pelo algoritmo e devolveu" de "recebeu por
  transferência e devolveu".

### 30. "Quem atendeu" esconde quem não tem habilitação, sem dizer

`src/app/caixa/page.tsx` — o seletor, obrigatório para `INADIMP.`/`ISENTO`
(categorias **fora** do rateio), é preenchido por `/escala`, que só devolve gente
com habilitação. Para categoria fora do rateio, habilitação não deveria ser
critério.

- **Cenário:** pessoa nova, sem categorias, atende um caso de inadimplência no
  balcão; o nome não está na lista, o botão fica cinza sem explicação, e o operador
  conclui que ela não foi cadastrada.

### 31. Alvos de toque abaixo do mínimo em três controles

`navegacao.tsx` ("sair", ~26 px), `caixa/page.tsx` (pastilhas de filtro, ~26 px),
`assistente.tsx` (fechar). O `Botao` do projeto garante `min-h-11` no celular, com
comentário explícito; estes três ficaram como `<button>` cru.

---

## Configuração

### 32. Nenhuma análise estática de segurança roda hoje

O CodeQL foi desarmado por decisão documentada e bem argumentada (workflow
eternamente vermelho ensina a ignorar vermelho). A consequência a registrar é que
o `gitleaks` cobre segredo, não vulnerabilidade de código.

### 33. A fronteira do fornecedor de IA não tem guarda automática

O invariante 2 diz que ninguém importa `IaAnthropic` ou `IaGemini` fora da fábrica.
Hoje é respeitado — e **nada verifica**. Compare com `core/pureza.test.ts`, que
guarda o invariante 1 com allowlist e prova que o detector detecta.

- **Correção:** um segundo teste no molde do `pureza.test.ts` sobre
  `adapters → fabrica`. É justamente a fronteira que o projeto usa como prova de
  que trocar de fornecedor custa uma linha.

### 34. Sentinela de chave para os anexos

Rotacionar `SESSAO_SECRET` sem fixar `ANEXOS_SECRET` continua tornando os anexos
ilegíveis — a diferença é que agora existe a variável, o aviso e a mensagem de
erro. O que falta é a falha ACONTECER NA PARTIDA.

- **Correção:** um arquivo-sentinela na raiz do armazenamento, gravado cifrado na
  primeira escrita e conferido na subida. Chave errada = o sistema recusa subir,
  no minuto zero, em vez de meses depois, pela pessoa errada.

### 35. `preparar-banco.ts` esconde o motivo quando a migração falha

`execSync('npx prisma migrate deploy', { stdio: 'ignore' })`. A falha sobe (certo),
mas a única coisa que o Prisma tinha a dizer foi jogada fora: o CI fica vermelho
com `Command failed` e nada mais.

### 36. `prisma.config.ts` inventa um `DATABASE_URL` que a aplicação recusa

`process.env['DATABASE_URL'] ?? 'file:./prisma/dev.db'` contra o `.min(1)` de
`ambiente.ts`. Quem rodar `db:migrate` antes de criar o `.env` migra um banco
órfão, e depois o `npm run dev` recusa subir.
