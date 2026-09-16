# Revisão de segurança da fase 1 — 15/09/2026

Revisão por agente, **somente leitura**, sobre o diff inteiro da fase 1 (`A17`, `A20`, `A23`) — as 84 mudanças que entraram na `main` pelo PR #44 (`2c4acdb`). Nenhum arquivo foi alterado durante ela.

**Resultado: nenhum achado CRÍTICO e nenhum ALTO.** Um MÉDIO e um BAIXO, os dois de decisão, não de defeito.

> **Quem revisou foi um agente, não uma pessoa.** Isso vale para todas as revisões deste projeto até hoje e está registrado em `ESTADO.md`. Uma revisão humana continua sendo trabalho em aberto antes de dado real de associado entrar.

## Os dois achados

### MÉDIO — a busca por CPF tem limite por minuto, e nenhum por dia

`src/app/api/itens/busca/route.ts:25,31` limita a **20 buscas por minuto por pessoa**, com a chave vinda da sessão (`ator.colaboradorId`), nunca do corpo. Não existe teto diário nem sinal de anomalia.

**Conferido à mão em 15/09/2026:** o limite é esse mesmo, e não há segundo teto em lugar nenhum.

**O cenário concreto:** uma conta autenticada comprometida — ou alguém de dentro — pode tentar cerca de 28 mil CPFs por dia. A resposta é um oráculo binário: achou item, ou não achou. Ela não distingue "este CPF existe no cadastro e não tem item" de "este CPF nunca passou por aqui", o que reduz o valor do ataque, mas não o elimina: descobrir **que um associado específico mandou e-mail para a secretaria** já é informação pessoal.

**Por que não é bloqueante:** exige conta válida, o espaço de busca é grande, e a busca só alcança itens que o sistema já tem. Mas o risco não está registrado em lugar nenhum, e o dono não decidiu sobre ele.

**Saídas, se o dono quiser reduzir:** teto diário cumulativo por pessoa; ou registrar na trilha (sem o número digitado) picos de busca por pessoa, para alguém olhar — detecção, não bloqueio automático, porque bloquear a equipe no meio do expediente é pior que o risco.

### BAIXO — o prazo de retenção pode ser posto em 1 dia

`PRAZO_MINIMO_EM_DIAS = 1` (`src/core/esquemas.ts:465`; teto de 3.650). O sistema aplica corretamente o que for configurado, com trilha e confirmação no servidor antes de encurtar. **Conferido à mão.**

Não é defeito: é piso de política. Falta o dono dizer se 1 dia é aceitável para o motivo de afastamento (dado de saúde) e para o texto do e-mail, ou se o código deve impor um piso maior.

## O que foi conferido e está sólido

**Busca por CPF protegido.** Código derivado por HMAC-SHA256 com `BUSCA_SECRET` (`src/servidor/cpf-protegido.ts:36`), segredo obrigatório na partida, sem valor padrão e sem cair para `SESSAO_SECRET`. O CPF nunca é gravado. A rota é `POST`, com o número no corpo — nunca no endereço, nunca no registro do servidor —, e um teste impede o `GET` de voltar. As mensagens de recusa são fixas, sem ecoar o que foi digitado. Só CPF completo e com dígito verificador válido vira chave, então texto hostil de e-mail não fabrica chave de busca. Identidade sempre do `Ator`.

**Expurgos.** O arquivo sai do disco antes da marca no banco, então falha de disco deixa o e-mail pendente em vez de criar órfão. Duas execuções simultâneas da limpeza diária são impedidas pela chave única `(rotina, data)` e por atualização condicional. O prazo é lido do banco e **revalidado** mesmo já gravado, o que protege contra edição direta no banco. Mudar prazo exige papel de gestor, e encurtar exige confirmação **no servidor**. Cada e-mail e cada item são transação própria, e sobra pendência faz a rotina falhar alto. Conteúdo sai; histórico operacional fica.

**Trilha sem dado pessoal.** É o ponto mais bem defendido do diff. Nome de campo passa por lista fechada (`src/core/nome-de-campo.ts`), o que neutraliza o caso em que o modelo devolve o próprio CPF **como chave** do campo. A trilha grava que houve mudança e **quais** campos, nunca os valores; o expurgo grava contagens e prazo, nunca o que apagou. Há teste dedicado (`src/servicos/trilha-sem-dado-pessoal.test.ts`).

**Aviso do dia da gestora.** Só gestor lê e confirma. A redação do motivo acontece no servidor. O aviso é montado por regra pura e servido por rota própria: **não passa pelo assistente nem por modelo de IA** — conferido também no cliente, onde a pergunta ao assistente leva só o texto digitado. O que fica guardado do "já vi" são ids de afastamento, nunca nome nem motivo.

**Conferido e descartado:** ataque de tempo na comparação do CPF protegido. A comparação é de índice no banco, dominada por rede e latência, não por processamento controlável pelo pedido.

## Uma observação de método, registrada em vez de apagada

O agente relatou duas coisas sobre a própria execução: que a branch foi mesclada no meio da revisão (por este chat, em paralelo) — ele conferiu que o diff revisado é o mesmo — e que uma leitura de arquivo voltou corrompida numa chamada paralela, percebida porque o conteúdo não batia com a contagem de linhas do arquivo real, e refeita.

Fica escrito porque é exatamente a classe de divergência silenciosa que este sistema existe para eliminar, e porque quem repetir esta revisão precisa saber que ela pode acontecer.

## O que isso significa para a implantação

**Nada aqui impede colocar o sistema no ar.** O que precisa de resposta do dono antes de dado real de associado passar pela busca:

1. Aceitar o risco de enumeração lenta, ou acrescentar teto diário e sinal de anomalia?
2. O piso de 1 dia para os prazos de retenção fica?

Continua valendo, e é maior que os dois: **nenhuma pessoa revisou este código.**
