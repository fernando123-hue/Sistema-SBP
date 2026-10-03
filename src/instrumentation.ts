/**
 * O que o servidor liga ao subir.
 *
 * Hoje, quatro coisas: a conferência do ambiente, que em produção encerra o
 * processo se ele estiver errado (pendência 49); a do modo estrito do MySQL na
 * sessão da aplicação, que também encerra (revisão de segurança do #204); a limpeza diária de `A17` — "a limpeza roda sozinha, uma
 * vez por dia" — e o aviso de troca da chave de sessão em curso (`AT-50`). O
 * Next chama `register` uma vez por instância de servidor, e em todos os
 * runtimes: por isso este arquivo só decide SE liga, e o que só existe
 * em Node (banco, `process.stderr`, temporizador) mora em
 * `instrumentation-node.ts`, carregado apenas no runtime Node — o padrão da
 * documentação do Next.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // `next build` também carrega o servidor para gerar páginas. Limpeza de dado
  // não tem nada a fazer durante um build — e o banco da máquina que compila
  // pode nem ser o de produção.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { agendarLimpezaDiaria, avisarTrocaDaChaveDeSessao, conferirAmbienteNaSubida, conferirModoSqlNaSubida } =
    await import('./instrumentation-node')
  // Primeiro: com a configuração errada, em produção o processo encerra aqui
  // (pendência 49), antes de agendar rotina que não teria como rodar.
  await conferirAmbienteNaSubida()
  // Depois do ambiente (que configura o banco) e antes de qualquer rotina que
  // grave: sem modo estrito, em produção o processo também encerra aqui.
  await conferirModoSqlNaSubida()
  await avisarTrocaDaChaveDeSessao()
  await agendarLimpezaDiaria()
}
