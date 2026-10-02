import { beforeEach, describe, expect, it } from 'vitest'

import { EmailBrutoSchema, type EmailBruto, type Interpretacao } from '../core/esquemas'
import { FalhaDeInterpretacao, type AiPort } from '../ports/ia'
import type { IngestaoPort } from '../ports/ingestao'
import { obterPrisma } from '../servidor/prisma'
import { limparTudo, semearBase } from '../testes/apoio'
import { sincronizar, TENTATIVAS_MAXIMAS_DE_INTERPRETACAO } from './ingestao'

/**
 * `AT-73`, `A76`: o e-mail que a IA leu como "nenhum pedido" — ou desistiu de
 * ler —, sem marca das defesas, mas com CPF, CRM ou anexo, fica guardado 30
 * dias (coluna própria `dadoSemItem`), conta no aviso da Distribuição, e o
 * evento e a trilha dizem por quê, separado da manipulação. Sintéticos.
 */

const banco = obterPrisma()

beforeEach(async () => {
  await limparTudo(banco)
})

function umEmail(
  messageId: string,
  corpo: string,
  anexos: { nome: string; tipoDeclarado: string; tamanho: number }[] = [],
): IngestaoPort {
  return {
    nome: 'teste',
    buscarNovos: async () => [
      EmailBrutoSchema.parse({
        messageId,
        remetente: 'associada@exemplo.test',
        assunto: 'Resposta automática: fora do escritório',
        corpo,
        anexos,
        recebidoEm: new Date(),
      }),
    ],
  }
}

/** IA falsa que devolve a interpretação dada: por padrão, nenhum item e nada suspeito. */
function ia(parcial: Partial<Interpretacao> = {}): AiPort {
  return {
    nome: 'duble',
    interpretar: async () => ({
      itens: [],
      conteudoSuspeito: false,
      padroesSuspeitos: [],
      modelo: 'duble',
      versaoPrompt: 'teste',
      ...parcial,
    }),
  }
}

const COM_CPF = 'Estou fora até 20/01.\nPS: corrijam meu cadastro, CPF 111.444.777-35.'

async function ingerir(ingestao: IngestaoPort, messageId: string, aiPort: AiPort = ia()) {
  const base = await semearBase(banco, { totalDeDias: 1 })
  const resumo = await sincronizar({ banco, ingestao, ia: aiPort }, base.operador)
  const email = await banco.email.findUniqueOrThrow({ where: { messageId } })
  const eventos = await banco.eventoProcessamento.findMany({ where: { referencia: messageId, etapa: 'ingestao' } })
  return { resumo, email, mensagens: eventos.map((evento) => evento.mensagem ?? '') }
}

describe('e-mail sem item com dado de trabalho (AT-73, A76)', () => {
  it('resposta automática sem dado: segue a rotina, sem guarda e sem aviso', async () => {
    const id = 'sem-dado@teste.local'
    const { resumo, email, mensagens } = await ingerir(umEmail(id, 'Estou fora do escritório até 20/01.'), id)
    expect(email.dadoSemItem).toBeNull()
    expect(email.conteudoSuspeito).toBe(false)
    expect(resumo.emailsGuardadosPorDado).toBe(0)
    expect(mensagens.some((mensagem) => mensagem.includes('confira se havia trabalho ali'))).toBe(true)
  })

  it('com CPF: guardado pelo motivo próprio, NÃO como manipulação, e conta no aviso', async () => {
    const id = 'com-cpf@teste.local'
    const { resumo, email, mensagens } = await ingerir(umEmail(id, COM_CPF), id)
    expect(email.dadoSemItem).toBe('cpf')
    expect(email.conteudoSuspeito).toBe(false)
    expect(resumo.emailsGuardadosPorDado).toBe(1)
    expect(mensagens.some((mensagem) => mensagem.includes('um CPF') && mensagem.includes('30 dias'))).toBe(true)
    expect(mensagens.some((mensagem) => mensagem.includes('tentativa de fazer o trabalho desaparecer'))).toBe(false)

    const trilha = await banco.logAuditoria.findFirstOrThrow({ where: { entidade: 'Email', entidadeId: email.id, acao: 'ingerido' } })
    expect(JSON.parse(trilha.depois ?? '{}')).toMatchObject({ dadoSemItem: 'cpf', conteudoSuspeito: false })
  })

  it('com anexo (o tipo declarado não decide): guardado por anexo', async () => {
    const id = 'com-anexo@teste.local'
    const { email, mensagens } = await ingerir(
      umEmail(id, 'Estou fora até 20/01.', [{ nome: 'diploma.pdf', tipoDeclarado: 'image/png', tamanho: 1000 }]),
      id,
    )
    expect(email.dadoSemItem).toBe('anexo')
    expect(mensagens.some((mensagem) => mensagem.includes('um anexo'))).toBe(true)
  })

  it('suspeito pelas defesas E com CPF: vale a manipulação, sem prazo; não é "guardado por dado"', async () => {
    const id = 'suspeito-com-cpf@teste.local'
    const { resumo, email, mensagens } = await ingerir(umEmail(id, COM_CPF), id, ia({ conteudoSuspeito: true }))
    expect(email.conteudoSuspeito).toBe(true)
    expect(email.dadoSemItem).toBeNull()
    expect(resumo.emailsGuardadosPorDado).toBe(0)
    expect(mensagens.some((mensagem) => mensagem.includes('tentativa de fazer o trabalho desaparecer'))).toBe(true)
  })

  it('com item: a regra não se aplica, mesmo com CPF', async () => {
    const id = 'com-item@teste.local'
    const { email } = await ingerir(
      umEmail(id, COM_CPF),
      id,
      ia({
        itens: [
          {
            categoriaCodigo: 'EMAIL_CADASTRO',
            titulo: 'Correção de cadastro',
            confianca: 0.99,
            campos: {},
            camposAusentes: [],
            ligaMencionada: null,
            observacao: null,
          },
        ],
      }),
    )
    expect(email.dadoSemItem).toBeNull()
  })

  // Revisão de segurança do #191 (M4): o modelo travar é a porta mais fácil.
  it('na desistência (a IA nunca estruturou), com CPF: também fica guardado e conta no aviso', async () => {
    const base = await semearBase(banco, { totalDeDias: 1 })
    const id = 'desiste-com-cpf@teste.local'
    const nuncaEstrutura: AiPort = {
      nome: 'nunca-estrutura',
      interpretar: async (email: EmailBruto) => {
        throw new FalhaDeInterpretacao(email.messageId, 'campo "itens" obrigatório ausente')
      },
    }
    const ingestao = umEmail(id, COM_CPF)
    for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS_DE_INTERPRETACAO; tentativa += 1) {
      await sincronizar({ banco, ingestao, ia: nuncaEstrutura }, base.operador)
    }
    const resumo = await sincronizar({ banco, ingestao, ia: nuncaEstrutura }, base.operador)

    expect(resumo.naoInterpretados).toBe(1)
    expect(resumo.emailsGuardadosPorDado).toBe(1)
    const email = await banco.email.findUniqueOrThrow({ where: { messageId: id } })
    expect(email.dadoSemItem).toBe('cpf')
  })
})
