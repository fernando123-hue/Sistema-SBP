import { beforeEach, describe, expect, it } from 'vitest'

import { obterPrisma } from '../servidor/prisma'
import { limparTudo } from '../testes/apoio'

/**
 * Invariante 14: toda linha de memória nasce sabendo de que domínio é.
 *
 * Até 03/10, `dominio` tinha `@default("distribuicao")` nas três tabelas. Um
 * segundo sistema que gravasse sem dizer o domínio ganharia "distribuicao" em
 * silêncio — e a trilha é append-only, então a linha errada ficaria errada para
 * sempre (`LogAuditoria.dominio`, no schema). O próprio sistema já fazia isso:
 * `notas.ts` criava a nota sem domínio e contava com o valor padrão.
 *
 * Sem o padrão, quem esquecer recebe erro do BANCO, não um rótulo inventado.
 * O teste grava por SQL cru de propósito: o tipo do Prisma já obriga o campo,
 * e o que se prova aqui é a trava que vale para qualquer cliente do banco.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

// A frase exata do MySQL (erro 1364), e o id das linhas não contém a palavra:
// o driver repete o SQL na mensagem, e uma regex frouxa casaria com qualquer
// erro que ecoasse o INSERT (revisão técnica do PR). A recusa depende do modo
// estrito do MySQL (`STRICT_TRANS_TABLES`, padrão do 8.4); sem ele, o banco
// gravaria '' com um aviso — se este teste ficar vermelho num servidor com
// `sql_mode` mexido, a causa é essa.
const SEM_DOMINIO = /Field 'dominio' doesn't have a default value/

describe('linha sem domínio é recusada pelo banco', () => {
  it('LogAuditoria', async () => {
    await expect(
      banco.$executeRaw`INSERT INTO LogAuditoria (id, entidade, entidadeId, acao, usuario)
        VALUES ('linha-1', 'Item', 'item-sintetico', 'teste', 'ninguem')`,
    ).rejects.toThrow(SEM_DOMINIO)
  })

  it('EventoProcessamento', async () => {
    await expect(
      banco.$executeRaw`INSERT INTO EventoProcessamento (id, correlacaoId, etapa, situacao)
        VALUES ('linha-1', 'correlacao-sintetica', 'teste', 'ok')`,
    ).rejects.toThrow(SEM_DOMINIO)
  })

  it('Nota', async () => {
    const autora = await banco.colaborador.create({
      data: { nome: 'Autora Sintética', email: 'autora-dominio@teste.local', papel: 'colaborador' },
    })
    await expect(
      banco.$executeRaw`INSERT INTO Nota (id, texto, autorId) VALUES ('linha-1', 'nota sintética', ${autora.id})`,
    ).rejects.toThrow(SEM_DOMINIO)
  })
})
