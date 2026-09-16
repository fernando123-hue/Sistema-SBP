import { describe, expect, it } from 'vitest'

import { TipoDeAfastamentoGravadoSchema } from './esquemas'
import {
  PRAZO_PADRAO_EM_DIAS,
  conteudoVenceu,
  diaEmQueOConteudoVence,
  diaEmQueOMotivoVence,
  exigirPrazoValido,
  motivoVenceu,
  textoDoConteudoRemovido,
  tipoDepoisDoPrazo,
} from './retencao'

/**
 * A fronteira do dia é onde o defeito de retenção mora: um dia a menos apaga o
 * motivo de quem a gestora ainda precisa acompanhar; um dia a mais guarda dado
 * de saúde além do que o dono decidiu (`A17`). Por isso cada caso abaixo fixa
 * a véspera E o dia.
 */

describe('quando o motivo de um afastamento vence', () => {
  it('férias de 01 a 10/09, prazo de 7 dias: volta em 11/09, vence em 18/09', () => {
    const ferias = { fim: '2026-09-10', canceladoNoDia: null }

    expect(diaEmQueOMotivoVence(ferias, 7)).toBe('2026-09-18')
    expect(motivoVenceu(ferias, '2026-09-17', 7)).toBe(false)
    expect(motivoVenceu(ferias, '2026-09-18', 7)).toBe(true)
  })

  it('falta de um dia só (fim igual ao início) conta da manhã seguinte', () => {
    const falta = { fim: '2026-09-01', canceladoNoDia: null }

    expect(diaEmQueOMotivoVence(falta, 7)).toBe('2026-09-09')
  })

  it('no prazo mais curto que o sistema aceita (5 dias), o motivo sai no quinto dia depois da volta', () => {
    const atestado = { fim: '2026-09-10', canceladoNoDia: null }

    // Volta em 11/09; com 5 dias, vence em 16/09 — na véspera, ainda não.
    expect(motivoVenceu(atestado, '2026-09-15', 5)).toBe(false)
    expect(motivoVenceu(atestado, '2026-09-16', 5)).toBe(true)
  })

  it('sem data de volta, o relógio não corre — por mais antiga que seja a saída', () => {
    const licenca = { fim: null, canceladoNoDia: null }

    expect(diaEmQueOMotivoVence(licenca, 7)).toBeNull()
    expect(motivoVenceu(licenca, '2030-01-01', 7)).toBe(false)
  })

  it('cancelado conta do cancelamento, mesmo com o fim registrado no futuro', () => {
    const feriasAdiadas = { fim: '2026-12-20', canceladoNoDia: '2026-09-05' }

    expect(diaEmQueOMotivoVence(feriasAdiadas, 7)).toBe('2026-09-12')
    expect(motivoVenceu(feriasAdiadas, '2026-09-11', 7)).toBe(false)
    expect(motivoVenceu(feriasAdiadas, '2026-09-12', 7)).toBe(true)
  })

  it('cancelado sem data de volta também conta do cancelamento', () => {
    expect(diaEmQueOMotivoVence({ fim: null, canceladoNoDia: '2026-09-05' }, 7)).toBe('2026-09-12')
  })

  it('atravessa virada de mês e de ano sem depender de fuso', () => {
    expect(diaEmQueOMotivoVence({ fim: '2026-12-28', canceladoNoDia: null }, 7)).toBe('2027-01-05')
  })
})

describe('o que sobra do tipo', () => {
  it('férias continua férias; todo o resto vira o mesmo ausente', () => {
    const reduzidos = TipoDeAfastamentoGravadoSchema.options.map((tipo) => [tipo, tipoDepoisDoPrazo(tipo)])

    expect(Object.fromEntries(reduzidos)).toEqual({
      ferias: 'ferias',
      falta: 'ausente',
      atestado: 'ausente',
      licenca: 'ausente',
      outro: 'ausente',
      ausente: 'ausente',
    })
  })
})

describe('prazo inválido é recusado antes de qualquer conta', () => {
  // 1 e 4 são o piso de `A45`: abaixo de 5 dias, um feriado prolongado consome o
  // prazo inteiro e o dado sai sem um único dia útil em que alguém pudesse ver.
  it.each([0, 1, 4, -30, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3651])('recusa %s', (dias) => {
    expect(() => exigirPrazoValido(dias)).toThrow(/Prazo de retenção inválido/)
    expect(() => diaEmQueOMotivoVence({ fim: '2026-09-10', canceladoNoDia: null }, dias)).toThrow(
      /Prazo de retenção inválido/,
    )
  })

  it.each([5, 7, 3650])('aceita %s', (dias) => {
    expect(() => exigirPrazoValido(dias)).not.toThrow()
  })

  it('o padrão decidido em A17 é 7 dias', () => {
    expect(PRAZO_PADRAO_EM_DIAS.motivo_de_afastamento).toBe(7)
  })

  it('o padrão decidido em A20 é 7 dias', () => {
    expect(PRAZO_PADRAO_EM_DIAS.conteudo_do_email).toBe(7)
  })
})

describe('quando o conteúdo de um e-mail vence (A20)', () => {
  const concluido = (dia: string) => ({ aberto: false as const, terminouNoDia: dia })
  const aberto = { aberto: true as const }

  it('último item concluído em 12/09, prazo de 7 dias: sai em 19/09 — na véspera, não', () => {
    const email = {
      recebidoNoDia: '2026-09-01',
      conteudoSuspeito: false,
      itens: [concluido('2026-09-05'), concluido('2026-09-12')],
    }

    expect(diaEmQueOConteudoVence(email, 7)).toBe('2026-09-19')
    expect(conteudoVenceu(email, '2026-09-18', 7)).toBe(false)
    expect(conteudoVenceu(email, '2026-09-19', 7)).toBe(true)
  })

  it('um item aberto segura o relógio, mesmo com o irmão concluído há meses', () => {
    const email = { recebidoNoDia: '2026-06-01', conteudoSuspeito: false, itens: [concluido('2026-06-02'), aberto] }

    expect(diaEmQueOConteudoVence(email, 7)).toBeNull()
    expect(conteudoVenceu(email, '2030-01-01', 7)).toBe(false)
  })

  it('e-mail que não virou item conta da chegada', () => {
    const email = { recebidoNoDia: '2026-09-10', conteudoSuspeito: false, itens: [] }

    expect(diaEmQueOConteudoVence(email, 7)).toBe('2026-09-17')
  })

  it('e-mail SUSPEITO que não virou item não vence: espera uma pessoa decidir (A34)', () => {
    const email = { recebidoNoDia: '2026-01-01', conteudoSuspeito: true, itens: [] }

    expect(diaEmQueOConteudoVence(email, 7)).toBeNull()
  })

  it('e-mail suspeito que virou item segue o relógio dos itens', () => {
    const email = { recebidoNoDia: '2026-09-01', conteudoSuspeito: true, itens: [concluido('2026-09-10')] }

    expect(diaEmQueOConteudoVence(email, 7)).toBe('2026-09-17')
  })

  it('recusa prazo inválido', () => {
    expect(() => diaEmQueOConteudoVence({ recebidoNoDia: '2026-09-01', conteudoSuspeito: false, itens: [] }, 0)).toThrow(
      /Prazo de retenção inválido/,
    )
  })
})

describe('o aviso onde o texto do e-mail aparecia', () => {
  it('diz quando saiu e quando o original chegou, com a hora de Brasília', () => {
    // 13h UTC de 20/09 é 10h em Brasília; 12h14 UTC de 12/09 é 09:14.
    expect(
      textoDoConteudoRemovido(new Date('2026-09-20T13:00:00Z'), new Date('2026-09-12T12:14:00Z')),
    ).toBe(
      'O texto deste e-mail já foi apagado do sistema no dia 20/09. Para ver o e-mail completo, procure no Outlook: ele chegou no dia 12/09, às 09:14.',
    )
  })

  it('chegada às 22h de Brasília continua no mesmo dia, e não no seguinte', () => {
    // 01h UTC de 13/09 é 22h de 12/09 em Brasília.
    expect(textoDoConteudoRemovido(new Date('2026-09-20T13:00:00Z'), new Date('2026-09-13T01:00:00Z'))).toContain(
      'chegou no dia 12/09, às 22:00',
    )
  })
})
