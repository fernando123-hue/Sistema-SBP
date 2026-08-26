# CONTEXTO — Sistema de Distribuição de Demandas (substituto de planilha)
**Handoff para Claude Code.** Documento autocontido: assuma que você não tem acesso à conversa anterior nem à planilha original.

---

## 0. COMO USAR ESTE DOCUMENTO

1. Coloque este arquivo na raiz do projeto como `CONTEXTO.md`.
2. Aplique a skill **`padrao-desenvolvimento`**: primeiros princípios → **Briefing → PRD → Spec** → scaffold → design system → telas.
3. **Não comece a codar antes de apresentar os três documentos para aprovação.**
4. As seções 1–8 abaixo são o insumo do Briefing. As seções 9–11 são restrições que valem como decisão já tomada.

---

## 1. ORIGEM

Fizemos engenharia reversa de `PRODUTIVIDADE_-_2026.xlsx` (27 abas, 3,8 MB), usada pela **Secretaria de Atendimento ao Associado** de uma associação médica de pediatria. A planilha reparte trabalho diário entre colaboradores.

**Objetivo do projeto:** substituir a planilha por um sistema, preservando a lógica operacional e eliminando os erros que ela produz. Não é para automatizar células — é para tornar a planilha desnecessária.

---

## 2. O QUE A OPERAÇÃO FAZ HOJE

Duas frentes:

| Frente | Categorias |
|---|---|
| **CADASTRO** (escopo do MVP) | `DOC. CADASTRO` · `ATUALIZAÇÃO CADASTRO` · `E-MAIL CADASTRO` · `LIGA` · `LIGANTE` · `E-MAIL LIGA` |
| **TÍTULOS/COMISSÃO** (fora do MVP) | `PED. CERTIFICADO` · `E-MAIL/TITULAÇÃO` · `PROTOCOLO DE CERT.` · `E-MAIL/COMISSÃO` |

Glossário:
- **Liga** = liga acadêmica (entidade estudantil vinculada à associação).
- **Ligante** = estudante membro de uma liga.
- **Ficha / Doc / E-mail** = tipos de demanda de cadastro de associado.

### Ciclo diário atual
```
e-mails chegam
 → operadora abre cada um e classifica mentalmente   (etapa mais cara, invisível na planilha)
 → digita a CONTAGEM por categoria                    (colunas B..H)
 → digita quantas pessoas estão de plantão            (coluna J)
 → fórmula divide: quantidade / J                     ("Mov. do dia")
 → operadora corrige a quebra à mão                   ("Mov. Extra", 898 lançamentos/ano)
 → move fisicamente os e-mails entre pastas           (invisível)
 → cada colaborador trabalha
 → operadora digita quanto cada um fez                ("Realizado")
 → fórmula calcula pendência
 → operadora redigita a pendência como saldo do dia seguinte
```

---

## 3. FATOS-CHAVE (medidos no arquivo, não inferidos)

Estes números justificam o projeto. Use-os no Briefing.

1. **A unidade de trabalho é a contagem, não o item.** Não existe em nenhuma célula: id de e-mail, nome de associado, nome de liga, protocolo, remetente ou assunto. Sabe-se que "Paulo recebeu 24" — nunca *quais* 24. Auditoria, reabertura e rastreio são impossíveis.

2. **Quem recebe está codificado em fórmula, não em dado.** A coluna `N. de colaborador` diz *quantos*, nunca *quem*. Colaboradores fora do plantão têm `0` **literal** na célula, não fórmula. Trocar o plantão exige editar fórmulas.

3. **A soma não se conserva em 29% dos dias.** Testados 157 dias com lançamento (jan–ago): em **45** o total distribuído ≠ o total de entrada. Abril fecha com **−59** (16 itens da categoria `LIGA` entraram e **0** foram distribuídos).

4. **Causa raiz de parte das perdas:** em dois blocos de colaborador a fórmula de `ABERTO` é `Mov.Dia + Saldo` — **`Mov. Extra` é descartado silenciosamente**. A pessoa digita o ajuste, vê o número na tela, e a fórmula joga fora. Exemplo real: `LIGANTE = 52` → distribuídos 33, perdidos 19.

5. **O relatório anual está errado.** Uma aba tem 27 linhas ocultas e o total usa `SUBTOTAL(109)`, que ignora linhas ocultas. O mês reporta **319** atendimentos quando o volume lançado é **1.369**. Já está no painel da diretoria.

6. **O total de pendência é texto digitado à mão.** As células de total das colunas `Pend.` não têm fórmula — contêm as strings `"0,0"` e `"3,0"`. Isso propaga até o indicador anual.

7. **A regra da quebra já é matematicamente correta — mas executada à mão 406 vezes/ano.** Exemplo canônico: 47 e-mails ÷ 2 → `23,5 / 23,5` → ajuste manual `−0,5 / +0,5` → **23 + 24 = 47**. A equipe já aplica "resto maior com conservação". O que falta é **memória entre dias**.

8. **Retrabalho anual estimado:** ~7.000 digitações evitáveis (898 ajustes + ~2.600 realizados + ~2.600 saldos + ~940 contagens).

---

## 4. REGRAS DE NEGÓCIO

Marcação de confiança: `[F]` fato lido no arquivo · `[I]` inferido com evidência · `[H]` hipótese a confirmar.

### Distribuição
- **RN-01** `[F]` Divisão igualitária **por categoria**, independentemente: `quantidade / nº_de_plantonistas`. Não há balanceamento entre categorias diferentes.
- **RN-02** `[F]` Elegibilidade hoje é fórmula. **No sistema vira dado** (`Habilitacao` + `Escala`).
- **RN-03** `[F]` Quando a fórmula distribui para quem não trabalha, corrige-se com `Mov. Extra` negativo. Sintoma a eliminar, não regra a preservar.
- **RN-04** `[F]` **Regra do resto:** `piso + distribuir o resto inteiro a um subconjunto, preservando a soma`. Nunca arredondar. `15 ÷ 2` → `8 + 7`, jamais `7+7` ou `8+8`.
- **RN-05** `[I]` **Volume baixo vai inteiro para uma pessoa.** Evidência: `FICHA = 3`, `J = 2` → uma pessoa levou 3, a outra 0. Precisa virar parâmetro (`granularidade_minima`).
- **RN-06** `[F]` A coluna `Mov. Extra` carrega **três intenções misturadas**: corrigir quebra (45% dos lançamentos), zerar inativo, transferir carga (29%). No sistema, três motivos distintos e auditáveis.
- **RN-07** `[F]` Existem **categorias de dono único**, sem rateio (recebem 100%). Modelar como `Categoria.divisivel = false`.

### Fila e pendência
- **RN-08** `[F]` `ABERTO = Saldo + Movimento do dia + Movimento extra`
- **RN-09** `[F]` `Pend. = max(0, Aberto − Realizado)`. **Defeito:** quem realiza mais do que recebeu (limpando backlog antigo) tem o excedente descartado. No sistema, excedente vira **quitação de backlog registrada**.
- **RN-10** `[F]` Carry-over diário é redigitação manual. Quebra em ~10% dos dias. No sistema: automático.
- **RN-11** `[F]` Carry-over mensal também é redigitação. No sistema: o mês é filtro de data, não estrutura.
- **RN-12** `[F]` A verdade sobre o backlog mora **na caixa de e-mail individual**, não na planilha. A planilha é uma cópia declarada.

### Balanceamento
- **RN-13** `[F]` **Não existe balanceamento histórico formal em lugar nenhum do arquivo.** Nenhuma fórmula acumula carga por colaborador nem usa histórico para decidir hoje. A alternância `+0,5 / −0,5` entre dias é memória humana. **É exatamente isso que o sistema precisa formalizar.**
- **RN-14** `[F]` Único modelo de esforço existente: `documentos = 7 × inscrições` (6 para um tipo de prova). É o embrião do conceito de **peso por atividade** — 1 unidade ≠ 1 unidade.
- **RN-15** `[H]` Categorias especiais `INADIMP.` e `ISENTO` ficam fora do rateio diário. Natureza a confirmar.

---

## 5. MODELO DE DADOS

```
Colaborador       id · nome · ativo · data_entrada · data_saida
Categoria         id · codigo · nome · frente · divisivel · peso_esforco · granularidade_minima
Habilitacao       colaborador_id · categoria_id · pode_receber · vigencia_inicio · vigencia_fim
Escala            data · colaborador_id · disponivel · capacidade_relativa

Item              id · categoria_id · origem · identificador_externo · remetente · assunto
                  · recebido_em · liga_id? · associado_id? · payload_extraido(json)
                  · status(novo|distribuido|em_andamento|concluido|revisao)
                  · confianca_classificacao

Atribuicao        id · item_id · colaborador_id · atribuido_em · rodada_id
                  · motivo(algoritmo|manual|transferencia) · atribuido_por · justificativa

RodadaDistribuicao id · data · categoria_id · quantidade_entrada · participantes[]
                  · alocacao{colaborador:qtd} · ordem_desempate · algoritmo_versao
                  · executado_em · executado_por

Execucao          item_id · colaborador_id · iniciado_em · concluido_em · resultado

SaldoCarga        colaborador_id · categoria_id · data · recebido · cota_justa · credito_acumulado
                  -- credito_acumulado = Σ(cota_justa − recebido)   ← coração do balanceamento

Liga              id · nome · instituicao · uf · status
Ligante           id · liga_id · nome · email · vinculo
RegraDistribuicao id · categoria_id? · tipo · parametros(json) · vigencia · ativo
Revisao           item_id · motivo · campo_incerto · sugestao_ia · confianca
                  · resolvido_por · resolvido_em · valor_final
LogAuditoria      entidade · entidade_id · acao · antes · depois · usuario · timestamp
```

**Não criar como entidade:** `Mov. Extra` (é `Atribuicao` com outro `motivo`) · `Saldo`/`Aberto`/`Pend.` (são **consultas** sobre `Item.status`, nunca colunas armazenadas) · totais e percentuais (agregação na leitura) · "aba do mês" (filtro de data).

**Relacionamentos**
```
Colaborador ─┬─< Habilitacao >─┬─ Categoria
             ├─< Escala        │
             ├─< Atribuicao >── Item ──┤
             ├─< Execucao              │
             └─< SaldoCarga >──────────┘
RodadaDistribuicao ──< Atribuicao
Liga ──< Ligante        Liga ──< Item        Item ──< Revisao
```

---

## 6. MOTOR DE DISTRIBUIÇÃO

**Contrato**
```
IN : data, categoria, Q (inteiro ≥ 0)
     elegiveis[] = Habilitacao ativa ∩ Escala do dia
     credito[c], config{granularidade_minima, peso, criterio_desempate}
OUT: alocacao{colaborador → inteiro ≥ 0}, com Σ alocacao == Q
     + RodadaDistribuicao registrada
```

**Algoritmo — resto maior com memória de crédito**
```
1. |elegiveis| == 0  → erro explícito. Nunca distribuir para ninguém.
2. Q == 0            → alocação vazia, mas registrar a rodada.

3. Q < granularidade_minima[categoria]:            ← RN-05
     destinatário único = maior credito
     alocar Q inteiro. Ir para 7.

4. base  = Q ÷ |elegiveis|   (divisão inteira)
   resto = Q mod |elegiveis|
   alocar `base` a cada elegível.

5. ordenar elegiveis por:
     a) maior credito_acumulado                    ← RN-13, resolve o balanceamento
     b) menor volume recebido no período corrente
     c) menor volume recebido no dia
     d) id (desempate estável e determinístico)

6. distribuir as `resto` unidades, uma para cada, seguindo a ordem.

7. VERIFICAR Σ alocacao == Q.
   Falhou → abortar a transação inteira. Nunca gravar parcialmente.

8. atualizar crédito:
     cota_justa  = Q × peso ÷ |elegiveis|
     credito[c] += cota_justa − alocado[c] × peso

9. gravar RodadaDistribuicao com entrada, elegíveis, ordem, alocação,
   versão do algoritmo, autor e timestamp.
```

**Prova de que resolve os dois problemas**
```
QUEBRA        15 ÷ 2 → base 7, resto 1 → o resto vai a quem tem maior crédito
              → 8 + 7 = 15 ✔   (o passo 7 torna 14 ou 16 impossíveis de persistir)

BALANCEAMENTO Seg: 15 → Ana 8 · Bia 7   crédito: Ana −0,5 · Bia +0,5
              Ter: 15 → Ana 7 · Bia 8   crédito: Ana 0   · Bia 0
              acumulado: 15 / 15 ✔
```

**Extensões previstas (campo modelado, ativação futura):** peso por esforço · capacidade relativa · categoria indivisível · afinidade por liga · teto de fila.

**Auditoria:** cada rodada responde sem interpretação — o que entrou, quem era elegível e por quê, qual a ordem e o critério, quanto cada um recebeu, crédito antes/depois, versão do algoritmo, quem disparou e quando. Transferência manual **não altera a rodada**: cria `Atribuicao` nova com `motivo = transferencia` + justificativa + autor. Histórico imutável.

---

## 7. INVARIANTES DO SISTEMA

Travas que a planilha não tem. Devem existir como constraint/teste, não como boa intenção.

1. `Σ(atribuições da rodada) == quantidade de entrada` — sempre.
2. Toda atribuição é **inteira e não-negativa**.
3. Todo item tem exatamente **um** responsável ativo.
4. `Realizado` nunca excede o atribuído; excedente vira quitação de backlog **registrada**.
5. **Nenhuma métrica de painel é digitável.**
6. Toda decisão automática é reproduzível a partir do log.

---

## 8. PAPEL DA IA

**IA para interpretar. Algoritmo para decidir. Banco para lembrar. Regra explícita para governar.**

| Usa IA | Nunca IA |
|---|---|
| classificar categoria do e-mail | calcular a divisão |
| extrair campos (nome, CPF, CRM, liga, instituição) | escolher quem recebe |
| ler documento/PDF/anexo | tratar o resto da divisão |
| associar e-mail à liga correta | somar, agregar, calcular % |
| detectar campo obrigatório ausente | aplicar habilitação/escala |
| detectar duplicata e anomalia | fechar o dia / carry-over |
| resumir thread longa para o operador | gravar auditoria |

**Governança:** todo output de IA carrega score de confiança · abaixo do limiar → revisão humana obrigatória · limiar configurável **por categoria** · persistir versão do modelo e do prompt em toda extração · toda correção humana vira dado de melhoria · começar conservador (limiar alto) e afrouxar por taxa de acerto medida, não por impressão.

> Se um número do painel não puder ser reconstruído passo a passo a partir dos logs, o sistema falhou — mesmo que o número esteja certo.

---

## 9. ESCOPO DO MVP

Ataca os dois problemas declarados pelo cliente:
1. **Analisar e filtrar os e-mails** → ingestão + classificação por IA + extração + fila de revisão.
2. **Distribuir corretamente** → motor determinístico com conservação garantida e crédito histórico.

### Telas (5)
1. **Caixa de Entrada** — itens classificados, agrupados por categoria, com badge de confiança.
2. **Revisão** — fila de baixa confiança. Sugestão da IA + campos editáveis + aceitar/corrigir.
3. **Distribuição do Dia** — marcar quem está de plantão, ver a prévia (`entrada 47 → Ana 24 · Bia 23`), confirmar, gravar a rodada.
4. **Minha Fila** — visão individual com itens reais (assunto, remetente). Concluir · devolver · pedir ajuda.
5. **Painel** — recebido/distribuído/realizado/pendente por dia, categoria e pessoa. **Zero campos digitáveis.**

### Fluxo alvo
```
08h00  sistema ingeriu e classificou os e-mails da noite
08h05  operadora resolve a fila de Revisão (itens abaixo do limiar)
08h10  marca o plantão, confere a prévia, confirma
08h11  cada colaborador recebe sua fila com os itens reais
  dia  concluem item a item
17h30  fechamento automático · crédito atualizado · painel atualizado · nada digitado
```

### Regras obrigatórias na V1
RN-01 · RN-04 · RN-02 como dado · balanceamento por crédito histórico · backlog automático (fim de RN-10/RN-11) · auditoria completa.

### Fora da V1 (estrutura preparada, ativação depois)
- Peso por esforço — **modelar o campo, usar `peso = 1`**
- Afinidade e teto de fila
- SLA e alertas de atraso
- Frente `TÍTULOS` completa — **começar só por `CADASTRO`**
- Cadastro completo de Ligas/Ligantes — na V1 apenas texto extraído
- Migração do histórico — importar como agregado somente-leitura
- Resposta automática ao remetente
- App mobile nativo (web responsiva atende)

### Critérios de aceitação
1. Em 30 dias simulados, `Σ distribuído == Σ entrada` em **100%** dos dias. *(Base atual: 71%.)*
2. Nenhum número de painel é digitável.
3. Toda distribuição é reconstruível a partir do log.
4. Desvio de carga acumulada entre colaboradores da mesma categoria ≤ 1 unidade ao fim de qualquer semana.
5. Classificação automática aceita sem correção ≥ 80% após 2 semanas.
6. Distribuição diária em ≤ 5 min. *(Hoje: ~30–45 min.)*

### Transição
Rodar **em paralelo** com a planilha por 2–4 semanas, comparando diariamente. Cada divergência é evidência a favor do sistema — as 45 divergências históricas provam que a planilha erra sozinha. Desligar a planilha só quando a equipe confiar mais no painel do que na própria digitação.

---

## 10. STACK E CONVENÇÕES

Conforme a skill `padrao-desenvolvimento`:

- **Next.js** · **shadcn/ui** · **Tailwind** · **Storybook** · **Postgres + Prisma**
- **Matriz e instância:** cada componente reutilizável definido **uma vez**, com variantes; validar no Storybook antes de espalhar instâncias.
- **Mobile-first. Cards no lugar de tabelas no mobile** — crítico aqui: a tela *Minha Fila* será consultada no celular.
- **Scaffold antes de conteúdo:** estrutura de pastas organizada antes de encher de código.
- **Markdown enxuto** em toda documentação.

**Motor de distribuição isolado:** função pura, sem dependência de UI ou banco, com suíte de testes própria. Casos obrigatórios: `Q=0` · `Q=1, 2 pessoas` · `Q ímpar` · `1 elegível` · `0 elegíveis` (deve lançar erro) · `Q < granularidade_minima` · verificação de conservação em 1.000 casos aleatórios · alternância de crédito ao longo de 5 dias.

---

## 11. DECISÕES PROVISÓRIAS (para o protótipo não travar)

Sete questões ainda dependem da equipe do cliente. Assuma os defaults abaixo, **deixe todos parametrizáveis** e marque no código como `// PENDENTE DE CONFIRMAÇÃO`.

| # | Questão aberta | Default do protótipo |
|---|---|---|
| 1 | Como se decide hoje quem leva a unidade extra? | Maior `credito_acumulado`; empate → menor volume no período → id |
| 2 | Existe limiar formal para "tudo para um só"? | `granularidade_minima = 3`, configurável por categoria |
| 3 | Um `DOC` custa o mesmo que um `E-MAIL`? | `peso = 1` para todas; campo já modelado |
| 4 | O que são `INADIMP.` e `ISENTO`? | Categorias com `divisivel = false`, fora do rateio diário |
| 5 | Quem faz a triagem é quem distribui? | Mesmo perfil (`operador`); papéis já separados no modelo |
| 6 | `LIGA` / `LIGANTE` / `E-MAIL LIGA` são fluxos independentes? | Independentes, 3 categorias distintas |
| 7 | Como o e-mail é associado à liga? | IA por menção textual + confirmação humana abaixo do limiar |
| 8 | Onde os e-mails moram (M365/Google/IMAP)? | **Mockar a ingestão na V1** — seed de itens fictícios; interface pronta para plugar |

**Fora do escopo do protótipo, mas registrar como risco:** LGPD (dados de associados e estudantes — retenção, acesso, log) e definição do dono do sistema após a entrega (quem cadastra colaborador, ajusta limiar, define escala).

---

## 12. PRIMEIRA TAREFA

1. Ler este documento por inteiro.
2. Aplicar primeiros princípios: quebrar o problema, questionar cada peça.
3. Produzir **Briefing → PRD → Spec** e apresentar para aprovação.
4. Só depois: scaffold → matrizes no Storybook → telas.

**Comece pelo motor de distribuição com testes.** É o núcleo de valor, é função pura, e prova o conceito antes de qualquer tela existir.
