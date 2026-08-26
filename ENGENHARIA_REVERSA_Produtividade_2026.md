# ENGENHARIA REVERSA — PRODUTIVIDADE 2026
**Objeto:** `PRODUTIVIDADE_-_2026.xlsx` · 27 abas · 3,8 MB
**Objetivo:** extrair o modelo operacional para substituí-lo por sistema.

> **Convenção de confiança usada em todo o documento**
> `[FATO]` — lido diretamente de célula/fórmula.
> `[INFERIDO]` — dedução sustentada por evidência na planilha.
> `[HIPÓTESE]` — precisa de confirmação com a equipe.

---

## A. VISÃO GERAL DA OPERAÇÃO

### A.1 O que a empresa faz
`[FATO]` A aba `MOVIMENTO CADASTRO` intitula-se **"EVOLUÇÃO - SECRETARIA DE ATENDIMENTO AO ASSOCIADO - 2026"**.
`[FATO]` A aba `TITULO ANALISE DOCUMENTAL PROVA` lista exames: *Neonatologia, Medicina Intensiva Pediátrica, TEP R1/R2/R3, Alergia e Imunologia Pediátrica...*

`[INFERIDO]` Trata-se da secretaria de uma **associação/sociedade médica de pediatria**, com duas frentes:

| Frente | Abas | Natureza |
|---|---|---|
| **CADASTRO** | `CAD-[MÊS]` | Cadastro e atualização de associados + relacionamento com **Ligas Acadêmicas** e seus **ligantes** (estudantes membros) |
| **TÍTULOS/COMISSÃO** | `TITULO-[MÊS]` | Certificação: pedidos de certificado, titulação, análise documental de inscritos em prova, protocolos |

`[INFERIDO]` "Liga" = liga acadêmica (entidade). "Ligante" = estudante vinculado à liga (pessoa). Isso explica a formulação original do briefing ("como as ligas influenciam a distribuição", "como os alunos são identificados").

### A.2 O que a planilha realmente é
A planilha **não é um relatório de produtividade**. É um **livro-razão diário de repartição de trabalho**. Ela acumula três responsabilidades incompatíveis num único artefato:

1. **Motor de distribuição** — divide o volume do dia entre quem está de plantão.
2. **Controle de fila individual** — mantém o saldo/backlog de cada pessoa por categoria.
3. **Relatório gerencial** — alimenta o painel anual de atendimento/realizado/pendente.

### A.3 O fato arquitetural central
> **A unidade de trabalho na planilha é a CONTAGEM, não o item.**

`[FATO]` Não existe em nenhuma célula: identificador de e-mail, nome de associado, nome de liga, número de protocolo, remetente ou assunto. Só existem números agregados por dia e categoria.

**Consequências diretas:**
- Ninguém sabe *qual* e-mail foi para quem — apenas *quantos*.
- "Realizado" é uma declaração de quantidade, não uma comprovação.
- É impossível auditar, reabrir, rastrear ou reatribuir um item específico.
- A pendência é um saldo abstrato: sabe-se que há 26 itens em aberto, não *quais*.

Essa é a limitação que o sistema novo elimina — e é a razão pela qual não se deve "melhorar a planilha".

---

## B. MAPA DA ESTRUTURA ATUAL

### B.1 Inventário de abas

| # | Aba | Papel no processo |
|---|---|---|
| 1 | `ORIENTAÇÃO` | Manual de uso escrito pela própria equipe. **Fonte primária de regras declaradas.** |
| 2–25 | `CAD-[MÊS]` × 12 e `TITULO-[MÊS]` × 12 | Operação diária. Uma aba = um mês = um ciclo fechado. |
| 26 | `MOVIMENTO CADASTRO` | Painel anual. Consolida os 12+12 meses. |
| 27 | `TITULO ANALISE DOCUMENTAL PROVA` | Dimensionamento de esforço da análise documental. **Único lugar com modelo de esforço.** |

`[FATO]` `ORIENTAÇÃO` declara: última atualização **Maio/2026**, versão **2.0**; colaboradores — Cadastros: Paulo, Jaqueline, Raiane, Solange · Títulos: Raiane, Solange, Ana.

`[FATO]` Meses com lançamento: Janeiro a Agosto. Setembro–Dezembro estão pré-formatados e vazios.

### B.2 Anatomia de uma aba `CAD-[MÊS]`

**Zona 1 — Entrada (colunas A–J), preenchida manualmente**

| Col | Campo | Origem |
|---|---|---|
| A | `Data` | Número do dia (1–31). **Não é data real.** |
| B | `DOC` | Manual |
| C | `FICHA` | Manual |
| D | `e-mail` | Manual |
| E | `total` | `=SUM(B:D)` |
| F | `Liga` | Manual |
| G | `Ligante` | Manual |
| H | `e-mail2` | Manual |
| I | `total3` | `=SUM(F:H)` |
| J | `N. De colaborador` | Manual — **o divisor** |

**Zona 2 — Distribuição (coluna K em diante)**
Estrutura em blocos: `linha 1` = nome do colaborador · `linha 2` = categoria · `linha 3` = campos.

Cada bloco = **6 colunas fixas**:

| Campo | Tipo | Fórmula típica |
|---|---|---|
| `Saldo` | Manual | — (herda pendência do dia anterior) |
| `Mov. Do dia` | Calculado | `=B4/J4` (categoria ÷ nº de colaboradores) |
| `Mov. Extra` | **Manual** | — (correção/transferência) |
| `ABERTO` | Calculado | `=Saldo + Mov.Dia + Mov.Extra` |
| `Realizado` | **Manual** | — |
| `Pend.` | Calculado | `=IF((ABERTO-Realizado)<0,"0",(ABERTO-Realizado))` |

**As 6 categorias, na ordem fixa de cada colaborador:**
`DOC. CADASTRO` → `ATUALIZAÇÃO CADASTRO` → `E-MAIL CADASTRO` → `LIGA` → `LIGANTE` → `E-MAIL LIGA`
(mapeadas 1:1 para as colunas de entrada B, C, D, F, G, H)

**Crescimento da estrutura ao longo do ano** `[FATO]`

| Meses | Colaboradores | Colunas |
|---|---|---|
| Jan–Mar | Paulo, Jaqueline, Raiane, Solange | 154 |
| Abr–Jul | + FERNANDO, ESTER (só `LIGANTE`) | 166 |
| Ago–Dez | + Daniela (`LIGA`, `LIGANTE`, `E-MAIL LIGA`) | 184 |

`[FATO]` Em Julho, "Raiane" foi **renomeada para "Daniela"** no bloco CE — o mesmo bloco físico muda de dono, sem histórico da troca.

**Zona 3 — Rodapé (linhas 35–49)**

| Linha | Conteúdo |
|---|---|
| 35 | `INADIMP.` — categoria especial fora do fluxo diário |
| 36 | `ISENTO` — idem |
| 37 | `Total` — `SUBTOTAL(109, ...)` por coluna |
| 38–43 | Painéis por colaborador: `MOVIMENTO`, `DESDOBRAMENTO`, `TOTAL DE MOVIMENTO`, `PENDENCIAS`, `SALDO REALIZADO` |
| 42–49 | Tabela `colaborador × movimento distribuído × % × realizado × % × pend × %` |

### B.3 Anatomia de uma aba `TITULO-[MÊS]`

**Entrada (A–G):** `Data` · `PED. CERTIFICADO` · `E-MAIL/ TITULAÇÃO` · `ANÁLISE DOCUMENTAL` · `E-MAIL/ TITULO.CONCURSO` · `total` · `N. de colaborador`

**Distribuição — e aqui há uma assimetria estrutural** `[FATO]`:

| Categoria | Colunas por bloco | Campos |
|---|---|---|
| `PED. CERTIFICADO` | 6 | Saldo, Diário, Mov.Extra, Aberto, Realizado, Pend. |
| `E-MAIL/ TITULAÇÃO` | 6 | idem |
| `PROTOCOLO DE CERT.` | **4** | Saldo, **Aberto**, Realizado, Pend. |
| `E-MAIL/ COMISSÃO` | **4** | idem |

Nos blocos de 4 colunas, `Aberto` **é** a divisão: `U4 = D4/G4`.
→ **A coluna `Saldo` existe, é preenchida, e nunca entra em nenhuma conta.** O carry-over de pendência é estruturalmente impossível nessas duas categorias.

Existe ainda um grupo `AUXILIO` (colunas AV+) para `ANÁLISE DOCUMENTAL` e `E-MAIL/TITULO.CONCURSO`, onde `Aberto = categoria + Saldo` — ou seja, **100% sem divisão**.

### B.4 A aba de dimensionamento (`TITULO ANALISE DOCUMENTAL PROVA`)
`[FATO]` Modelo de esforço explícito — o **único** do arquivo:
- Exames gerais: `Total de documentos = 7 × Total de inscrição`
- TEP R1/R2/R3: `= 6 × Total de inscrição`
- 1.141 inscrições → 7.855 documentos para análise
- Rateio nominal ao final: solange 920 · Paulo 546 · Angel 1.086 · "Ana e Rai" o resto, com `média individual = resto/2`

`[INFERIDO]` Esta aba é o embrião do conceito de **peso/esforço por atividade** que falta em todo o resto do arquivo.

### B.5 Estruturas escondidas que influenciam o funcionamento

| Achado | Evidência | Impacto |
|---|---|---|
| **Linhas ocultas** | `CAD-AGOSTO`: linhas 10–36 ocultas | `SUBTOTAL(109)` **ignora linhas ocultas** → total do mês colapsa (ver §E.1) |
| **Colunas ocultas** | 36 colunas ocultas em AGO/SET/OUT; 15–18 em outros meses | Blocos de colaboradores inativos ficam invisíveis mas continuam somando |
| **Zero validações de dados** | `dataValidation = 0` em **todas** as 27 abas | Nada impede texto onde deveria haver número |
| **Tabelas superdimensionadas** | Tabelas definidas até a linha **712** com dados só até a 34 | Explica os 3,8 MB e a lentidão |
| **Freeze panes aleatórios** | `K30`, `G30`, `AP18`, `A33`, `I1`, `K3`... | Cada mês navega diferente; sintoma de edição por tentativa |
| **Nomes definidos** | Nenhum | Toda referência é posicional e frágil |

---

## C. FLUXO OPERACIONAL RECONSTRUÍDO

### C.0 Visão do ciclo
```
[E-mails chegam na caixa da secretaria]
        ↓
1. TRIAGEM E CLASSIFICAÇÃO      (humano, no cliente de e-mail — invisível na planilha)
        ↓
2. CONTAGEM POR CATEGORIA       (humano → colunas B..H)
        ↓
3. DEFINIÇÃO DO PLANTÃO         (humano → coluna J)
        ↓
4. DIVISÃO AUTOMÁTICA           (fórmula → Mov. Do dia)
        ↓
5. CORREÇÃO MANUAL DA QUEBRA    (humano → Mov. Extra)   ← 898 lançamentos/ano
        ↓
6. REPARTIÇÃO FÍSICA            (humano, movendo e-mails entre pastas — invisível)
        ↓
7. EXECUÇÃO                     (colaborador trabalha)
        ↓
8. DECLARAÇÃO DO REALIZADO      (humano → Realizado)
        ↓
9. FECHAMENTO E CARRY-OVER      (fórmula Pend. → digitação manual no Saldo do dia seguinte)
        ↓
[próximo dia] / [próximo mês → novo Saldo por categoria]
```

### C.1 Detalhamento por etapa

**Etapa 1 — Triagem** `[HIPÓTESE]`
*Entra:* caixa de entrada. *Faz:* abre cada e-mail, identifica de que se trata. *Produz:* classificação mental em 6 categorias. *Armazena:* em lugar nenhum. *Depende dela:* tudo.
→ **Etapa mais cara da operação e completamente ausente da planilha.** É onde está o conhecimento tácito.

**Etapa 2 — Contagem** `[FATO]`
Digita totais em B–D e F–H. `E` e `I` somam automaticamente.
→ Aqui já se perdeu a identidade dos itens. Todo o resto do processo opera sobre números anônimos.

**Etapa 3 — Plantão** `[FATO]`
Digita `J` = nº de colaboradores. Em 8 meses analisados, `J = 2` em praticamente todos os dias (Janeiro tem 4 dias com `J = 1`).
→ **`J` diz *quantos*, nunca *quem*.** Quem recebe está codificado nas *fórmulas*, não nos dados.

**Etapa 4 — Divisão** `[FATO]`
`Mov. Do dia = categoria / J`. Aplicada em cada bloco de colaborador que tenha a fórmula.

**Etapa 5 — Correção** `[FATO]`
Digita `Mov. Extra` para: (a) resolver a metade quebrada, (b) zerar quem não trabalha, (c) transferir carga.

**Etapa 6 — Repartição física** `[HIPÓTESE]`
Alguém move fisicamente os e-mails para as pastas individuais. `ORIENTAÇÃO` confirma: *"controle dentro da pasta de e-mail individual de cada colaborador"*.
→ **A planilha diz "Paulo: 24". Quais 24? Decisão humana não registrada.**

**Etapa 7–8 — Execução e declaração** `[FATO]`
`Realizado` é digitado. Sem timestamp, sem evidência, sem vínculo com item.

**Etapa 9 — Fechamento** `[FATO]`
`Pend. = max(0, Aberto − Realizado)`. O valor é **retransmitido manualmente** para o `Saldo` do dia seguinte.
**Verificação:** em `CAD-MAIO`, `Saldo(d) = Pend.(d−1)` em 26 de 30 dias; em `CAD-JULHO`, 27 de 30.
→ **Cerca de 10% dos dias quebram a cadeia de continuidade do backlog.** Não há fórmula ligando um dia ao outro.

---

## D. REGRAS DE NEGÓCIO IDENTIFICADAS

### D.1 Regras de distribuição

**RN-01 — Divisão igualitária por categoria** `[FATO]`
`Mov. Do dia = quantidade_da_categoria / J`. Cada categoria é dividida **independentemente**.
→ Não existe balanceamento *entre* categorias. Ninguém compara "24 e-mails" com "7 documentos".

**RN-02 — Elegibilidade codificada em fórmula, não em dado** `[FATO]`
Quem participa da divisão é definido por *ter ou não a fórmula* na célula.
Evidências: em `CAD-JANEIRO`, Raiane e Solange têm `Mov. Do dia = 0` **literal** (não fórmula). Em `CAD-AGOSTO`, Paulo tem fórmula em DOC/FICHA/E-MAIL mas `0` literal em LIGA/E-MAIL LIGA.
→ **Mudar quem está de plantão exige editar fórmulas.** É a fragilidade estrutural nº 1.

**RN-03 — Zeragem por Mov. Extra negativo** `[FATO]`
Quando `J = 1` mas a fórmula `/J` continua ativa em vários blocos, todo mundo recebe 100%. Corrige-se digitando `Mov. Extra = −quantidade`.
Exemplo `CAD-JANEIRO` linha 15: `J=1`, DOC=16 → Paulo recebe 16 e digita-se `Mov.Extra = −16`; FICHA=26 → `−26`; e-mail=55 → `−55`.
→ **A fórmula produz o resultado errado por padrão e o humano desfaz.**

**RN-04 — Regra do resto (a "quebra")** `[FATO — a regra real, deduzida da própria planilha]`
Quando `Q/J` gera `,5`, a equipe **transfere a metade de um para o outro**, preservando o total.
Evidência canônica — `CAD-AGOSTO`, dia 12, `e-mail = 47`, `J = 2`:
```
Paulo   : Mov.Dia 23,5 · Mov.Extra −0,5 → 23
Solange : Mov.Dia 23,5 · Mov.Extra +0,5 → 24
                                    Σ  = 47 ✔
```
→ **A regra real não é "arredondar". É:** `piso + distribuir o resto inteiro a um subconjunto, preservando a soma`.
→ Ocorrências: **406 lançamentos de ±0,5** nas abas CAD ao longo do ano. São 406 execuções manuais de um algoritmo de 4 linhas.

**RN-05 — Regra do "tudo para um" em volumes pequenos** `[INFERIDO]`
`CAD-AGOSTO`, dia 12, `FICHA = 3`: Paulo `1,5 + 1,5 = 3` · Solange `1,5 − 1,5 = 0`.
→ Com quantidade baixa, a equipe **não** faz 2/1 — dá tudo a uma pessoa. Provavelmente por custo de setup/contexto.
→ **Precisa virar parâmetro explícito:** limiar abaixo do qual não se fragmenta.

**RN-06 — Transferência de carga** `[FATO]`
`Mov. Extra` também move blocos grandes: `−19`, `+13`, `−37`, `+33,5`.
**Distribuição dos 898 lançamentos manuais em `Mov. Extra` (abas CAD):**

| Tipo | Qtd | % |
|---|---|---|
| `±0,5` — correção de quebra | 406 | 45% |
| `≥ 5` — transferência/zeragem | 256 | 29% |
| outros | 236 | 26% |

→ **Uma única coluna carrega três intenções distintas** (corrigir quebra, zerar inativo, transferir carga) sem nenhuma distinção. É impossível auditar o motivo de qualquer ajuste.

**RN-07 — Categorias sem divisão** `[FATO]`
`CAD-AGOSTO`, bloco Daniela `E-MAIL LIGA`: `Mov.Dia = e-mail2` (100%, sem `/J`).
Grupo `AUXILIO` em `TITULO`: `Aberto = ANÁLISE DOCUMENTAL + Saldo` (100%).
→ **Existe o conceito de "categoria de dono único"** — deve ser modelado, não improvisado.

### D.2 Regras de fila e pendência

**RN-08 — Equação da fila** `[FATO, declarada em `ORIENTAÇÃO`]`
`ABERTO = Saldo + Mov. do Dia + Mov. Extra`

**RN-09 — Pendência nunca negativa** `[FATO]`
`Pend. = IF((Aberto − Realizado) < 0, "0", Aberto − Realizado)`
→ Se alguém realiza **mais** do que recebeu (limpando backlog de dias anteriores), o excedente **é descartado silenciosamente**. A produtividade extra some.
→ E o `"0"` retornado é **texto**, não número (ver §E.3).

**RN-10 — Carry-over manual** `[FATO]`
`Saldo(d) = Pend.(d−1)`, digitado à mão. Sem fórmula. Quebra em ~10% dos dias.

**RN-11 — Carry-over mensal** `[FATO, declarada em `ORIENTAÇÃO`]`
*"O saldo final deve ser lançado por categoria no mês seguinte."* Nenhuma fórmula cruza abas de meses — é 100% redigitação.

**RN-12 — Pendência é gerida fora da planilha** `[FATO, declarada em `ORIENTAÇÃO`]`
*"O campo 'Pendência' (em amarelo) é preenchido manualmente. Refere-se ao controle dentro da pasta de e-mail individual de cada colaborador."*
→ **A verdade sobre o backlog mora na caixa de e-mail, não na planilha.** A planilha é uma cópia declarada.

### D.3 Regras de balanceamento ao longo do tempo

**RN-13 — Não existe balanceamento histórico formal** `[FATO]`
Não há em nenhuma fórmula: soma acumulada por colaborador ao longo dos dias, comparação entre colaboradores, ou qualquer uso do histórico para decidir a distribuição de hoje.
O único acumulado é o **total do mês** (linha 37) e o painel `colaborador × %` (linhas 42–49) — que é **relatório retrospectivo**, não entrada de decisão.

→ **Resposta direta à pergunta do briefing (item 5):** o balanceamento ao longo da semana **não está representado na planilha**. Ele existe apenas na cabeça de quem digita `Mov. Extra`. A alternância `+0,5 / −0,5` entre dias é a única pegada — e é memória humana, não estrutura.

`[HIPÓTESE]` A pessoa alterna mentalmente quem leva a unidade extra. É exatamente a lógica que o motor precisa formalizar.

### D.4 Regras de esforço

**RN-14 — Modelo de esforço só existe na análise documental** `[FATO]`
`documentos = 7 × inscrições` (6 para TEP).
→ É o único reconhecimento no arquivo de que **1 unidade ≠ 1 unidade**.

**RN-15 — Categorias especiais fora do fluxo** `[FATO]`
`INADIMP.` e `ISENTO` (linhas 35–36) recebem valores mas ficam fora da lógica de distribuição diária. Em `CAD-MAIO`, linha 35 tem `Mov.Extra = 11`, `Aberto = 11`, `Realizado = 11` digitados diretamente.
`[HIPÓTESE]` São categorias de exceção que exigem tratamento distinto (associado inadimplente / isento de anuidade).

---

## E. PROBLEMAS E RISCOS ATUAIS

### E.1 🔴 CRÍTICO — O relatório anual está errado por causa de linhas ocultas

`[FATO]` `CAD-AGOSTO` tem as **linhas 10 a 36 ocultas**.
`[FATO]` A linha de total usa `SUBTOTAL(109; ...)` — a função `109` **ignora linhas ocultas por definição**.

| Métrica | Valor |
|---|---|
| Volume realmente lançado em Agosto (soma de todos os dias) | **1.369** |
| Valor que `CAD-AGOSTO!E38` reporta | **319** |
| Valor que aparece no painel anual `MOVIMENTO CADASTRO` | **319** |
| **Diferença omitida** | **~1.050 atendimentos (77%)** |

→ **Basta alguém colapsar linhas para o relatório da diretoria encolher.** Silenciosamente, sem erro, sem aviso.

### E.2 🔴 CRÍTICO — A soma das entradas não é preservada

Teste executado: para cada dia, `Σ(Mov.Dia + Mov.Extra)` de todos os blocos de uma categoria **vs.** valor de entrada daquela categoria.

| Mês | Dias com lançamento | Dias com divergência | Δ líquido no mês |
|---|---|---|---|
| Janeiro | 20 | 5 | **+7** |
| Fevereiro | 17 | 2 | −6 |
| Março | 22 | 3 | +3 |
| **Abril** | 20 | **9** | **−59** |
| Maio | 20 | 8 | +26 |
| Junho | 19 | 3 | −3 |
| Julho | 23 | 7 | −16 |
| Agosto | 16 | 8 | +8 |
| **TOTAL** | **157** | **45 (29%)** | — |

**Em quase 1 a cada 3 dias, o que foi distribuído não bate com o que entrou.**

Casos ilustrativos:
- `CAD-ABRIL`, `LIGA`: entraram **16**, distribuídos **0**. Trabalho recebido e nunca atribuído a ninguém.
- `CAD-ABRIL`, dia 15, `LIGANTE = 57`: divergência de **−39**.
- `CAD-AGOSTO`, dia 18, `LIGANTE = 55`: divergência de **−55** (nada distribuído); no dia 19, `LIGANTE = 0` e aparecem **+55** distribuídos.
  `[HIPÓTESE]` Lançamento retroativo de um dia no outro — mas sem nenhum registro que permita afirmar isso.

### E.3 🔴 CRÍTICO — Total de pendência é texto digitado à mão

`[FATO]` As células de total das colunas `Pend.` (P37, V37, AB37, AH37, AN37, AT37) **não contêm fórmula**. Contêm as strings literais `"0,0"` e `"3,0"`.

Causa provável: `RN-09` retorna o **texto** `"0"`, o que envenena `SUBTOTAL`. Em vez de corrigir a fórmula, digitou-se o resultado.

Cadeia de propagação:
```
Pend. → IF(...,"0",...)  [texto]
   → P37 = "3,0"          [string digitada à mão]
   → M41 (PENDENCIAS)
   → C44/H44 (painel do colaborador)
   → E39 (TOTAL DE PENDÊNCIA do mês)
   → MOVIMENTO CADASTRO!D8
   → TOTAL ANUAL
```
→ **O indicador anual de pendência repousa sobre uma string digitada manualmente.**

### E.4 🔴 CRÍTICO — `Mov. Extra` é ignorado para dois colaboradores

`[FATO]` Nos blocos de Fernando e Ester (Abr–Dez), a fórmula de `ABERTO` é:
`=EZ8+EY8` → **`Mov. Do dia + Saldo` apenas.** A coluna `Mov. Extra` **não entra**.

Consequência real (`CAD-AGOSTO`, dia 12, `LIGANTE = 52`):
```
Fernando : 15
Ester    : Mov.Dia 11 · Mov.Extra −19  →  ABERTO = 11  (o −19 evapora)
Daniela  : 7
                              Σ = 33  ·  perdidos: 19
```
→ A pessoa digita um ajuste, vê o número na tela, e **a fórmula o descarta**.

### E.5 🟠 Fórmulas corrompidas por arrasto

`[FATO]` `TITULO-MAIO`, linha 4: as células `AN4` até `BC4` contêm uma cascata de
`=IF((AL4−AM4)<0,"0",(AL4−AM4))`, `=IF((AM4−AN4)<0,...)`, `=IF((AN4−AO4)<0,...)` ...

Ou seja: a fórmula de *pendência* foi arrastada horizontalmente por 16 colunas, sobrescrevendo os blocos `PROTOCOLO DE CERT.`, `E-MAIL/COMISSÃO` de Solange **e todo o grupo AUXILIO**. Cada célula agora calcula a diferença da anterior — sem nenhum significado de negócio.

### E.6 🟠 102 erros `#DIV/0!` ativos no arquivo

| Aba | Erros | | Aba | Erros |
|---|---|---|---|---|
| CAD-SETEMBRO | 15 | | TITULO-SET/OUT/NOV/DEZ | 9 cada |
| CAD-OUTUBRO | 15 | | CAD-NOV / CAD-DEZ | 6 cada |
| CAD-FEV / CAD-ABR | 4 cada | | demais | 2 cada |

Origem: painéis de `%` dividindo por colaborador com denominador zero (`=M44/K44` com `K44 = 0`).

### E.7 🟠 Referências quebradas e cruzadas

| Célula | Fórmula | Problema |
|---|---|---|
| `CAD-JANEIRO!E48` | `=IF((C47-E38)<0,"0",(C47-E338))` | **`E338`** não existe |
| `CAD-MAIO!E49` | `...(C48-E339)` | **`E339`** não existe |
| `CAD-JANEIRO!H46` | `=M41` | Pendência de **Solange** apontando para o painel do **Paulo** |
| `TITULO ANALISE...!E14` | `=SUM(E9:E13)` | Deveria ser `E3:E13` — soma parcial |
| `TITULO ANALISE...!D21` | `='546'` | Número cravado como fórmula |
| `CAD-AGOSTO!E39` | `=H47` | Meses anteriores usam `=M41+AW41`. Lógica diferente por mês. |

### E.8 🟠 Rótulos incorretos

`[FATO]` O 6º bloco de Solange está rotulado `E-MAIL CADASTRO` (célula `ES2`) em **todos os 12 meses**, quando pela posição deveria ser `E-MAIL LIGA`.
→ Duas categorias diferentes com o mesmo nome na mesma linha. Quem lê a planilha não consegue distinguir.

### E.9 🟠 Painel anual mostra pendência negativa

`[FATO]` `MOVIMENTO CADASTRO`:

| Mês | Atendimento | Realizado | Pendente |
|---|---|---|---|
| Janeiro (Títulos) | 153 | 179 | **−26** |
| Abril (Títulos) | 726 | 738 | **−12** |

→ Realizado maior que o recebido. Fisicamente impossível como "pendência". É `RN-09` sendo violada no nível agregado.

### E.10 🟡 Fragilidades estruturais

- **Zero validações de dados** em 27 abas. Nada impede texto, negativo ou valor absurdo.
- **Sem identidade de item.** Impossível auditar, reabrir ou provar qualquer atendimento.
- **Sem data real.** Coluna A é `1..31`. Não há dia da semana, feriado, nem chave temporal utilizável.
- **Sem registro de quem fez o quê.** Não há autor, timestamp ou log de alteração.
- **Duas pessoas decidiriam diferente.** Não há regra escrita para: quem leva o `+0,5`, quando dar tudo a um só, quando transferir carga.
- **Bloco reaproveitado com troca de dono** (Raiane→Daniela em Julho) apaga o histórico.
- **Conhecimento concentrado.** Quem entende a mecânica dos ajustes é uma pessoa. Férias ou saída = paralisia.
- **Performance.** Tabelas até a linha 712 com dados até a 34 → 3,8 MB.

### E.11 Retrabalho quantificado (ano parcial, só abas CAD)

| Atividade manual | Volume estimado/ano |
|---|---|
| Lançamentos em `Mov. Extra` | **898** |
| Digitações de `Realizado` | ~2.600 |
| Digitações de `Saldo` (carry-over diário) | ~2.600 |
| Contagens de e-mail digitadas | ~940 |
| **Total de digitações evitáveis** | **~7.000/ano** |

---

## F. MODELO DE DADOS

### F.1 Entidades

**`Colaborador`**
`id · nome · ativo · data_entrada · data_saida`
*Por quê:* substitui o nome na linha 1 e resolve o caso Raiane→Daniela sem apagar histórico.

**`Categoria`**
`id · codigo · nome · frente (CADASTRO|TITULOS) · divisivel (bool) · peso_esforco · granularidade_minima`
*Por quê:* `divisivel=false` modela `RN-07`. `peso_esforco` traz para o modelo o que só existe hoje na aba de análise documental (`RN-14`). `granularidade_minima` formaliza `RN-05`.

**`Habilitacao`** *(Colaborador × Categoria)*
`colaborador_id · categoria_id · pode_receber · vigencia_inicio · vigencia_fim`
*Por quê:* **esta é a entidade que elimina o problema estrutural nº 1** (`RN-02`). Elegibilidade vira dado, não fórmula.

**`Escala`**
`data · colaborador_id · disponivel · capacidade_relativa`
*Por quê:* substitui a coluna `J`. Diz **quem**, não só *quantos*.

**`Item`** ← *entidade que não existe hoje*
`id · categoria_id · origem (email|documento|manual) · identificador_externo (message-id) · remetente · assunto · recebido_em · liga_id? · associado_id? · payload_extraido (json) · status (novo|distribuido|em_andamento|concluido|revisao) · confianca_classificacao`
*Por quê:* é a virada de chave. Sai a contagem, entra o item. Torna auditoria, reabertura e rastreio possíveis pela primeira vez.

**`Atribuicao`**
`id · item_id · colaborador_id · atribuido_em · rodada_id · motivo (algoritmo|manual|transferencia) · atribuido_por`
*Por quê:* substitui `Mov. Do dia` + `Mov. Extra` — e **separa as três intenções que hoje moram numa coluna só** (`RN-06`).

**`RodadaDistribuicao`**
`id · data · categoria_id · quantidade_entrada · participantes[] · alocacao{colaborador:qtd} · algoritmo_versao · executado_em · executado_por`
*Por quê:* torna cada decisão de rateio auditável e reproduzível. Guarda a **prova** de que `Σ alocação = entrada`.

**`Execucao`**
`item_id · colaborador_id · iniciado_em · concluido_em · resultado`
*Por quê:* substitui `Realizado` — agora é evento com carimbo, não número declarado.

**`SaldoCarga`** *(histórico — o coração do balanceamento)*
`colaborador_id · categoria_id · data · recebido · cota_justa · credito_acumulado`
Onde `credito_acumulado = Σ(cota_justa − recebido)`.
*Por quê:* **é a entidade que a planilha não tem** e que resolve o item 5 do briefing. Quem tem crédito positivo recebeu menos que o devido e leva a próxima unidade extra.

**`Liga`** e **`Ligante`**
`Liga: id · nome · instituicao · uf · status`
`Ligante: id · liga_id · nome · email · vinculo`
*Por quê:* hoje existem só como contadores. Sem cadastro, é impossível associar e-mail → liga automaticamente.

**`RegraDistribuicao`** *(configuração versionada)*
`id · categoria_id? · tipo · parametros(json) · vigencia · ativo`
*Por quê:* o limiar de `RN-05`, o critério de desempate, o peso — tudo parametrizável sem mexer em código.

**`Revisao`**
`item_id · motivo · campo_incerto · sugestao_ia · confianca · resolvido_por · resolvido_em · valor_final`
*Por quê:* fila de exceções da IA. **Também é o dataset de melhoria contínua.**

**`LogAuditoria`**
`entidade · entidade_id · acao · antes · depois · usuario · timestamp`

### F.2 Relacionamentos essenciais
```
Colaborador ─┬─< Habilitacao >─┬─ Categoria
             ├─< Escala                │
             ├─< Atribuicao >── Item ──┤
             ├─< Execucao              │
             └─< SaldoCarga >──────────┘

RodadaDistribuicao ──< Atribuicao
Liga ──< Ligante        Liga ──< Item
Item ──< Revisao
```

### F.3 O que NÃO virar entidade
- ~~`Mov. Extra`~~ → é `Atribuicao` com `motivo` diferente.
- ~~`Saldo`, `Aberto`, `Pend.`~~ → são **consultas** sobre `Item.status`, não colunas armazenadas.
- ~~`Total`, `%`, painéis~~ → agregações calculadas na leitura.
- ~~"Aba do mês"~~ → o mês é um filtro de data, não uma estrutura.

---

## G. ARQUITETURA DO SISTEMA SUBSTITUTO

### G.1 Princípio norteador
> Hoje: **e-mail → cabeça humana → número → planilha → pasta de e-mail**
> Depois: **e-mail → item estruturado → motor determinístico → fila individual → evidência**

A planilha some porque **cada uma das suas três funções** ganha um lugar próprio: o motor distribui, o banco guarda a fila, o painel reporta.

### G.2 Camadas

```
┌─ INGESTÃO ────────────────────────────────────────────┐
│ IMAP/Graph API · webhook · upload manual              │
│ → cria Item bruto, idempotente por message-id         │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ INTERPRETAÇÃO (IA) ──────────────────────────────────┐
│ classifica categoria · extrai campos · associa liga    │
│ · detecta anexo · emite score de confiança             │
│ → nunca decide quantidade nem destinatário             │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ VALIDAÇÃO ───────────────────────────────────────────┐
│ confiança ≥ limiar → segue                             │
│ confiança < limiar → fila de Revisão humana            │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ MOTOR DE DISTRIBUIÇÃO (determinístico) ──────────────┐
│ resto maior + crédito histórico + habilitação          │
│ invariante: Σ alocado = entrada, sempre inteiro        │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ FILAS INDIVIDUAIS ───────────────────────────────────┐
│ cada colaborador vê SEUS itens, não um número          │
│ conclui item a item → Execucao com timestamp           │
└───────────────────────────────────────────────────────┘
                        ↓
┌─ HISTÓRICO E PAINEL ──────────────────────────────────┐
│ SaldoCarga atualizado a cada rodada                    │
│ dashboards derivados, nunca digitados                  │
└───────────────────────────────────────────────────────┘
```

### G.3 Entradas / Processamento / Saídas

**ENTRADAS:** e-mails (corpo, remetente, anexos) · documentos (PDF, fichas) · cadastro de colaboradores · escala do dia · configuração de regras · lançamento manual de exceção.

**PROCESSAMENTO:** deduplicação → classificação → extração → validação → enfileiramento → rateio → notificação → execução → fechamento → agregação.

**SAÍDAS:** fila individual por colaborador · registro auditável de cada rodada · painel diário/mensal/anual · alertas de backlog e de anomalia · exportação (inclusive `.xlsx`, para a transição) · trilha de auditoria completa.

### G.4 Invariantes do sistema *(travas que a planilha não tem)*
1. `Σ(atribuições da rodada) == quantidade de entrada` — sempre.
2. Toda atribuição é **inteira e não-negativa**.
3. Todo item tem exatamente **um** responsável ativo.
4. `Realizado` nunca excede o atribuído; excedente vira **quitação de backlog**, com registro (corrige `RN-09`).
5. Nenhuma métrica de relatório é digitável.
6. Toda decisão automática é reproduzível a partir do log.

---

## H. PAPEL DA IA

### H.1 Onde a IA é necessária *(interpretação de linguagem)*

| Tarefa | Entrada | Saída | Fallback |
|---|---|---|---|
| Classificar categoria | assunto + corpo + anexos | uma das 6 (CAD) / 4 (TÍTULOS) + confiança | fila de revisão |
| Extrair campos | e-mail e anexos | nome, CPF, CRM, liga, instituição, tipo de documento | campo em branco → revisão |
| Ler documento | PDF/imagem | texto + campos | OCR falhou → revisão |
| Associar à liga | menções textuais | `liga_id` | ambíguo → revisão |
| Detectar ausência | item extraído | lista de campos obrigatórios faltantes | — |
| Detectar duplicata | item + histórico | score de similaridade | — |
| Detectar anomalia | item | fora do padrão → sinaliza | — |
| Resumir para o operador | thread longa | 2 linhas de contexto | — |

### H.2 Onde a IA **não pode** entrar *(tem que ser código)*

| Nunca IA | Por quê |
|---|---|
| Calcular a divisão | Precisa ser exata, reproduzível e provável. Uma alocação que varia entre execuções é indefensável. |
| Escolher quem recebe | É consequência aritmética do crédito histórico. |
| Tratar o resto/quebra | `RN-04` é um algoritmo fechado. |
| Somar, agregar, calcular % | SQL. |
| Aplicar habilitação/escala | Consulta a tabela. |
| Fechar o dia / carry-over | Transação. |
| Gravar auditoria | Infraestrutura. |

### H.3 A regra de ouro
> **IA para interpretar. Algoritmo para decidir. Banco para lembrar. Regra explícita para governar.**

Se um número do painel não puder ser reconstruído passo a passo a partir dos logs, o sistema falhou — mesmo que o número esteja certo.

### H.4 Governança da IA
- **Todo output de IA carrega confiança.** Abaixo do limiar → revisão humana obrigatória.
- **Limiar é configurável por categoria** (`E-MAIL LIGA` pode tolerar mais erro que `DOC. CADASTRO`).
- **Nenhuma extração se torna definitiva sem persistir a versão do modelo e do prompt.**
- **Toda correção humana vira dado de melhoria.**
- **Começar conservador:** limiar alto, muita revisão, e afrouxar conforme a taxa de acerto medida — não conforme a impressão.

---

## I. MOTOR DE DISTRIBUIÇÃO

### I.1 Contrato

**Entrada**
```
data, categoria, quantidade Q (inteiro ≥ 0)
elegiveis[] = colaboradores com Habilitacao ativa ∩ Escala do dia
credito[c]  = crédito acumulado de cada elegível na categoria
config      = { granularidade_minima, criterio_desempate, peso }
```

**Saída**
```
alocacao{colaborador → inteiro ≥ 0}
garantindo Σ alocacao == Q
+ registro RodadaDistribuicao com o racional completo
```

### I.2 Algoritmo — *resto maior com memória de crédito*

```
1. Se |elegiveis| == 0 → erro explícito. Nunca distribuir para ninguém.
2. Se Q == 0 → alocação vazia. Registrar a rodada mesmo assim.

3. Se Q < granularidade_minima[categoria]:          ← formaliza RN-05
      → destinatário único = maior credito
      → alocar Q inteiro a ele. Ir para 7.

4. base = Q ÷ |elegiveis|   (divisão inteira)
   resto = Q mod |elegiveis|
   alocar `base` a cada elegível.

5. Ordenar elegíveis por:
      a) maior credito acumulado                     ← RESOLVE O ITEM 5 DO BRIEFING
      b) menor volume recebido no período corrente
      c) menor volume recebido no dia
      d) ordem estável (id) — desempate determinístico

6. Distribuir as `resto` unidades restantes, uma para cada,
   seguindo a ordem acima.

7. VERIFICAR: Σ alocacao == Q.
   Se falhar → abortar a transação inteira. Nunca gravar parcialmente.

8. Atualizar crédito de cada participante:
      cota_justa   = Q × peso ÷ |elegiveis|
      credito[c]  += cota_justa − alocado[c] × peso

9. Gravar RodadaDistribuicao com entrada, elegíveis, ordem de
   desempate, alocação, versão do algoritmo, timestamp.
```

### I.3 Por que isto resolve os dois problemas do briefing

**Problema da quebra (`15 ÷ 2 = 7,5`)**
```
base = 7 · resto = 1
→ 7 + 7 = 14, sobra 1 → vai para quem tem maior crédito
→ 8 + 7 = 15 ✔
```
Nunca `7+7=14`. Nunca `8+8=16`. A verificação do passo 7 torna o erro **impossível de persistir**.

**Problema do balanceamento semanal**
```
Seg: 15 ligantes · Ana crédito 0 · Bia crédito 0 → desempate por id
     Ana 8 · Bia 7
     crédito: Ana 7,5−8 = −0,5  ·  Bia 7,5−7 = +0,5

Ter: 15 ligantes · Bia tem crédito maior
     Ana 7 · Bia 8
     crédito: Ana 0 · Bia 0

Acumulado: Ana 15 · Bia 15   ✔ (exatamente o cenário do briefing)
```
→ **A alternância que hoje é memória de uma pessoa vira um número guardado no banco.**

### I.4 Extensões previstas *(estrutura pronta, ativação futura)*
- **Peso por esforço** — `RN-14` generalizado. Balanceia *carga*, não *contagem*.
- **Capacidade relativa** — meio período, treinamento, retorno de férias.
- **Categoria indivisível** — `RN-07`: dono único, sem rateio.
- **Afinidade** — quem já tratou a liga X continua com ela.
- **Teto de fila** — não empurrar para quem já está saturado; excedente vira alerta.

### I.5 Auditoria
Cada rodada responde, sem interpretação: *o que entrou · quem estava elegível e por quê · qual foi a ordem e o critério · quanto cada um recebeu · qual crédito antes e depois · qual versão do algoritmo · quem disparou e quando.*

Uma transferência manual **não altera a rodada** — cria uma `Atribuicao` nova com `motivo = transferencia`, justificativa e autor. O histórico é imutável.

---

## J. MVP

### J.1 Escopo — ataca os dois problemas declarados

| Problema | Entrega da V1 |
|---|---|
| **1. Analisar e filtrar e-mails** | Ingestão + classificação por IA + extração + fila de revisão |
| **2. Distribuir corretamente** | Motor determinístico com conservação garantida e crédito histórico |

### J.2 Método de construção
Conforme o padrão de desenvolvimento: **Briefing → PRD → Spec, aprovados antes de qualquer código.** Este documento é o insumo do Briefing.

**Stack:** Next.js · shadcn/ui · Tailwind · Storybook · Postgres (Prisma).
**UI:** mobile-first, cards no lugar de tabelas em tela pequena — relevante aqui, porque a fila individual será consultada no celular.

### J.3 Telas (5)

1. **Caixa de Entrada** — itens classificados, agrupados por categoria, com badge de confiança.
2. **Revisão** — fila de baixa confiança. Sugestão da IA + campos editáveis + aceitar/corrigir.
3. **Distribuição do Dia** — define escala, mostra a prévia (`entrada N → Ana 8 · Bia 7`), exige confirmação, grava a rodada.
4. **Minha Fila** — visão individual: itens reais, com assunto e remetente. Concluir, devolver, pedir ajuda.
5. **Painel** — recebido/distribuído/realizado/pendente por dia, categoria e pessoa. **Zero campos digitáveis.**

### J.4 Fluxo do usuário na V1
```
08h00  Sistema ingeriu os e-mails da noite e classificou.
08h05  Operadora abre Revisão: 12 itens abaixo do limiar. Corrige em 4 min.
08h10  Abre Distribuição do Dia. Marca quem está de plantão.
       Sistema mostra a prévia. Ela confirma.
08h11  Cada colaborador recebe sua fila com os itens reais.
       Ao longo do dia  →  concluem item a item.
17h30  Fechamento automático. Não concluídos permanecem na fila.
       Crédito atualizado. Painel atualizado. Nada digitado.
```

### J.5 Regras obrigatórias na V1
- `RN-01` divisão por categoria
- `RN-04` resto maior com conservação garantida
- `RN-02` elegibilidade como **dado** (`Habilitacao` + `Escala`)
- Balanceamento por crédito histórico (`SaldoCarga`)
- Backlog automático (fim de `RN-10` e `RN-11`)
- Auditoria completa de toda distribuição

### J.6 Fora da V1 *(estrutura preparada, ativação depois)*
- Peso por esforço — modelar o campo, usar `peso = 1`
- Regras de afinidade e teto de fila
- SLA e alertas de atraso
- Frente `TÍTULOS` completa — **começar só por `CADASTRO`**
- Cadastro completo de Ligas/Ligantes — na V1, apenas texto extraído
- Migração do histórico Jan–Ago — importar como agregado somente-leitura
- Automação de resposta ao remetente
- App mobile nativo (a web responsiva atende)

### J.7 Critérios de aceitação
1. Em 30 dias de operação simulada, `Σ distribuído == Σ entrada` em **100%** dos dias.
   *(Base atual: 71%.)*
2. Nenhum número de painel é digitável.
3. Toda distribuição é reconstruível a partir do log.
4. Desvio máximo de carga acumulada entre colaboradores da mesma categoria ≤ 1 unidade ao fim de qualquer semana.
5. Taxa de classificação automática aceita sem correção ≥ 80% após 2 semanas.
6. Tempo de distribuição diária ≤ 5 minutos. *(Hoje: ~30–45 min de digitação e conferência.)*

### J.8 Estratégia de transição
Rodar **em paralelo** com a planilha por 2–4 semanas. Comparar os dois diariamente. **Cada divergência é evidência a favor do sistema** — as 45 divergências históricas provam que a planilha erra sozinha. A planilha só é desligada quando a equipe confiar no painel mais do que na própria digitação.

---

## K. QUESTÕES AINDA NÃO RESOLVIDAS

### K.1 Bloqueadores — precisam de resposta antes da Spec

1. **Como se decide hoje quem leva o `+0,5`?** A planilha não registra. Existe alternância consciente ou é ad hoc? → Define o critério de desempate primário.
2. **Existe limiar formal para "dar tudo a um só"?** `RN-05` foi inferido de um caso (`FICHA = 3`). É 3? 5? Depende da categoria?
3. **Um `DOC` custa o mesmo que um `E-MAIL`?** Se não, quais os pesos relativos? → Sem isso, o balanceamento equaliza contagem, não trabalho.
4. **O que são exatamente `INADIMP.` e `ISENTO`?** Por que ficam fora do rateio diário?
5. **Quem faz a triagem hoje?** É a mesma pessoa que distribui? → Define o desenho da tela de Revisão.
6. **`LIGA` vs `LIGANTE` vs `E-MAIL LIGA`** — são fluxos independentes ou etapas de um mesmo processo? Um e-mail de liga gera N ligantes?
7. **Como um e-mail é associado hoje a uma liga?** Assinatura? Domínio? Conhecimento pessoal? → Determina a viabilidade da automação.

### K.2 Divergências que precisam de explicação factual

8. **`CAD-ABRIL`: 16 `LIGA` entraram, 0 distribuídos.** Erro de digitação, ou existe caminho de tratamento fora da planilha?
9. **`CAD-AGOSTO` dias 18/19: `LIGANTE` −55 e +55.** Lançamento retroativo? É prática comum?
10. **`MOVIMENTO CADASTRO`: pendência negativa em Janeiro (−26) e Abril (−12).** Como a diretoria interpreta isso hoje?
11. **`CAD-AGOSTO` com 27 linhas ocultas.** Foi intencional? Alguém percebeu que o total do mês caiu de ~1.369 para 319?
12. **Raiane → Daniela em Julho.** Foi substituição de pessoa, ou renomeação? O saldo herdado é da mesma fila?
13. **Fernando e Ester ignoram `Mov. Extra` desde Abril.** Alguém notou os ajustes sumindo?

### K.3 Escopo e organização

14. **Frente `TÍTULOS` entra em qual fase?** A estrutura é diferente (4 categorias, blocos assimétricos, grupo AUXILIO).
15. **A "Análise Documental" (7 docs por inscrição) é o mesmo processo ou é sazonal, ligado a período de prova?**
16. **Quem é o dono do sistema depois de entregue?** Quem cadastra colaborador, ajusta limiar, define escala?
17. **Onde os e-mails moram?** Microsoft 365 / Google Workspace / IMAP próprio? → Define a camada de ingestão.
18. **Restrições de LGPD** — dados de associados e estudantes. Retenção? Acesso? Log?
19. **Migrar Jan–Ago?** Sugestão: importar como agregado somente-leitura, sem tentar reconstruir itens que nunca existiram.

### K.4 Limite honesto desta análise

O que **não** pode ser afirmado a partir do arquivo:
- O que acontece **antes** da contagem — a triagem, que é a etapa mais cara, é invisível.
- Como os itens são fisicamente repartidos entre as pastas de e-mail.
- Se as divergências são erro de digitação ou processo paralelo legítimo.
- Se a distribuição atual é percebida como justa pela equipe.
- Qual o tempo real gasto em cada etapa.

**Recomendação:** uma sessão de observação de 2 horas com a pessoa que opera a planilha responde 8 das 19 questões acima — mais do que qualquer análise adicional do arquivo pode entregar.

---

## RESUMO EXECUTIVO

**O que a planilha realmente faz:** conta demanda por categoria, divide pelo número de pessoas de plantão, corrige a divisão à mão, e declara o que foi feito.

**Por que ela precisa sumir:**

| | Hoje | Depois |
|---|---|---|
| Unidade de trabalho | contagem anônima | item rastreável |
| Quem recebe | codificado em fórmula | dado (habilitação + escala) |
| Tratamento do resto | 406 correções manuais/ano | algoritmo, 4 linhas |
| Balanceamento histórico | memória de uma pessoa | `credito_acumulado` no banco |
| Conservação da soma | falha em 29% dos dias | invariante do sistema |
| Total do relatório | quebra se ocultarem linhas | consulta agregada |
| Pendência anual | string digitada à mão | derivada de `Item.status` |
| Auditoria | impossível | completa |
| Digitação | ~7.000 lançamentos/ano | ~0 |

**A regra fundamental foi respeitada:** não se preserva a planilha — preserva-se a lógica operacional que ela representa. E essa lógica, uma vez explicitada, cabe em um motor determinístico de 30 linhas com um livro-razão de crédito ao lado.
