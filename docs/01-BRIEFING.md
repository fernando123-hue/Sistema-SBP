# Briefing — Sistema de Distribuição de Demandas

> Responde **por quê**. Insumo: `CONTEXTO.md` + `ENGENHARIA_REVERSA_Produtividade_2026.md`.
> Modo: **Matriz** (produto novo).

## 1. O produto

Sistema operacional que substitui a planilha `PRODUTIVIDADE_-_2026.xlsx` na Secretaria de Atendimento ao Associado de uma associação médica de pediatria.

Não é uma planilha melhor. É a troca da **unidade de trabalho**: sai a contagem anônima, entra o **item rastreável**.

## 2. Para quem

| Papel | Uso |
|---|---|
| **Operador** | Triagem, revisão das exceções da IA, define escala, dispara a distribuição |
| **Colaborador** | Recebe sua fila com itens reais, conclui item a item |
| **Gestor** | Painel de recebido/distribuído/realizado/pendente. Zero campo digitável |

Hoje: 4–7 colaboradores cadastrados, mas `J = 2` de plantão em quase todos os dias.

## 3. O problema

A planilha acumula três responsabilidades incompatíveis num arquivo só — motor de rateio, controle de fila individual e relatório gerencial. Falha nas três.

**Medido no arquivo:**

| Falha | Evidência |
|---|---|
| Soma não se conserva | 45 de 157 dias (29%). Abril fecha −59 |
| Trabalho some | `CAD-ABRIL`: 16 `LIGA` entraram, 0 distribuídos |
| Ajuste é descartado pela fórmula | Blocos Fernando/Ester: `ABERTO = Mov.Dia + Saldo`. `Mov. Extra` evapora. `LIGANTE = 52` → 33 distribuídos |
| Relatório da diretoria errado | `SUBTOTAL(109)` + 27 linhas ocultas → Agosto reporta **319** de **1.369** |
| Indicador anual é string | Totais de `Pend.` são texto digitado: `"0,0"`, `"3,0"` |
| Nada é auditável | Nenhuma célula tem id de e-mail, remetente, assunto ou protocolo |
| Retrabalho | ~7.000 digitações evitáveis/ano |

**A causa raiz é uma só:** a planilha guarda *quantos*, nunca *quais*. Sem identidade de item não há auditoria, reabertura, rastreio nem prova de atendimento.

## 4. Objetivos

1. **Conservação garantida.** `Σ distribuído == Σ entrada`, sempre, como invariante de transação — não como boa intenção.
2. **Balanceamento formalizado.** A alternância `+0,5 / −0,5` que hoje é memória de uma pessoa vira `credito_acumulado` no banco.
3. **Elegibilidade como dado.** Trocar quem está de plantão deixa de exigir edição de fórmula.
4. **Item rastreável.** Cada colaborador vê *seus* e-mails, não um número.
5. **Painel derivado.** Nenhuma métrica digitável em lugar nenhum.
6. **IA absorve a triagem.** A etapa mais cara da operação é hoje invisível na planilha.

## 5. Contexto de negócio

O cliente possui **sistema próprio, antigo**, que pretende trocar no futuro. Este sistema não o substitui agora — **alivia a dor imediata** (triagem + distribuição) e precisa **conviver e integrar** com o legado.

Consequência direta na arquitetura: **API-first**. Toda operação existe como endpoint antes de existir como tela. Integração é um adapter plugável, igual ao da IA.

Se der certo, expande.

## 6. Restrições

- Frente `CADASTRO` na V1. `TÍTULOS` tem estrutura diferente (4 categorias, blocos assimétricos, grupo `AUXILIO`) e fica para depois.
- Ingestão de e-mail **mockada** na V1 — provedor real (M365/Google/IMAP) ainda indefinido. Interface pronta para plugar.
- Pesos de esforço por categoria **ainda não existem**. Campo modelado, `peso = 1`, configurável sem deploy.
- Sete decisões dependem da equipe do cliente. Defaults assumidos e registrados em `DECISOES.md`.
- Stack fixada: Next.js · shadcn/ui · Tailwind · Storybook · Prisma.

## 7. Critério de sucesso

A planilha deixa de ser necessária porque cada uma das suas três funções ganhou lugar próprio: o motor distribui, o banco guarda a fila, o painel reporta.

Prova operacional: rodar **em paralelo** com a planilha por 2–4 semanas. Cada divergência é evidência a favor do sistema — as 45 divergências históricas provam que a planilha erra sozinha.
