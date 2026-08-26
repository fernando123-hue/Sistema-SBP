import type { Categoria, Elegivel } from '../tipos'
import { LIMIAR_INDIVISIVEL_PADRAO, PESO_PADRAO } from '../config'

/** Fábricas para os testes. Não faz parte do domínio. */

export function criarElegivel(
  colaboradorId: string,
  sobrescrever: Partial<Omit<Elegivel, 'colaboradorId'>> = {},
): Elegivel {
  return {
    colaboradorId,
    creditoCategoria: 0,
    creditoGlobal: 0,
    recebidoPeriodo: 0,
    recebidoDia: 0,
    capacidadeRelativa: 1,
    ...sobrescrever,
  }
}

export function criarCategoria(sobrescrever: Partial<Categoria> = {}): Categoria {
  return {
    id: 'LIGANTE',
    codigo: 'LIGANTE',
    rotulo: 'Ligante',
    frente: 'CADASTRO',
    grupo: 'LIGA',
    divisivel: true,
    peso: PESO_PADRAO,
    limiarIndivisivel: LIMIAR_INDIVISIVEL_PADRAO,
    entraNoRateio: true,
    ...sobrescrever,
  }
}
