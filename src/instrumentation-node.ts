/**
 * Agenda a limpeza diária de `A17` no processo do servidor. Só runtime Node —
 * ver `instrumentation.ts`.
 *
 * ═══ POR QUE UM TEMPORIZADOR, E NÃO UM AGENDADOR DE FORA ═══
 *
 * O sistema roda num servidor só, ligado o dia inteiro, na rede da associação.
 * Um cron do sistema operacional seria mais uma peça para instalar, lembrar e
 * conferir em cada máquina — e a que esquecem é a que deixa dado de saúde
 * guardado além do prazo sem ninguém saber. Tentar a cada quinze minutos, com a
 * linha `(rotina, data)` única garantindo uma execução por dia, não depende de
 * nada além do próprio servidor. Hipótese em `DECISOES.md § AT-18`; em
 * implantação sem servidor ligado o dia todo, `npm run db:expurgar` num cron
 * faz o mesmo trabalho, pela mesma trava.
 *
 * ═══ O QUE NÃO ACONTECE AQUI ═══
 *
 * Nenhum erro derruba o servidor. A limpeza que falha fica em
 * `ExecucaoDeRotina` e `EventoProcessamento` e é tentada de novo; parar a
 * equipe inteira de trabalhar porque a limpeza falhou trocaria um problema
 * visível por um maior.
 */

import type { ArmazenamentoPort } from './ports/armazenamento'

const MINUTOS_ENTRE_TENTATIVAS = 15

export async function agendarLimpezaDiaria(): Promise<void> {
  // O modo de desenvolvimento pode chamar `register` de novo ao recarregar.
  // Dois temporizadores não duplicariam a limpeza (a trava é no banco), mas
  // dobrariam as tentativas e o ruído no log.
  const marca = globalThis as typeof globalThis & { limpezaDiariaAgendada?: boolean }
  if (marca.limpezaDiariaAgendada === true) return
  marca.limpezaDiariaAgendada = true

  // A carga dos módulos também fica dentro da promessa de "nenhum erro derruba o
  // servidor": um módulo quebrado aqui faria `register` rejeitar, e o que o Next
  // faz com isso não é contrato documentado. Sem o registrador carregado, o
  // único canal que resta é o stderr.
  let modulos
  try {
    modulos = await Promise.all([
      import('./servicos/rotinas'),
      import('./servidor/prisma'),
      import('./servidor/observabilidade'),
      import('./adapters/fabrica'),
    ])
  } catch (erro) {
    marca.limpezaDiariaAgendada = false
    process.stderr.write(
      `a limpeza diária NÃO foi agendada: falha ao carregar os módulos (${erro instanceof Error ? erro.message : String(erro)})\n`,
    )
    return
  }
  const [{ rodarLimpezaDiaria }, { obterPrisma }, { mensagemDoErro, registrarLog }, { criarArmazenamentoPort }] =
    modulos

  const tentar = (): void => {
    // Sem armazenamento, a limpeza segue sem ele: o motivo de afastamento sai, e
    // e-mail com anexo fica pendente com a execução marcada como falha — nunca
    // "apagado do banco" com o arquivo ainda no disco.
    let armazenamento: ArmazenamentoPort | null = null
    try {
      armazenamento = criarArmazenamentoPort()
    } catch (erro) {
      registrarLog('erro', 'armazenamento de anexos indisponível para a limpeza diária', {
        erro: mensagemDoErro(erro),
      })
    }

    // `rodarLimpezaDiaria` já registra a própria falha. Chega aqui só o que
    // impediu até de começar — banco inacessível, ambiente mal configurado.
    rodarLimpezaDiaria(obterPrisma(), { armazenamento }).catch((erro: unknown) => {
      registrarLog('erro', 'a limpeza diária não conseguiu nem começar', { erro: mensagemDoErro(erro) })
    })
  }

  tentar()
  // `unref`: o temporizador não segura o processo vivo quando o servidor para.
  setInterval(tentar, MINUTOS_ENTRE_TENTATIVAS * 60_000).unref()
}
