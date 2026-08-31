import { ErroDeNegocio } from '../core/erros'
import { RegistroManualSchema, serializar } from '../core/esquemas'
import { exigirPapel, type Ator } from '../servidor/ator'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Registro manual de item.
 *
 * Nem todo trabalho chega por e-mail. `INADIMP.` e `ISENTO` são lançadas
 * direto na planilha (`CAD-MAIO`, linha 35: `Mov.Extra = 11`), e aqui elas
 * estavam num beco sem saída — semeadas em `config.ts`, fora do rateio, e
 * proibidas à IA. Existiam no cadastro e eram inalcançáveis: nenhuma rota, nem
 * pela tela, nem pela API. Duas colunas da planilha simplesmente não tinham
 * como ser reproduzidas no substituto.
 *
 * O que este serviço NÃO faz, e por quê:
 *
 * - **Não move o livro-razão de crédito.** `entraNoRateio = false` significa
 *   exatamente "fora da matemática do rateio diário". Somar carga de `INADIMP.`
 *   em `SaldoCarga` faria uma categoria de exceção inclinar a cota justa das
 *   categorias reais — quem registrasse muitos inadimplentes apareceria credor
 *   e passaria a receber MENOS `DOC_CADASTRO`. Ficar de fora é a escolha
 *   reversível: começar a contar depois é decisão; despoluir um razão já
 *   acumulado exige recomputar histórico (o mesmo raciocínio de `H-D6`).
 *   Registrado em `DECISOES.md § AT-09`, e o volume continua VISÍVEL por
 *   pessoa no painel, que conta atribuição, não crédito.
 *
 * - **Não nasce concluído.** A planilha lança `Aberto = 11` e `Realizado = 11`
 *   no mesmo dia, na mesma célula. Reproduzir isso seria o operador declarando
 *   a conclusão do trabalho de outra pessoa — precisamente o que `concluir`
 *   recusa ("não há como declarar ter concluído o trabalho de outra pessoa").
 *   O item nasce `distribuido` na fila do responsável, e a conclusão continua
 *   sendo ato dele, com carimbo próprio.
 */

export interface RegistroManualFeito {
  itensCriados: string[]
  categoriaCodigo: string
  quantidade: number
  responsavel: { colaboradorId: string; nome: string } | null
}

/**
 * Confere a categoria e a coerência entre "entra no rateio" e "tem responsável".
 *
 * Separado da gravação porque as duas recusas abaixo precisam sair ANTES de
 * qualquer item existir: criar cinco e falhar no sexto deixaria meio
 * lançamento no banco, e o operador não teria como saber quantos passaram.
 */
async function conferirDestino(
  tx: Transacao,
  codigo: string,
  colaboradorId: string | null,
): Promise<{ categoriaId: string }> {
  const categoria = await tx.categoria.findUnique({
    where: { codigo },
    select: { id: true, ativa: true, entraNoRateio: true },
  })

  if (!categoria || !categoria.ativa) {
    throw new ErroDeNegocio(
      `Categoria "${codigo}" não existe ou está inativa. Nenhum item foi criado.`,
    )
  }

  if (categoria.entraNoRateio && colaboradorId !== null) {
    throw new ErroDeNegocio(
      `A categoria "${codigo}" entra no rateio diário: quem escolhe o responsável é o ` +
        `motor de distribuição, não quem registra. O item foi recusado em vez de criado ` +
        `sem dono — envie sem responsável e ele entra na próxima rodada, ou use ` +
        `transferência depois de distribuído, que deixa justificativa no histórico.`,
    )
  }

  if (!categoria.entraNoRateio && colaboradorId === null) {
    throw new ErroDeNegocio(
      `A categoria "${codigo}" fica fora do rateio diário, então o motor nunca vai ` +
        `atribuir este item a ninguém. Sem responsável ele nasceria pendente para ` +
        `sempre, engordando o painel sem que ninguém pudesse concluí-lo. Informe quem ` +
        `atendeu.`,
    )
  }

  return { categoriaId: categoria.id }
}

/**
 * Confere que o responsável existe e está ativo.
 *
 * Habilitação NÃO é exigida aqui, e a ausência é deliberada. `Habilitacao` ∩
 * escala do dia é o que governa quem o MOTOR pode escolher; este caminho é
 * outro — um gestor nomeando explicitamente quem atendeu, com trilha de
 * auditoria. Exigir habilitação inviabilizaria o registro na prática: ninguém
 * é semeado com `INADIMP.`/`ISENTO`, e lançar o atendimento de ontem quebraria
 * na escala de ontem.
 *
 * Já `ativo` é exigido: atribuir a alguém desligado cria um item que ninguém
 * pode concluir — a mesma pendência eterna que este serviço evita.
 */
async function exigirResponsavel(
  tx: Transacao,
  colaboradorId: string,
): Promise<{ colaboradorId: string; nome: string }> {
  const colaborador = await tx.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { id: true, nome: true, ativo: true },
  })

  if (!colaborador) {
    throw new ErroDeNegocio(`Colaborador "${colaboradorId}" não existe. Nenhum item foi criado.`)
  }
  if (!colaborador.ativo) {
    throw new ErroDeNegocio(
      `"${colaborador.nome}" está com o acesso desligado e não teria como concluir o item. ` +
        `Reative a pessoa ou registre em nome de quem atendeu de fato.`,
    )
  }

  return { colaboradorId: colaborador.id, nome: colaborador.nome }
}

export async function registrarManual(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<RegistroManualFeito> {
  exigirPapel(ator, 'registrar item manualmente', 'operador', 'gestor')
  const dados = RegistroManualSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const { categoriaId } = await conferirDestino(tx, dados.categoriaCodigo, dados.colaboradorId)

    const responsavel = dados.colaboradorId
      ? await exigirResponsavel(tx, dados.colaboradorId)
      : null

    const itensCriados: string[] = []

    for (let posicao = 0; posicao < dados.quantidade; posicao += 1) {
      const item = await tx.item.create({
        data: {
          // Nulo é o que marca "origem manual" no resto do sistema:
          // `planejarCategoria` já filtra por ele, e `caixa` já rotula assim.
          emailId: null,
          categoriaId,
          // `(emailId, sequencia)` é único, mas NULL é distinto de NULL num
          // índice único — a numeração aqui é só para distinguir os irmãos do
          // mesmo lançamento na lista, não para o banco.
          sequencia: posicao + 1,
          titulo: dados.titulo,
          payload: serializar({
            campos: {},
            camposAusentes: [],
            ligaMencionada: null,
            observacao: dados.observacao,
            revisadoPorHumano: true,
          }),
          // Um humano digitou: não há classificação de que duvidar. E
          // `modeloIa` fica nulo, que é o que mantém o item fora do
          // denominador da taxa de acerto da IA — sem isso, cada registro
          // manual entraria como um acerto de graça do modelo.
          confianca: 1,
          status: responsavel ? 'distribuido' : 'aprovado',
        },
        select: { id: true },
      })

      itensCriados.push(item.id)

      if (responsavel) {
        await tx.atribuicao.create({
          data: {
            itemId: item.id,
            colaboradorId: responsavel.colaboradorId,
            // Sem rodada: não houve rateio nenhum, e inventar uma faria a
            // conferência de conservação comparar uma entrada que não existiu.
            rodadaId: null,
            motivo: 'manual',
            atribuidoPor: ator.colaboradorId,
            ativa: true,
          },
        })
      }

      await auditar(tx, {
        entidade: 'Item',
        entidadeId: item.id,
        acao: 'item_registrado_manualmente',
        depois: {
          categoriaCodigo: dados.categoriaCodigo,
          titulo: dados.titulo,
          status: responsavel ? 'distribuido' : 'aprovado',
          colaboradorId: responsavel?.colaboradorId ?? null,
          observacao: dados.observacao,
          loteDe: dados.quantidade,
        },
        usuario: ator.colaboradorId,
        correlacaoId,
      })
    }

    return {
      itensCriados,
      categoriaCodigo: dados.categoriaCodigo,
      quantidade: itensCriados.length,
      responsavel,
    }
  })
}
