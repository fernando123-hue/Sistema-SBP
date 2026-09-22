import type { Banco, Transacao } from '../servidor/prisma'

/**
 * Um `Banco` cujo `$transaction` entrega um `tx` que anota cada chamada de
 * delegate (`modelo.metodo`), na ordem em que acontecem. Só para teste.
 *
 * O que ele prova é ORDEM e QUANTIDADE de chamadas: que a trava do dia vem
 * primeiro e que a gravação da rodada não voltou a ser item a item. A
 * CONCORRÊNCIA de verdade é observável desde que o banco virou MySQL (`A42`) e
 * tem testes próprios em `trava-de-distribuicao.test.ts` — foram eles que
 * mostraram que serializar a escrita não bastava (achado N-09).
 */
export function bancoQueAnota(banco: Banco, ordem: string[]): Banco {
  const anotarDelegate = (modelo: string, delegate: object) =>
    new Proxy(delegate, {
      get(alvo, metodo) {
        const valor: unknown = Reflect.get(alvo, metodo)
        if (typeof valor !== 'function' || typeof metodo !== 'string') return valor
        return (...argumentos: unknown[]) => {
          ordem.push(`${modelo}.${metodo}`)
          return (valor as (...a: unknown[]) => unknown).apply(alvo, argumentos)
        }
      },
    })

  const anotarTransacao = (tx: Transacao): Transacao =>
    new Proxy(tx, {
      get(alvo, chave) {
        const valor: unknown = Reflect.get(alvo, chave)
        // Consulta crua também entra na ordem: as travas `FOR UPDATE` e o
        // `INSERT ... ON DUPLICATE KEY UPDATE` da trava do dia moram nela.
        if ((chave === '$queryRaw' || chave === '$executeRaw') && typeof valor === 'function') {
          return (...argumentos: unknown[]) => {
            ordem.push(`tx.${chave}`)
            return (valor as (...a: unknown[]) => unknown).apply(alvo, argumentos)
          }
        }
        if (typeof chave !== 'string' || chave.startsWith('$')) return valor
        if (typeof valor !== 'object' || valor === null) return valor
        return anotarDelegate(chave, valor)
      },
    })

  return new Proxy(banco, {
    get(alvo, chave) {
      if (chave !== '$transaction') return Reflect.get(alvo, chave)
      return (executar: (tx: Transacao) => Promise<unknown>) =>
        alvo.$transaction((tx) => executar(anotarTransacao(tx)))
    },
  })
}
