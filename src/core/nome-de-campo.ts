/**
 * O nome de um campo extraído, na forma que pode ser guardada sem prazo.
 *
 * A CHAVE de `campos` também vem do modelo, e o modelo lê conteúdo hostil. O
 * esquema só limita o tamanho dela, e o prompt dá "nome, cpf, crm" como
 * exemplo, não como lista fechada: um e-mail pode fazer o modelo devolver
 * `{"111.444.777-35": "confirmado"}`, com o CPF no lugar do nome do campo.
 *
 * Onde o nome do campo sobrevive ao prazo do conteúdo — o acerto gravado na
 * revisão (`A23(c)`) —, só entra nome desta lista; qualquer outro vira
 * `outro`. A medida perde o detalhe de um campo raro e nunca guarda um dado
 * pessoal para sempre. Achado da revisão de segurança de 13/09/2026.
 */
export const NOMES_DE_CAMPO_CONHECIDOS = [
  'nome',
  'cpf',
  'crm',
  'email',
  'telefone',
  'instituicao',
  'matricula',
] as const

export const CAMPO_FORA_DA_LISTA = 'outro'

/**
 * "E-mail", "Instituição" e "CPF" são o mesmo campo que "email",
 * "instituicao" e "cpf": o modelo varia a escrita, e a comparação ignora
 * acento, maiúscula e tudo que não for letra.
 */
export function nomeDeCampoGravavel(chave: string): string {
  const forma = chave
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return NOMES_DE_CAMPO_CONHECIDOS.find((nome) => nome === forma) ?? CAMPO_FORA_DA_LISTA
}
