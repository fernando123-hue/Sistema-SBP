import { CATEGORIAS_CADASTRO, limiarConfiancaSemente } from '../core/config'
import type { Papel } from '../core/esquemas'
import { hojeIso, sequenciaDeDatas } from '../core/util/datas'
import { atorDaSessao, type Ator } from '../servidor/ator'
import type { Banco } from '../servidor/prisma'

/** Apoio aos testes de integração. Dados 100% sintéticos. */

/**
 * Antes era uma string fixa no passado ('2026-09-01'). `planejarCategoria`
 * corta itens por `criadoEm <= fimDoDia(data)` — de propósito, é o corte
 * temporal que impede uma rodada de varrer o futuro inteiro. Como `criadoEm`
 * nasce do relógio real (`@default(now())`), toda vez que o relógio real
 * passava da data fixa, itens criados pelos testes nasciam "no futuro" em
 * relação a ela e o corte os excluía — bomba-relógio, não defeito de
 * produção. Ancorado em `hojeIso()` para nunca ficar para trás.
 */
export const DATA_BASE = hojeIso()

/** Ator de teste. Equivale ao que a camada de sessão produzirá em produção. */
export function atorDeTeste(colaboradorId: string, papel: Papel): Ator {
  return atorDaSessao({ colaboradorId, papel })
}

export async function limparTudo(banco: Banco): Promise<void> {
  // Filhos antes dos pais, respeitando as chaves estrangeiras.
  // As duas primeiras não têm chave nenhuma; um prazo editado ou uma rotina
  // "já rodada hoje" vazando de um teste mudaria o resultado do seguinte.
  await banco.prazoDeRetencao.deleteMany()
  await banco.execucaoDeRotina.deleteMany()
  await banco.avisoVisto.deleteMany()
  await banco.execucao.deleteMany()
  // `JustificativaDeAtribuicao` ANTES de `Atribuicao`: desde o N-22 a relação
  // é `Restrict`, e a cascata não apaga mais a justificativa junto. É o
  // comportamento pedido — histórico operacional não some sozinho —, e o preço
  // é a ordem explícita aqui.
  await banco.justificativaDeAtribuicao.deleteMany()
  await banco.atribuicao.deleteMany()
  await banco.revisao.deleteMany()
  await banco.rodadaDistribuicao.deleteMany()
  await banco.travaDeDistribuicao.deleteMany()
  await banco.item.deleteMany()
  await banco.email.deleteMany()
  await banco.saldoCarga.deleteMany()
  await banco.saldoCargaGlobal.deleteMany()
  await banco.eventoProcessamento.deleteMany()
  await banco.logAuditoria.deleteMany()
  await banco.escala.deleteMany()
  await banco.afastamento.deleteMany()
  // Antes de `colaborador`: `Nota.autorId` é `Restrict`, então uma nota viva
  // impediria a limpeza do autor e derrubaria o teste seguinte, não este.
  await banco.nota.deleteMany()
  await banco.contagemDeBusca.deleteMany()
  await banco.habilitacao.deleteMany()
  await banco.colaborador.deleteMany()
  await banco.regraDistribuicao.deleteMany()
  await banco.categoria.deleteMany()
}

/**
 * Aprova TODAS as revisões pendentes, direto no banco.
 *
 * Só para teste. `aprovarTodosPendentes` do serviço recusa, de propósito,
 * conteúdo suspeito, anexo rejeitado e desdobramento — e é isso que a maioria
 * dos cenários precisa pular para chegar na distribuição. Fazer o atalho aqui,
 * explicitamente, é mais honesto do que afrouxar a regra de produção.
 */
export async function aprovarTudoNoBanco(banco: Banco): Promise<number> {
  const pendentes = await banco.revisao.findMany({
    where: { resolvidoEm: null },
    select: { itemId: true },
  })

  if (pendentes.length === 0) return 0

  // Em lote, não em laço. Depois que o desdobramento passou a exigir revisão
  // humana, uma simulação de 30 dias gera centenas de pendências — duas
  // consultas por item faziam o teste estourar o tempo limite.
  await banco.item.updateMany({
    where: { id: { in: pendentes.map((pendente) => pendente.itemId) } },
    data: { status: 'aprovado' },
  })
  await banco.revisao.updateMany({
    where: { resolvidoEm: null },
    data: { resolvidoEm: new Date() },
  })

  return pendentes.length
}

export interface BaseSemeada {
  operadorId: string
  operador: Ator
  colaboradores: { id: string; nome: string; ator: Ator }[]
  datas: string[]
}

export async function semearBase(
  banco: Banco,
  opcoes: {
    totalDeDias?: number
    pessoasDePlantao?: number
    /** Sobrescreve o limiar de indivisibilidade de TODAS as categorias. */
    limiarIndivisivel?: number
  } = {},
): Promise<BaseSemeada> {
  const totalDeDias = opcoes.totalDeDias ?? 5
  const pessoasDePlantao = opcoes.pessoasDePlantao ?? 3
  const datas = sequenciaDeDatas(DATA_BASE, totalDeDias)

  for (const [posicao, categoria] of CATEGORIAS_CADASTRO.entries()) {
    await banco.categoria.create({
      data: {
        codigo: categoria.codigo,
        rotulo: categoria.rotulo,
        frente: categoria.frente,
        grupo: categoria.grupo,
        ordem: posicao,
        divisivel: categoria.divisivel,
        peso: categoria.peso,
        limiarIndivisivel: opcoes.limiarIndivisivel ?? categoria.limiarIndivisivel,
        limiarConfianca: limiarConfiancaSemente(categoria.codigo),
        entraNoRateio: categoria.entraNoRateio,
        agrupaPorLiga: categoria.agrupaPorLiga,
      },
    })
  }

  const categorias = await banco.categoria.findMany({ where: { entraNoRateio: true } })
  const vigenciaInicio = new Date(`${DATA_BASE}T00:00:00.000Z`)

  const operador = await banco.colaborador.create({
    data: { nome: 'Operadora de Teste', email: 'operador@teste.local', papel: 'operador' },
  })

  const colaboradores: { id: string; nome: string; ator: Ator }[] = []

  for (let indice = 0; indice < pessoasDePlantao; indice += 1) {
    const pessoa = await banco.colaborador.create({
      data: {
        // Ids ordenáveis: o desempate final do motor é por id, então nomes
        // previsíveis deixam o teste determinístico e legível.
        nome: `Colaborador ${String.fromCharCode(65 + indice)}`,
        email: `pessoa${indice}@teste.local`,
        papel: 'colaborador',
      },
    })
    colaboradores.push({
      id: pessoa.id,
      nome: pessoa.nome,
      ator: atorDeTeste(pessoa.id, 'colaborador'),
    })

    for (const categoria of categorias) {
      await banco.habilitacao.create({
        data: { colaboradorId: pessoa.id, categoriaId: categoria.id, vigenciaInicio },
      })
    }

    for (const data of datas) {
      await banco.escala.create({ data: { data, colaboradorId: pessoa.id, disponivel: true } })
    }
  }

  return {
    operadorId: operador.id,
    operador: atorDeTeste(operador.id, 'operador'),
    colaboradores,
    datas,
  }
}
