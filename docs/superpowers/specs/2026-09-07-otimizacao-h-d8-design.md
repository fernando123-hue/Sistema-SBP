# Otimização H-D8 — desenho

## Objetivo

Preparar as leituras do Painel e do planejamento de distribuição para um banco
remoto, sem mudar resultados, contratos HTTP, schema Prisma, migrações ou
dados persistidos.

## Contexto

No SQLite local, as consultas encadeadas são baratas. Em PostgreSQL cada uma
vira uma ida ao banco. Hoje `porPessoa` executa quatro consultas por pessoa e
`carregarElegiveis` executa quatro por pessoa escalada, por categoria. Isso
alarga também a transação que protege a distribuição diária.

## Escopo escolhido

1. `porPessoa` passará a buscar os colaboradores e todos os quatro conjuntos
   de dados necessários em lote, agrupando-os em memória por `colaboradorId`.
2. `carregarElegiveis` continuará aplicando exatamente os mesmos filtros de
   habilitação, escala, afastamento, crédito, janela de 30 dias e ajuste global,
   mas buscará os saldos de todos os candidatos em consultas por conjunto, não
   quatro consultas por candidato.
3. Testes de regressão montarão vários colaboradores e categorias para provar
   que os valores e a ordenação permanecem idênticos, incluindo quem está
   afastado e o crédito global ajustado no planejamento da mesma rodada.
4. `docs/ESTADO.md` e `README.md` passarão a refletir apenas o estado que o
   código e os testes comprovam após a mudança.

## Fora do escopo

- Migração para PostgreSQL, mudança no provider ou no adapter Prisma.
- Migrações de schema, escrita, expurgo, backfill ou alteração de registros.
- Alterações de papéis, retenção, exposição da Caixa ou regras de distribuição.
- Medição com produção, telemetria nova ou chamadas de rede.

## Desenho

As funções públicas preservam suas assinaturas e retornos. A refatoração fica
contida em `src/servicos/painel.ts` e `src/servicos/distribuicao.ts`.

Em `porPessoa`, contagens de atribuição, execução e pendência serão feitas por
`groupBy` com um único conjunto de ids; o saldo global será lido de uma vez e
reduzido ao registro mais recente por pessoa. A ordem continua sendo o nome do
colaborador retornado pela primeira consulta.

Em `carregarElegiveis`, habilitações, escalas e afastamentos continuam sendo a
porta de elegibilidade. Depois de determinar os candidatos presentes na escala,
o serviço lê em lote: último saldo por categoria, último saldo global no escopo,
soma recebida na janela e saldo do dia. A seleção do registro mais recente usa
explicitamente a mesma ordenação `data desc` atual; nenhuma dependência será
transferida para a ordem incidental do banco.

## Garantias de equivalência

- Pessoas inativas não aparecem no Painel.
- `atribuidos`, `concluidos`, `pendentes` e `creditoGlobal` mantêm suas
  definições atuais.
- Afastamento cancelado não exclui pessoa; afastamento vigente exclui.
- A janela é inclusiva entre `data - 29 dias` e `data`.
- `ajusteGlobal` só incide no crédito global da mesma rodada.
- A prévia e a confirmação continuam a compartilhar o mesmo planejamento.

## Verificação e reversão

Os testes novos falham contra a implementação que faça agrupamento incompleto
ou escolha saldo histórico errado. A validação final é `npm run verificar`.
Não haverá comando destrutivo, alteração de banco ou migração. Cada tarefa será
um commit isolado, permitindo reversão por `git revert` sem restaurar arquivos
manualmente.
