/**
 * Política de acesso — domínio puro.
 *
 * Nada aqui sabe o que é banco, cookie ou requisição: são as REGRAS de quando
 * uma conta trava e por quanto tempo, isoladas para poderem ser testadas em
 * milissegundos e mudadas sem tocar em infraestrutura.
 *
 * O hash em si mora em `src/servidor/credenciais.ts` — depende do runtime.
 */

/** Erros consecutivos tolerados antes de a conta travar. */
export const TENTATIVAS_ANTES_DE_TRAVAR = 5

/** Teto do atraso. Sem ele, o dobro sucessivo chega a horas e vira negação de serviço contra o próprio usuário. */
export const BLOQUEIO_MAXIMO_SEGUNDOS = 15 * 60

const BLOQUEIO_BASE_SEGUNDOS = 30

/**
 * Quanto tempo a conta fica travada depois de `tentativasFalhas` erros seguidos.
 *
 * Progressivo e com teto: dedo trocado custa segundos, força bruta fica
 * inviável, e ninguém precisa abrir chamado para voltar a trabalhar. Devolve
 * `0` enquanto o limite não foi atingido.
 *
 * Deliberadamente NÃO é bloqueio permanente: trancar até intervenção humana
 * transformaria "errar a senha de um colega de propósito" em ferramenta para
 * deixá-lo fora do sistema.
 */
export function segundosDeBloqueio(tentativasFalhas: number): number {
  if (tentativasFalhas < TENTATIVAS_ANTES_DE_TRAVAR) return 0

  const excedentes = tentativasFalhas - TENTATIVAS_ANTES_DE_TRAVAR
  const atraso = BLOQUEIO_BASE_SEGUNDOS * 2 ** excedentes
  return Math.min(atraso, BLOQUEIO_MAXIMO_SEGUNDOS)
}

/** Segundos restantes de bloqueio, ou `0` se a conta está liberada. */
export function bloqueioRestanteEmSegundos(bloqueadoAte: Date | null, agora: Date): number {
  if (!bloqueadoAte) return 0
  const restante = Math.ceil((bloqueadoAte.getTime() - agora.getTime()) / 1000)
  return restante > 0 ? restante : 0
}
