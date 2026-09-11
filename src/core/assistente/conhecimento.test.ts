import { describe, expect, it } from 'vitest'

import { PapelSchema } from '../esquemas'
import { buscarNoManual, normalizar } from './busca'
import {
  MANUAL,
  PAPEIS_DA_TELA,
  TELAS,
  papelAlcancaTela,
  selecionarVerbetes,
} from './conhecimento'
import { montarMaterial } from './prompt'

/**
 * O manual é documentação executável, e envelhece como toda documentação.
 *
 * Estes testes travam o que dá para travar por máquina — que toda tela citada
 * existe, que todo papel citado é válido, que id não se repete, que a filtragem
 * por papel de fato filtra. A EXATIDÃO DO TEXTO continua sendo responsabilidade
 * de quem altera o sistema: nenhum teste aqui percebe se o verbete "como
 * distribuir" descreve um botão que mudou de nome.
 */

const PAPEIS = ['colaborador', 'operador', 'gestor'] as const

describe('manual do assistente', () => {
  it('não tem identificador repetido — o servidor confere citações por ele', () => {
    const ids = MANUAL.map((verbete) => verbete.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('só cita telas que existem', () => {
    for (const verbete of MANUAL) {
      if (verbete.tela === null) continue
      expect(TELAS).toContain(verbete.tela)
    }
  })

  it('só cita papéis válidos', () => {
    for (const verbete of MANUAL) {
      for (const papel of verbete.papeis) {
        expect(() => PapelSchema.parse(papel)).not.toThrow()
      }
    }
  })

  it('nunca oferece a um papel uma tela que aquele papel não alcança', () => {
    // Um verbete de colaborador que aponte para `/acesso` mandaria a pessoa
    // bater numa porta que a API tranca — e concluir que o sistema quebrou.
    for (const verbete of MANUAL) {
      if (verbete.tela === null) continue
      for (const papel of verbete.papeis) {
        expect(PAPEIS_DA_TELA[verbete.tela]).toContain(papel)
      }
    }
  })

  it('todo papel recebe pelo menos um verbete', () => {
    for (const papel of PAPEIS) {
      expect(selecionarVerbetes(papel).length).toBeGreaterThan(0)
    }
  })
})

describe('filtragem por papel', () => {
  it('não entrega ao colaborador o verbete restrito a gestor', () => {
    const doColaborador = selecionarVerbetes('colaborador').map((verbete) => verbete.id)
    expect(doColaborador).not.toContain('gestao-de-acesso')
    expect(doColaborador).not.toContain('motivo-de-afastamento')
  })

  it('não entrega ao operador o verbete restrito a gestor', () => {
    const doOperador = selecionarVerbetes('operador').map((verbete) => verbete.id)
    expect(doOperador).not.toContain('gestao-de-acesso')
    expect(doOperador).not.toContain('motivo-de-afastamento')
  })

  it('o material do prompt do colaborador não contém o texto restrito a gestor', () => {
    // A garantia que interessa não é "o verbete foi filtrado da lista" — é que
    // o TEXTO dele não está na string que sai para o fornecedor de IA.
    const material = montarMaterial({ nome: '', papel: 'colaborador', itensNaFila: 0 })
    expect(material.instrucoes).not.toContain('só o gestor vê POR QUÊ')
    expect(material.instrucoes).not.toContain('destrava conta bloqueada')
  })

  it('o material do gestor contém o que é dele', () => {
    const material = montarMaterial({ nome: '', papel: 'gestor', itensNaFila: 0 })
    expect(material.instrucoes).toContain('destrava conta bloqueada')
  })

  it('o material nunca leva o nome de quem pergunta ao modelo', () => {
    const material = montarMaterial({ nome: 'Fulano Sintético', papel: 'operador', itensNaFila: 3 })
    expect(material.instrucoes).not.toContain('Fulano Sintético')
  })

  it('o material declara ao modelo que ele não executa nada', () => {
    const material = montarMaterial({ nome: '', papel: 'gestor', itensNaFila: 0 })
    expect(material.instrucoes).toContain('Você não executa nada')
  })
})

describe('papelAlcancaTela', () => {
  it('reconhece o que cada papel alcança', () => {
    expect(papelAlcancaTela('gestor', '/acesso')).toBe(true)
    expect(papelAlcancaTela('operador', '/acesso')).toBe(false)
    expect(papelAlcancaTela('colaborador', '/distribuicao')).toBe(false)
    expect(papelAlcancaTela('colaborador', '/fila')).toBe(true)
  })

  it('recusa tela que não existe, inclusive caminho forjado', () => {
    expect(papelAlcancaTela('gestor', '/nao-existe')).toBe(false)
    expect(papelAlcancaTela('gestor', 'https://exemplo.test')).toBe(false)
    expect(papelAlcancaTela('gestor', '//exemplo.test')).toBe(false)
  })
})

describe('busca no manual', () => {
  it('tira acento antes de comparar — quem digita com pressa não acentua', () => {
    expect(normalizar('Revisão')).toBe('revisao')
  })

  it('acha o verbete certo para a pergunta que a operação faz', () => {
    const achados = buscarNoManual('como eu distribuo o dia?', selecionarVerbetes('operador'))
    expect(achados[0]?.verbete.id).toBe('como-distribuir')
  })

  it('acha devolução sem que a pessoa saiba o nome do verbete', () => {
    const achados = buscarNoManual(
      'esse item nao e comigo, como devolvo?',
      selecionarVerbetes('colaborador'),
    )
    expect(achados[0]?.verbete.id).toBe('devolver-e-transferir')
  })

  it('não devolve nada quando a pergunta não é sobre o sistema', () => {
    const achados = buscarNoManual('qual a capital da Mongólia', selecionarVerbetes('operador'))
    expect(achados).toHaveLength(0)
  })

  it('não devolve nada para pergunta só de conectivos', () => {
    // Sem a lista de palavras vazias, "o que é isso" pontuaria em todo verbete
    // e a busca devolveria sempre o primeiro da lista.
    const achados = buscarNoManual('o que é isso', selecionarVerbetes('operador'))
    expect(achados).toHaveLength(0)
  })

  it('não encontra verbete de gestor para quem não é gestor', () => {
    const pergunta = 'como destravar a conta bloqueada de alguem'

    // A garantia é de ALCANCE, não de ordem: o gestor consegue chegar ao
    // verbete que é dele, e o operador não o encontra de jeito nenhum.
    // Qual dos verbetes elegíveis vence o ranking é qualidade de busca e muda
    // com a redação do manual; o que não pode mudar é o que cada papel alcança.
    const paraGestor = buscarNoManual(pergunta, selecionarVerbetes('gestor'))
    expect(paraGestor.map((achado) => achado.verbete.id)).toContain('gestao-de-acesso')

    const paraOperador = buscarNoManual(pergunta, selecionarVerbetes('operador'))
    expect(paraOperador.map((achado) => achado.verbete.id)).not.toContain('gestao-de-acesso')
  })
})

describe('qualidade do casamento — regressões vistas na tela', () => {
  it('acha o verbete certo mesmo com o verbo conjugado de outro jeito', () => {
    // "destravo" nunca casaria com "destravar" por substring. A pergunta caía
    // no verbete do RATEIO, por causa de "conta" e "colegas", e o assistente
    // respondia sobre outro assunto com ar de quem sabia.
    const achados = buscarNoManual(
      'como destravo a conta bloqueada de um colega?',
      selecionarVerbetes('operador'),
    )
    expect(achados[0]?.verbete.id).toBe('senha-e-bloqueio')
  })

  it('não confunde palavras que só começam parecido', () => {
    // `conta` (a da divisão) e `contagem` têm radicais distintos; casar por
    // substring juntaria as duas.
    expect(normalizar('contagem').startsWith('conta')).toBe(true)
    const achados = buscarNoManual('revisar item', selecionarVerbetes('operador'))
    expect(achados[0]?.verbete.id).toBe('revisao')
  })

  it('duas palavras comuns coincidindo não valem uma resposta', () => {
    // Abaixo do peso de um acerto no título é ruído. Dizer "não sei" é melhor
    // que responder com o verbete errado.
    const achados = buscarNoManual('a conta do colega', selecionarVerbetes('operador'))
    expect(achados).toHaveLength(0)
  })
})
