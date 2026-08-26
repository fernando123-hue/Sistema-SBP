import { CATEGORIAS_CADASTRO } from '../core/config'
import { sequenciaDeDatas } from '../core/util/datas'
import type { Banco } from '../servidor/prisma'

/** Apoio aos testes de integração. Dados 100% sintéticos. */

export const DATA_BASE = '2026-09-01'

export async function limparTudo(banco: Banco): Promise<void> {
  // Filhos antes dos pais, respeitando as chaves estrangeiras.
  await banco.execucao.deleteMany()
  await banco.atribuicao.deleteMany()
  await banco.revisao.deleteMany()
  await banco.rodadaDistribuicao.deleteMany()
  await banco.item.deleteMany()
  await banco.email.deleteMany()
  await banco.saldoCarga.deleteMany()
  await banco.saldoCargaGlobal.deleteMany()
  await banco.eventoProcessamento.deleteMany()
  await banco.logAuditoria.deleteMany()
  await banco.escala.deleteMany()
  await banco.habilitacao.deleteMany()
  await banco.colaborador.deleteMany()
  await banco.regraDistribuicao.deleteMany()
  await banco.categoria.deleteMany()
}

export interface BaseSemeada {
  operadorId: string
  colaboradores: { id: string; nome: string }[]
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
        entraNoRateio: categoria.entraNoRateio,
      },
    })
  }

  const categorias = await banco.categoria.findMany({ where: { entraNoRateio: true } })
  const vigenciaInicio = new Date(`${DATA_BASE}T00:00:00.000Z`)

  const operador = await banco.colaborador.create({
    data: { nome: 'Operadora de Teste', email: 'operador@teste.local', papel: 'operador' },
  })

  const colaboradores: { id: string; nome: string }[] = []

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
    colaboradores.push({ id: pessoa.id, nome: pessoa.nome })

    for (const categoria of categorias) {
      await banco.habilitacao.create({
        data: { colaboradorId: pessoa.id, categoriaId: categoria.id, vigenciaInicio },
      })
    }

    for (const data of datas) {
      await banco.escala.create({ data: { data, colaboradorId: pessoa.id, disponivel: true } })
    }
  }

  return { operadorId: operador.id, colaboradores, datas }
}
