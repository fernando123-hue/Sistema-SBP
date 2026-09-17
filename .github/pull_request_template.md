## O que mudou

<!-- Uma frase. O que o sistema faz agora que não fazia antes. -->

## Nível de risco

<!-- O CI calcula pelos arquivos alterados e mostra no resumo do job "Processo".
     0 documentação · 1 tela · 2 regra de negócio · 3 sensível. Ver docs/PROCESSO.md.
     O CI falha se faltar a evidência que o nível exige nas seções abaixo. -->

## Impacto

- [ ] Altera regra de negócio — qual: 
- [ ] Altera o motor de distribuição — versão do algoritmo bumpada?
- [ ] Altera o modelo de dados — migração incluída?
- [ ] Altera comportamento da IA — prompt/versão registrados?
- [ ] Nenhum dos acima

## Evidência

### Especificação

<!-- Todo nível. O que foi pedido e onde: regra (RN-xx), decisão (DECISOES.md § …), achado de auditoria. -->

### Visto rodando

<!-- Nível 1+. Tela vista rodando (sbp-local) e o que foi conferido. Sem tela: "Não se aplica — <motivo>". -->

### Verificação comportamental

<!-- Nível 2+. O comportamento pedido, provado: propriedade ou conta (ex.: Σ atribuições = entrada em N sorteios),
     casos extremos (Q=0, Q ímpar, 1 elegível, 0 elegíveis), determinismo, erro tratado. Cite os testes. -->

### Teste visto vermelho

<!-- Nível 2+. Qual teste falhou com a correção revertida (ou com o defeito reintroduzido), e com que mensagem. -->

### Revisão técnica

<!-- Nível 2+. Agente revisor DIFERENTE do que escreveu o código, com o LINK do comentário publicado neste PR
     (…/pull/N#issuecomment-…). Achados críticos e altos: corrigidos ou com destino escrito. -->

### Revisão de segurança

<!-- Nível 3. Agente de segurança, com o LINK do comentário publicado neste PR. -->

### Regressão

<!-- Nível 1+. `npm run verificar`: arquivos, testes, pulados. E os checks do CI lidos um a um. -->

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
