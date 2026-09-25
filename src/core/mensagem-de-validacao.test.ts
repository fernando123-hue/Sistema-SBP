import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { CadastroDeColaboradorSchema, DataIsoSchema, TrocaDeSenhaSchema } from './esquemas'
import { mensagemDeValidacao } from './mensagem-de-validacao'

/**
 * Validação responde em português de gente (achado N-28, pedido do dono em A40).
 *
 * O Zod falava inglês e a tela de Acesso mostrava as issues cruas: a gestora
 * digitava um e-mail com erro e lia `email: Invalid email address`; marcava uma
 * categoria que o servidor não conhecia e lia `categorias.3: Invalid option`.
 * Nenhuma das duas diz o que fazer, e a segunda nem diz qual campo.
 */

/** O que nunca pode aparecer para a equipe: inglês, sintaxe do Zod, índice de lista. */
const JARGAO = /Invalid|expected|Too (small|big)|esperava|\|"|\.\d|>=|<=/

function mensagemDe(esquema: z.ZodType, entrada: unknown): string {
  const conferido = esquema.safeParse(entrada)
  if (conferido.success) throw new Error('a entrada devia ter sido recusada')
  return mensagemDeValidacao(conferido.error)
}

describe('mensagemDeValidacao', () => {
  it('e-mail errado no cadastro: diz o campo e o que está errado, sem inglês', () => {
    const mensagem = mensagemDe(CadastroDeColaboradorSchema, {
      nome: 'Ana Sintética',
      email: 'ana.sintetica.exemplo.test',
      papel: 'colaborador',
    })

    expect(mensagem).toBe('E-mail: não parece um endereço de e-mail.')
  })

  it('categoria desconhecida na lista: diz o campo, sem o índice nem as opções em código', () => {
    const mensagem = mensagemDe(CadastroDeColaboradorSchema, {
      nome: 'Ana Sintética',
      email: 'ana.sintetica@exemplo.test',
      papel: 'colaborador',
      categorias: ['LIGA', 'INEXISTENTE'],
    })

    expect(mensagem).toBe('Categorias: não é uma das opções aceitas.')
    expect(mensagem).not.toMatch(JARGAO)
  })

  it('campo obrigatório vazio e ausente', () => {
    const mensagem = mensagemDe(CadastroDeColaboradorSchema, { nome: '   ', email: 'ana@exemplo.test' })

    expect(mensagem).toBe('Nome: não pode ficar vazio. Papel: é obrigatório.')
  })

  it.each([
    ['texto curto demais', z.object({ senha: z.string().min(12) }), { senha: 'curta' }, 'Senha: precisa ter pelo menos 12 caracteres.'],
    ['texto longo demais', z.object({ texto: z.string().max(3) }), { texto: 'longo' }, 'Texto: pode ter no máximo 3 caracteres.'],
    ['número pequeno', z.object({ dias: z.number().int().min(7) }), { dias: 1 }, 'Dias: precisa ser pelo menos 7.'],
    ['número grande', z.object({ dias: z.number().int().max(30) }), { dias: 90 }, 'Dias: pode ser no máximo 30.'],
    ['lista longa', z.object({ categorias: z.array(z.string()).max(1) }), { categorias: ['a', 'b'] }, 'Categorias: pode ter no máximo 1 escolha.'],
    ['tipo errado', z.object({ dias: z.number() }), { dias: 'sete' }, 'Dias: está num formato que o sistema não aceita.'],
    ['formato de data', z.object({ data: z.iso.date() }), { data: '2026/09/24' }, 'Data: está num formato que o sistema não aceita.'],
  ] as const)('%s', (_, esquema, entrada, esperado) => {
    const mensagem = mensagemDe(esquema, entrada)

    expect(mensagem).toBe(esperado)
    expect(mensagem).not.toMatch(JARGAO)
  })

  it('campo que a tela não digita (id) não expõe o nome técnico', () => {
    // `colaboradorId` inválido é defeito da tela, não engano de quem usa: o
    // nome do campo não ajuda ninguém a corrigir, então ele não aparece.
    const mensagem = mensagemDe(z.object({ colaboradorId: z.string().min(1) }), {})

    expect(mensagem).toBe('Um dado do pedido é obrigatório. Atualize a tela e tente de novo.')
    expect(mensagem).not.toContain('colaboradorId')
  })

  it('mensagem escrita no próprio esquema continua valendo', () => {
    const mensagem = mensagemDe(
      z.object({ justificativa: z.string().min(1, 'Diga por que o item vai para outra pessoa.') }),
      { justificativa: '' },
    )

    expect(mensagem).toBe('Justificativa: Diga por que o item vai para outra pessoa.')
  })

  describe('esquema validado sem campo em volta (revisão técnica do #114)', () => {
    // `obterEscala` faz `DataIsoSchema.parse(data)` direto, com a data da URL:
    // a issue nasce sem caminho, sem rótulo. A frase escrita no esquema já se
    // sustenta; o que não pode é virar "Um dado do pedido data deve estar…".
    it('data que não existe no calendário', () => {
      expect(mensagemDe(DataIsoSchema, '2026-02-30')).toBe('Essa data não existe no calendário.')
    })

    it('data em formato errado dá uma frase só, não duas contraditórias', () => {
      expect(mensagemDe(DataIsoSchema, '20-2-3')).toBe('A data não está num formato que o sistema aceita.')
    })

    it('frase nossa sem campo continua dizendo o que fazer', () => {
      expect(mensagemDe(z.string().min(1), '')).toBe(
        'Um dado do pedido não pode ficar vazio. Atualize a tela e tente de novo.',
      )
    })
  })

  it('nova senha curta: diz qual das duas senhas, sem frase quebrada', () => {
    const mensagem = mensagemDe(TrocaDeSenhaSchema, { senhaAtual: 'qualquer', senhaNova: 'curta' })

    expect(mensagem).toBe('Nova senha: a senha precisa de pelo menos 10 caracteres.')
  })

  it('o mesmo problema repetido em vários itens da lista aparece uma vez', () => {
    const mensagem = mensagemDe(z.object({ categorias: z.array(z.enum(['A'])) }), { categorias: ['X', 'Y'] })

    expect(mensagem).toBe('Categorias: não é uma das opções aceitas.')
  })
})
