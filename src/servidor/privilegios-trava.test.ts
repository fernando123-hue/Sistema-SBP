import { describe, expect, it } from 'vitest'

import { problemasDaTravaDaTrilha, type TriggerNoBanco } from './privilegios'

/**
 * A conferência de que a trava da trilha está de pé (`AT-66`, revisões do #184).
 *
 * A trava pode sumir sem a aplicação perceber: uma migração que parou no meio
 * e foi dada como aplicada à mão, ou uma restauração de backup interrompida.
 * `npm run db:conferir-trilha` lê `information_schema.TRIGGERS` e passa por
 * aqui; estes casos decidem se ela acusa o que precisa.
 */

const CORPO = (tabela: string): string =>
  `BEGIN\n  SIGNAL SQLSTATE '45000'\n  SET MESSAGE_TEXT = '${tabela} e append-only';\nEND`

function trava(tabela: string, mudar: Partial<TriggerNoBanco> = {}): TriggerNoBanco {
  return { nome: `${tabela}_recusa_update`, tabela, evento: 'UPDATE', momento: 'BEFORE', corpo: CORPO(tabela), ...mudar }
}

const AS_DUAS = [trava('LogAuditoria'), trava('EventoProcessamento')]

describe('a trava da trilha', () => {
  it('as duas triggers na forma certa: nada a acusar', () => {
    expect(problemasDaTravaDaTrilha(AS_DUAS)).toEqual([])
  })

  it('durante a troca, a antiga ao lado da nova também está de pé', () => {
    // A migração do AT-66 cria as novas antes de apagar as antigas.
    expect(problemasDaTravaDaTrilha([...AS_DUAS, trava('LogAuditoria', { nome: 'outra', corpo: CORPO('x') })])).toEqual([])
  })

  it('nenhuma trigger visível é acusado, dizendo as duas causas possíveis', () => {
    const [problema] = problemasDaTravaDaTrilha([])
    expect(problema).toMatch(/sem trava/)
    expect(problema).toMatch(/conta administradora/)
  })

  it('falta a de uma tabela: acusa essa tabela', () => {
    expect(problemasDaTravaDaTrilha([trava('LogAuditoria')])).toEqual([
      'EventoProcessamento sem a trigger BEFORE UPDATE que recusa reescrever o passado.',
    ])
  })

  it('corpo com o ";" do fim (a forma que o mysqldump não restaura) é acusado', () => {
    const antiga = trava('LogAuditoria', {
      nome: 'LogAuditoria_append_only',
      corpo: "SIGNAL SQLSTATE '45000'\nSET MESSAGE_TEXT = 'LogAuditoria e append-only';",
    })
    // Ela ainda recusa o UPDATE: o problema é só a forma, e a frase diz isso.
    expect(problemasDaTravaDaTrilha([antiga, trava('EventoProcessamento')])).toEqual([
      'A trigger LogAuditoria_append_only não tem o corpo entre BEGIN e END, a forma que o backup (mysqldump) restaura.',
    ])
  })

  it('trigger em outra tabela, em outro evento, depois do fato ou que não recusa não conta como trava', () => {
    for (const errada of [
      trava('LogAuditoria', { tabela: 'Item' }),
      trava('LogAuditoria', { evento: 'DELETE' }),
      trava('LogAuditoria', { momento: 'AFTER' }),
      trava('LogAuditoria', { corpo: 'BEGIN\n  SET NEW.acao = OLD.acao;\nEND' }),
    ]) {
      expect(problemasDaTravaDaTrilha([errada, trava('EventoProcessamento')])).toContain(
        'LogAuditoria sem a trigger BEFORE UPDATE que recusa reescrever o passado.',
      )
    }
  })

  it('o que vem do information_schema em minúsculas ainda vale', () => {
    expect(problemasDaTravaDaTrilha(AS_DUAS.map((t) => ({ ...t, evento: 'update', momento: 'before' })))).toEqual([])
  })
})
