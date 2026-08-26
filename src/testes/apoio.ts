import { CATEGORIAS_CADASTRO } from '../core/config'
import type { Papel } from '../core/esquemas'
import { sequenciaDeDatas } from '../core/util/datas'
import { atorDaSessao, type Ator } from '../servidor/ator'
import type { Banco } from '../servidor/prisma'

/** Apoio aos testes de integração. Dados 100% sintéticos. */

export const DATA_BASE = '2026-09-01'

/** Ator de teste. Equivale ao que a camada de sessão produzirá em produção. */
export function atorDeTeste(colaboradorId: string, papel: Papel): Ator {
  return atorDaSessao({ colaboradorId, papel })
}

export async function limparTudo(banco: Banco): Promise<void> {
  // Filhos antes dos pais, respeitando as chaves estrangeiras.
  await banco.execucao.deleteMany()
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
    select: { id: true, itemId: true },
  })

  for (const pendente of pendentes) {
    await banco.item.update({ where: { id: pendente.itemId }, data: { status: 'aprovado' } })
    await banco.revisao.update({
      where: { id: pendente.id },
      data: { resolvidoEm: new Date() },
    })
  }

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
        entraNoRateio: categoria.entraNoRateio,
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
