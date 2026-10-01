import { describe, expect, it } from 'vitest'

import { camposParaCopiar } from './dados-do-item'

/** Valores 100% sintéticos (invariante 8). */
describe('camposParaCopiar (`A69`, 3B)', () => {
  it('põe os campos conhecidos primeiro, com rótulo da casa, e o resto em ordem alfabética', () => {
    const campos = camposParaCopiar({
      telefone: '(11) 90000-0000',
      zona: 'norte',
      cpf: '111.444.777-35',
      matricula: '48213',
      nome: 'Beltrana Sintética',
      apelido: 'Bel',
    })

    expect(campos).toEqual([
      { campo: 'nome', rotulo: 'Nome', valor: 'Beltrana Sintética' },
      { campo: 'cpf', rotulo: 'CPF', valor: '111.444.777-35' },
      { campo: 'matricula', rotulo: 'Matrícula', valor: '48213' },
      { campo: 'telefone', rotulo: 'Telefone', valor: '(11) 90000-0000' },
      { campo: 'apelido', rotulo: 'apelido', valor: 'Bel' },
      { campo: 'zona', rotulo: 'zona', valor: 'norte' },
    ])
  })

  it('deixa de fora o campo vazio e tira os espaços das pontas do que vai ser copiado', () => {
    expect(camposParaCopiar({ cpf: '  111.444.777-35 ', crm: '   ', email: '' })).toEqual([
      { campo: 'cpf', rotulo: 'CPF', valor: '111.444.777-35' },
    ])
  })

  // O nome do campo vem da IA: "toString" num objeto comum acharia a função
  // herdada (mesma armadilha de `lerSugestao`, 2ª rodada do #150).
  it('só lê chaves próprias com valor texto', () => {
    const campos = Object.assign(Object.create({ herdado: 'nao' }), { cpf: '111.444.777-35', numero: 5 })
    expect(camposParaCopiar(campos)).toEqual([{ campo: 'cpf', rotulo: 'CPF', valor: '111.444.777-35' }])
  })

  // O valor vai para a área de transferência e dali para o sistema da
  // associação: um controle de direção invisível colado num CPF viraria um
  // CPF diferente do que a pessoa viu (mesma regra do #163).
  it('troca a formatação invisível por um sinal visível, no valor e no nome do campo', () => {
    const [campo] = camposParaCopiar({ 'c​pf': '111‮444' })
    expect(campo!.valor).toBe('111�444')
    expect(campo!.rotulo).toBe('c�pf')
  })

  it('reconhece o campo conhecido sem depender de maiúsculas', () => {
    expect(camposParaCopiar({ CPF: '111.444.777-35' })[0]!.rotulo).toBe('CPF')
  })
})
