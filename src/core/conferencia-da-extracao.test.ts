import { describe, expect, it } from 'vitest'

import { CASOS_DO_GABARITO } from './avaliacao/casos'
import {
  CAMPO_DA_LIGA,
  PASSOS_POR_EMAIL,
  conferirExtracao,
  ligaEstaNoTexto,
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
    expect(conferirExtracao(texto, {}, 'Liga de Pediatria')).toEqual({
      motivo: 'valor_fora_do_texto',
      campo: CAMPO_DA_LIGA,
    })
  })

  /**
   * A liga é conferida à parte do primeiro problema: com o CPF errado vindo
   * antes, a liga inventada seguia para `resolverLiga` (2ª rodada do #150).
   */
  it('a liga é conferida mesmo quando outro campo falha antes', () => {
    expect(conferirExtracao(texto, { cpf: '11144477736' }, 'Liga de Pediatria')?.motivo).toBe('cpf_invalido')
    expect(ligaEstaNoTexto(texto, 'Liga de Pediatria')).toBe(false)
    expect(ligaEstaNoTexto(texto, 'Liga Acadêmica de Pediatria Sintética')).toBe(true)
    expect(ligaEstaNoTexto(texto, null)).toBe(true)
  })

  it('a liga é conferida mesmo com um nome reescrito antes', () => {
    expect(conferirExtracao(texto, { nome: 'Mariana de Souza' }, 'Liga Inventada do Brasil')?.campo).toBe('nome')
    expect(ligaEstaNoTexto(texto, 'Liga Inventada do Brasil')).toBe(false)
  })

  /**
   * A liga vira identidade: "LX" ausente do texto nascia como liga "lx",
   * porque valor curto não era conferido (2ª rodada de segurança do #150).
   */
  it('liga curta não escapa da conferência', () => {
    const comSigla = prepararTextoParaConferir('Somos da LP, liga de pediatria.')
    expect(ligaEstaNoTexto(comSigla, 'LP')).toBe(true)
    expect(ligaEstaNoTexto(comSigla, 'LX')).toBe(false)
    expect(ligaEstaNoTexto(comSigla, 'L.X.')).toBe(false)
    // Sem letra nem dígito é "nenhuma liga", como `null`.
    expect(ligaEstaNoTexto(comSigla, '—')).toBe(true)
    // Como campo comum, continua isento: "SP" está em qualquer texto.
    expect(valorEstaNoTexto(comSigla, 'LX')).toBe(true)
    expect(conferirExtracao(comSigla, {}, 'LX')).toEqual({ motivo: 'valor_fora_do_texto', campo: CAMPO_DA_LIGA })
  })

  it('um campo da IA chamado "liga" não se confunde com a liga citada', () => {
    expect(conferirExtracao(texto, { liga: 'Nome Inventado' }, null)).toEqual({
      motivo: 'valor_fora_do_texto',
      campo: 'liga',
    })
    expect(CAMPO_DA_LIGA).not.toBe('liga')
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

  it('endereço entre aspas, sinais ou "mailto:" no texto é o mesmo endereço', () => {
    for (const corpo of [
      'Escreva para “ana.souza@exemplo.test”.',
      'Escreva para «ana.souza@exemplo.test»!',
      'Contato: mailto:ana.souza@exemplo.test?',
      'Ana Souza <ana.souza@exemplo.test>|telefone',
      'responder a ana.souza@exemplo.test/obrigada',
    ]) {
      const doTexto = prepararTextoParaConferir(corpo)
      expect({ corpo, noTexto: valorEstaNoTexto(doTexto, 'ana.souza@exemplo.test') }).toEqual({ corpo, noTexto: true })
    }
  })

  it('valor com nome e endereço confere as duas partes', () => {
    const doTexto = prepararTextoParaConferir('De: Ana Souza Sintética <ana.souza@exemplo.test>')
    expect(valorEstaNoTexto(doTexto, 'Ana Souza Sintética <ana.souza@exemplo.test>')).toBe(true)
    expect(valorEstaNoTexto(doTexto, 'mailto:ana.souza@exemplo.test')).toBe(true)
    expect(valorEstaNoTexto(doTexto, 'Ana Souza Sintética <ana@souza.exemplo.test>')).toBe(false)
    expect(valorEstaNoTexto(doTexto, 'Beatriz Inventada <ana.souza@exemplo.test>')).toBe(false)
  })

  it('"@" de largura cheia é o mesmo "@": o endereço é comparado inteiro', () => {
    for (const reescrito of ['ana＠souza.exemplo.test', 'ana﹫souza.exemplo.test']) {
      expect({ reescrito, noTexto: valorEstaNoTexto(comEndereco, reescrito) }).toEqual({ reescrito, noTexto: false })
    }
    expect(valorEstaNoTexto(comEndereco, 'ana.souza＠exemplo.test')).toBe(true)
  })

  /**
   * Apóstrofo é válido no endereço. Cortando ali, "avila@…" — outro
   * endereço — passava, e o certo ia para a Revisão (2ª rodada de segurança).
   */
  it("apóstrofo não corta o endereço", () => {
    const comApostrofo = prepararTextoParaConferir("Contato: joana.d'avila@exemplo.test ou 'bia@exemplo.test'.")
    expect(valorEstaNoTexto(comApostrofo, "joana.d'avila@exemplo.test")).toBe(true)
    expect(valorEstaNoTexto(comApostrofo, 'avila@exemplo.test')).toBe(false)
    expect(valorEstaNoTexto(comApostrofo, 'bia@exemplo.test')).toBe(true)
  })

  it('"@perfil" sem nada antes não é endereço: vai pela conferência de palavras', () => {
    const doTexto = prepararTextoParaConferir('Siga a liga no @ligasintetica.')
    expect(valorEstaNoTexto(doTexto, '@ligasintetica')).toBe(true)
    expect(valorEstaNoTexto(doTexto, '@ligainventada')).toBe(false)
  })
})

describe('caixa e símbolos que o critério manda ignorar', () => {
  it('"ß" é "ss", e "°" escrito no lugar de "º" é o mesmo ordinal', () => {
    const doTexto = prepararTextoParaConferir('Rua STRASSE, nº 12')
    expect(valorEstaNoTexto(doTexto, 'Straße')).toBe(true)
    expect(valorEstaNoTexto(doTexto, 'n° 12')).toBe(true)
  })

  it('"ẞ" maiúsculo também é "ss", e "İ" é "i" sem sobrar ponto', () => {
    expect(valorEstaNoTexto(prepararTextoParaConferir('Rua GROẞE, 12'), 'grosse')).toBe(true)
    expect(valorEstaNoTexto(prepararTextoParaConferir('Rua Grosse, 12'), 'GROẞE')).toBe(true)
    expect(valorEstaNoTexto(prepararTextoParaConferir('Sra. İLKAY Sintética'), 'ilkay sintetica')).toBe(true)
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

  /**
   * O remetente escolhe o texto, e a PREPARAÇÃO também entra na conta: a
   * expressão que achava endereços voltava atrás a cada letra de um trecho
   * sem `@` — 200 mil letras levavam dezenas de segundos antes de qualquer
   * orçamento (2ª rodada do #150).
   */
  it.each([
    ['letras sem @', 'x'.repeat(200_000)],
    ['@ repetido', 'a@'.repeat(100_000)],
    ['pontos entre letras', `a${'.'.repeat(200_000)}a`],
    ['pontos e @', `a${'.@'.repeat(100_000)}a`],
    ['"⅟", que a forma de compatibilidade dobra em dois', '⅟'.repeat(200_000)],
  ])('preparar um texto hostil (%s) não trava o servidor', (_nome, hostil) => {
    const inicio = performance.now()
    const preparado = prepararTextoParaConferir(hostil)
    valorEstaNoTexto(preparado, 'fulana@exemplo.test')
    valorEstaNoTexto(preparado, `a${'.'.repeat(1000)}a@b`)
    expect(performance.now() - inicio).toBeLessThan(2000)
  })

  it('orçamento esgotado conta como NÃO achado: o item vai para uma pessoa', () => {
    const doTexto = prepararTextoParaConferir('Nome: Fulana Sintética')
    doTexto.orcamento = 0
    expect(valorEstaNoTexto(doTexto, 'Fulana Sintética')).toBe(false)
    expect(PASSOS_POR_EMAIL).toBeGreaterThan(0)
  })

  /**
   * "Dado não encontrado no e-mail" de um valor que pode estar lá seria
   * mentir para quem revisa: o motivo diz que a conferência não terminou
   * (2ª rodada de segurança do #150).
   */
  it('orçamento esgotado tem motivo próprio, e a liga não vira identidade', () => {
    const doTexto = prepararTextoParaConferir('Nome: Fulana Sintética. Liga Sintética de Pediatria.')
    doTexto.orcamento = 0
    expect(conferirExtracao(doTexto, { nome: 'Fulana Sintética' }, null)).toEqual({
      motivo: 'conferencia_incompleta',
      campo: 'nome',
    })
    expect(conferirExtracao(doTexto, {}, 'Liga Sintética de Pediatria')).toEqual({
      motivo: 'conferencia_incompleta',
      campo: CAMPO_DA_LIGA,
    })
    expect(ligaEstaNoTexto(doTexto, 'Liga Sintética de Pediatria')).toBe(false)
  })

  /**
   * O valor também custa: 2 mil dígitos recortavam 2 mil prefixos, e 2 mil
   * pontos passavam pela limpeza, sem gastar passo (2ª rodada de segurança).
   */
  it('valores longos gastam orçamento, e 1.800 deles não travam o servidor', () => {
    const doTexto = prepararTextoParaConferir(`Nome: Fulana Sintética, CPF 111.444.777-35. ${'1 '.repeat(1000)}`)
    const inicio = performance.now()
    for (let i = 0; i < 600; i += 1) {
      valorEstaNoTexto(doTexto, `${i}${'1'.repeat(1990)}`)
      valorEstaNoTexto(doTexto, `a@${'.'.repeat(1990)}${i}`)
      valorEstaNoTexto(doTexto, `${'ﷺ'.repeat(1990)}${i}`)
    }
    expect(performance.now() - inicio).toBeLessThan(2000)
    expect(doTexto.orcamento).toBeLessThan(0)
  })
})
