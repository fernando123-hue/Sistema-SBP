# Rodada de segurança e qualidade — 16/09/2026

Pedido do dono (`DECISOES.md § A49`): *"reforçar a segurança e a qualidade do protótipo"*, antes de ligar a IA paga. Plano completo no bloco do topo de `docs/ESTADO.md`, item 4.

**Situação: etapa 1 (auditar) em andamento.** Este arquivo é gravado **antes** de qualquer correção, para que nenhum achado exista só numa conversa.

## Como esta rodada é feita

1. **Medições automáticas** — feitas em 16/09/2026 à noite, resultado abaixo.
2. **Auditoria por agentes, só leitura, sobre a `main` inteira** — em paralelo, com verificação adversarial de cada achado. O dono autorizou em 16/09/2026 à noite e pediu que seja feita **com calma, quando o limite de uso voltar**: *"qualidade e segurança são o crucial aqui"*. Ainda não rodou.
3. **Correção por severidade**, um PR por tema, cada uma com teste visto vermelho antes.
4. **Destino de cada achado** registrado na tabela do fim. Nenhum fica sem destino.

> **Quem audita é agente, não pessoa.** Uma revisão humana continua em aberto antes de dado real de associado entrar.

## 1. Medições automáticas — 16/09/2026

Sobre a `main` em `5503ecd`, nesta máquina, contra MySQL 8.4 na porta 3307.

| Medição | Resultado |
|---|---|
| `npm run verificar` (tipos + testes) | verde: 82 arquivos, 877 testes, nenhum pulado (337 s) |
| `npm audit` | **0 vulnerabilidades** (nenhuma baixa, média, alta ou crítica). Overrides em vigor: `deepmerge-ts`, `mysql2`, `mariadb` (`AT-31`) |
| `npm run test:cobertura` | linhas **95,63%**, instruções 93,9%, ramos 85,07%, funções 95,98% (era 92,8% das linhas) |

### Bateria sintética contra o Gemini gratuito (`A38`) — 16/09/2026, 17h46 UTC

`npm run ia:experimentar`, os mesmos quatro casos sintéticos, dois modelos.

| Modelo | Respondeu | Resto |
|---|---|---|
| `gemini-3.5-flash` | 0 de 4 | `503` (Google sem capacidade) |
| `gemini-3.1-flash-lite` | 1 de 4 (campo faltando: categoria certa, os três ausentes listados, 21 s) | `503` |

**O sistema se comportou como deve:** cada falha foi registrada e o e-mail iria para a revisão humana — nada foi perdido nem inventado. **O que a medição diz:** a camada gratuita é instável demais para servir de linha de base (`A37`) neste horário; a injeção não chegou a ser testada. Repetir em outro horário. Não é achado de código.

### Arquivos com cobertura baixa (instruções abaixo de 75%)

Não são achados ainda — são **onde a auditoria de testes deve olhar primeiro**.

| Arquivo | Instruções | Linhas | Por que importa |
|---|---|---|---|
| `src/adapters/fornecedor.ts` | 33% | 33% | escolha do fornecedor de IA (`criarAiPort`) |
| `src/adapters/ia-anthropic.ts` | 35% | 38% | **é o fornecedor que o `A49` vai ligar**; antes da chave, precisa de prova |
| `src/adapters/ia-gemini.ts` | 41% | 42% | fornecedor alternativo |
| `src/app/api/colaboradores/route.ts` | 73% | 70% | cadastro da equipe (rota administrativa) |
| `src/app/api/rodadas/[id]/route.ts` | 50% | 57% | leitura de uma distribuição |
| `src/servidor/limite-de-taxa.ts` | 72% | 81% | limite por minuto (defesa contra abuso) |

### Achado manual — MySQL local: X Plugin em todas as interfaces (16/09/2026, 21h12)

| Campo | Valor |
|---|---|
| ID | M-01 |
| Severidade | BAIXO nesta máquina · ALTO se o mesmo comando for usado num servidor |
| Categoria | Infraestrutura / configuração do MySQL |
| Onde | comando de partida em `docs/ESTADO.md` (bloco do topo, item 1) |
| Evidência | log do `mysqld`: `X Plugin ready for connections. Bind-address: '::' port: 33060` |
| Descrição | `--bind-address=127.0.0.1` vale só para a porta clássica (3307). O protocolo X (33060) escuta em **todas** as interfaces, IPv4 e IPv6 |
| Vetor e pré-condições | alguém na mesma rede alcança a porta 33060. Hoje a conta `root` sem senha é só `root@localhost`, então a conexão de fora é recusada — mas a porta está aberta e anunciando a versão |
| Impacto | superfície de ataque desnecessária; num servidor da empresa, com outra conta criada para `%`, vira acesso ao banco |
| Causa raiz | opção de rede aplicada a um só protocolo |
| Correção | acrescentar `--mysqlx=OFF` ao comando (o sistema não usa o protocolo X) ou `--mysqlx-bind-address=127.0.0.1`; conferir com `netstat -an \| findstr 33060` |
| Teste de regressão | na lista de implantação: nenhuma porta do MySQL escutando fora de `127.0.0.1` / rede interna autorizada |

## 2. Achados da auditoria por agentes

*Ainda não rodou.* Método: `roteiro-da-auditoria-de-seguranca.md` (entregue pelo dono em 16/09/2026) e as dimensões do `ESTADO.md`, item 4. Cada achado segue o formato da seção 21 do roteiro.

## 3. Destino de cada achado

| Id | Severidade | Onde | Resumo | Destino |
|---|---|---|---|---|
| — | — | — | — | — |
