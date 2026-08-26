import {
  InterpretacaoSchema,
  LIMITE_ITENS_POR_EMAIL,
  TAMANHO_MAXIMO_CORPO,
  type EmailBruto,
  type Interpretacao,
  type ItemExtraido,
} from '../core/esquemas'
import { prepararConteudoExterno } from '../core/seguranca/conteudo-nao-confiavel'
import type { AiPort } from '../ports/ia'

/**
 * Adapter de IA determinístico.
 *
 * Não é um stub que devolve dados falsos — é um classificador por regras que
 * imita o contrato do modelo real. Serve para três coisas:
 *   - rodar o pipeline inteiro sem custo e sem rede
 *   - testar ingestão, revisão e distribuição com resultado reproduzível
 *   - servir de fallback quando o modelo real estiver indisponível
 *
 * O adapter `anthropic` substitui este sem alterar uma linha dos serviços.
 */

const VERSAO_PROMPT = 'mock-1.0.0'
const NOME_MODELO = 'regras-deterministicas'

interface Regra {
  categoria: ItemExtraido['categoriaCodigo']
  termos: readonly RegExp[]
  confianca: number
}

/** Ordem importa: a primeira regra que casa vence. Do mais específico ao mais genérico. */
const REGRAS: readonly Regra[] = [
  {
    categoria: 'LIGANTE',
    termos: [/\bligantes?\b/i, /\bmembros?\s+da\s+liga\b/i, /\bestudantes?\s+vinculad/i],
    confianca: 0.93,
  },
  {
    categoria: 'LIGA',
    termos: [/\bnova\s+liga\b/i, /\bcadastro\s+de\s+liga\b/i, /\bliga\s+acad[êe]mica\b/i],
    confianca: 0.91,
  },
  {
    categoria: 'FICHA_CADASTRO',
    termos: [/\bficha\b/i, /\batualiza[çc][ãa]o\s+cadastral\b/i, /\batualizar\s+(o\s+)?cadastro\b/i],
    confianca: 0.9,
  },
  {
    categoria: 'DOC_CADASTRO',
    termos: [/\bdocumenta[çc][ãa]o\b/i, /\bcomprovante\b/i, /\bdiploma\b/i, /\bcertid[ãa]o\b/i],
    confianca: 0.89,
  },
  {
    categoria: 'EMAIL_LIGA',
    termos: [/\bliga\b/i],
    confianca: 0.82,
  },
]

const CONFIANCA_PADRAO = 0.78

/** Uma linha de lista: "1. Fulano — fulano@x.com" ou "- Fulano". */
const LINHA_DE_LISTA = /^\s*(?:[-*•]|\d{1,3}[.)])\s+(.{2,120})$/gm
const CAMPO_CPF = /\bCPF[:\s]+([\d.\-]{11,14})\b/i
const CAMPO_CRM = /\bCRM[:\s/-]*([A-Z]{2})?\s*([\d]{3,8})\b/i
const CAMPO_NOME = /\bnome[:\s]+([^\n]{3,120})/i
const MENCAO_LIGA = /\bliga\s+(?:acad[êe]mica\s+)?(?:de\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\n,.;]{2,60})/i

function classificar(texto: string): { categoria: ItemExtraido['categoriaCodigo']; confianca: number } {
  for (const regra of REGRAS) {
    if (regra.termos.some((termo) => termo.test(texto))) {
      return { categoria: regra.categoria, confianca: regra.confianca }
    }
  }
  return { categoria: 'EMAIL_CADASTRO', confianca: CONFIANCA_PADRAO }
}

function extrairCampos(texto: string): Record<string, string> {
  const campos: Record<string, string> = {}

  const nome = CAMPO_NOME.exec(texto)
  if (nome?.[1]) campos['nome'] = nome[1].trim().slice(0, 200)

  const cpf = CAMPO_CPF.exec(texto)
  if (cpf?.[1]) campos['cpf'] = cpf[1].trim()

  const crm = CAMPO_CRM.exec(texto)
  if (crm?.[2]) campos['crm'] = `${crm[1] ?? ''}${crm[2]}`.trim()

  return campos
}

function detectarLiga(texto: string): string | null {
  const encontrado = MENCAO_LIGA.exec(texto)
  return encontrado?.[1]?.trim().slice(0, 200) ?? null
}

/**
 * Desdobramento — decisão A1 do projeto.
 *
 * Um e-mail de liga com 30 ligantes listados vale 30 unidades de carga, não 1.
 * O adapter só PROPÕE o desdobramento; o operador confirma na Revisão.
 */
function extrairLista(texto: string): string[] {
  LINHA_DE_LISTA.lastIndex = 0
  const nomes: string[] = []
  let achado: RegExpExecArray | null

  while ((achado = LINHA_DE_LISTA.exec(texto)) !== null) {
    const linha = achado[1]?.trim()
    if (linha && linha.length >= 3) nomes.push(linha.slice(0, 200))
    if (nomes.length >= LIMITE_ITENS_POR_EMAIL) break
  }

  return nomes
}

function camposObrigatorios(categoria: ItemExtraido['categoriaCodigo']): string[] {
  switch (categoria) {
    case 'DOC_CADASTRO':
    case 'FICHA_CADASTRO':
      return ['nome', 'cpf']
    case 'LIGANTE':
      return ['nome']
    default:
      return []
  }
}

export class IaMock implements AiPort {
  readonly nome = 'mock'

  async interpretar(email: EmailBruto): Promise<Interpretacao> {
    const bruto = `${email.assunto}\n${email.corpo}`

    // Conteúdo externo passa pelas três camadas ANTES de qualquer análise.
    const { analise } = prepararConteudoExterno(bruto, TAMANHO_MAXIMO_CORPO)

    const { categoria, confianca } = classificar(bruto)
    const ligaMencionada = detectarLiga(bruto)
    const camposBase = extrairCampos(bruto)

    // Suspeita de injeção derruba a confiança para forçar revisão humana.
    const confiancaFinal = analise.suspeito ? Math.min(confianca, 0.4) : confianca

    const lista = categoria === 'LIGANTE' ? extrairLista(email.corpo) : []
    const itens: ItemExtraido[] =
      lista.length > 0
        ? lista.map((entrada) => montarItem(categoria, entrada, confiancaFinal, camposBase, ligaMencionada, entrada))
        : [
            montarItem(
              categoria,
              email.assunto || 'Sem assunto',
              confiancaFinal,
              camposBase,
              ligaMencionada,
              null,
            ),
          ]

    return InterpretacaoSchema.parse({
      itens,
      conteudoSuspeito: analise.suspeito,
      padroesSuspeitos: analise.padroes,
      modelo: NOME_MODELO,
      versaoPrompt: VERSAO_PROMPT,
    } satisfies Interpretacao)
  }
}

function montarItem(
  categoria: ItemExtraido['categoriaCodigo'],
  titulo: string,
  confianca: number,
  camposBase: Record<string, string>,
  ligaMencionada: string | null,
  nomeDaLista: string | null,
): ItemExtraido {
  const campos = nomeDaLista ? { ...camposBase, nome: nomeDaLista } : camposBase
  const ausentes = camposObrigatorios(categoria).filter((campo) => !campos[campo])

  return {
    categoriaCodigo: categoria,
    titulo: titulo.slice(0, 300),
    // Cada campo obrigatório ausente custa confiança — é o que empurra o item
    // para a fila de revisão em vez de deixá-lo passar incompleto.
    confianca: Math.max(0, confianca - ausentes.length * 0.15),
    campos,
    camposAusentes: ausentes,
    ligaMencionada,
    observacao: null,
  }
}
