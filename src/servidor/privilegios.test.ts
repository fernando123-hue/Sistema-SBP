import { describe, expect, it } from 'vitest'

import { privilegiosQueAmeacamATrilha } from './privilegios'

/**
 * A conferência de privilégio da trilha (`AT-39`, achado da revisão de
 * segurança do PR #77).
 *
 * A promessa "em produção o usuário do banco não pode apagar a trilha" só vale
 * se alguém conferir. Estes casos são os que decidem entre uma conferência que
 * protege e uma que dá conforto: `GRANT ALL`, privilégio na base inteira,
 * caixa do nome da tabela diferente (o MySQL do Windows guarda em minúsculas —
 * `AT-32`) e a linha `USAGE`, que não concede nada.
 */

describe('privilégios que ameaçam a trilha', () => {
  it('o usuário só de leitura e escrita nova está limpo', () => {
    expect(
      privilegiosQueAmeacamATrilha([
        'GRANT USAGE ON *.* TO `app`@`%`',
        'GRANT SELECT, INSERT ON `sbp`.`LogAuditoria` TO `app`@`%`',
        'GRANT SELECT, INSERT ON `sbp`.`EventoProcessamento` TO `app`@`%`',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON `sbp`.`Item` TO `app`@`%`',
      ]),
    ).toEqual([])
  })

  it('DELETE na trilha é acusado, mesmo concedido tabela a tabela', () => {
    const achados = privilegiosQueAmeacamATrilha([
      'GRANT SELECT, INSERT, DELETE ON `sbp`.`LogAuditoria` TO `app`@`%`',
    ])

    expect(achados).toEqual([
      expect.objectContaining({ privilegio: 'DELETE', alvo: 'LogAuditoria' }),
    ])
  })

  it('GRANT ALL na base inteira é acusado nas DUAS tabelas', () => {
    // É a forma mais comum do erro: clonar a credencial de desenvolvimento.
    const achados = privilegiosQueAmeacamATrilha(['GRANT ALL PRIVILEGES ON `sbp`.* TO `app`@`%`'])

    expect(achados.map((achado) => achado.alvo).sort()).toEqual([
      'EventoProcessamento',
      'LogAuditoria',
    ])
    expect(achados.every((achado) => achado.privilegio === 'ALL PRIVILEGES')).toBe(true)
  })

  it('a caixa do nome da tabela não salva ninguém', () => {
    // No Windows o MySQL guarda o nome em minúsculas (`AT-32`). Uma conferência
    // sensível à caixa passaria verde exatamente onde o risco é o mesmo.
    expect(privilegiosQueAmeacamATrilha(['GRANT DELETE ON `sbp`.`logauditoria` TO `app`@`%`'])).toHaveLength(1)
  })

  it('privilégio por COLUNA não engana o leitor de privilégios', () => {
    expect(
      privilegiosQueAmeacamATrilha(['GRANT SELECT (id), UPDATE (acao) ON `sbp`.`LogAuditoria` TO `app`@`%`']),
    ).toEqual([expect.objectContaining({ privilegio: 'UPDATE' })])
  })

  it('TRIGGER também é acusado: quem pode derrubar a trava pode reescrever depois', () => {
    // A trava de `UPDATE` é uma TRIGGER. Poder criá-la e apagá-la é poder
    // desligar a própria proteção — vale o mesmo que o UPDATE direto.
    expect(
      privilegiosQueAmeacamATrilha(['GRANT TRIGGER ON `sbp`.`EventoProcessamento` TO `app`@`%`']),
    ).toHaveLength(1)
  })

  it('linha que não é concessão é ignorada sem quebrar', () => {
    expect(privilegiosQueAmeacamATrilha(['', 'REVOKE DELETE ON `sbp`.* FROM `app`@`%`'])).toEqual([])
  })
})
