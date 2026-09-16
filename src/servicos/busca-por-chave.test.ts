import { beforeEach, describe, expect, it } from 'vitest'

import { MENSAGEM_BUSCA_NAO_RECONHECIDA, MENSAGEM_CPF_NAO_CONFERE } from '../core/busca-por-chave'
import { protegerCpf } from '../servidor/cpf-protegido'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { buscarPorChave } from './caixa'

/**
 * A busca por CPF ou matrícula, no serviço (`A23(b)`, `A40` resposta 24).
 *
 * É o que deixa a equipe achar um item antigo depois que o texto do e-mail
 * saiu. Usa a mesma leitura da Caixa, com um filtro a mais — e desde a fase 2 a
 * busca HERDA o recorte de `A24`: quem procura só acha o que já podia ver na
 * Caixa. Os casos abaixo rodam como operadora, que vê tudo; o recorte do
 * colaborador tem teste próprio em `quem-ve-o-que.test.ts`.
 */

const banco = obterPrisma()

const CPF_A = '111.444.777-35'
const CPF_B = '529.982.247-25'

beforeEach(async () => {
  await limparTudo(banco)
})

async function preparar() {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const categoria = await banco.categoria.findUniqueOrThrow({ where: { codigo: 'DOC_CADASTRO' } })

  const criar = (titulo: string, dados: { cpfProtegido?: string | null; matricula?: string | null }) =>
    banco.item.create({
      data: { categoriaId: categoria.id, titulo, status: 'aprovado', confianca: 1, ...dados },
      select: { id: true },
    })

  const doA = await criar('Documento do associado A', { cpfProtegido: protegerCpf(CPF_A) })
  const outroDoA = await criar('Outro documento do associado A', { cpfProtegido: protegerCpf(CPF_A) })
  const doB = await criar('Documento do associado B', { cpfProtegido: protegerCpf(CPF_B), matricula: '12345' })
  await criar('Documento sem chave', {})

  return { base, doA, outroDoA, doB }
}

describe('busca por CPF ou matrícula', () => {
  it('acha pelo CPF digitado de qualquer jeito, e só os itens daquele CPF', async () => {
    const { base, doA, outroDoA } = await preparar()

    const comPontos = await buscarPorChave(banco, { texto: CPF_A }, base.operador)
    expect(new Set(comPontos.map((item) => item.itemId))).toEqual(new Set([doA.id, outroDoA.id]))

    const semPontos = await buscarPorChave(banco, { texto: '11144477735' }, base.operador)
    expect(semPontos).toHaveLength(2)
  })

  it('acha pela matrícula', async () => {
    const { base, doB } = await preparar()

    const achados = await buscarPorChave(banco, { texto: '12.345' }, base.operador)
    expect(achados.map((item) => item.itemId)).toEqual([doB.id])
  })

  it('nada encontrado é lista vazia, não erro', async () => {
    const { base } = await preparar()
    expect(await buscarPorChave(banco, { texto: '9876' }, base.operador)).toEqual([])
  })

  it('CPF que não confere: frase clara, sem procurar e sem repetir o número', async () => {
    const { base } = await preparar()
    await expect(buscarPorChave(banco, { texto: '111.444.777-36' }, base.operador)).rejects.toThrow(
      MENSAGEM_CPF_NAO_CONFERE,
    )
  })

  it('texto que não é CPF nem matrícula: frase clara', async () => {
    const { base } = await preparar()
    await expect(buscarPorChave(banco, { texto: 'Helena Prado' }, base.operador)).rejects.toThrow(
      MENSAGEM_BUSCA_NAO_RECONHECIDA,
    )
  })

  it('texto comprido demais é recusado antes de qualquer consulta', async () => {
    const { base } = await preparar()
    await expect(buscarPorChave(banco, { texto: '1'.repeat(200) }, base.operador)).rejects.toThrow()
  })
})
