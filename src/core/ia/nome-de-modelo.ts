/**
 * A forma de um nome de modelo de IA: identificador curto, sem espaço.
 *
 * O nome vem do FORNECEDOR (e, no caso do classificador, também de
 * `CLASSIFICADOR_MODELO`) e vai para dois lugares que duram: a trilha, que é
 * append-only e sem retenção, e `UsoDaIa.modelo`, que é `VARCHAR(191)` e faz
 * parte da chave primária — um nome maior derrubaria a gravação, e a chamada
 * sumiria da conta do teto diário. Uma frase no lugar do nome ("Maria…, Rua…")
 * levaria texto derivado do e-mail para os dois.
 *
 * Mora aqui, e não no adaptador, porque três lugares precisam da MESMA régua:
 * a política comum do classificador (trilha), a fábrica (`UsoDaIa`) e o
 * `ambiente()` (a variável). Revisões do #142 e do #143.
 */
export function ehNomeDeModelo(nome: string): boolean {
  return /^[\w.:/-]{1,100}$/.test(nome)
}
