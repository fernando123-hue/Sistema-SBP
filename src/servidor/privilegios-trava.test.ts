import { describe, expect, it } from 'vitest'

import { conferirTravaDaTrilha, corpoDaTrava, type TriggerNoBanco } from './privilegios'

/**
 * A conferência de que a trava da trilha está como a migração a deixa
 * (`AT-66`, revisões do #184).
 *
 * A trava pode sumir sem a aplicação perceber: uma migração que parou no meio
 * e foi dada como aplicada à mão, ou uma restauração de backup interrompida.
 * `npm run db:conferir-trilha` lê `information_schema.TRIGGERS` e passa por
 * aqui; estes casos decidem se ela acusa o que precisa, e só isso.
 */

type Tabela = 'LogAuditoria' | 'EventoProcessamento'

/** O corpo como o MySQL o devolve: com as quebras de linha da migração. */
const CORPO = (tabela: Tabela): string =>
  `BEGIN\n  SIGNAL SQLSTATE '45000'\n  SET MESSAGE_TEXT = '${tabela} e append-only: grave um registro novo em vez de alterar o passado';\nEND`

function trava(tabela: Tabela, mudar: Partial<TriggerNoBanco> = {}): TriggerNoBanco {
  return { nome: `${tabela}_recusa_update`, tabela, evento: 'UPDATE', momento: 'BEFORE', corpo: CORPO(tabela), ...mudar }
}

const AS_DUAS = [trava('LogAuditoria'), trava('EventoProcessamento')]
const LIMPA = { semTrava: [], foraDaForma: [], nenhumaVisivel: false }
/** `@@lower_case_table_names`: 0 no Linux (caixa conta), 1 no Windows. */
const LINUX = 0
const WINDOWS = 1

describe('a trava da trilha', () => {
  it('as duas triggers com o corpo exato: nada a acusar', () => {
    expect(conferirTravaDaTrilha(AS_DUAS, LINUX)).toEqual(LIMPA)
  })

  it('o corpo esperado é o da migração, com os espaços normalizados', () => {
    expect(corpoDaTrava('LogAuditoria')).toBe(CORPO('LogAuditoria').replace(/\s+/g, ' '))
  })

  it('no MySQL do Windows (lower_case_table_names=1) a tabela vem em minúsculas, e a trava vale', () => {
    // Segunda rodada das revisões do #184: comparar com caixa dava alarme
    // falso com a trava de pé, justamente na máquina da V1.
    const windows = AS_DUAS.map((t) => ({ ...t, tabela: t.tabela.toLowerCase(), evento: 'update', momento: 'before' }))
    expect(conferirTravaDaTrilha(windows, WINDOWS)).toEqual(LIMPA)
  })

  it('no Linux, uma tabela-sombra "logauditoria" com o corpo exato NÃO conta como trava da trilha', () => {
    // Terceira rodada das revisões do #184, medido: com a comparação sempre
    // sem caixa, isto dava OK e o UPDATE em LogAuditoria passava.
    const sombra = trava('LogAuditoria', { nome: 'logauditoria_sombra', tabela: 'logauditoria' })
    expect(conferirTravaDaTrilha([sombra, trava('EventoProcessamento')], LINUX).semTrava).toEqual(['LogAuditoria'])
    // No Windows o mesmo nome É a tabela da trilha.
    expect(conferirTravaDaTrilha([sombra, trava('EventoProcessamento')], WINDOWS).semTrava).toEqual([])
  })

  it('migração com CRLF: o \\r no corpo não muda nada', () => {
    const crlf = AS_DUAS.map((t) => ({ ...t, corpo: t.corpo.replace(/\n/g, '\r\n') }))
    expect(conferirTravaDaTrilha(crlf, LINUX)).toEqual(LIMPA)
  })

  it('durante a troca, as antigas ao lado das novas: as novas bastam, as antigas são acusadas pela forma', () => {
    const antiga: TriggerNoBanco = {
      ...trava('LogAuditoria'),
      nome: 'LogAuditoria_append_only',
      corpo: "SIGNAL SQLSTATE '45000'\nSET MESSAGE_TEXT = 'LogAuditoria e append-only: grave um registro novo em vez de alterar o passado';",
    }
    const resultado = conferirTravaDaTrilha([...AS_DUAS, antiga], LINUX)
    expect(resultado.semTrava).toEqual([])
    expect(resultado.foraDaForma).toHaveLength(1)
    expect(resultado.foraDaForma[0]).toMatch(/LogAuditoria_append_only/)
  })

  it('nenhuma trigger visível é dito como tal', () => {
    expect(conferirTravaDaTrilha([], LINUX)).toEqual({
      semTrava: ['LogAuditoria', 'EventoProcessamento'],
      foraDaForma: [],
      nenhumaVisivel: true,
    })
  })

  it('falta a de uma tabela: acusa essa tabela', () => {
    expect(conferirTravaDaTrilha([trava('LogAuditoria')], LINUX).semTrava).toEqual(['EventoProcessamento'])
  })

  it('só a forma antiga, sem BEGIN … END: sem a trava da migração, e fora da forma', () => {
    const antigas = AS_DUAS.map((t) => ({ ...t, corpo: t.corpo.replace(/^BEGIN\s*/, '').replace(/\s*END$/, '') }))
    const resultado = conferirTravaDaTrilha(antigas, LINUX)
    expect(resultado.semTrava).toEqual(['LogAuditoria', 'EventoProcessamento'])
    expect(resultado.foraDaForma).toHaveLength(2)
  })

  it('trava falsa não conta: SIGNAL em comentário, sob IF que nunca vale, ou em outra tabela, evento ou momento', () => {
    // Segunda rodada de segurança do #184, medido: as duas primeiras deixavam
    // o UPDATE passar, e a conferência por "contém SIGNAL" dizia OK.
    for (const falsa of [
      trava('LogAuditoria', { corpo: "BEGIN /* SIGNAL SQLSTATE '45000' */ SET NEW.acao = NEW.acao; END" }),
      trava('LogAuditoria', { corpo: `BEGIN IF 1 = 0 THEN ${CORPO('LogAuditoria').slice(6, -4)} END IF; END` }),
      trava('LogAuditoria', { tabela: 'Item' }),
      trava('LogAuditoria', { evento: 'DELETE' }),
      trava('LogAuditoria', { momento: 'AFTER' }),
      trava('LogAuditoria', { corpo: CORPO('EventoProcessamento') }),
    ]) {
      expect(conferirTravaDaTrilha([falsa, trava('EventoProcessamento')], LINUX).semTrava).toEqual(['LogAuditoria'])
    }
  })

  it('trigger fora da trilha, de um comando só, é acusada pela forma sem tirar a trava da trilha', () => {
    const outra: TriggerNoBanco = { nome: 'Item_teste', tabela: 'Item', evento: 'INSERT', momento: 'BEFORE', corpo: 'SET NEW.id = NEW.id' }
    const resultado = conferirTravaDaTrilha([...AS_DUAS, outra], LINUX)
    expect(resultado.semTrava).toEqual([])
    expect(resultado.foraDaForma).toEqual([expect.stringMatching(/Item_teste/)])
  })
})
