import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'

/**
 * O modo estrito provado pelo COMPORTAMENTO, não pela configuração (revisão
 * de segurança do #204): texto maior que a coluna é RECUSADO (P2000), e não
 * cortado em silêncio. O Prisma não confere o tamanho de `@db.VarChar`; quem
 * recusa é o MySQL estrito. Sem ele, o MySQL grava o começo do texto com um
 * aviso — e no e-mail do colaborador (`@unique`), dois endereços longos com o
 * mesmo começo virariam a mesma pessoa.
 *
 * A borda já recusa antes: o Zod limita `messageId` a 191 e o e-mail a 320
 * (`core/esquemas.ts`). Este teste cobre a ÚLTIMA camada — o caminho que
 * contorna o Zod (seed, script, SQL cru, um caminho novo de escrita que o
 * esqueça). `db:conferir-trilha`, `db:privilegios` e a subida conferem o
 * `sql_mode`; este teste é o que fica vermelho se a suíte rodar num MySQL
 * afrouxado.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

describe('texto maior que a coluna é recusado, não cortado', () => {
  it('Email.messageId (VarChar 191)', async () => {
    await expect(
      banco.email.create({ data: { messageId: `${'m'.repeat(185)}@x.test`, recebidoEm: new Date() } }),
    ).rejects.toMatchObject({ code: 'P2000' })
    expect(await banco.email.count()).toBe(0)
  })

  // Recusar já impede o corte que, num campo único, juntaria duas pessoas com
  // o mesmo começo de e-mail.
  it('Colaborador.email (VarChar 320, único)', async () => {
    await expect(
      banco.colaborador.create({
        data: { nome: 'Pessoa Sintética', email: `${'a'.repeat(318)}@um.test`, papel: 'colaborador' },
      }),
    ).rejects.toMatchObject({ code: 'P2000' })
    expect(await banco.colaborador.count()).toBe(0)
  })
})
