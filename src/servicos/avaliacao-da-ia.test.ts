import { describe, expect, it } from 'vitest'

import { IaMock } from '../adapters/ia-mock'
import { CASOS_DO_GABARITO } from '../core/avaliacao/casos'
import type { CasoDoGabarito } from '../core/avaliacao/gabarito'
import type { EmailBruto, Interpretacao } from '../core/esquemas'
import { FalhaDeInterpretacao, InterpretacaoIndisponivelError, type AiPort } from '../ports/ia'
import { avaliarInterpretacao, resumirMedicoes } from './avaliacao-da-ia'

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

/**
 * Duas medidas que a nota não dá e que a linha de chegada pede (`ESTADO.md`,
 * item 4 da lista "o que falta"): quanto tempo cada e-mail leva — decide se a
 * sincronização vira rotina em segundo plano — e quantos itens a conferência
 * da pendência 17 manda para a Revisão que, sem ela, entrariam aprovados.
 */
describe('tempo por caso e efeito da conferência (pendência 17)', () => {
  function relogio(...marcas: number[]): () => number {
    const fila = [...marcas]
    return () => {
      const proxima = fila.shift()
      if (proxima === undefined) throw new Error('relógio do teste sem marca')
      return proxima
    }
  }

  function comCampos(campos: Record<string, string>, confianca = 0.99): Interpretacao {
    const base = resposta()
    return { ...base, itens: [{ ...base.itens[0]!, confianca, campos }] }
  }

  const CASO_COM_CPF: CasoDoGabarito = {
    ...CASO,
    id: 'com-cpf',
    email: { assunto: 'Cadastro', corpo: 'Sou Ana Lima, CPF 529.982.247-25.' },
  }

  it('mede o tempo de cada chamada, também quando ela falha', async () => {
    let vez = 0
    const resultado = await avaliarInterpretacao(
      porta(async () => {
        vez += 1
        if (vez === 2) throw new FalhaDeInterpretacao('x', 'laço cortado pelo teto')
        return resposta()
      }),
      [CASO, { ...CASO, id: 'segundo' }],
      relogio(1000, 1250, 2000, 2900),
    )
    expect(resultado.medicoes.map((m) => [m.id, m.ms])).toEqual([
      ['duvida', 250],
      ['segundo', 900],
    ])
    expect(resultado.medicoes[1]!.conferencia).toBeNull()
  })

  it('valor que está no texto não muda o destino', async () => {
    const resultado = await avaliarInterpretacao(
      porta(async () => comCampos({ nome: 'Ana Lima', cpf: '529.982.247-25' })),
      [CASO_COM_CPF],
      relogio(0, 10),
    )
    expect(resultado.medicoes[0]!.conferencia).toEqual({
      itens: 1,
      comProblema: 0,
      mudamDeDestino: 0,
      motivos: {},
    })
  })

  it('valor reescrito que entraria aprovado passa a ir para a Revisão — e é contado', async () => {
    const resultado = await avaliarInterpretacao(
      porta(async () => comCampos({ nome: 'Ana Maria Lima' })),
      [CASO_COM_CPF],
      relogio(0, 10),
    )
    expect(resultado.medicoes[0]!.conferencia).toEqual({
      itens: 1,
      comProblema: 1,
      mudamDeDestino: 1,
      motivos: { valor_fora_do_texto: 1 },
    })
  })

  it('item que já iria para a Revisão por outro motivo tem problema, mas não muda de destino', async () => {
    const resultado = await avaliarInterpretacao(
      porta(async () => comCampos({ nome: 'Ana Maria Lima' }, 0.3)),
      [CASO_COM_CPF],
      relogio(0, 10),
    )
    expect(resultado.medicoes[0]!.conferencia).toMatchObject({ comProblema: 1, mudamDeDestino: 0 })
  })

  // Os outros gatilhos já mandam à Revisão: o problema conta, a mudança não.
  // Sem estes, a medição poderia ignorar um gatilho da ingestão e ninguém
  // perceberia (revisão técnica do #166).
  it.each([
    [
      'conteúdo suspeito',
      (base: Interpretacao): Interpretacao => ({ ...base, conteudoSuspeito: true }),
    ],
    [
      'campo ausente',
      (base: Interpretacao): Interpretacao => ({ ...base, itens: [{ ...base.itens[0]!, camposAusentes: ['cpf'] }] }),
    ],
    [
      'desdobramento (mais de um item)',
      (base: Interpretacao): Interpretacao => ({ ...base, itens: [base.itens[0]!, { ...base.itens[0]!, titulo: 'Outro' }] }),
    ],
  ])('com %s, o item com problema não conta como mudança de destino', async (_nome, ajustar) => {
    const resultado = await avaliarInterpretacao(
      porta(async () => ajustar(comCampos({ nome: 'Ana Maria Lima' }))),
      [CASO_COM_CPF],
      relogio(0, 10),
    )
    const conferencia = resultado.medicoes[0]!.conferencia!
    expect(conferencia.comProblema).toBeGreaterThan(0)
    expect(conferencia.mudamDeDestino).toBe(0)
  })

  it('CPF com dígito trocado conta como cpf_invalido', async () => {
    const resultado = await avaliarInterpretacao(
      porta(async () => comCampos({ cpf: '529.982.247-26' })),
      [{ ...CASO_COM_CPF, email: { assunto: 'Cadastro', corpo: 'CPF 529.982.247-26.' } }],
      relogio(0, 10),
    )
    expect(resultado.medicoes[0]!.conferencia?.motivos).toEqual({ cpf_invalido: 1 })
  })

  it('o resumo dá mediana, máximo e total do tempo, e soma o efeito só dos casos respondidos', () => {
    const conferencia = { itens: 3, comProblema: 2, mudamDeDestino: 1, motivos: {} }
    expect(
      resumirMedicoes([
        { id: 'a', ms: 300, conferencia },
        { id: 'b', ms: 100, conferencia: null },
        { id: 'c', ms: 200, conferencia },
        { id: 'd', ms: 900, conferencia },
      ]),
    ).toEqual({ msMediana: 250, msMaximo: 900, msTotal: 1500, itens: 9, comProblema: 6, mudamDeDestino: 3 })
    expect(resumirMedicoes([{ id: 'a', ms: 7, conferencia: null }]).msMediana).toBe(7)
    expect(resumirMedicoes([])).toEqual({ msMediana: 0, msMaximo: 0, msTotal: 0, itens: 0, comProblema: 0, mudamDeDestino: 0 })
  })

  it('o resultado inteiro não carrega texto do e-mail, valor extraído nem nome de campo', async () => {
    const resultado = await avaliarInterpretacao(
      porta(async () => comCampos({ apelidoSintetico: 'Ana Maria Lima', cpf: '529.982.247-25' })),
      [CASO_COM_CPF],
      relogio(0, 10),
    )
    // O resultado inteiro, e não só `medicoes`: é tudo isto que o `--json`
    // imprime (revisão de segurança do #166).
    const serializado = JSON.stringify(resultado)
    expect(resultado.medicoes[0]!.conferencia?.comProblema).toBe(1)
    expect(serializado).not.toContain('Ana')
    expect(serializado).not.toContain('Lima')
    expect(serializado).not.toContain('529')
    expect(serializado).not.toContain('apelidoSintetico')
    expect(serializado).not.toContain('Sou ')
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
        "agradecimento 1 1 null null 1 1",
        "resposta-automatica-ausencia 0 0 null null 1 0.333333",
        "confirmacao-automatica 0 0 null null 1 0.333333",
        "fichas-duas-pessoas 0 0.5 0.5 1 1 0.6",
        "documentos-duas-pessoas 0 0 0 null 1 0.25",
        "ligantes-quatro-em-linha 0 0.25 0 null 1 0.3125",
        "segunda-via-duas-pessoas 0 0.5 0 null 1 0.375",
      ]
    `)
    expect(resultado.resumo.nota).toMatchInlineSnapshot(`0.783507`)
  })
})
