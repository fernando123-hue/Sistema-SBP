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
 * Nenhum erro DA LIMPEZA derruba o servidor. (A configuração errada derruba,
 * de propósito e só em produção: ver `conferirAmbienteNaSubida`.) A limpeza que falha fica em
 * `ExecucaoDeRotina` e `EventoProcessamento` e é tentada de novo; parar a
 * equipe inteira de trabalhar porque a limpeza falhou trocaria um problema
 * visível por um maior.
 */

import type { ArmazenamentoPort } from './ports/armazenamento'

/**
 * Confere o ambiente na subida e, em produção, ENCERRA o processo se ele
 * estiver errado (pendência 49).
 *
 * Antes, um `ambiente()` inválido virava "Failed to prepare server" no log e o
 * processo seguia de pé respondendo 500 a toda requisição: o supervisor
 * (systemd) via um serviço rodando, e o TI só descobria quando alguém
 * reclamasse. Falhar alto é sair com código diferente de zero, que o
 * supervisor acusa e registra na hora.
 *
 * Só em produção, pelo literal que o Next fixa no build (`AT-63`): em
 * desenvolvimento, derrubar o `next dev` a cada `.env` meio escrito atrapalha,
 * e a tela de erro já mostra o motivo. A mensagem é a de `ambiente()`, que
 * nunca leva valor de segredo.
 *
 * `sair` e `escrever` são injetados só para o teste não encerrar a suíte.
 */
export async function conferirAmbienteNaSubida(
  // Sai DEPOIS de o stderr esvaziar: no Windows (a validação do `A74`) a
  // escrita em pipe é assíncrona, e sair na hora cortaria o motivo (revisão
  // técnica do #183). O `write` vazio só chama de volta quando a fila andou.
  sair: (codigo: number) => void = (codigo) => process.stderr.write('', () => process.exit(codigo)),
  escrever: (texto: string) => void = (texto) => process.stderr.write(texto),
): Promise<void> {
  // A carga do módulo fica FORA do `try` da configuração: código que não
  // carrega (build corrompido, dependência quebrada) não pode mandar o TI
  // conferir o `.env` (revisão técnica do #183).
  let ambiente: () => unknown
  try {
    ;({ ambiente } = await import('./servidor/ambiente'))
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    escrever(`O servidor NÃO subiu: o código não carregou (confira o build e as dependências, não o .env). ${motivo}\n`)
    if (process.env['NODE_ENV'] === 'production') sair(1)
    return
  }

  try {
    ambiente()
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro)
    if (process.env['NODE_ENV'] === 'production') {
      escrever(`O servidor NÃO subiu: a configuração está errada. ${motivo}\n`)
      sair(1)
      return
    }
    escrever(`Configuração inválida (em produção, isto encerraria o servidor): ${motivo}\n`)
  }
}

/**
 * Confere, na subida, que a SESSÃO da aplicação no MySQL está em modo estrito
 * (revisão de segurança do #204). `db:conferir-trilha` e `db:privilegios` só
 * conferem quando o TI roda o comando; um `SET GLOBAL` ou um `my.cnf` mexido
 * depois passaria calado — e sem modo estrito, linha sem domínio é gravada com
 * aviso em vez de recusada (#199), e texto longo é cortado.
 *
 * Em produção, modo LIDO e não estrito encerra com código 1, como a
 * configuração errada. O que não deu para LER (banco ainda subindo, na ordem
 * do systemd) só vai ao log: derrubar aqui viraria laço de reinício por um
 * problema que não é do modo, e a primeira requisição já falha alto pelo banco.
 *
 * `lerModo`, `sair` e `escrever` são injetados só para o teste.
 */
export async function conferirModoSqlNaSubida(
  lerModo: () => Promise<unknown> = lerModoDaSessao,
  sair: (codigo: number) => void = (codigo) => process.stderr.write('', () => process.exit(codigo)),
  escrever: (texto: string) => void = (texto) => process.stderr.write(texto),
): Promise<void> {
  let modo: unknown
  try {
    modo = await lerModo()
  } catch (erro) {
    escrever(`não deu para conferir o modo SQL na subida: ${erro instanceof Error ? erro.message : String(erro)}\n`)
    return
  }

  const { modoSqlEstrito } = await import('./servidor/privilegios')
  let estrito: boolean
  try {
    estrito = modoSqlEstrito(modo)
  } catch (erro) {
    estrito = false
    escrever(`${erro instanceof Error ? erro.message : String(erro)}\n`)
  }
  if (estrito) return

  const motivo =
    `a sessão do MySQL não está em modo estrito (sql_mode: ${String(modo)}). Sem STRICT_TRANS_TABLES, ` +
    'linha sem domínio é gravada com aviso em vez de recusada. Ajuste o sql_mode do servidor (docs/INSTALACAO.md, seção 1).'
  if (process.env['NODE_ENV'] === 'production') {
    escrever(`O servidor NÃO subiu: ${motivo}\n`)
    sair(1)
    return
  }
  escrever(`Aviso (em produção, isto encerraria o servidor): ${motivo}\n`)
}

/** A sessão que a aplicação usa: a mesma `obterPrisma()` das rotas. */
async function lerModoDaSessao(): Promise<unknown> {
  const { obterPrisma } = await import('./servidor/prisma')
  const [linha] = await obterPrisma().$queryRaw<{ modo: unknown }[]>`SELECT @@SESSION.sql_mode AS modo`
  return linha?.modo
}

const MINUTOS_ENTRE_TENTATIVAS = 15

/**
 * Avisa no log, na subida, que `SESSAO_SECRET_ANTERIOR` está definida (`AT-50`).
 *
 * Na subida, e não na primeira leitura de cookie: com a variável esquecida e o
 * processo reiniciando sozinho, nenhum cookie da chave anterior chega, e o
 * aviso nunca sairia (2ª rodada de revisão do #146).
 *
 * Como a limpeza, nenhum erro DO AVISO derruba o servidor. Em produção, um
 * ambiente inválido já encerrou o processo antes, em `conferirAmbienteNaSubida`;
 * em desenvolvimento ele chega aqui e aparece como falha do aviso. Nos dois
 * casos a mensagem de `ambiente()` vai ao log, e por isso nunca leva valor de
 * segredo.
 */
export async function avisarTrocaDaChaveDeSessao(): Promise<void> {
  // O modo de desenvolvimento pode chamar `register` de novo ao recarregar:
  // sem a marca, cada recarga repetiria o aviso e agendaria outro temporizador.
  const marca = globalThis as typeof globalThis & { avisoDaTrocaDeSessaoFeito?: boolean }
  if (marca.avisoDaTrocaDeSessaoFeito === true) return
  marca.avisoDaTrocaDeSessaoFeito = true
  try {
    const { avisarTrocaDaChaveEmCurso } = await import('./servidor/sessao')
    avisarTrocaDaChaveEmCurso()
  } catch (erro) {
    process.stderr.write(
      `o aviso de troca da chave de sessão NÃO foi feito (${erro instanceof Error ? erro.message : String(erro)})\n`,
    )
  }
}

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
