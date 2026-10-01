import { describe, expect, it } from 'vitest'

import { ClassificadorExterno } from '../adapters/classificador-externo'
import { clienteMock, PERFIL_MOCK } from '../adapters/classificador-mock'
import { CASOS_DO_GABARITO } from '../core/avaliacao/casos'
import { QUANTIDADES } from '../core/avaliacao/classificacao'
import {
  ClassificadorIndisponivelError,
  FalhaDeClassificacao,
  type ClassificadorPort,
  type PedidoDeClassificacao,
} from '../ports/classificador'
import {
  avaliarClassificador,
  PERGUNTA_DE_QUANTIDADE,
  PERGUNTAS_DA_AVALIACAO,
  VERSAO_DAS_PERGUNTAS_DA_AVALIACAO,
} from './avaliacao-do-classificador'
import { PERGUNTAS_DA_INGESTAO, VERSAO_DAS_PERGUNTAS } from './segunda-opiniao'

/**
 * A avaliação do classificador no gabarito (`A70`, P2). Sem rede: o dublê
 * passa pela mesma política do fornecedor de verdade.
 */

describe('as perguntas da avaliação', () => {
  it('são as da ingestão mais a de quantidade, congeladas, e a versão diz isso', () => {
    expect(Object.keys(PERGUNTAS_DA_AVALIACAO).sort()).toEqual(['categoria', 'quantidade', 'suspeita'])
    expect(PERGUNTAS_DA_AVALIACAO.categoria).toBe(PERGUNTAS_DA_INGESTAO.categoria)
    expect(PERGUNTAS_DA_AVALIACAO.suspeita).toBe(PERGUNTAS_DA_INGESTAO.suspeita)
    expect(Object.isFrozen(PERGUNTAS_DA_AVALIACAO)).toBe(true)
    expect(Object.isFrozen(PERGUNTA_DE_QUANTIDADE)).toBe(true)
    expect(Object.isFrozen(PERGUNTA_DE_QUANTIDADE.opcoes)).toBe(true)
    expect(VERSAO_DAS_PERGUNTAS_DA_AVALIACAO.startsWith(`${VERSAO_DAS_PERGUNTAS}+`)).toBe(true)
  })

  // Uma opção a mais na pergunta, sem a nota saber dela, viraria erro calado.
  it('as opções da pergunta de quantidade são, na ordem, as que a nota conhece', () => {
    expect(Object.keys(PERGUNTA_DE_QUANTIDADE.opcoes)).toEqual([...QUANTIDADES])
  })
})

describe('avaliarClassificador', () => {
  it('o dublê dá a linha de base: um caso por chamada, só com as perguntas da avaliação', async () => {
    const pedidos: PedidoDeClassificacao[] = []
    const mock = new ClassificadorExterno(PERFIL_MOCK, clienteMock())
    const porta: ClassificadorPort = {
      fornecedor: mock.fornecedor,
      classificar: (pedido) => {
        pedidos.push(pedido)
        return mock.classificar(pedido)
      },
    }

    let agora = 0
    const resultado = await avaliarClassificador(porta, CASOS_DO_GABARITO, () => (agora += 5))

    expect(pedidos).toHaveLength(CASOS_DO_GABARITO.length)
    for (const pedido of pedidos) expect(pedido.perguntas).toBe(PERGUNTAS_DA_AVALIACAO)
    expect(pedidos[0]!.texto).toContain('Assunto:')

    expect(resultado).toMatchObject({ fornecedor: 'mock', modelos: ['mock-1'], versaoDasPerguntas: VERSAO_DAS_PERGUNTAS_DA_AVALIACAO })
    // O dublê responde sempre o primeiro rótulo: "nenhum" nunca está certo no gabarito.
    expect(resultado.resumo.porPergunta.quantidade).toMatchObject({ acerto: 0, probabilidadeDaCerta: 0 })
    expect(resultado.resumo).toMatchObject({ falhas: 0, tempoMedioMs: 5 })
  })

  it('a falha de UM e-mail vira nota de falha; o resto segue', async () => {
    const mock = new ClassificadorExterno(PERFIL_MOCK, clienteMock())
    let chamada = 0
    const porta: ClassificadorPort = {
      fornecedor: 'teste',
      classificar: async (pedido) => {
        chamada++
        if (chamada === 2) throw new FalhaDeClassificacao('logprobs: invalid_type')
        return mock.classificar(pedido)
      },
    }
    const resultado = await avaliarClassificador(porta, CASOS_DO_GABARITO.slice(0, 3))
    expect(resultado.notas.map((nota) => nota.falhou)).toEqual([false, true, false])
    expect(resultado.notas[1]!.motivo).toBe('logprobs: invalid_type')
    expect(resultado.resumo.falhas).toBe(1)
  })

  // Nota zero esconderia um servidor desligado atrás de "o modelo é ruim".
  it('classificador indisponível e defeito sobem, em vez de virar nota', async () => {
    const indisponivel: ClassificadorPort = {
      fornecedor: 'teste',
      classificar: async () => {
        throw new ClassificadorIndisponivelError('servidor recusou', 'credencial')
      },
    }
    await expect(avaliarClassificador(indisponivel)).rejects.toBeInstanceOf(ClassificadorIndisponivelError)

    const defeito: ClassificadorPort = {
      fornecedor: 'teste',
      classificar: async () => {
        throw new TypeError('defeito nosso')
      },
    }
    await expect(avaliarClassificador(defeito)).rejects.toBeInstanceOf(TypeError)
  })
})
