import { describe, expect, it } from 'vitest'

import { CASOS_DO_GABARITO } from './avaliacao/casos'
import {
  PASSOS_POR_EMAIL,
  conferirExtracao,
  prepararTextoParaConferir,
  valorEstaNoTexto,
} from './conferencia-da-extracao'

/**
 * A conferência do que a IA extraiu contra o texto (pendência 17, `§ H.4` 40).
 * Dados 100% sintéticos (invariante 8); `111.444.777-35` é o CPF público de teste.
 */

const EMAIL =
  'Assunto: Atualização cadastral\n' +
  'Bom dia. Segue minha ficha.\n' +
  'Nome: MARIANA SOUZA Sintética, CPF 111.444.777-35.\n' +
  'Telefone: (11) 98765-4321 — nascida em 12/05/1990.\n' +
  'CRM SP 123456. Liga Acadêmica de Pediatria Sintética.\n' +
  'Valor pago: R$ 350,00'

const texto = prepararTextoParaConferir(EMAIL)
const esta = (valor: string) => valorEstaNoTexto(texto, valor)

describe('valorEstaNoTexto — o que passa', () => {
  it('ignora maiúsculas, acentos e espaços', () => {
    expect(esta('Mariana Souza Sintetica')).toBe(true)
    expect(esta('  mariana   souza  ')).toBe(true)
  })

  it('trata pontuação como espaço', () => {
    expect(esta('Sintética, CPF')).toBe(true)
  })

  it('compara número só pelos dígitos, com ou sem formatação', () => {
    expect(esta('11144477735')).toBe(true)
    expect(esta('111.444.777-35')).toBe(true)
    expect(esta('111 444 777 35')).toBe(true)
  })

  it('junta os grupos de um telefone e de uma data', () => {
    expect(esta('11987654321')).toBe(true)
    expect(esta('(11) 98765-4321')).toBe(true)
    expect(esta('98765-4321')).toBe(true)
    expect(esta('12/05/1990')).toBe(true)
    expect(esta('12051990')).toBe(true)
  })

  it('aceita letra e número colados quando o texto os separa (CRM)', () => {
    expect(esta('SP123456')).toBe(true)
    expect(esta('SP 123456')).toBe(true)
  })

  it('não confere valor curto demais para provar alguma coisa', () => {
    expect(esta('SP')).toBe(true)
    expect(esta('zz')).toBe(true)
    expect(esta('')).toBe(true)
  })
})

describe('valorEstaNoTexto — o que a IA reescreveu', () => {
  it('nome reescrito', () => {
    expect(esta('Mariana de Souza')).toBe(false)
    expect(esta('Souza Mariana')).toBe(false)
  })

  it('palavra dentro de outra palavra não conta: "Ana Souza" não está em "Mariana Souza"', () => {
    expect(esta('Ana Souza')).toBe(false)
  })

  it('CPF com um dígito a menos, a mais ou trocado', () => {
    expect(esta('1114447773')).toBe(false)
    expect(esta('111444777350')).toBe(false)
    expect(esta('11144477736')).toBe(false)
  })

  it('número que corta um grupo ao meio', () => {
    expect(esta('4447')).toBe(false)
    expect(esta('119876')).toBe(false)
  })

  it('valor inventado', () => {
    expect(esta('Fulano Inexistente')).toBe(false)
    expect(esta('999.888.777-66')).toBe(false)
  })

  it('ordem trocada entre letra e número (CRM 123456/SP)', () => {
    expect(esta('123456/SP')).toBe(false)
  })
})

describe('conferirExtracao', () => {
  it('extração literal: nenhum problema', () => {
    expect(
      conferirExtracao(texto, { nome: 'Mariana Souza Sintética', cpf: '111.444.777-35', crm: 'SP123456' }, null),
    ).toBeNull()
  })

  it('CPF que não confere vai para a revisão, mesmo copiado literalmente do e-mail', () => {
    const comCpfErrado = prepararTextoParaConferir('Nome: Fulano Sintético\nCPF: 000.000.000-00')
    expect(conferirExtracao(comCpfErrado, { nome: 'Fulano Sintético', cpf: '000.000.000-00' }, null)).toEqual({
      motivo: 'cpf_invalido',
      campo: 'cpf',
    })
  })

  it('reconhece o campo de CPF escrito de outro jeito ("C.P.F.")', () => {
    expect(conferirExtracao(texto, { 'C.P.F.': '123' }, null)).toEqual({ motivo: 'cpf_invalido', campo: 'C.P.F.' })
  })

  it('CPF que não confere vem antes de valor fora do texto', () => {
    expect(conferirExtracao(texto, { nome: 'Nome Inventado', cpf: '11144477736' }, null)).toEqual({
      motivo: 'cpf_invalido',
      campo: 'cpf',
    })
  })

  it('diz QUAL campo não está no e-mail', () => {
    expect(conferirExtracao(texto, { nome: 'Mariana Souza', telefone: '(11) 91234-0000' }, null)).toEqual({
      motivo: 'valor_fora_do_texto',
      campo: 'telefone',
    })
  })

  it('confere a liga mencionada, que vira identidade no banco', () => {
    expect(conferirExtracao(texto, {}, 'Liga Acadêmica de Pediatria Sintética')).toBeNull()
    expect(conferirExtracao(texto, {}, 'Liga de Pediatria')).toEqual({ motivo: 'valor_fora_do_texto', campo: 'liga' })
  })
})

describe('o gabarito inteiro passa pela conferência de texto', () => {
  /**
   * As respostas esperadas do gabarito são, por definição, cópia literal do
   * e-mail. Se a conferência acusar alguma, a regra está apertada demais e
   * mandaria para a Revisão o item que a IA leu certo. Campo a campo: a
   * conferência do item para no primeiro problema, e o CPF de teste
   * `000.000.000-00` esconderia os outros campos (revisão técnica do #150).
   *
   * Cobre o que o gabarito tem: nomes, CPF e CRM. Telefone, e-mail, data e
   * liga estão nos casos escritos acima.
   */
  it.each(CASOS_DO_GABARITO.map((caso) => [caso.id, caso] as const))('%s', (_id, caso) => {
    const doCaso = prepararTextoParaConferir(`${caso.email.assunto}\n${caso.email.corpo}`)
    for (const item of caso.esperado.itens) {
      for (const [campo, valor] of Object.entries(item.campos ?? {})) {
        expect({ campo, valor, noTexto: valorEstaNoTexto(doCaso, valor) }).toEqual({ campo, valor, noTexto: true })
      }
    }
  })
})

describe('endereço de e-mail é comparado inteiro', () => {
  const comEndereco = prepararTextoParaConferir('Contato: ana.souza@exemplo.test, obrigada.')

  it('o endereço copiado passa, em maiúsculas ou com ponto final', () => {
    expect(valorEstaNoTexto(comEndereco, 'Ana.Souza@Exemplo.test')).toBe(true)
    expect(valorEstaNoTexto(comEndereco, 'ana.souza@exemplo.test.')).toBe(true)
  })

  it('outro endereço com as mesmas palavras não passa', () => {
    for (const reescrito of [
      'ana@souza.exemplo.test',
      'ana-souza@exemplo.test',
      'ana.souza@exemplo-test',
      'anasouza@exemplo.test',
    ]) {
      expect({ reescrito, noTexto: valorEstaNoTexto(comEndereco, reescrito) }).toEqual({ reescrito, noTexto: false })
    }
  })
})

describe('caixa e símbolos que o critério manda ignorar', () => {
  it('"ß" é "ss", e "°" escrito no lugar de "º" é o mesmo ordinal', () => {
    const doTexto = prepararTextoParaConferir('Rua STRASSE, nº 12')
    expect(valorEstaNoTexto(doTexto, 'Straße')).toBe(true)
    expect(valorEstaNoTexto(doTexto, 'n° 12')).toBe(true)
  })

  it('"CPF" sem nenhum dígito não é CPF que não confere: é valor a conferir no texto', () => {
    expect(conferirExtracao(texto, { cpf: 'não informado' }, null)).toEqual({ motivo: 'valor_fora_do_texto', campo: 'cpf' })
    expect(conferirExtracao(texto, { cpf: '' }, null)).toBeNull()
  })
})

describe('custo', () => {
  it('um e-mail no tamanho máximo com muitos valores confere em tempo de tela', () => {
    const linha = 'Nome: Fulano Sintético, CPF 111.444.777-35, telefone (11) 98765-4321.\n'
    const grande = prepararTextoParaConferir(linha.repeat(2800))
    const inicio = performance.now()
    for (let i = 0; i < 1000; i += 1) {
      conferirExtracao(grande, { nome: 'Fulano Sintético', cpf: '111.444.777-35', telefone: '11987654321' }, null)
      valorEstaNoTexto(grande, 'Fulano Inexistente')
    }
    expect(performance.now() - inicio).toBeLessThan(5000)
  })

  /**
   * O texto é do remetente. Cem mil "1" soltos e uma lista de pessoas que a
   * IA desdobra sozinha levavam ~27 s de CPU síncrona, com o servidor parado
   * para todos (revisões do #150). Com o índice por número e o orçamento de
   * passos por e-mail, o tempo tem teto.
   */
  it('texto hostil com cem mil números iguais e 1.800 valores não trava o servidor', () => {
    const hostil = prepararTextoParaConferir(`${'1 '.repeat(100_000)}CPF 111.444.777-35`)
    const inicio = performance.now()
    for (let i = 0; i < 1800; i += 1) valorEstaNoTexto(hostil, `1${String(i).padStart(10, '0')}`)
    expect(performance.now() - inicio).toBeLessThan(2000)
  })

  it('texto hostil com valores longos que quase casam não trava o servidor', () => {
    const hostil = prepararTextoParaConferir('a 1 '.repeat(50_000))
    const quase = `${'a 1 '.repeat(499)}b`
    const inicio = performance.now()
    for (let i = 0; i < 25; i += 1) valorEstaNoTexto(hostil, `${quase} ${i}`)
    expect(performance.now() - inicio).toBeLessThan(2000)
  })

  it('orçamento esgotado conta como NÃO achado: o item vai para uma pessoa', () => {
    const doTexto = prepararTextoParaConferir('Nome: Fulana Sintética')
    doTexto.orcamento = 0
    expect(valorEstaNoTexto(doTexto, 'Fulana Sintética')).toBe(false)
    expect(PASSOS_POR_EMAIL).toBeGreaterThan(0)
  })
})
