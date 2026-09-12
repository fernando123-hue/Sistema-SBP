import { ambiente } from './ambiente'

/**
 * Acesso local sem senha — só para conferir telas em desenvolvimento.
 *
 * ═══ POR QUE EXISTE ═══
 *
 * Toda tela além de `/entrar` exige login, e quem verifica uma mudança de tela
 * não digita senha — o agente não faz isso, nem com a senha em mãos. Resultado:
 * mudança de tela saía "conferida por tipos e build, não vista rodando". O dono
 * pediu, em 12/09/2026, que desse para entrar sem senha e ver de verdade o que
 * está sendo feito, **sem deixar falha de segurança**.
 *
 * A resposta NÃO foi tirar a senha. Tirar a senha é uma mudança que alguém
 * precisa lembrar de desfazer, e a que ninguém lembra é a que vai para produção.
 * O que existe é uma porta a mais, ao lado da senha, com cinco travas
 * independentes — cada uma sozinha já impede o uso fora do lugar certo:
 *
 * 1. **Desligada por padrão.** Só `ACESSO_LOCAL_SEM_SENHA=1` liga, e o caminho
 *    normal é `npm run dev:local`, que liga só para aquele processo.
 * 2. **Nunca em produção.** `ambiente()` recusa subir com a variável ligada e
 *    `NODE_ENV=production`, e esta função confere de novo.
 * 3. **Só pela própria máquina, e só pela própria tela.** O `dev:local` escuta
 *    apenas em `127.0.0.1`; a rota recusa pedido cujo endereço ou origem não seja
 *    de loopback, e recusa a entrada que não venha da tela do sistema (CSRF —
 *    ver `ehPedidoDaPropriaTela`).
 * 4. **Só contas sintéticas.** Entra-se apenas em conta `@exemplo.test` — domínio
 *    reservado, que nenhuma pessoa real tem. Mesmo ligado num banco com gente de
 *    verdade, ninguém real vira alvo.
 * 5. **Morre quando desliga.** O cookie emitido por aqui carrega a marca `local`,
 *    assinada; `perfilAtual` recusa essa sessão no instante em que o acesso
 *    local deixa de estar ligado. Desligar a variável derruba todas elas.
 *
 * Toda entrada por aqui é gravada na trilha como `entrada_local_sem_senha`, e a
 * tela mostra uma faixa enquanto a sessão local estiver aberta.
 */

/** Domínio reservado para teste (RFC 6761): nenhuma conta real termina assim. */
export const DOMINIO_SINTETICO = '@exemplo.test'

export function acessoLocalHabilitado(): boolean {
  const configuracao = ambiente()
  // `ambiente()` já recusa produção com a variável ligada; conferir aqui de
  // novo custa uma comparação e protege contra quem um dia afrouxar aquela.
  return configuracao.ACESSO_LOCAL_SEM_SENHA && configuracao.NODE_ENV !== 'production'
}

export function ehContaSintetica(email: string): boolean {
  return email.trim().toLowerCase().endsWith(DOMINIO_SINTETICO)
}

/**
 * O pedido de ENTRADA saiu da própria tela do sistema?
 *
 * Achado da revisão de segurança de 12/09/2026, e é CSRF de verdade: com o
 * `dev:local` rodando, uma página maliciosa aberta no mesmo navegador podia
 * mandar um `<form method="POST" enctype="text/plain">` para
 * `http://localhost:3000/api/sessao/local`. Formulário assim não passa por
 * preflight, o corpo pode ser montado para virar JSON válido, e `corpoJson` não
 * olha o `Content-Type`. O pedido chega de loopback de verdade — a trava 3 não
 * pega —, e o navegador sai logado numa conta que outra pessoa escolheu, com a
 * entrada gravada na trilha como se tivesse sido intenção de quem estava ali.
 *
 * Duas conferências, e as duas precisam passar:
 *
 * - `Sec-Fetch-Site: same-origin` — o navegador escreve este cabeçalho, e página
 *   nenhuma consegue escrevê-lo por ela. Formulário vindo de outro site chega
 *   com `cross-site`; ferramenta de linha de comando chega sem ele, e também é
 *   recusada, porque o acesso existe para a tela, não para script;
 * - `Content-Type: application/json` — o que a tela manda. Formulário não
 *   consegue mandar isso sem passar por preflight, que o sistema não autoriza.
 *
 * Só a entrada precisa disto. A listagem (`GET`) não muda estado, e o que ela
 * devolve outro site não consegue ler.
 */
export function ehPedidoDaPropriaTela(requisicao: Request): boolean {
  if (requisicao.headers.get('sec-fetch-site') !== 'same-origin') return false
  const tipo = requisicao.headers.get('content-type') ?? ''
  return tipo.split(';')[0]!.trim().toLowerCase() === 'application/json'
}

const HOSTS_DE_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
const ENDERECOS_DE_LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * O pedido veio desta máquina?
 *
 * Duas conferências, porque cada uma sozinha é contornável:
 *
 * - o **endereço pedido** precisa ser de loopback. Quem chega pela rede local
 *   pede `http://192.168.x.x:3000`, e é recusado aqui;
 * - a **origem**, quando conhecida, também. Medido no servidor de
 *   desenvolvimento: sem `x-forwarded-for` vindo do cliente, o Next preenche o
 *   cabeçalho com o endereço do socket — então quem chega de outra máquina
 *   aparece com o endereço dela. Toda entrada da cadeia precisa ser loopback.
 *
 * Um cliente pode escrever os dois cabeçalhos à mão, e é por isso que esta
 * conferência é a trava 3 de cinco, e não a única: o `dev:local` nem escuta fora
 * de `127.0.0.1`, e as travas 1, 2 e 4 não dependem de nada que o cliente mande.
 */
export function ehRequisicaoLocal(requisicao: Request): boolean {
  let host: string
  try {
    host = new URL(requisicao.url).hostname
  } catch {
    return false
  }
  if (!HOSTS_DE_LOOPBACK.has(host)) return false

  const cadeia = requisicao.headers.get('x-forwarded-for')
  if (cadeia === null) return true

  const enderecos = cadeia.split(',').map((endereco) => endereco.trim())
  return enderecos.every((endereco) => ENDERECOS_DE_LOOPBACK.has(endereco))
}
