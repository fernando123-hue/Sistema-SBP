import { ErroDeNegocio } from '../core/erros'
import {
  CadastroDeColaboradorSchema,
  HabilitacaoEntradaSchema,
  type Papel,
} from '../core/esquemas'
import { exigirPapel, type Ator } from '../servidor/ator'
import { gerarHash, sortearSenhaProvisoria } from '../servidor/credenciais'
import { novaCorrelacao } from '../servidor/observabilidade'
import type { Banco, Transacao } from '../servidor/prisma'
import { auditar } from './auditoria'

/**
 * Cadastro de pessoas e do que cada uma pode receber.
 *
 * Até aqui só o seed criava colaborador, o que significava que montar a equipe
 * exigia acesso ao terminal e ao banco. Cadastro e habilitação entram JUNTOS de
 * propósito: quem trabalha na fila e nasce sem categoria nenhuma não aparece na
 * tela de plantão nem entra no rateio — some da operação sem que nada acuse.
 * Meia funcionalidade aqui é pior que nenhuma.
 *
 * Nada nunca é apagado. Tirar uma categoria de alguém desliga `podeReceber` na
 * linha que já existe; o histórico de carga e a trilha de auditoria precisam
 * continuar respondendo quem recebeu o quê no ano passado.
 */

export interface ColaboradorCriado {
  colaboradorId: string
  nome: string
  email: string
  papel: Papel
  /** Em texto, UMA vez, para o gestor entregar. Só o hash é gravado. */
  senhaProvisoria: string
  categorias: string[]
}

/**
 * Confere que todo código pedido existe e está ativo, e devolve o id de cada um.
 *
 * Aceitar um código inexistente criaria uma habilitação que nunca casa com
 * categoria nenhuma: a pessoa apareceria habilitada na tela e continuaria fora
 * de todo rateio. Erro de digitação virando trabalhador invisível.
 */
async function resolverCategorias(
  tx: Transacao,
  codigos: readonly string[],
): Promise<{ id: string; codigo: string }[]> {
  if (codigos.length === 0) return []

  const pedidos = [...new Set(codigos)]
  const encontradas = await tx.categoria.findMany({
    where: { codigo: { in: pedidos }, ativa: true },
    select: { id: true, codigo: true },
  })

  if (encontradas.length !== pedidos.length) {
    const achadas = new Set(encontradas.map((categoria) => categoria.codigo))
    const faltando = pedidos.filter((codigo) => !achadas.has(codigo))
    throw new ErroDeNegocio(
      `Categoria inexistente ou inativa: ${faltando.join(', ')}. ` +
        `A habilitação não foi gravada — nenhuma categoria da lista foi aplicada.`,
    )
  }

  return encontradas
}

export async function criarColaborador(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<ColaboradorCriado> {
  exigirPapel(ator, 'cadastrar colaborador', 'gestor')
  const dados = CadastroDeColaboradorSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  const senhaProvisoria = sortearSenhaProvisoria()
  // Fora da transação: derivar o hash custa ~80ms de CPU de propósito, e
  // segurar uma transação aberta por isso serializa escrita do banco inteiro.
  const senhaHash = await gerarHash(senhaProvisoria)

  const criado = await banco.$transaction(async (tx) => {
    // O índice único do banco é a garantia real; esta consulta existe só para
    // trocar o erro cru de constraint por uma frase que diz o que fazer.
    const jaExiste = await tx.colaborador.findUnique({
      where: { email: dados.email },
      select: { id: true, ativo: true },
    })
    if (jaExiste) {
      throw new ErroDeNegocio(
        `Já existe colaborador com o e-mail "${dados.email}"` +
          (jaExiste.ativo
            ? '.'
            : ', com o acesso desligado. Reative em vez de cadastrar de novo — ' +
              'criar outra pessoa duplicaria o histórico de carga.'),
      )
    }

    const categorias = await resolverCategorias(tx, dados.categorias)

    const colaborador = await tx.colaborador.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        papel: dados.papel,
        senhaHash,
        senhaDefinidaEm: new Date(),
        // A janela em que outra pessoa conhece a senha termina no primeiro
        // acesso do dono.
        precisaTrocarSenha: true,
      },
      select: { id: true, nome: true, email: true, papel: true },
    })

    const vigenciaInicio = new Date()
    for (const categoria of categorias) {
      await tx.habilitacao.create({
        data: { colaboradorId: colaborador.id, categoriaId: categoria.id, vigenciaInicio },
      })
    }

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: 'colaborador_criado',
      depois: {
        nome: colaborador.nome,
        email: colaborador.email,
        papel: colaborador.papel,
        categorias: categorias.map((categoria) => categoria.codigo),
      },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return {
      colaboradorId: colaborador.id,
      nome: colaborador.nome,
      email: colaborador.email,
      papel: colaborador.papel as Papel,
      categorias: categorias.map((categoria) => categoria.codigo),
    }
  })

  return { ...criado, senhaProvisoria }
}

/**
 * Define o conjunto de categorias que alguém pode receber.
 *
 * A lista recebida é o estado final: o que não estiver nela é desligado.
 */
export async function definirHabilitacoes(
  banco: Banco,
  entrada: unknown,
  ator: Ator,
): Promise<{ colaboradorId: string; categorias: string[] }> {
  exigirPapel(ator, 'definir habilitação', 'gestor')
  const dados = HabilitacaoEntradaSchema.parse(entrada)
  const correlacaoId = novaCorrelacao()

  return banco.$transaction(async (tx) => {
    const colaborador = await tx.colaborador.findUnique({
      where: { id: dados.colaboradorId },
      select: { id: true },
    })
    if (!colaborador) {
      throw new ErroDeNegocio(`Colaborador "${dados.colaboradorId}" não existe.`)
    }

    const desejadas = await resolverCategorias(tx, dados.categorias)
    const desejadasPorId = new Set(desejadas.map((categoria) => categoria.id))

    const existentes = await tx.habilitacao.findMany({
      where: { colaboradorId: colaborador.id },
      select: { id: true, categoriaId: true, podeReceber: true },
    })
    const existentesPorCategoria = new Map(
      existentes.map((habilitacao) => [habilitacao.categoriaId, habilitacao]),
    )

    const antes = existentes
      .filter((habilitacao) => habilitacao.podeReceber)
      .map((habilitacao) => habilitacao.categoriaId)

    // Liga o que foi pedido.
    for (const categoria of desejadas) {
      const existente = existentesPorCategoria.get(categoria.id)
      if (!existente) {
        await tx.habilitacao.create({
          data: {
            colaboradorId: colaborador.id,
            categoriaId: categoria.id,
            vigenciaInicio: new Date(),
          },
        })
        continue
      }
      if (!existente.podeReceber) {
        await tx.habilitacao.update({
          where: { id: existente.id },
          data: { podeReceber: true },
        })
      }
    }

    // Desliga o que saiu da lista. NUNCA apaga: a linha é o registro de que
    // aquela pessoa esteve habilitada, e o histórico de carga se apoia nela.
    for (const habilitacao of existentes) {
      if (habilitacao.podeReceber && !desejadasPorId.has(habilitacao.categoriaId)) {
        await tx.habilitacao.update({
          where: { id: habilitacao.id },
          data: { podeReceber: false },
        })
      }
    }

    await auditar(tx, {
      entidade: 'Colaborador',
      entidadeId: colaborador.id,
      acao: 'habilitacao_definida',
      antes: { categoriaIds: antes },
      depois: { categoriaIds: [...desejadasPorId] },
      usuario: ator.colaboradorId,
      correlacaoId,
    })

    return {
      colaboradorId: colaborador.id,
      categorias: desejadas.map((categoria) => categoria.codigo),
    }
  })
}
