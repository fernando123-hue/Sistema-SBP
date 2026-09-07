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

/**
 * Piso de tempo de QUALQUER recusa de entrada.
 *
 * ═══ POR QUE IGUALAR O HASH NÃO BASTOU ═══
 *
 * `gastarTempoDeConferencia` iguala o custo do `scrypt` quando o e-mail não
 * existe, e a intenção estava certa: sem ele, "não existe" responde em 1 ms e
 * "senha errada" em ~90 ms, e o relógio conta o que a mensagem se recusa a
 * dizer. Só que a igualdade valia para o scrypt e para mais nada.
 *
 * O ramo de conta ATIVA com senha errada faz, DEPOIS do hash, escritas que o
 * ramo do e-mail inexistente não faz: incrementa `tentativasFalhas`, grava
 * `entrada_recusada` na trilha, e às vezes ainda grava `bloqueadoAte`. Cada uma
 * é uma transação com fsync. Medido neste repositório, com o banco de teste e
 * 30 amostras alternadas: mediana de 92,3 ms para e-mail inexistente contra
 * 115,7 ms para conta ativa com senha errada — 23,5 ms de diferença, com 22 das
 * 30 amostras do segundo caminho acima do p75 do primeiro.
 *
 * Vinte e cinco milissegundos, com ~5 amostras por endereço, respondem "esta
 * conta existe e está ativa" — que é exatamente a lista que a mensagem única
 * existe para não entregar.
 *
 * ═══ POR QUE UM PISO, E NÃO MAIS CONTABILIDADE ═══
 *
 * Tentar igualar operação a operação — gravar um registro descartável no ramo
 * do e-mail inexistente, por exemplo — polui a trilha com fatos que não
 * aconteceram e quebra de novo no dia em que alguém acrescentar uma escrita a
 * um dos lados. O piso não depende de o que há dentro dos ramos continuar
 * simétrico: ele mede do começo ao fim e espera o que faltar.
 *
 * O valor fica acima do pior caso medido (p75 de 148 ms) com folga para máquina
 * mais lenta. Ele NÃO se aplica à entrada bem-sucedida: quem acertou a senha já
 * provou conhecê-la, e atrasar quem acerta é custo sem defesa.
 */
export const PISO_DE_RESPOSTA_DE_ENTRADA_MS = 250

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
