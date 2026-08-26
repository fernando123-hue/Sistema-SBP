## O que mudou

<!-- Uma frase. O que o sistema faz agora que não fazia antes. -->

## Por que

<!-- Qual problema da operação isso resolve. Referencie a regra (RN-xx) ou a decisão (DECISOES.md § ...) quando houver. -->

## Impacto

- [ ] Altera regra de negócio — qual: 
- [ ] Altera o motor de distribuição — versão do algoritmo bumpada?
- [ ] Altera o modelo de dados — migração incluída?
- [ ] Altera comportamento da IA — prompt/versão registrados?
- [ ] Nenhum dos acima

## Testes

<!-- O que foi testado e como. Se mudou o motor ou a distribuição, cite os casos. -->

- [ ] `npm run verificar` passa (typecheck + testes)
- [ ] Conservação de totais coberta por teste
- [ ] Casos de borda cobertos (Q=0, Q ímpar, 1 elegível, 0 elegíveis)

## Segurança

- [ ] Sem segredo em código, log, fixture ou migração
- [ ] Entrada externa validada por Zod na borda
- [ ] Conteúdo de e-mail/documento tratado como dado, nunca como instrução
- [ ] Operação crítica é idempotente
- [ ] Auditoria registra quem, quando, antes e depois

## Migrações

<!-- Reversível? Precisa de backfill? Trava tabela? Se não há migração, escreva "nenhuma". -->

## Hipóteses

<!-- Alguma decisão provisória foi assumida? Registrou em DECISOES.md? -->
