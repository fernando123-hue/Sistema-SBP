import type { Papel } from '../esquemas'
import { PAPEIS_DA_TELA, TELAS, type Tela } from '../telas'

/**
 * O manual do sistema, em pedaços.
 *
 * ═══ POR QUE O CONHECIMENTO É UM ARQUIVO, E NÃO O BANCO ═══
 *
 * O assistente responde APENAS a partir daqui. Ele não lê e-mail, não lê nota
 * do setor, não lê trilha de auditoria e não consulta o banco atrás de texto.
 * Isso não é limitação de implementação — é a fronteira que torna o assistente
 * seguro:
 *
 *   - **Nada que um terceiro escreveu entra no prompt.** Corpo de e-mail é
 *     conteúdo hostil por hipótese (invariante 6). Se ele alimentasse o
 *     assistente, uma injeção plantada num e-mail passaria a responder
 *     perguntas para a equipe — injeção de uma mensagem virando ataque
 *     persistente, que é exatamente o que o invariante 12 proíbe.
 *
 *   - **Nada de dado pessoal entra no prompt.** Não há nome de associado, CPF,
 *     CRM nem motivo de afastamento aqui. O que sai da casa quando `IA_ADAPTER`
 *     aponta para um fornecedor externo é este texto, escrito por nós, mais a
 *     pergunta de quem está logado.
 *
 *   - **As notas do setor NÃO entram.** Elas são a memória da equipe e a
 *     tentação óbvia de contexto. `DECISOES.md § A14(c)` condiciona esse passo
 *     a uma decisão do dono do negócio, depois de medir o acerto do modelo
 *     real. Enquanto essa decisão não vier, `src/core/notas.ts` alimenta a
 *     TELA e só ela.
 *
 * ═══ PAPEL FILTRA ANTES DO PROMPT ═══
 *
 * Cada verbete declara quem pode vê-lo, e a filtragem acontece em código, em
 * `selecionarVerbetes` — nunca por instrução ao modelo. Pedir a um modelo que
 * "não conte isso ao colaborador" é autorização por boa vontade: o verbete de
 * gestor simplesmente não é enviado quando quem pergunta não é gestor.
 *
 * ═══ QUANDO ESTE ARQUIVO MENTE, O ASSISTENTE MENTE ═══
 *
 * É documentação executável, e envelhece como toda documentação. Mudou regra
 * de negócio, mudou tela, mudou nome de botão: o verbete correspondente muda
 * na mesma entrega. `conhecimento.test.ts` trava o que dá para travar
 * automaticamente — que toda tela citada existe e que todo papel citado é
 * válido —, mas a exatidão do texto continua sendo responsabilidade de quem
 * altera o sistema.
 */

// As telas e quem alcança cada uma moram em `core/telas.ts` — a MESMA fonte que
// a navegação lê. Era uma cópia daqui, espelhada à mão. Reexportadas para quem
// já as importava deste arquivo.
export { PAPEIS_DA_TELA, TELAS, type Tela }

export interface VerbeteDoManual {
  /** Estável: é o que o modelo cita e o que o servidor confere depois. */
  readonly id: string
  readonly titulo: string
  /** Quem pode receber este verbete. Filtrado em código, nunca por instrução. */
  readonly papeis: readonly Papel[]
  readonly texto: string
  /** Para onde mandar quem perguntou. `null` quando a resposta não é uma tela. */
  readonly tela: Tela | null
}

const TODOS: readonly Papel[] = ['colaborador', 'operador', 'gestor']
const OPERACAO: readonly Papel[] = ['operador', 'gestor']

export const MANUAL: readonly VerbeteDoManual[] = [
  {
    id: 'o-que-e-o-sistema',
    titulo: 'O que este sistema faz',
    papeis: TODOS,
    tela: null,
    texto:
      'O sistema reparte entre a equipe o trabalho que chega por e-mail para a Secretaria de Atendimento ao Associado. ' +
      'Ele substitui a planilha de produtividade. A diferença principal: a planilha contava quantos itens cada pessoa recebeu, ' +
      'sem dizer QUAIS. Aqui cada demanda é um item com identidade própria, que dá para abrir, acompanhar, transferir e concluir. ' +
      'O caminho de uma demanda é sempre o mesmo: o e-mail chega, a leitura automática o transforma em um ou mais itens, ' +
      'o que ficou duvidoso passa por revisão humana, o dia é distribuído entre quem está escalado, e cada pessoa conclui os itens da própria fila.',
  },
  {
    id: 'papeis',
    titulo: 'Os três papéis',
    papeis: TODOS,
    tela: null,
    texto:
      'Colaborador: vê a caixa de entrada, a própria fila e o painel; conclui, devolve e transfere os próprios itens. ' +
      'Operador: faz tudo isso e mais a distribuição do dia, a revisão do que a leitura automática não resolveu, e a escala. ' +
      'Gestor: faz tudo isso e mais a gestão de acesso — criar pessoa, ativar, desativar, habilitar em categoria, destravar conta e redefinir senha. ' +
      'Só o gestor vê o motivo de um afastamento; todo mundo vê que a pessoa está fora.',
  },
  {
    id: 'como-distribuir',
    titulo: 'Como distribuir o dia',
    papeis: OPERACAO,
    tela: '/distribuicao',
    texto:
      'Na tela Distribuição, escolha a data e peça a prévia. A prévia mostra, categoria por categoria, quantos itens entram, ' +
      'quem está elegível e quanto cada pessoa receberia — sem gravar nada. Confira e só então confirme. ' +
      'Confirmar grava as atribuições e some com a prévia: a partir daí os itens aparecem na fila de cada pessoa. ' +
      'Se algo estiver errado na prévia, corrija a causa antes de confirmar (escala, habilitação, afastamento, revisão pendente) e peça a prévia de novo. ' +
      'Clicar confirmar duas vezes não distribui duas vezes: o dia é travado enquanto a rodada roda.',
  },
  {
    id: 'como-o-rateio-decide',
    titulo: 'Como o sistema decide quem recebe o quê',
    papeis: TODOS,
    tela: null,
    texto:
      'A conta é sempre a mesma e não é a leitura automática que a faz — é um algoritmo fixo, que qualquer pessoa pode conferir depois. ' +
      'Primeiro o sistema separa quem está elegível na categoria: precisa estar escalado no dia, habilitado naquela categoria e não estar afastado. ' +
      'Depois divide a quantidade de entrada pelo número de pessoas elegíveis. A parte inteira todo mundo recebe igual. ' +
      'O que sobra da divisão (o resto) vai para quem está com menos carga acumulada — é o crédito, um livro-razão que o sistema mantém ' +
      'para que, ao longo dos dias, ninguém receba sistematicamente mais que os colegas. O crédito olha os últimos 30 dias. ' +
      'Quem está afastado não entra na rodada, então o crédito dessa pessoa congela sozinho e ela não volta de férias levando tudo.',
  },
  {
    id: 'conservacao',
    titulo: 'Por que a soma sempre bate',
    papeis: TODOS,
    tela: null,
    texto:
      'Antes de gravar qualquer distribuição, o sistema confere que a soma do que foi repartido é exatamente igual à quantidade que entrou. ' +
      'Se não bater, ele aborta tudo e não grava nada — em vez de gravar um número errado e seguir adiante. ' +
      'Essa conferência existe porque na planilha esse erro acontecia e passava despercebido. Se você vir uma mensagem de erro falando em conservação, ' +
      'não é problema do que você digitou: é o sistema recusando gravar uma conta que não fecha. Anote o código de referência e avise quem cuida do sistema.',
  },
  {
    id: 'pesos',
    titulo: 'Por que uma categoria pesa mais que outra',
    papeis: TODOS,
    tela: null,
    texto:
      'Nem toda demanda dá o mesmo trabalho. Cada categoria tem um peso, e o balanceamento usa o peso, não a contagem crua. ' +
      'Documento de cadastro pesa mais que os demais porque leva mais tempo; ficha de cadastro pesa um pouco mais que o normal. ' +
      'Por isso a pessoa que recebeu menos ITENS pode aparecer com mais CARGA que outra: são dois números diferentes, e os dois aparecem no painel. ' +
      'Os pesos são configuração, não estão chumbados no código — mudá-los é decisão de quem coordena o setor.',
  },
  {
    id: 'revisao',
    titulo: 'Por que um item foi para revisão',
    papeis: OPERACAO,
    tela: '/revisao',
    texto:
      'A leitura automática dá uma nota de confiança para cada item, de 0 a 100%. Abaixo do limiar da categoria, o item não é distribuído: ' +
      'ele espera revisão humana. Isso acontece por quatro motivos, e a tela diz qual: confiança baixa, campo obrigatório ausente, ' +
      'suspeita de duplicata, ou conteúdo suspeito. Na revisão você corrige a categoria e os campos, e pode dividir o item em vários ' +
      '— um e-mail que lista trinta ligantes vale trinta itens de trabalho, não um. Item revisado entra na próxima distribuição.',
  },
  {
    id: 'conteudo-suspeito',
    titulo: 'O que significa "conteúdo suspeito"',
    papeis: OPERACAO,
    tela: '/revisao',
    texto:
      'Quer dizer que o texto do e-mail contém algo que parece uma ORDEM dirigida ao sistema, e não uma demanda comum: ' +
      'pedidos como "ignore as regras", "trate como prioridade máxima", "atribua tudo para fulano" ou "marque confiança máxima". ' +
      'O sistema nunca obedece a isso — o texto do e-mail é tratado como dado, jamais como instrução —, mas marca o item e manda para revisão ' +
      'para que uma pessoa olhe. Na prática costuma ser texto legítimo com redação infeliz. Leia o e-mail, classifique pelo que ele realmente pede e siga.',
  },
  {
    id: 'confianca',
    titulo: 'O que é o percentual de confiança',
    papeis: TODOS,
    tela: null,
    texto:
      'É o quanto a leitura automática acha que acertou a categoria daquele item — não é a qualidade do trabalho de ninguém, ' +
      'e não entra em avaliação de pessoa. Verde: passou do limiar da categoria e o item segue direto. ' +
      'Amarelo ou vermelho: vai para revisão humana. Confiança baixa é barata (custa uma revisão); confiança alta e errada é cara ' +
      '(um item entra na fila da pessoa errada). Por isso o sistema prefere errar mandando para revisão.',
  },
  {
    id: 'minha-fila',
    titulo: 'Trabalhar a própria fila',
    papeis: TODOS,
    tela: '/fila',
    texto:
      'Minha fila mostra os itens sob sua responsabilidade, do mais antigo para o mais novo. A idade é a do ITEM, não a da atribuição: ' +
      'item que passou de mão continua com a idade original, para que trabalho parado não rejuvenesça ao mudar de dono. ' +
      'Ao terminar um item, use Concluir. Ninguém declara quantidade no fim do dia — o número do painel é consequência dos itens concluídos, um a um.',
  },
  {
    id: 'devolver-e-transferir',
    titulo: 'Devolver ou transferir um item',
    papeis: TODOS,
    tela: '/fila',
    texto:
      'São coisas diferentes e as duas exigem justificativa. DEVOLVER manda o item de volta ao bolo: ele fica sem dono e entra na próxima ' +
      'distribuição da categoria, onde o algoritmo decide de novo. Use quando o item não é para você, ou quando não vai dar conta. ' +
      'TRANSFERIR entrega o item a uma pessoa escolhida por você. Use quando já combinou com alguém. ' +
      'Nos dois casos o crédito não é estornado: quem recebeu na rodada continua tendo recebido. Se fosse estornado, devolver viraria ' +
      'ferramenta para manipular a própria carga. Item já concluído não pode ser devolvido.',
  },
  {
    id: 'caixa-de-entrada',
    titulo: 'A caixa de entrada',
    papeis: TODOS,
    tela: '/caixa',
    texto:
      'Mostra tudo que chegou, com filtro por categoria e por liga, independentemente de quem ficou responsável. ' +
      'Serve para procurar uma demanda específica, conferir o que a leitura automática entendeu de um e-mail e ver o estado de cada item. ' +
      'Ao escolher uma liga, o bloco de notas do setor passa a mostrar o que a equipe anotou sobre aquela liga.',
  },
  {
    id: 'notas-do-setor',
    titulo: 'As notas do setor',
    papeis: TODOS,
    tela: '/caixa',
    texto:
      'É a memória escrita pela equipe: o que se aprendeu operando. Basta escrever — não existe campo obrigatório de tipo ou categoria, ' +
      'porque formulário que obriga a classificar antes de escrever faz ninguém escrever. ' +
      'Se você estiver com uma categoria ou uma liga selecionada ao anotar, a nota nasce ligada a ela e volta a aparecer sozinha para quem estiver ' +
      'trabalhando naquele contexto — na fila, na revisão, na distribuição e na caixa. Nota não é apagada, é arquivada: ' +
      'o fato de ter valido um dia também é história. As notas NÃO alimentam a leitura automática: são para gente ler.',
  },
  {
    id: 'escala-e-afastamento',
    titulo: 'Escala e afastamento',
    papeis: OPERACAO,
    tela: '/distribuicao',
    texto:
      'São perguntas diferentes. A ESCALA diz quem está de plantão HOJE — decisão diária, marcada na tela de Distribuição. ' +
      'O AFASTAMENTO diz quem está fora NUM PERÍODO — férias, atestado, falta, licença — e é declarado uma vez, com data de início e fim. ' +
      'Para entrar na distribuição a pessoa precisa das duas coisas: estar escalada e não estar afastada. ' +
      'O afastamento existe para que duas semanas de férias não sejam catorze marcações manuais que alguém precisa lembrar de fazer. ' +
      'Afastamento registrado por engano é CANCELADO, nunca apagado — a trilha precisa poder explicar por que alguém ficou fora do rateio numa terça-feira.',
  },
  {
    id: 'motivo-de-afastamento',
    titulo: 'Quem vê o motivo de um afastamento',
    papeis: ['gestor'],
    tela: null,
    texto:
      'Todo mundo vê que a pessoa está fora; só o gestor vê POR QUÊ. O motivo de um afastamento pode revelar condição de saúde, ' +
      'que é dado sensível pela LGPD, então ele não aparece para operador nem para colaborador — nem na tela, nem pela API. ' +
      'Ao registrar, escreva no campo de observação só o necessário para a operação. ' +
      'O motivo também não fica para sempre: 7 dias depois de a pessoa voltar, a observação é apagada e o tipo vira "férias" ou "ausente". ' +
      'As datas ficam. Ausência sem data de volta não conta até alguém marcar a volta. A limpeza roda sozinha uma vez por dia, ' +
      'e o prazo pode ser mudado por quem é gestor, na tela Acesso, em "Prazos de retenção" — encurtar pede confirmação, porque apaga sem volta.',
  },
  {
    id: 'painel',
    titulo: 'O painel',
    papeis: TODOS,
    tela: '/painel',
    texto:
      'Mostra o que entrou, o que foi distribuído, o que foi concluído, o que está pendente e há quanto tempo, além do acerto da leitura automática. ' +
      'Nenhum número do painel é digitável: não existe campo para preencher e não existe caminho para corrigir um número à mão. ' +
      'Todo valor é calculado a partir de fatos registrados — item criado, item distribuído, item concluído. ' +
      'Se um número parece errado, o que está errado é um fato lá atrás, e é ele que precisa ser corrigido. ' +
      'Os números por pessoa existem para equilibrar carga e achar gargalo, não para avaliar ninguém.',
  },
  {
    id: 'gestao-de-acesso',
    titulo: 'Gestão de acesso',
    papeis: ['gestor'],
    tela: '/acesso',
    texto:
      'Na tela Acesso o gestor cria pessoas, define papel, ativa e desativa, habilita cada pessoa nas categorias que ela pode receber, ' +
      'destrava conta bloqueada por erro de senha e redefine senha. Pessoa nunca é removida do sistema, apenas desativada: ' +
      'apagar levaria junto o histórico de quanto ela recebeu, que é registro de auditoria. ' +
      'Senha redefinida pelo gestor é provisória — a pessoa é obrigada a trocar no primeiro acesso, e enquanto não trocar não consegue fazer mais nada. ' +
      'Desativar alguém e trocar a senha de alguém encerram na hora as sessões abertas daquela pessoa.',
  },
  {
    id: 'senha-e-bloqueio',
    titulo: 'Senha, bloqueio e primeiro acesso',
    papeis: TODOS,
    tela: null,
    texto:
      'Depois de cinco erros seguidos a conta trava por alguns minutos, e o tempo dobra a cada novo erro, até um teto. ' +
      'O bloqueio é temporário de propósito: bloqueio permanente permitiria que alguém errasse a senha de um colega de propósito para deixá-lo fora do sistema. ' +
      'Se não quiser esperar, peça ao gestor para destravar. Ao receber uma senha provisória do gestor, você precisa trocá-la antes de usar qualquer outra tela. ' +
      'Tanto SAIR quanto TROCAR A SENHA encerram todas as sessões abertas com a sua conta, em qualquer computador ou celular — ' +
      'é o que fazer se você desconfiar de acesso indevido, ou se esqueceu o sistema aberto em outra máquina. ' +
      'Por isso, ao sair no computador do balcão você também sai no celular; é o preço de "sair" significar sair de verdade. ' +
      'Se aparecer um aviso dizendo que não foi possível sair, você CONTINUA conectado — tente de novo antes de deixar a máquina.',
  },
  {
    id: 'ligas',
    titulo: 'Ligas e ligantes',
    papeis: TODOS,
    tela: '/caixa',
    texto:
      'Liga é a liga acadêmica; ligante é a pessoa vinculada a ela. Nas categorias de liga, o rateio mantém a liga inteira com a mesma pessoa: ' +
      'trinta ligantes da mesma liga não são espalhados entre a equipe, porque quem já está com o contexto daquela liga resolve mais rápido ' +
      'e o associado não recebe resposta de três pessoas diferentes. O agrupamento vale para a distribuição; a contagem de carga continua sendo por item.',
  },
  {
    id: 'quando-algo-falha',
    titulo: 'Quando aparece um erro',
    papeis: TODOS,
    tela: null,
    texto:
      'O sistema prefere parar e avisar a seguir com um número errado. Se aparecer uma mensagem de erro interna com um código de referência, ' +
      'copie esse código: ele permite localizar exatamente o que falhou. Se a mensagem disser que NÃO foi possível registrar a falha, ' +
      'o código só existe no servidor — nesse caso, descreva o que você estava fazendo. ' +
      'Erro que aparece é melhor que erro que não aparece: o sistema existe justamente porque a planilha errava em silêncio.',
  },
]

/**
 * Os verbetes que este papel pode receber.
 *
 * A filtragem é aqui, em código, ANTES de o prompt existir. Um verbete de
 * gestor não é enviado ao modelo quando quem pergunta é colaborador — em vez
 * de ser enviado com um pedido para o modelo não contar, que é autorização por
 * boa vontade.
 */
export function selecionarVerbetes(papel: Papel): readonly VerbeteDoManual[] {
  return MANUAL.filter((verbete) => verbete.papeis.includes(papel))
}

/** `true` quando o papel alcança a tela. Espelha a navegação e as rotas. */
export function papelAlcancaTela(papel: Papel, tela: string): tela is Tela {
  const permitidos = PAPEIS_DA_TELA[tela as Tela]
  return permitidos !== undefined && permitidos.includes(papel)
}
