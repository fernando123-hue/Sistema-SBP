/**
 * Verificação do tipo REAL do arquivo, pelos primeiros bytes.
 *
 * A allowlist de extensão (`validarAnexo`) responde "o nome termina em algo
 * permitido?". Isso é o que o remetente ESCREVEU. Esta verificação responde "o
 * conteúdo é mesmo aquilo?" — e as duas respostas divergem exatamente nos casos
 * que importam: um executável renomeado para `laudo.pdf` passa pela allowlist
 * inteiro.
 *
 * O `tipoDeclarado` que vem no e-mail nunca entra nesta conta. Quem afirma o
 * tipo é o remetente, e o remetente é justamente de quem estamos nos
 * defendendo.
 *
 * Registrado como obrigatório em DECISOES.md § G (D3) antes de qualquer adapter
 * real de e-mail ser plugado.
 */

interface Assinatura {
  /** Bytes esperados no início do arquivo. */
  readonly prefixo: readonly number[]
  /** Deslocamento onde o prefixo começa. Quase sempre 0. */
  readonly deslocamento?: number
}

/**
 * Assinaturas por extensão.
 *
 * Uma extensão pode ter mais de uma forma legítima: `.doc` antigo é OLE, `.docx`
 * é um zip. Basta uma casar.
 */
const ASSINATURAS: Readonly<Record<string, readonly Assinatura[]>> = {
  '.pdf': [{ prefixo: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  '.png': [{ prefixo: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  '.jpg': [{ prefixo: [0xff, 0xd8, 0xff] }],
  '.jpeg': [{ prefixo: [0xff, 0xd8, 0xff] }],
  '.gif': [
    { prefixo: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { prefixo: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  // RIFF....WEBP — o tamanho fica entre os dois marcadores.
  '.webp': [{ prefixo: [0x57, 0x45, 0x42, 0x50], deslocamento: 8 }],
  // OOXML são arquivos zip.
  '.docx': [{ prefixo: [0x50, 0x4b, 0x03, 0x04] }],
  '.xlsx': [{ prefixo: [0x50, 0x4b, 0x03, 0x04] }],
  // Office anterior a 2007: contêiner OLE2.
  '.doc': [{ prefixo: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  '.xls': [{ prefixo: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
}

/**
 * Extensões que legitimamente NÃO têm assinatura.
 *
 * Texto puro é qualquer sequência de bytes. Não há o que verificar, e fingir que
 * há seria pior que admitir o limite: um `.txt` continua sendo o formato em que
 * um atacante põe o que quiser — só que texto não executa sozinho.
 */
const SEM_ASSINATURA = new Set(['.txt', '.csv'])

export type VeredictoDeAssinatura =
  | { situacao: 'confere' }
  | { situacao: 'sem_assinatura_conhecida' }
  | { situacao: 'divergente'; motivo: string }

function casa(bytes: Uint8Array, assinatura: Assinatura): boolean {
  const inicio = assinatura.deslocamento ?? 0
  if (bytes.length < inicio + assinatura.prefixo.length) return false

  return assinatura.prefixo.every((esperado, posicao) => bytes[inicio + posicao] === esperado)
}

/**
 * Confere os bytes contra a extensão do nome já normalizado.
 *
 * Devolve veredicto em vez de lançar: quem decide o que fazer com um anexo
 * divergente é a camada de ingestão, que precisa registrar o motivo e mandar o
 * item para revisão humana — nunca descartar em silêncio.
 */
export function conferirAssinatura(nomeSeguro: string, bytes: Uint8Array): VeredictoDeAssinatura {
  const ponto = nomeSeguro.lastIndexOf('.')
  const extensao = ponto === -1 ? '' : nomeSeguro.slice(ponto).toLowerCase()

  if (SEM_ASSINATURA.has(extensao)) return { situacao: 'sem_assinatura_conhecida' }

  const esperadas = ASSINATURAS[extensao]
  if (!esperadas) return { situacao: 'sem_assinatura_conhecida' }

  if (bytes.length === 0) {
    return { situacao: 'divergente', motivo: `arquivo "${extensao}" vazio` }
  }

  if (esperadas.some((assinatura) => casa(bytes, assinatura))) {
    return { situacao: 'confere' }
  }

  return {
    situacao: 'divergente',
    motivo: `conteúdo não corresponde à extensão "${extensao}"`,
  }
}
