import type { Papel } from './esquemas'

/**
 * As telas do sistema e quem alcança cada uma — fonte única.
 *
 * Existiam duas cópias mantidas à mão: `DESTINOS`, em `componentes/navegacao.tsx`,
 * que desenha os links, e `PAPEIS_DA_TELA`, em `core/assistente/conhecimento.ts`,
 * que a segunda conferência do assistente lê — com um comentário pedindo para
 * espelhar. Mudar uma e esquecer a outra acabava de dois jeitos, os dois calados:
 * o link aparece e o assistente apaga a sugestão, gravando aviso a cada pergunta
 * e poluindo o sinal que existe para pegar modelo escorregando; ou o assistente
 * manda a pessoa para uma tela que responde 403. Achado 20 da auditoria de
 * 08/09/2026.
 *
 * Os dois mapas são `Record<Tela, …>`: acrescentar uma tela em `TELAS` sem dizer
 * o rótulo e quem a alcança não compila. A seta continua apontando para dentro —
 * a navegação importa daqui.
 */

/** Na ordem em que aparecem na navegação. Fechada: o modelo não inventa destino. */
export const TELAS = ['/distribuicao', '/revisao', '/caixa', '/fila', '/painel', '/acesso'] as const

export type Tela = (typeof TELAS)[number]

/** "Isto é uma tela?" também com fonte única — sem `as Tela` espalhado. */
export function ehTela(caminho: string): caminho is Tela {
  return (TELAS as readonly string[]).includes(caminho)
}

export const ROTULO_DA_TELA: Readonly<Record<Tela, string>> = {
  '/distribuicao': 'Distribuição',
  '/revisao': 'Revisão',
  '/caixa': 'Caixa de entrada',
  '/fila': 'Minha fila',
  '/painel': 'Painel',
  '/acesso': 'Acesso',
}

/**
 * Quem alcança cada tela. A rota também confere no servidor: esconder o link é
 * conveniência, não proteção — quem digitar `/acesso` sem ser gestor recebe 403
 * da API.
 */
export const PAPEIS_DA_TELA: Readonly<Record<Tela, readonly Papel[]>> = {
  '/distribuicao': ['operador', 'gestor'],
  '/revisao': ['operador', 'gestor'],
  '/caixa': ['operador', 'gestor', 'colaborador'],
  '/fila': ['operador', 'gestor', 'colaborador'],
  '/painel': ['operador', 'gestor', 'colaborador'],
  '/acesso': ['gestor'],
}

/**
 * Onde cada papel começa: depois de entrar, depois de trocar a senha, na raiz
 * e no logotipo — uma regra só (achado N-31).
 *
 * Eram três cópias e um destino fixo: a troca de senha e o logotipo mandavam
 * todo mundo para a Distribuição, e o colaborador novo tinha como primeira
 * tela uma que não é dele, com controles que falham em 403.
 */
export function telaInicial(papel: string): Tela {
  return papel === 'colaborador' ? '/fila' : '/distribuicao'
}
