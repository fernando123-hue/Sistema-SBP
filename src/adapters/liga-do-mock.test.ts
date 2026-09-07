import { describe, expect, it } from 'vitest'

import { EmailBrutoSchema, type EmailBruto } from '../core/esquemas'
import { IaMock } from './ia-mock'

/**
 * O adapter padrão não pode inventar liga.
 *
 * ═══ O DEFEITO, MEDIDO EM PRODUÇÃO LOCAL ═══
 *
 * `MENCAO_LIGA` tinha a flag `/i`, que anula a âncora de maiúscula: a expressão
 * agarrava qualquer texto depois da palavra "liga". Uma ingestão real com este
 * adapter — que é o PADRÃO do sistema — criou duas ligas no banco: `"Prezados"`,
 * com NOVE itens de e-mails sem relação nenhuma, e uma frase inteira de
 * solicitação.
 *
 * Com o `A4`, a liga é a unidade que não se separa. Os nove itens viravam UM
 * lote para uma pessoa só, como se fossem o mesmo assunto — o erro que
 * `core/ligas.ts` descreve como o que "ninguém descobre, nunca".
 */

function email(corpo: string, assunto = 'Assunto'): EmailBruto {
  return EmailBrutoSchema.parse({
    messageId: `liga-mock-${corpo.length}-${assunto}@teste.local`,
    remetente: 'alguem@exemplo.test',
    assunto,
    corpo,
    recebidoEm: new Date('2026-09-07T12:00:00.000Z'),
  })
}

async function ligaDetectada(corpo: string, assunto?: string): Promise<string | null> {
  const interpretacao = await new IaMock().interpretar(email(corpo, assunto))
  return interpretacao.itens[0]?.ligaMencionada ?? null
}

describe('detecção de liga no adapter padrão', () => {
  it('NÃO transforma a saudação em nome de liga', async () => {
    // A forma exata do defeito: "Liga Acadêmica" no fim de uma linha e
    // "Prezados" abrindo a seguinte.
    const detectada = await ligaDetectada(
      'Cadastro de Liga Acadêmica\n\nPrezados, seguem os dados solicitados.',
    )
    expect(detectada).not.toBe('Prezados')
  })

  it('NÃO transforma uma frase inteira em nome de liga', async () => {
    const detectada = await ligaDetectada(
      'Solicitamos o cadastro de liga acadêmica junto à associação.',
    )
    expect(detectada).toBeNull()
  })

  it('reconhece o nome próprio quando ele está escrito como nome próprio', async () => {
    expect(await ligaDetectada('Segue o quadro da Liga de Cardiologia para cadastro.')).toBe(
      'Cardiologia',
    )
  })

  it('reconhece o nome composto até a pontuação', async () => {
    expect(
      await ligaDetectada('Dados da Liga Acadêmica de Pediatria Neonatal, conforme pedido.'),
    ).toBe('Pediatria Neonatal')
  })

  it('não atravessa quebra de linha', async () => {
    const detectada = await ligaDetectada('Liga\nCardiologia da UFMG')
    expect(detectada).toBeNull()
  })

  it('prefere NENHUMA liga a uma liga errada', async () => {
    // A assimetria assumida: minúscula deixa de virar liga. Item sem liga é um
    // lote de um item só, inofensivo; item na liga errada é trabalho entregue
    // à pessoa errada, e ninguém descobre.
    expect(await ligaDetectada('segue a liga de cardiologia para cadastro')).toBeNull()
  })
})
