import { DOMINIO_ATUAL, OperacaoSchema, type Operacao, type Papel } from '../core/esquemas'
import { mensagemDoErro, novaCorrelacao, registrarEvento, registrarLog } from './observabilidade'
import type { Banco } from './prisma'

/**
 * Uma linha de negação por pessoa e tentativa a cada janela (achado C-24).
 *
 * `EventoProcessamento` nunca é apagado, e quem sonda escolhe quantas vezes
 * tenta: uma linha por recusa seria torneira de escrita. O que a investigação
 * precisa é saber que houve, quem, com que papel e o quê — e a sondagem
 * sustentada aparece como uma linha a cada janela. Mesmo desenho do rastro de
 * recusa de entrada (`servicos/autenticacao.ts`, C-19).
 */
const JANELA_DO_RASTRO_DE_NEGACAO_MS = 10 * 60 * 1000

/**
 * O que se tentou, em vocabulário FECHADO: a operação de `OperacaoSchema` (a
 * negação vertical) ou uma das tentativas horizontais abaixo. `mensagem` do
 * evento é gravada sem redação e para sempre, então o compilador — e não só
 * um comentário — garante que nenhum id, título ou nome entra aqui (revisão
 * de segurança do #130).
 */
export type Tentativa = Operacao | 'concluir item de outra pessoa'

/**
 * Registra uma recusa de autorização: log sempre, evento no máximo uma vez por
 * janela.
 *
 * Serve às duas sondagens: a VERTICAL (papel sem a operação, o 403 de
 * `rota()`) e a HORIZONTAL (mexer no item de outra pessoa, que responde 422 —
 * pendência 8). NUNCA o corpo da requisição nem o caminho com ids.
 *
 * A falha ao gravar não troca a resposta por outra coisa: quem recebe a recusa
 * continua recebendo a recusa; o defeito do registro vai para o log. Por isso
 * o banco pode vir como função: `obterPrisma()` que lance também cai no
 * `catch`, em vez de trocar o 403 por um 500 (revisão técnica do #130).
 */
export async function registrarNegacao(
  banco: Banco | (() => Banco),
  quem: { colaboradorId: string; papel: Papel },
  tentativa: Tentativa,
): Promise<void> {
  const tipo = OperacaoSchema.safeParse(tentativa).success ? 'vertical' : 'horizontal'
  const contexto = { colaboradorId: quem.colaboradorId, papel: quem.papel, operacao: tentativa, tipo }
  registrarLog('aviso', 'permissão negada', contexto)

  try {
    const bancoDaVez = typeof banco === 'function' ? banco() : banco
    const mensagem = `papel "${quem.papel}" tentou "${tentativa}"`
    const recente = await bancoDaVez.eventoProcessamento.findFirst({
      where: {
        // `situacao` junto de `etapa`: é o índice [situacao, etapa] da tabela,
        // que só cresce. Sem ela, cada recusa viraria varredura (revisão do #97).
        situacao: 'falha',
        etapa: 'autorizacao',
        // O domínio também: a tabela é compartilhada (invariante 14), e a linha
        // de outro sistema não pode calar a deste (revisão de segurança do #97).
        dominio: DOMINIO_ATUAL,
        referencia: quem.colaboradorId,
        mensagem,
        criadoEm: { gte: new Date(Date.now() - JANELA_DO_RASTRO_DE_NEGACAO_MS) },
      },
      select: { id: true },
    })
    if (recente) return

    await registrarEvento(bancoDaVez, {
      correlacaoId: novaCorrelacao(),
      etapa: 'autorizacao',
      situacao: 'falha',
      referencia: quem.colaboradorId,
      mensagem,
    })
  } catch (aoGravar) {
    registrarLog('erro', 'falha ao registrar a permissão negada', {
      ...contexto,
      erro: mensagemDoErro(aoGravar),
    })
  }
}
