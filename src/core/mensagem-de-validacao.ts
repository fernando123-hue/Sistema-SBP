import { z } from 'zod'

/**
 * Validação em português de gente (achado N-28, pedido do dono em A40).
 *
 * O Zod fala inglês e fala com quem programa: a gestora digitava um e-mail com
 * erro e lia `email: Invalid email address`; marcava uma categoria que o
 * servidor não conhecia e lia `categorias.3: Invalid option: expected one of
 * "DOC_CADASTRO"|…`. A regra de A40 é frase curta, sem termo técnico, dizendo o
 * que houve e o que fazer.
 *
 * ═══ POR QUE NÃO O IDIOMA PRONTO DO ZOD ═══
 *
 * O `pt-BR` que vem com o Zod traduz, mas continua falando com quem programa
 * ("Pequeno demais: esperava que o texto tivesse >= 3 caracteres", e a lista
 * de opções em código). E `zod/locales` é outro pacote para a trava de pureza
 * de `core/`. As frases abaixo são poucas porque os problemas são poucos.
 *
 * ═══ CONFIGURAÇÃO GLOBAL, DE PROPÓSITO ═══
 *
 * `z.config` vale para o processo inteiro — no servidor e no navegador. Este
 * módulo é importado por `esquemas.ts`, então quem carrega um esquema carrega
 * as frases. A mensagem escrita no próprio esquema (`.min(1, 'Diga por que…')`)
 * continua vencendo: o Zod só pergunta aqui quando o esquema não disse nada.
 */

/**
 * Nomes que a equipe reconhece, para os campos que ela mesma preenche.
 *
 * Campo fora desta lista (`colaboradorId`, `revisaoId`…) é preenchido pela
 * tela, não por quem usa: se ele falha, o defeito é da tela, e o nome técnico
 * não ajuda ninguém a corrigir — por isso ele não aparece.
 */
const ROTULOS: Readonly<Record<string, string>> = {
  nome: 'Nome',
  email: 'E-mail',
  papel: 'Papel',
  categorias: 'Categorias',
  categoriaCodigo: 'Categoria',
  senha: 'Senha',
  senhaAtual: 'Senha atual',
  texto: 'Texto',
  titulo: 'Título',
  motivo: 'Motivo',
  justificativa: 'Justificativa',
  observacao: 'Observação',
  data: 'Data',
  inicio: 'Início',
  fim: 'Fim',
  dias: 'Dias',
  quantidade: 'Quantidade',
  assunto: 'Assunto',
  remetente: 'Remetente',
  ligaMencionada: 'Liga',
  ligaId: 'Liga',
  paraColaboradorId: 'Pessoa que recebe',
}

const SEM_ROTULO = 'Um dado do pedido'

type Problema = z.core.$ZodRawIssue

function unidade(quantidade: number | bigint, singular: string, plural: string): string {
  return `${quantidade} ${Number(quantidade) === 1 ? singular : plural}`
}

/** A frase sem o nome do campo, começando por verbo: "não pode ficar vazio". */
function frase(problema: Problema): string {
  if (problema.input === undefined) return 'é obrigatório'

  switch (problema.code) {
    case 'too_small': {
      if (problema.origin === 'string') {
        return Number(problema.minimum) <= 1
          ? 'não pode ficar vazio'
          : `precisa ter pelo menos ${unidade(problema.minimum, 'caractere', 'caracteres')}`
      }
      if (problema.origin === 'array' || problema.origin === 'set') {
        return `precisa ter pelo menos ${unidade(problema.minimum, 'escolha', 'escolhas')}`
      }
      return `precisa ser pelo menos ${problema.minimum}`
    }
    case 'too_big': {
      if (problema.origin === 'string') {
        return `pode ter no máximo ${unidade(problema.maximum, 'caractere', 'caracteres')}`
      }
      if (problema.origin === 'array' || problema.origin === 'set') {
        return `pode ter no máximo ${unidade(problema.maximum, 'escolha', 'escolhas')}`
      }
      return `pode ser no máximo ${problema.maximum}`
    }
    case 'invalid_format':
      return problema.format === 'email'
        ? 'não parece um endereço de e-mail'
        : 'está num formato que o sistema não aceita'
    case 'invalid_value':
      return 'não é uma das opções aceitas'
    case 'invalid_type':
    case 'invalid_union':
    case 'not_multiple_of':
      return 'está num formato que o sistema não aceita'
    case 'unrecognized_keys':
      return 'traz campos que o sistema não conhece'
    default:
      // `custom` sem mensagem e o que o Zod ainda inventar: não fica em inglês.
      return 'não foi aceito'
  }
}

z.config({ customError: frase })

/** O primeiro trecho do caminho que é nome de campo (`categorias.3` → `categorias`). */
function campoDe(caminho: readonly PropertyKey[]): string | undefined {
  return caminho.find((trecho): trecho is string => typeof trecho === 'string')
}

/**
 * Uma frase por campo: `E-mail: não parece um endereço de e-mail.`
 *
 * O mesmo problema em vários itens da lista (`categorias.1`, `categorias.4`)
 * aparece uma vez — o índice não diz nada a quem marcou caixas na tela.
 */
export function mensagemDeValidacao(erro: z.ZodError): string {
  const linhas = erro.issues.map((problema) => {
    const campo = campoDe(problema.path)
    const rotulo = campo === undefined ? undefined : ROTULOS[campo]
    const texto = problema.message.replace(/\.$/, '')
    if (rotulo) return `${rotulo}: ${texto}.`
    // Frase escrita no próprio esquema começa com maiúscula e já se sustenta.
    if (/^\p{Lu}/u.test(texto)) return `${texto}.`
    return `${SEM_ROTULO} ${texto}. Atualize a tela e tente de novo.`
  })
  return [...new Set(linhas)].join(' ')
}
