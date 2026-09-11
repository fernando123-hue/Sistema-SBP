import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { ambiente } from '../servidor/ambiente'

const CABECALHO_MAGICO = Buffer.from('SBP_ENC_v1!!') // 12 bytes
const TAMANHO_IV = 12 // 12 bytes para AES-GCM
const TAMANHO_TAG = 16 // 16 bytes para tag de autenticação

/**
 * Armazenamento em disco local, cifrado em repouso (`H-D19`).
 *
 * Suficiente para o protótipo e para instalação em servidor único. Ao migrar
 * para nuvem, troca-se este adapter — nada fora dele sabe que existe sistema de
 * arquivos.
 *
 * A chave do ARQUIVO é sorteada, nunca derivada do nome do anexo. Nome de anexo
 * vem do remetente: usá-lo para montar caminho é convite a travessia de
 * diretório e a colisão entre dois `documento.pdf` de pessoas diferentes. O
 * nome original continua no banco, para exibir ao humano.
 *
 * Os arquivos são espalhados em subpastas de dois caracteres porque diretório
 * único com dezenas de milhares de entradas fica lento em qualquer sistema de
 * arquivos.
 *
 * ═══ CIFRAGEM ═══
 *
 * Os bytes vão para o disco em AES-256-GCM. GCM e não CBC porque GCM autentica:
 * um byte trocado no arquivo faz a leitura FALHAR, em vez de devolver lixo que
 * o resto do sistema trataria como documento. O IV é sorteado por arquivo — o
 * mesmo IV com a mesma chave duas vezes destrói a garantia do modo.
 */
/**
 * Deriva a chave de cifragem uma vez por segredo, e lembra.
 *
 * `scryptSync` é caro DE PROPÓSITO — é o que torna o segredo difícil de
 * quebrar por força bruta — e trava a thread enquanto roda. `criarArmazenamentoPort()`
 * constrói um adapter por requisição de ingestão: derivar ali dentro pagaria o
 * custo inteiro a cada chamada, sem ganho nenhum, porque o segredo é o mesmo.
 */
const chavesDerivadas = new Map<string, Buffer>()

export function chaveDeCifragem(segredo: string): Buffer {
  const lembrada = chavesDerivadas.get(segredo)
  if (lembrada) return lembrada
  const derivada = scryptSync(segredo, 'sbp-armazenamento-sal-v1', 32)
  chavesDerivadas.set(segredo, derivada)
  return derivada
}

/**
 * Cifra bytes no formato do arquivo em repouso.
 *
 * Função de módulo, e não método privado, porque a migração dos anexos legados
 * (`scripts/recifrar-anexos.ts`) precisa gravar EXATAMENTE este formato. Uma
 * segunda implementação divergiria em silêncio, e o anexo gravado por ela
 * simplesmente não abriria depois.
 *
 * Estrutura: CABECALHO_MAGICO (12b) + IV (12b) + TAG (16b) + CIFRADO (Nb).
 */
export function cifrarBytes(dados: Uint8Array, chave: Buffer): Buffer {
  const iv = randomBytes(TAMANHO_IV)
  const cifrador = createCipheriv('aes-256-gcm', chave, iv)
  const cifrado = Buffer.concat([cifrador.update(dados), cifrador.final()])
  return Buffer.concat([CABECALHO_MAGICO, iv, cifrador.getAuthTag(), cifrado])
}

export class ArmazenamentoEmDisco implements ArmazenamentoPort {
  readonly nome = 'disco'
  private readonly chaveCifra: Buffer

  constructor(
    private readonly raiz: string = ambiente().ARMAZENAMENTO_DIR,
    segredo: string = ambiente().ANEXOS_SECRET ?? ambiente().SESSAO_SECRET,
  ) {
    this.chaveCifra = chaveDeCifragem(segredo)
  }

  private caminhoDe(chave: string): string {
    const alvo = resolve(this.raiz, chave)
    const raizResolvida = resolve(this.raiz)

    // Defesa em profundidade. A chave é gerada aqui e não deveria escapar da
    // raiz — mas se algum dia vier de fora (banco corrompido, migração mal
    // feita), `../../etc/passwd` não pode virar caminho válido.
    if (alvo !== raizResolvida && !alvo.startsWith(raizResolvida + sep)) {
      throw new FalhaDeArmazenamento('resolver', `chave fora da raiz: "${chave}"`)
    }
    return alvo
  }

  private cifrar(dados: Uint8Array): Buffer {
    return cifrarBytes(dados, this.chaveCifra)
  }

  private decifrar(conteudo: Buffer): Uint8Array {
    const temCabecalho = conteudo.subarray(0, CABECALHO_MAGICO.length).equals(CABECALHO_MAGICO)

    // Cabeçalho presente mas o arquivo é curto demais para ter IV e tag: é
    // gravação interrompida (disco cheio, processo morto no meio do
    // `writeFile`), não anexo antigo. Tratar como "legado" devolveria o próprio
    // IV como se fosse o documento — bytes plausíveis, conteúdo nenhum, e a
    // tela mostrando um PDF corrompido sem ninguém saber de onde veio.
    if (temCabecalho && conteudo.length < CABECALHO_MAGICO.length + TAMANHO_IV + TAMANHO_TAG) {
      throw new FalhaDeArmazenamento(
        'decifrar',
        `anexo truncado: ${conteudo.length} bytes, mínimo de ${CABECALHO_MAGICO.length + TAMANHO_IV + TAMANHO_TAG} — a gravação foi interrompida`,
      )
    }

    if (!temCabecalho) {
      // Arquivo sem o cabeçalho: gravado antes de a cifragem existir. É lido em
      // texto puro DE PROPÓSITO — recusar aqui apagaria da operação todo anexo
      // anterior a esta versão, sem que ninguém tivesse decidido isso.
      //
      // O preço está registrado em `DECISOES.md § C`: enquanto este ramo
      // existir, um arquivo em texto puro colocado na pasta é aceito como
      // legítimo. Ele sai quando houver rotina de migração — e aí a ausência do
      // cabeçalho passa a ser erro.
      return new Uint8Array(conteudo)
    }

    const inicioIv = CABECALHO_MAGICO.length
    const inicioTag = inicioIv + TAMANHO_IV
    const inicioCifrado = inicioTag + TAMANHO_TAG

    const iv = conteudo.subarray(inicioIv, inicioTag)
    const tag = conteudo.subarray(inicioTag, inicioCifrado)
    const cifrado = conteudo.subarray(inicioCifrado)

    try {
      const decifrador = createDecipheriv('aes-256-gcm', this.chaveCifra, iv)
      decifrador.setAuthTag(tag)
      const decifrado = Buffer.concat([decifrador.update(cifrado), decifrador.final()])
      return new Uint8Array(decifrado)
    } catch (erro) {
      // A causa mais provável NÃO é adulteração: é a chave ter mudado. O
      // segredo de sessão pode ser rotacionado por rotina de segurança, e sem
      // `ANEXOS_SECRET` definido isso troca também a chave dos anexos. Quem
      // investiga precisa ler essa hipótese aqui, não descobrir depois.
      throw new FalhaDeArmazenamento(
        'decifrar',
        `anexo não decifra — chave errada (${'ANEXOS_SECRET'} mudou?) ou arquivo adulterado: ${erro instanceof Error ? erro.message : String(erro)}`,
      )
    }
  }

  async guardar(bytes: Uint8Array, extensao: string): Promise<string> {
    const sorteio = randomBytes(16).toString('hex')
    const seguraExtensao = /^\.[a-z0-9]{1,10}$/i.test(extensao) ? extensao.toLowerCase() : ''
    const chave = join(sorteio.slice(0, 2), `${sorteio}${seguraExtensao}`)
    const caminho = this.caminhoDe(chave)

    try {
      await mkdir(dirname(caminho), { recursive: true })
      // `wx` falha se o arquivo já existir: sobrescrever em silêncio esconderia
      // uma colisão de chave, que aqui significaria defeito no sorteio.
      await writeFile(caminho, this.cifrar(bytes), { flag: 'wx' })
    } catch (erro) {
      throw new FalhaDeArmazenamento('guardar', erro instanceof Error ? erro.message : String(erro))
    }

    return chave
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    try {
      const conteudo = await readFile(this.caminhoDe(chave))
      return this.decifrar(conteudo)
    } catch (erro) {
      // Falha de decifragem já vem descrita: não pode ser confundida com
      // "arquivo ausente" no ramo abaixo.
      if (erro instanceof FalhaDeArmazenamento) throw erro
      // Ausente é resposta legítima: o arquivo pode ter sido expurgado pela
      // retenção. Qualquer OUTRA falha (permissão, disco) precisa subir alto,
      // porque significa que o arquivo existe e não conseguimos entregá-lo.
      if (erro instanceof Error && 'code' in erro && erro.code === 'ENOENT') return null
      throw new FalhaDeArmazenamento('ler', erro instanceof Error ? erro.message : String(erro))
    }
  }

  async remover(chave: string): Promise<void> {
    try {
      await rm(this.caminhoDe(chave), { force: true })
    } catch (erro) {
      throw new FalhaDeArmazenamento('remover', erro instanceof Error ? erro.message : String(erro))
    }
  }
}

