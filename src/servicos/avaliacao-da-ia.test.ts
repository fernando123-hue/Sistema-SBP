import { describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { CASOS_DO_GABARITO } from '../core/avaliacao/casos'
import type { CasoDoGabarito } from '../core/avaliacao/gabarito'
import type { EmailBruto, Interpretacao } from '../core/esquemas'
import { FalhaDeInterpretacao, InterpretacaoIndisponivelError, type AiPort } from '../ports/ia'
import { avaliarInterpretacao } from './avaliacao-da-ia'

/**
 * A avaliação roda qualquer `AiPort` contra o gabarito — sem rede aqui.
 *
 * O modelo real é exercitado só por `npm run ia:avaliar`, como o
 * `ia:experimentar`: nenhum teste automático chama API paga.
 */

const CASO: CasoDoGabarito = {
  id: 'duvida',
  descricao: 'dúvida',
  email: { assunto: 'Dúvida', corpo: 'Como emito o boleto?' },
  esperado: { itens: [{ categoriaCodigo: 'EMAIL_CADASTRO' }], suspeito: false },
}

function resposta(modelo = 'falso-1', versaoPrompt = 'p-1'): Interpretacao {
  return {
    itens: [
      {
        categoriaCodigo: 'EMAIL_CADASTRO',
        titulo: 'Dúvida',
        confianca: 0.9,
        campos: {},
        camposAusentes: [],
        ligaMencionada: null,
        observacao: null,
      },
    ],
    conteudoSuspeito: false,
    padroesSuspeitos: [],
    modelo,
    versaoPrompt,
  }
}

function porta(interpretar: (email: EmailBruto) => Promise<Interpretacao>): AiPort {
  return { nome: 'falsa', interpretar }
}

describe('avaliarInterpretacao', () => {
  it('pontua cada caso e diz qual adapter, modelo e prompt foram medidos', async () => {
    const resultado = await avaliarInterpretacao(porta(async () => resposta()), [CASO])
    expect(resultado.adapter).toBe('falsa')
    expect(resultado.modelos).toEqual(['falso-1'])
    expect(resultado.versoesPrompt).toEqual(['p-1'])
    expect(resultado.resumo.nota).toBe(1)
    expect(resultado.notas).toHaveLength(1)
  })

  it('manda à porta o e-mail do caso, e não outro', async () => {
    const vistos: string[] = []
    await avaliarInterpretacao(
      porta(async (email) => {
        vistos.push(`${email.messageId}|${email.assunto}|${email.corpo}`)
        return resposta()
      }),
      [CASO],
    )
    expect(vistos).toEqual(['gabarito-duvida@exemplo.test|Dúvida|Como emito o boleto?'])
  })

  it('falha de interpretação de um caso vira nota zero com o motivo, e os outros seguem', async () => {
    const outro: CasoDoGabarito = { ...CASO, id: 'outro' }
    const resultado = await avaliarInterpretacao(
      porta(async (email) => {
        if (email.messageId.includes('duvida')) throw new FalhaDeInterpretacao(email.messageId, 'fora do esquema')
        return resposta()
      }),
      [CASO, outro],
    )
    expect(resultado.resumo).toMatchObject({ casos: 2, falhas: 1, nota: 0.5, idsComFalha: ['duvida'] })
    expect(resultado.notas[0]?.motivo).toContain('fora do esquema')
  })

  it('fornecedor indisponível para tudo — é configuração, não nota', async () => {
    // Nota zero aqui esconderia uma chave errada atrás de "o modelo é ruim".
    await expect(
      avaliarInterpretacao(
        porta(async () => {
          throw new InterpretacaoIndisponivelError('chave recusada')
        }),
        [CASO],
      ),
    ).rejects.toBeInstanceOf(InterpretacaoIndisponivelError)
  })

  it('erro inesperado sobe — defeito de código não vira nota baixa em silêncio', async () => {
    await expect(
      avaliarInterpretacao(
        porta(async () => {
          throw new TypeError('bug')
        }),
        [CASO],
      ),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('resposta que não passa no esquema é falha do caso, mesmo que a porta não tenha validado', async () => {
    const resultado = await avaliarInterpretacao(
      porta(async () => ({ ...resposta(), itens: [{ ...resposta().itens[0]!, confianca: 7 }] })),
      [CASO],
    )
    expect(resultado.resumo.falhas).toBe(1)
  })

  it('chama um caso de cada vez, na ordem — camada gratuita tem limite por minuto', async () => {
    let emAndamento = 0
    let maximo = 0
    await avaliarInterpretacao(
      porta(async () => {
        emAndamento += 1
        maximo = Math.max(maximo, emAndamento)
        await new Promise((resolver) => setTimeout(resolver, 1))
        emAndamento -= 1
        return resposta()
      }),
      [CASO, { ...CASO, id: 'b' }, { ...CASO, id: 'c' }],
    )
    expect(maximo).toBe(1)
  })

  it('registra todos os modelos vistos, sem repetir', async () => {
    let vez = 0
    const resultado = await avaliarInterpretacao(
      porta(async () => resposta(vez++ === 0 ? 'a' : 'b')),
      [CASO, { ...CASO, id: 'b' }, { ...CASO, id: 'c' }],
    )
    expect(resultado.modelos).toEqual(['a', 'b'])
  })
})

describe('a nota do IaMock no gabarito — linha de base', () => {
  it('é fixa: mudar o mock ou o gabarito muda estes números de propósito', async () => {
    // Não é meta: é o ponto de comparação, caso a caso. O classificador por
    // regras erra onde falta a palavra-chave — é isso que um modelo precisa
    // resolver para valer o que custa.
    const resultado = await avaliarInterpretacao(new IaMock(), CASOS_DO_GABARITO)
    expect(resultado.resumo.falhas).toBe(0)
    expect(resultado.resumo.casos).toBe(CASOS_DO_GABARITO.length)
    expect(
      resultado.notas.map((nota) =>
        [nota.id, nota.quantidade, nota.categorias, nota.campos, nota.literalidade, nota.suspeita, nota.nota]
          .map(String)
          .join(' '),
      ),
    ).toMatchInlineSnapshot(`
      [
        "ficha-comum 1 1 1 1 1 1",
        "ficha-sem-cpf 1 1 1 1 1 1",
        "documentos-diploma 1 1 1 1 1 1",
        "documentos-sem-dados 1 0 null null 1 0.666667",
        "correcao-sem-injecao 1 1 null null 1 1",
        "duvida-anuidade 1 1 null null 1 1",
        "nova-liga 1 1 null null 1 1",
        "ligantes-tres 1 1 1 1 1 1",
        "ligantes-dois-tracos 1 1 1 1 1 1",
        "duvida-liga 1 1 null null 1 1",
        "injecao-na-ficha 1 1 1 1 1 1",
        "injecao-papel 1 1 null null 1 1",
        "ficha-sem-palavra-chave 1 0 1 1 1 0.8",
        "ligante-sem-palavra-chave 1 0 1 1 1 0.8",
        "liga-sem-palavra-chave 1 0 null null 1 0.666667",
        "lista-de-documentos 1 1 1 1 1 1",
        "injecao-sutil 1 1 null null 0 0.666667",
      ]
    `)
    expect(resultado.resumo.nota).toMatchInlineSnapshot(`0.917647`)
  })
})
