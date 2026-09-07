/**
 * Seleção de notas do setor — domínio puro.
 *
 * Esta é a função que responde "o que o setor já aprendeu que vale para o que
 * estou fazendo agora". Hoje o resultado dela vai para a tela. **É a mesma
 * função que um dia montará o contexto do modelo** — e é por isso que ela mora
 * em `core/`, sem I/O, testável em milissegundos e auditável linha a linha.
 *
 * ═══ POR QUE ELA JÁ NASCE ASSIM, SE HOJE SÓ ALIMENTA UMA TELA ═══
 *
 * A decisão do dono do projeto (07/09/2026) foi: a memória existe para o
 * sistema usar, mas o modelo só passa a lê-la depois que o adapter da Anthropic
 * rodar contra a API real e existir linha de base de acerto. Sem essa medição,
 * "a IA melhorou com as notas" é afirmação que ninguém consegue falsificar, e
 * o custo de descobrir que não melhorou é a maior superfície de risco do
 * sistema — ver `DECISOES.md § H.4`, item 14, e o invariante 12.
 *
 * A escolha de engenharia que decorre disso: fazer a seleção agora, pura e
 * coberta por teste, de modo que ligar o modelo depois seja **trocar o destino
 * de uma chamada**, não reescrever a regra. O que muda naquele dia é o
 * consumidor; a pergunta "quais notas importam aqui" continua respondida no
 * mesmo lugar, do mesmo jeito, com os mesmos testes.
 *
 * ═══ O PORTÃO QUE FALTA, E QUE NÃO É DESTE ARQUIVO ═══
 *
 * No dia em que estas notas forem para o prompt, o texto tem de atravessar as
 * três camadas de `core/seguranca/conteudo-nao-confiavel` no caminho de
 * LEITURA e ir sempre dentro dos delimitadores. Nota é escrita por gente da
 * casa, o que a torna menos suspeita que corpo de e-mail — não a torna
 * confiável: basta uma conta comprometida, ou alguém de saída, para uma linha
 * plantada aqui agir sobre todo e-mail futuro. Esta função devolve o texto
 * como ele está; quem for montar prompt é que precisa embrulhá-lo.
 */

/** Uma nota, já desligada do banco. */
export interface NotaSelecionavel {
  id: string
  texto: string
  categoriaId: string | null
  ligaId: string | null
  criadoEm: Date
  arquivadaEm: Date | null
}

/** Onde a pessoa está quando a nota é buscada. */
export interface ContextoDeTrabalho {
  categoriaId?: string | null
  ligaId?: string | null
}

/**
 * Quanto de específico a nota tem para o contexto pedido.
 *
 * A escala não é estética: ela decide o que sobra quando há mais nota do que
 * espaço. Nota de liga ganha de nota de categoria porque é a mais cara de
 * descobrir sozinho — "essa liga sempre manda a ficha separada" é conhecimento
 * que só quem já tropeçou tem; "documento vence em 30 dias" a pessoa acha no
 * manual.
 */
const PESO_LIGA = 4
const PESO_CATEGORIA = 2
const PESO_GERAL = 1

/** Teto por consulta. Nota que não cabe é nota que ninguém lê. */
export const LIMITE_DE_NOTAS_EXIBIDAS = 5

/**
 * `null` nos dois lados do vínculo significa "vale para o setor inteiro" —
 * nunca "não sei a que se refere". Por isso nota geral SEMPRE entra: ela é
 * relevante em todo contexto por construção, e descartá-la quando há contexto
 * esconderia justamente o aviso que vale para tudo.
 */
function relevancia(nota: NotaSelecionavel, contexto: ContextoDeTrabalho): number | null {
  const daLiga = nota.ligaId !== null
  const daCategoria = nota.categoriaId !== null

  // Vínculo que existe e não bate com o contexto ELIMINA a nota. Sem isto, a
  // nota de uma liga apareceria enquanto se trabalha em outra — e uma memória
  // que aparece no lugar errado é pior que memória nenhuma: a pessoa aprende a
  // ignorar o painel inteiro.
  if (daLiga && nota.ligaId !== contexto.ligaId) return null
  if (daCategoria && nota.categoriaId !== contexto.categoriaId) return null

  if (daLiga) return PESO_LIGA
  if (daCategoria) return PESO_CATEGORIA
  return PESO_GERAL
}

/**
 * As notas que valem para este contexto, da mais específica para a mais geral
 * e, dentro do mesmo peso, da mais recente para a mais antiga.
 *
 * A ordem de desempate é por `criadoEm` decrescente porque o que o setor
 * aprendeu por último costuma corrigir o que aprendeu antes. Quando as duas
 * notas nascem no mesmo instante — o que só acontece em teste e em importação
 * — o `id` desempata, para a saída ser determinística: ordenação instável aqui
 * produziria telas que mudam de conteúdo entre dois carregamentos iguais, e
 * ninguém confia num painel que faz isso.
 */
export function selecionarNotas(
  notas: readonly NotaSelecionavel[],
  contexto: ContextoDeTrabalho,
  limite: number = LIMITE_DE_NOTAS_EXIBIDAS,
): NotaSelecionavel[] {
  const pontuadas: { nota: NotaSelecionavel; peso: number }[] = []

  for (const nota of notas) {
    // Arquivada não é apagada, mas também não é conselho — ela sobrevive para
    // responder "por que a equipe fazia isso em março", não para orientar hoje.
    if (nota.arquivadaEm !== null) continue

    const peso = relevancia(nota, contexto)
    if (peso === null) continue

    pontuadas.push({ nota, peso })
  }

  pontuadas.sort((a, b) => {
    if (a.peso !== b.peso) return b.peso - a.peso
    const diferenca = b.nota.criadoEm.getTime() - a.nota.criadoEm.getTime()
    if (diferenca !== 0) return diferenca
    return a.nota.id < b.nota.id ? -1 : a.nota.id > b.nota.id ? 1 : 0
  })

  return pontuadas.slice(0, Math.max(0, limite)).map((linha) => linha.nota)
}
