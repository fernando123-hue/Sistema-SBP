import { truncar } from './conteudo-nao-confiavel'

/**
 * O que vai ao log de uma falha de TRANSPORTE do modelo (pendência 10).
 *
 * `resumoDeValidacao` cuida da falha de validação, que é derivada da resposta
 * do modelo. A de transporte é texto do fornecedor (`503`, `overloaded_error`,
 * `RESOURCE_EXHAUSTED`) e é o que a operação precisa ler para saber o que
 * arrumar — por isso ela ia inteira.
 *
 * Conferido nos SDKs instalados (revisão de segurança do #90): nenhum ecoa o
 * PEDIDO. A Anthropic monta `"<status> <JSON do erro>"`, o Gemini
 * `"got status: … <JSON do erro>"`, e a `ia-local` só lança frases nossas.
 * Sobra o corpo de erro que a própria API devolve, que pode citar um trecho do
 * que recebeu ("texto inválido perto de …") — e o trecho é o e-mail do
 * associado. O log não tem política de retenção (invariante 11), então:
 * curto, e com e-mail e número de documento mascarados. Status e código
 * sobrevivem.
 */
const LIMITE = 300

// Endereço de e-mail, em qualquer lugar do texto.
const EMAIL = /[^\s@"'<>\\]+@[^\s@"'<>\\]+\.[^\s@"'<>\\]+/g

// Oito ou mais dígitos, com ou sem pontuação entre eles: CPF, CNPJ, telefone,
// CRM longo. Status HTTP e códigos curtos ficam de fora.
const NUMERO_DE_DOCUMENTO = /\d(?:[.\-/\s]?\d){7,}/g

export function resumoDeTransporte(causa: string): string {
  const mascarado = causa.replace(EMAIL, '[e-mail]').replace(NUMERO_DE_DOCUMENTO, '[número]')
  return truncar(mascarado, LIMITE)
}
