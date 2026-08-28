import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConservacaoVioladaError, SemElegiveisError } from '../core/erros'
import { obterPrisma } from '../servidor/prisma'
import { DATA_BASE, aprovarTudoNoBanco, limparTudo, semearBase } from '../testes/apoio'
import { IaMock } from '../adapters/ia-mock'
import { IngestaoMock } from '../adapters/ingestao-mock'
import { sequenciaDeDatas } from '../core/util/datas'
import { sincronizar } from './ingestao'

/**
 * O que o planejamento engole e o que ele deixa subir.
 *
 * `planejarCategoria` envolve a chamada ao motor num `try/catch`. Isso é certo
 * para UMA situação — ninguém de plantão hoje — e errado para todas as outras.
 *
 * `ConservacaoVioladaError` é a trava que materializa o invariante nº 3 do
 * projeto, o único que o `CLAUDE.md` descreve como razão de o sistema existir.
 * Se ela for capturada junto com o resto, uma violação de conservação vira uma
 * linha de log de nível `aviso`, indistinguível de um dia sem escala — e a
 * categoria inteira é pulada em silêncio, com os itens presos na fila.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
  vi.restoreAllMocks()
})

async function prepararDia() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const datas = sequenciaDeDatas(DATA_BASE, 1)
  await sincronizar(
    { banco, ingestao: new IngestaoMock({ datas, semente: 5 }), ia: new IaMock() },
    base.operador,
  )
  await aprovarTudoNoBanco(banco)
  return { base, data: datas[0]! }
}

describe('violação de conservação não pode virar aviso de rotina', () => {
  it('sobe inteira em vez de virar "categoria não distribuída"', async () => {
    const { base, data } = await prepararDia()

    const motor = await import('../core/distribuicao/motor')
    vi.spyOn(motor, 'distribuir').mockImplementation(() => {
      throw new ConservacaoVioladaError(10, 9, { alguem: 9 })
    })

    const { previa } = await import('./distribuicao')

    // Engolir aqui apagaria a única prova de que o motor errou. O operador
    // veria "categoria não distribuída hoje" com a mesma cara de um dia sem
    // plantão, e os itens ficariam presos sem ninguém saber por quê.
    await expect(previa(banco, { data, categorias: [] }, base.operador)).rejects.toThrow(
      ConservacaoVioladaError,
    )
  })

  it('mas "ninguém de plantão" continua sendo resultado, não exceção', async () => {
    const { base, data } = await prepararDia()

    // Ninguém disponível: é situação de operação, não defeito. O trabalho fica
    // na fila e a tela diz por categoria o que aconteceu — que é o oposto do
    // que a planilha faz quando perde 16 itens de LIGA.
    await banco.escala.updateMany({ where: { data }, data: { disponivel: false } })

    const relatorio = await previaDoModulo(banco, { data, categorias: [] }, base.operador)
    const comErro = relatorio.planos.filter((plano) => plano.erro)

    expect(comErro.length).toBeGreaterThan(0)
    expect(comErro[0]!.erro).toContain('Nenhum colaborador elegível')
    expect(new SemElegiveisError('X', data).message).toContain('Nenhum colaborador elegível')
  })
})

/** Import tardio para não colidir com o `vi.spyOn` do teste anterior. */
async function previaDoModulo(
  ...argumentos: Parameters<typeof import('./distribuicao').previa>
): ReturnType<typeof import('./distribuicao').previa> {
  const { previa } = await import('./distribuicao')
  return previa(...argumentos)
}
