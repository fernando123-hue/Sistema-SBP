import { CATEGORIAS_CADASTRO } from '../src/core/config'
import { sequenciaDeDatas } from '../src/core/util/datas'
import { obterPrisma } from '../src/servidor/prisma'

/**
 * Seed.
 *
 * TODOS os dados são SINTÉTICOS. Nenhum colaborador, associado, liga ou e-mail
 * real da associação entra no repositório — nem aqui, nem em teste, nem em
 * fixture. A ESTRUTURA imita a operação real (equipe pequena, habilitações
 * desiguais, 2 a 3 pessoas de plantão por dia); os DADOS são inventados.
 */

/** Espelha o padrão observado: nem todo mundo opera todas as categorias. */
const EQUIPE = [
  {
    nome: 'Ana Ribeiro Salgado',
    email: 'ana.operadora@exemplo.test',
    papel: 'operador',
    categorias: ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA'],
  },
  {
    nome: 'Bianca Toledo Marques',
    email: 'bianca@exemplo.test',
    papel: 'colaborador',
    categorias: ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGA', 'LIGANTE', 'EMAIL_LIGA'],
  },
  {
    nome: 'Caio Bernardes Villas',
    email: 'caio@exemplo.test',
    papel: 'colaborador',
    categorias: ['DOC_CADASTRO', 'FICHA_CADASTRO', 'EMAIL_CADASTRO', 'LIGANTE'],
  },
  {
    nome: 'Dora Menezes Aguiar',
    email: 'dora@exemplo.test',
    papel: 'colaborador',
    categorias: ['LIGA', 'LIGANTE', 'EMAIL_LIGA'],
  },
  {
    // Reproduz o caso "só LIGANTE" dos blocos que ignoram Mov. Extra na planilha.
    nome: 'Elias Farias Quadros',
    email: 'elias@exemplo.test',
    papel: 'colaborador',
    categorias: ['LIGANTE'],
  },
  {
    nome: 'Fabiana Loureiro Sena',
    email: 'fabiana.gestora@exemplo.test',
    papel: 'gestor',
    categorias: [],
  },
] as const

export const DATA_INICIAL = '2026-09-01'
export const TOTAL_DE_DIAS = 30

async function principal(): Promise<void> {
  const banco = obterPrisma()

  for (const [posicao, categoria] of CATEGORIAS_CADASTRO.entries()) {
    await banco.categoria.upsert({
      where: { codigo: categoria.codigo },
      create: {
        codigo: categoria.codigo,
        rotulo: categoria.rotulo,
        frente: categoria.frente,
        grupo: categoria.grupo,
        ordem: posicao,
        divisivel: categoria.divisivel,
        peso: categoria.peso,
        limiarIndivisivel: categoria.limiarIndivisivel,
        entraNoRateio: categoria.entraNoRateio,
      },
      update: { rotulo: categoria.rotulo, ordem: posicao },
    })
  }

  const datas = sequenciaDeDatas(DATA_INICIAL, TOTAL_DE_DIAS)

  for (const [posicao, pessoa] of EQUIPE.entries()) {
    const colaborador = await banco.colaborador.upsert({
      where: { email: pessoa.email },
      create: { nome: pessoa.nome, email: pessoa.email, papel: pessoa.papel },
      update: { nome: pessoa.nome, papel: pessoa.papel },
    })

    for (const codigo of pessoa.categorias) {
      const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo } })
      const vigenciaInicio = new Date(`${DATA_INICIAL}T00:00:00.000Z`)

      await banco.habilitacao.upsert({
        where: {
          colaboradorId_categoriaId_vigenciaInicio: {
            colaboradorId: colaborador.id,
            categoriaId: categoria.id,
            vigenciaInicio,
          },
        },
        create: { colaboradorId: colaborador.id, categoriaId: categoria.id, vigenciaInicio },
        update: { podeReceber: true },
      })
    }

    if (pessoa.categorias.length === 0) continue

    // Escala determinística: 3 pessoas por dia, rodando. Reproduz o `J = 2..3`
    // da planilha sem que ninguém precise editar fórmula para trocar o plantão.
    for (const [diaIndice, data] of datas.entries()) {
      const disponivel = (diaIndice + posicao) % 5 < 3

      await banco.escala.upsert({
        where: { data_colaboradorId: { data, colaboradorId: colaborador.id } },
        create: { data, colaboradorId: colaborador.id, disponivel },
        update: { disponivel },
      })
    }
  }

  const totais = {
    categorias: await banco.categoria.count(),
    colaboradores: await banco.colaborador.count(),
    habilitacoes: await banco.habilitacao.count(),
    escalas: await banco.escala.count(),
  }

  process.stdout.write(`Seed concluído: ${JSON.stringify(totais)}\n`)
}

principal().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  process.exitCode = 1
})
