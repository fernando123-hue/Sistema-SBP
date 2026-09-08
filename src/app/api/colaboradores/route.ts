import type { ColaboradorResumo } from '../../../core/tipos'
import { criarColaborador } from '../../../servicos/colaboradores'
import { corpoJson, responder, rota } from '../../../servidor/http'
import { obterPrisma } from '../../../servidor/prisma'
import { exigirAtor } from '../../../servidor/sessao'
import { exigirPapel } from '../../../servidor/ator'

/**
 * Lista de colaboradores, com o estado de acesso de cada um.
 *
 * ERA PÚBLICA e não é mais. Enquanto a entrada não tinha senha, esta rota
 * precisava ser aberta — era ela que populava a tela de escolha de identidade,
 * e junto com `POST /api/sessao` significava que qualquer um que alcançasse o
 * servidor assumia qualquer identidade, inclusive a de gestor.
 *
 * Agora a entrada é por e-mail e senha e ninguém precisa ver a lista para
 * entrar. Quem consulta aqui é o gestor, para administrar acesso: nome e
 * papel da equipe são justamente o material de quem está montando um ataque
 * direcionado.
 *
 * Inclui os INATIVOS de propósito: sem eles a tela de acesso não teria como
 * reativar ninguém, e alguém desligado por engano ficaria invisível.
 */
export async function GET(): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    exigirPapel(ator, 'listar colaboradores', 'gestor')

    const colaboradores = await obterPrisma().colaborador.findMany({
      orderBy: [{ ativo: 'desc' }, { papel: 'asc' }, { nome: 'asc' }],
      select: {
        id: true,
        nome: true,
        papel: true,
        email: true,
        ativo: true,
        precisaTrocarSenha: true,
        senhaDefinidaEm: true,
        bloqueadoAte: true,
        tentativasFalhas: true,
        // Sem isto, a tela não tem como mostrar quem está sem categoria — e
        // quem está sem categoria some da distribuição sem nada acusar.
        habilitacoes: {
          where: { podeReceber: true },
          select: { categoria: { select: { codigo: true } } },
        },
      },
    })

    // O hash nunca sai daqui, em nenhuma forma. `senhaDefinidaEm` responde
    // "esta pessoa já tem acesso?" sem revelar nada sobre a senha em si.
    // ═══ CAMPO A CAMPO, E NÃO POR ESPALHAMENTO ═══
    //
    // `ColaboradorResumo` é a forma que a TELA lê, e anotar o alvo faz o
    // compilador comparar as duas — mas só em UMA direção. Campo que some
    // quebra a compilação; campo que SOBRA, entrando por `...colaborador`,
    // passa calado: espalhamento desliga a checagem de excedente. A prova está
    // na versão anterior desta linha, onde `habilitacoes: undefined` — chave
    // que `ColaboradorResumo` não declara — compilava sem uma reclamação.
    //
    // Consequência de verdade: alguém acrescenta `senhaHash: true` ao `select`
    // para investigar um bug de entrada, esquece de tirar, e o hash `scrypt` da
    // equipe inteira sai numa resposta HTTP. `tsc` verde, testes verdes, e a
    // promessa escrita três linhas acima — "o hash nunca sai daqui, em nenhuma
    // forma" — vira só prosa.
    //
    // Escrevendo campo a campo, o excedente não tem por onde entrar.
    const resumo: ColaboradorResumo[] = colaboradores.map((colaborador) => ({
      id: colaborador.id,
      nome: colaborador.nome,
      papel: colaborador.papel,
      email: colaborador.email,
      ativo: colaborador.ativo,
      precisaTrocarSenha: colaborador.precisaTrocarSenha,
      senhaDefinidaEm: colaborador.senhaDefinidaEm,
      bloqueadoAte: colaborador.bloqueadoAte,
      tentativasFalhas: colaborador.tentativasFalhas,
      categorias: colaborador.habilitacoes.map((h) => h.categoria.codigo),
      // `satisfies` e não só a anotação da const: a anotação sozinha pega campo
      // que SOME (o objeto deixa de ser atribuível) e não pega campo que SOBRA,
      // porque o literal perde a "frescura" ao atravessar o genérico do `map`.
      // Testado: com só a anotação, acrescentar `senhaHash` aqui compilava.
      }) satisfies ColaboradorResumo)

    return responder(resumo)
  })
}

/**
 * Gestor cadastra alguém novo.
 *
 * Devolve a senha provisória em texto UMA vez, para ser entregue à pessoa.
 * Ela não é gravada em lugar nenhum além do hash e não volta em consulta
 * nenhuma depois disto.
 */
export async function POST(requisicao: Request): Promise<Response> {
  return rota(async () => {
    const ator = await exigirAtor()
    return responder(await criarColaborador(obterPrisma(), await corpoJson(requisicao), ator))
  })
}
