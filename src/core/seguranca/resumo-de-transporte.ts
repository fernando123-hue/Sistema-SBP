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
 * PEDIDO. A Anthropic monta `"<status> <JSON do erro>"`, o Gemini (fora do
 * streaming, que não usamos) só `JSON.stringify` do corpo de erro, e a
 * `ia-local` só lança frases nossas. Quando o corpo NÃO é JSON — página de
 * erro de um proxy — os dois SDKs põem o texto cru na mensagem, sem limite de
 * tamanho. Sobra o que a própria API devolve, que pode citar um trecho do que
 * recebeu ("texto inválido perto de …") — e o trecho é o e-mail do associado.
 * O log não tem política de retenção (invariante 11), então: curto, e com
 * e-mail, CRM e número de documento mascarados. Status e código sobrevivem.
 *
 * NOME E ENDEREÇO NÃO SÃO COBERTOS — não há regex que ache nome em texto
 * livre. O resíduo foi aceito: o trecho é hipotético, e cabe em 300
 * caracteres (revisões do #132).
 */
const LIMITE = 300

// Só esta fatia é mascarada. Sem ela, uma página de proxy de 100 mil
// caracteres sem espaço parava o servidor inteiro por segundos (revisões do
// #132). Quatro vezes o limite: um endereço partido na borda desta fatia cai
// fora no corte final, e não sobra pedaço dele sem máscara.
const FATIA = LIMITE * 4

// Endereço de e-mail, em qualquer lugar do texto; `%40` é o `@` escapado em
// URL. Com teto de tamanho (os limites do próprio endereço), e não `+`: sem
// teto, um trecho longo sem `@` era varrido a partir de CADA posição.
const EMAIL = /[^\s@"'<>\\]{1,64}(?:@|%40)[^\s@"'<>\\]{1,255}\.[^\s@"'<>\\]{1,63}/gi

// O número depois de "CRM"/"RQE", mesmo curto demais para a regra de baixo.
// Tudo com teto: dois `\s*` em volta de um grupo que pode ser vazio é
// quadrático (revisões do #135).
const REGISTRO_PROFISSIONAL = /\b((?:CRM|RQE)(?:[-/ ]?[A-Z]{2})?[\s:º°.\-]{0,6})\d{1,7}/gi

// Oito ou mais dígitos, com até dois separadores entre eles: CPF, CNPJ,
// telefone. Os traços incluem os tipográficos (o Outlook troca o hífen
// sozinho). Espaço, sim; quebra de linha, não — `503\n12345678` engolia o
// status. Status HTTP e códigos curtos ficam de fora.
const NUMERO_DE_DOCUMENTO = /\d(?:[.\-/ \t\u00a0\u2010-\u2014]{0,2}\d){7,}/g

export function resumoDeTransporte(causa: string): string {
  const mascarado = causa
    .slice(0, FATIA)
    .replace(EMAIL, '[e-mail]')
    .replace(REGISTRO_PROFISSIONAL, (_inteiro, prefixo: string) => `${prefixo}[número]`)
    .replace(NUMERO_DE_DOCUMENTO, '[número]')
  return truncar(mascarado, LIMITE)
}
