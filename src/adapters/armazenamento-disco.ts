import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import { FalhaDeArmazenamento, type ArmazenamentoPort } from '../ports/armazenamento'
import { ambiente } from '../servidor/ambiente'

/**
 * Armazenamento em disco local.
 *
 * Suficiente para o protótipo e para instalação em servidor único. Ao migrar
 * para nuvem, troca-se este adapter — nada fora dele sabe que existe sistema de
 * arquivos.
 *
 * A chave é sorteada, nunca derivada do nome do arquivo. Nome de anexo vem do
 * remetente: usá-lo para montar caminho é convite a travessia de diretório e a
 * colisão entre dois `documento.pdf` de pessoas diferentes. O nome original
 * continua no banco, para exibir ao humano.
 *
 * Os arquivos são espalhados em subpastas de dois caracteres porque diretório
 * único com dezenas de milhares de entradas fica lento em qualquer sistema de
 * arquivos.
 */
export class ArmazenamentoEmDisco implements ArmazenamentoPort {
  readonly nome = 'disco'

  constructor(private readonly raiz: string = ambiente().ARMAZENAMENTO_DIR) {}

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

  async guardar(bytes: Uint8Array, extensao: string): Promise<string> {
    const sorteio = randomBytes(16).toString('hex')
    const seguraExtensao = /^\.[a-z0-9]{1,10}$/i.test(extensao) ? extensao.toLowerCase() : ''
    const chave = join(sorteio.slice(0, 2), `${sorteio}${seguraExtensao}`)
    const caminho = this.caminhoDe(chave)

    try {
      await mkdir(dirname(caminho), { recursive: true })
      // `wx` falha se o arquivo já existir: sobrescrever em silêncio esconderia
      // uma colisão de chave, que aqui significaria defeito no sorteio.
      await writeFile(caminho, bytes, { flag: 'wx' })
    } catch (erro) {
      throw new FalhaDeArmazenamento('guardar', erro instanceof Error ? erro.message : String(erro))
    }

    return chave
  }

  async ler(chave: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.caminhoDe(chave)))
    } catch (erro) {
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
