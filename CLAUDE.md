# Instruções para o Claude Code neste repositório

## Comece por aqui

Leia **`docs/ESTADO.md`** antes de qualquer coisa. Ele diz o que está pronto, onde o trabalho parou e qual é o próximo passo. Depois, conforme a tarefa:

- `docs/DECISOES.md` — **a fonte da verdade sobre o que foi assumido e o que foi confirmado.** Correções aos documentos de origem (§ B), decisões do cliente (§ A), hipóteses provisórias (§ C), pendências (§ D) e a auditoria completa (§ H).
- `docs/02-PRD.md` — requisitos e invariantes.
- `docs/03-SPEC.md` — arquitetura, modelo de dados, motor, API.
- `CONTEXTO.md` e `ENGENHARIA_REVERSA_Produtividade_2026.md` — os documentos de origem, com as regras `RN-01` a `RN-15` extraídas da planilha real.

## O que este sistema é

Substituto da planilha `PRODUTIVIDADE_-_2026.xlsx`, usada pela Secretaria de Atendimento ao Associado de uma associação médica de pediatria para repartir trabalho diário entre a equipe.

A virada central: **sai a contagem anônima, entra o item rastreável.** A planilha sabe que "Paulo recebeu 24"; nunca *quais* 24.

O cliente é uma empresa de grande porte, mas este é o **primeiro** sistema de uma estratégia de automação progressiva. O escopo pequeno é intencional. A regra é: menor arquitetura que resolve corretamente o problema atual, sem decisões estruturais que criem obstáculo ao crescimento.

## Regras que não se quebram

1. **`src/core/` é domínio puro.** Não importa Prisma, React, Next nem `fetch`. As setas apontam só para dentro: `app → servicos → core`. É isso que mantém o motor testável em milissegundos e auditável para sempre.

2. **IA interpreta. Algoritmo decide. Banco lembra. Regra explícita governa.** A IA nunca calcula divisão, nunca escolhe quem recebe, nunca trata o resto. Toda saída dela passa por Zod (`InterpretacaoSchema`); o que não valida vai para revisão humana, nunca para o motor.

3. **Conservação é invariante de transação, não boa intenção.** `Σ atribuições == quantidade de entrada`, verificado antes do commit. Falhou, aborta tudo. A planilha erra isso em 29% dos dias — é a razão de o projeto existir.

4. **Nenhuma métrica de painel é digitável.** Métrica é `<p>`, nunca `<input>`. Não existe rota de escrita para métrica.

5. **Identidade vem do `Ator`, nunca do corpo da requisição.** Nenhum esquema de entrada carrega "quem fez". Sem isso, a trilha de auditoria seria preenchida pelo cliente.

6. **Conteúdo externo é dado, nunca instrução.** Corpo de e-mail, assunto e nome de anexo passam por truncar → detectar → delimitar.

7. **Falhar alto, nunca degradar em silêncio.** Erro silencioso é a doença que este sistema existe para curar. Ver `src/core/erros.ts`.

8. **Dados de teste são 100% sintéticos.** Nenhum nome, CPF, CRM ou e-mail real entra no repositório.

9. **Guardar histórico não é treinar modelo.** O sistema preserva o histórico operacional para auditoria, métrica e melhoria de regra. Nenhuma rotina de treinamento, fine-tuning ou aprendizado automático com dado real da associação pode ser implementada sem decisão explícita do dono do negócio — e não existe hoje nenhum caminho de export para isso. Se for preciso criar um, ele é uma decisão, nunca um efeito colateral.

10. **Métrica por pessoa é observabilidade, não avaliação.** Tempo de execução, taxa de devolução e volume existem para balancear carga, achar gargalo e planejar. O sistema **não** transforma esses números em julgamento sobre indivíduo — nada de ranking, nota ou classificação de desempenho sem decisão separada, com critérios explícitos e análise de privacidade.

11. **Conteúdo tem retenção; histórico operacional, não.** `EmailConteudo` e os bytes de anexo são expurgáveis por política de retenção; `Email`, `Item`, `Atribuicao`, `SaldoCarga` e `LogAuditoria` sobrevivem. Nunca junte as duas coisas na mesma linha, e nunca apague dado operacional para simplificar armazenamento.

12. **Memória é lida, nunca soprada de volta ao modelo.** A trilha (`LogAuditoria`, `EventoProcessamento`) existe para humano investigar e para uma orquestração futura consultar. Ela **não** monta contexto de prompt. Devolver ao modelo texto que veio de e-mail transforma injeção de prompt — hoje limitada a uma mensagem — em ataque persistente; e selecionar correções humanas parecidas para injetar no prompt é aprendizado em contexto, ou seja, treinar com dado real da associação sem a decisão que o invariante 9 exige. Se um dia isso entrar, entra como decisão do dono, com o texto passando pelas três camadas de `conteudo-nao-confiavel` no caminho de **leitura** e sempre dentro dos delimitadores.

13. **Toda linha de memória nasce sabendo de que domínio é.** `dominio` em `LogAuditoria` e `EventoProcessamento` não é enfeite para o futuro: a trilha é append-only, então uma linha gravada sem domínio só ganharia um por `UPDATE` — a única escrita que este sistema promete nunca fazer. Evento futuro é gravado **na mesma `Transacao`** do fato, ou não é gravado: publicar antes do commit deixa a memória afirmando uma distribuição que a transação abortou.

## Antes de considerar qualquer trabalho pronto

```bash
npm run verificar    # typecheck + testes
```

Mudou schema? `npx prisma migrate dev` e confira que o CI valida a sincronia.
Mudou algo observável na tela? Suba `npm run dev` e verifique de verdade.

## Convenções

- **Código e comentários em português.** Nomes de domínio em português é decisão consciente — o vocabulário do código é o vocabulário da operação.
- Comentário explica **por quê**, não o quê. Vários comentários no código registram o bug que a linha previne — preserve-os, são memória cara.
- Commits em português, formato convencional (`feat:`, `fix:`, `chore:`).
- Nunca trabalhe direto na `main`. Branch + PR.

## Hipótese não vira regra em silêncio

Se precisar assumir algo que os documentos não decidem, registre em `DECISOES.md § C` com hipótese, motivo, impacto e status. Se a decisão for do dono do negócio, **não invente a resposta** — formule a pergunta objetiva e registre em `§ H.4`.
