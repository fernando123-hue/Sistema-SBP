import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'

import { RespostaDoModeloAssistenteSchema } from '../core/assistente/esquemas'
import { EmailBrutoSchema } from '../core/esquemas'
import { InterpretadorEstruturado, RespostaDoModeloSchema, type ClienteDeModelo } from './ia-estruturada'
import { PERFIL_ANTHROPIC } from './ia-anthropic'

/**
 * Achado C-01 (`docs/auditoria/2026-09-17-achados-da-auditoria-por-agentes.md`).
 *
 * A saída estruturada da Anthropic (`zodOutputFormat`) fecha TODO objeto com
 * `additionalProperties: false`. Um `z.record` vira um objeto fechado sem
 * propriedade nenhuma, e a decodificação restrita só deixa o modelo escrever
 * `{}` ali. Era o caso de `campos`: com `IA_ADAPTER=anthropic`, nome, CPF e CRM
 * nunca eram extraídos, e nada acusava. O duble dos outros testes não passa
 * pelo SDK, por isso nenhum deles via.
 *
 * Estes testes olham a forma DEPOIS da transformação do SDK — a que a API
 * recebe de verdade.
 */

type NoDeEsquema = Record<string, unknown>

/** Todo objeto fechado que não declara propriedade nenhuma: só aceita `{}`. */
function objetosFechadosVazios(no: unknown, caminho = '$'): string[] {
  if (Array.isArray(no)) return no.flatMap((filho, i) => objetosFechadosVazios(filho, `${caminho}[${i}]`))
  if (no === null || typeof no !== 'object') return []
  const objeto = no as NoDeEsquema
  const proprios =
    objeto['type'] === 'object' &&
    objeto['additionalProperties'] === false &&
    Object.keys((objeto['properties'] as NoDeEsquema | undefined) ?? {}).length === 0
      ? [caminho]
      : []
  return [
    ...proprios,
    ...Object.entries(objeto).flatMap(([chave, filho]) => objetosFechadosVazios(filho, `${caminho}.${chave}`)),
  ]
}

describe('forma enviada à saída estruturada da Anthropic', () => {
  it.each([
    ['interpretação de e-mail', RespostaDoModeloSchema],
    ['assistente', RespostaDoModeloAssistenteSchema],
  ])('%s: nenhum objeto sai fechado e vazio', (_nome, esquema) => {
    expect(objetosFechadosVazios(zodOutputFormat(esquema).schema)).toEqual([])
  })

  it('campos viaja como lista de pares chave/valor', () => {
    const forma = JSON.stringify(zodOutputFormat(RespostaDoModeloSchema).schema)
    expect(forma).toContain('"chave"')
    expect(forma).toContain('"valor"')
  })
})

const EMAIL = EmailBrutoSchema.parse({
  messageId: 'c01@exemplo.test',
  remetente: 'alguem@exemplo.test',
  assunto: 'Ficha',
  corpo: 'Nome: Fulano Sintético. CPF 000.000.000-00',
  recebidoEm: new Date('2026-09-17T12:00:00.000Z'),
})

function item(campos: unknown): unknown {
  return {
    categoriaCodigo: 'FICHA_CADASTRO',
    titulo: 'Ficha',
    confianca: 0.9,
    campos,
    camposAusentes: [],
    ligaMencionada: null,
    observacao: null,
  }
}

function cliente(respostas: unknown[]): ClienteDeModelo & { chamadas: number } {
  const estado = { chamadas: 0 }
  return {
    get chamadas() {
      return estado.chamadas
    },
    async gerar() {
      const atual = respostas[Math.min(estado.chamadas, respostas.length - 1)]
      estado.chamadas += 1
      return { objeto: atual, modeloUsado: 'modelo-de-teste' }
    },
  }
}

describe('campos: pares do modelo viram o mapa do sistema', () => {
  it('os pares chegam à interpretação como mapa', async () => {
    const duble = cliente([
      {
        itens: [
          item([
            { chave: 'nome', valor: 'Fulano Sintético' },
            { chave: 'cpf', valor: '000.000.000-00' },
          ]),
        ],
        pareceInstrucao: false,
      },
    ])

    const interpretacao = await new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)

    expect(interpretacao.itens[0]!.campos).toEqual({ nome: 'Fulano Sintético', cpf: '000.000.000-00' })
  })

  it('lista vazia vira mapa vazio, e campos omitido também', async () => {
    const duble = cliente([{ itens: [item([]), { ...(item([]) as object), campos: undefined }], pareceInstrucao: false }])

    const interpretacao = await new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)

    expect(interpretacao.itens.map((i) => i.campos)).toEqual([{}, {}])
  })

  it('chave repetida é defeito de forma: repete uma vez e depois falha alto', async () => {
    const repetida = {
      itens: [
        item([
          { chave: 'cpf', valor: '000.000.000-00' },
          { chave: 'cpf', valor: '111.111.111-11' },
        ]),
      ],
      pareceInstrucao: false,
    }
    const duble = cliente([repetida, repetida])

    await expect(new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)).rejects.toThrow()
    expect(duble.chamadas).toBe(2)
  })

  it('o mapa antigo não é mais aceito do modelo', async () => {
    const antigo = { itens: [item({ cpf: '000.000.000-00' })], pareceInstrucao: false }
    const duble = cliente([antigo, antigo])

    await expect(new InterpretadorEstruturado(PERFIL_ANTHROPIC, duble).interpretar(EMAIL)).rejects.toThrow()
  })
})
