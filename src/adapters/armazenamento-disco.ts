import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { ambiente } from '../servidor/ambiente'

const CABECALHO_MAGICO = Buffer.from('SBP_ENC_v1!!') // 12 bytes
const TAMANHO_IV = 12 // 12 bytes para AES-GCM
const TAMANHO_TAG = 16 // 16 bytes para tag de autenticação

/**
 * Armazenamento em disco local com cifragem em repouso (`H-D19`).
 *
 * Suficiente para o protótipo e para instalação em servidor único. Ao migrar
 * para nuvem, troca-se este adapter — nada fora dele sabe que existe sistema de
 * arquivos.
 *
 * Os bytes são cifrados no disco com AES-256-GCM usando chave derivada de
 * `SESSAO_SECRET`. A leitura detecta o cabeçalho mágico e decifra
 * automaticamente, mantendo compatibilidade com anexos legados não cifrados.
 */
export class ArmazenamentoEmDisco implements ArmazenamentoPort {
  readonly nome = 'disco'
  private readonly chaveCifra: Buffer

  constructor(
    private readonly raiz: string = ambiente().ARMAZENAMENTO_DIR,
    segredo: string = ambiente().SESSAO_SECRET,
  ) {
    this.chaveCifra = scryptSync(segredo, 'sbp-armazenamento-sal-v1', 32)
  }

  private caminhoDe(chave: string): string {
    const alvo = resolve(this.raiz, chave)
    const raizResolvida = resolve(this.raiz)

    if (alvo !== raizResolvida && !alvo.startsWith(raizResolvida + sep)) {
      throw new FalhaDeArmazenamento('resolver', `chave fora da raiz: "${chave}"`)
    }
    return alvo
  }

  private cifrar(dados: Uint8Array): Buffer {
    const iv = randomBytes(TAMANHO_IV)
    const cifrador = createCipheriv('aes-256-gcm', this.chaveCifra, iv)
    const cifrado = Buffer.concat([cifrador.update(dados), cifrador.final()])
    const tag = cifrador.getAuthTag()

    // Estrutura: CABECALHO_MAGICO (12b) + IV (12b) + TAG (16b) + CIFRADO (Nb)
    return Buffer.concat([CABECALHO_MAGICO, iv, tag, cifrado])
  }

  private decifrar(conteudo: Buffer): Uint8Array {
    if (
      conteudo.length < CABECALHO_MAGICO.length + TAMANHO_IV + TAMANHO_TAG ||
      !conteudo.subarray(0, CABECALHO_MAGICO.length).equals(CABECALHO_MAGICO)
    ) {
      // Fallback para anexos legados gravados em texto puro antes da cifragem
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
      throw new FalhaDeArmazenamento(
        'decifrar',
        `falha de integridade ao decifrar anexo: ${erro instanceof Error ? erro.message : String(erro)}`,
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
      const cifrado = this.cifrar(bytes)
      await writeFile(caminho, cifrado, { flag: 'wx' })
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
      if (erro instanceof FalhaDeArmazenamento) throw erro
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

