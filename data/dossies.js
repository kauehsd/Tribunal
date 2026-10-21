// data/dossies.js — o "por trás das câmeras" de cada caso.
//
// rito:        'comum' (juiz singular) ou 'juri' (crime doloso contra a vida: passa pela pronúncia)
// acordo:      true se cabe acordo de não persecução penal (Art. 28-A CPP)
// testemunhas: interpretadas pela IA na audiência. Os segredos só aparecem se a pergunta for certeira.
// segredo_acu / segredo_def: o que só um dos lados sabe no começo (como na vida real)
// fatos_ocultos: o que uma diligência (carta) pode descobrir
// reviravolta: acontece no meio da instrução
// dicas_*: aparecem para quem joga no nível Estagiário

export const DOSSIES = {
  '00': {
    rito: 'comum', acordo: true,
    testemunhas: [
      { id: 'carla', nome: 'Carla Menezes', emoji: '😤', papel: 'vitima', papel_txt: 'vítima, colega de apartamento', arrolada_por: 'acusacao',
        perfil: 'Contadora de 29 anos, organizada, rancorosa e muito dramática quando o assunto é comida. Fala com exagero ("foi um ATENTADO").',
        depoimento: 'Guardou a fatia com bilhete bem claro. Acordou e encontrou a caixa vazia. Diz que Bruno sempre pega coisas dela.',
        segredos: ['Ela mesma comeu um iogurte do Bruno na semana anterior, sem pedir.', 'Na verdade a pizza foi paga pelos dois, meio a meio — ela só guardou a última fatia.'] },
      { id: 'tiago', nome: 'Tiago (vizinho de porta)', emoji: '🙄', papel: 'testemunha', papel_txt: 'testemunha, vizinho', arrolada_por: 'defesa',
        perfil: 'Estudante de 22 anos, preguiçoso, acha tudo uma bobagem e responde com ironia.',
        depoimento: 'Ouviu a geladeira abrindo às 3h e alguém rindo. Acha o processo ridículo.',
        segredos: ['Bruno ofereceu um pedaço da fatia para ele às 3h — e ele aceitou metade.'] },
      { id: 'bruno', nome: 'Bruno Alves', emoji: '😇', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Designer de 27 anos, simpático, um pouco cínico, tenta resolver tudo com humor.',
        depoimento: 'Chegou com fome de uma festa, viu a pizza, "achou que ela não ia ligar". Já pediu outra pizza de desculpas.',
        segredos: ['Ele leu o bilhete antes de comer e achou engraçado.', 'Tinha um pacote de miojo no armário.'] }
    ],
    segredo_acu: ['Carla tem um áudio de Bruno, de um mês atrás, dizendo: "comida com nome na geladeira é desafio".'],
    segredo_def: ['Bruno te contou que Carla também come as coisas dele e que a pizza foi paga pelos dois.'],
    fatos_ocultos: [
      'Perícia na caixa: havia DUAS marcas de mordida diferentes na borda da fatia (alguém dividiu a pizza).',
      'Extrato do app de entrega: a pizza foi paga com o cartão de Bruno, e Carla fez um PIX de metade depois.',
      'Câmera do corredor: às 3h05 Tiago entra no apartamento e sai com um prato.'
    ],
    reviravolta: { titulo: 'A metade misteriosa', texto: 'O síndico entrega ao juízo um vídeo do corredor: às 3h05, o vizinho Tiago sai do apartamento com um prato na mão. Será que Bruno não comeu a fatia sozinho?' },
    dicas_acu: ['Use o bilhete para provar que Bruno SABIA que a pizza era de outra pessoa (isso é o dolo).', 'Pergunte ao Bruno se havia outra comida em casa.'],
    dicas_def: ['A insignificância é sua melhor arma: R$9 não justifica um processo.', 'Pergunte a Carla quem pagou a pizza.']
  },

  '01': {
    rito: 'comum', acordo: true,
    testemunhas: [
      { id: 'joaquim', nome: 'Seu Joaquim Pereira', emoji: '🧓', papel: 'vitima', papel_txt: 'vítima, dono do Mercado Vitória', arrolada_por: 'acusacao',
        perfil: 'Comerciante de 63 anos, já foi assaltado 3 vezes, cansado e desconfiado, mas tem bom coração.',
        depoimento: 'Foi acordado pelo alarme. Viu nas câmeras o rapaz forçando a porta dos fundos. A porta é saída de emergência. O prejuízo maior foi a fechadura.',
        segredos: ['Já tinha visto Marcos no mercado pedindo fiado para comprar leite, e negou.', 'Depois do caso, disse a um vizinho que "não queria ver o rapaz preso, só queria o prejuízo pago".'] },
      { id: 'sd_lima', nome: 'Soldado PM Lima', emoji: '👮', papel: 'policial', papel_txt: 'policial militar que fez a prisão', arrolada_por: 'acusacao',
        perfil: 'Policial de 26 anos, objetivo, segue o protocolo, fala em linguagem de boletim de ocorrência.',
        depoimento: 'Atendeu ao alarme, encontrou Marcos a 200m com a sacola. Ele não resistiu e chorou dizendo que era para a filha.',
        segredos: ['Na sacola havia também uma barra de chocolate, que não é item de primeira necessidade.', 'Marcos pediu, na viatura, para passarem na casa dele e levarem a filha à UPA — e eles não levaram.'] },
      { id: 'dona_cida', nome: 'Dona Cida', emoji: '👵', papel: 'testemunha', papel_txt: 'vizinha de Marcos', arrolada_por: 'defesa',
        perfil: 'Aposentada de 70 anos, religiosa, culpada por não ter ajudado, fala emocionada e se perde nos detalhes.',
        depoimento: 'Às 2h Marcos bateu na porta dela pedindo ajuda; ela não abriu por medo. Ouviu o bebê chorando a noite toda.',
        segredos: ['Ela tem carro, mas não dirige à noite.', 'Já tinha emprestado dinheiro a Marcos antes, e ele devolveu certinho.'] },
      { id: 'marcos', nome: 'Marcos Silva', emoji: '😔', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Pedreiro desempregado de 31 anos, humilde, envergonhado, fala pouco e baixo.',
        depoimento: 'A filha estava ardendo em febre, não tinha remédio nem dinheiro, tentou vizinhos e o orelhão. Pegou só o necessário.',
        segredos: ['Não sabia que havia UPA 24h a 8km.', 'O objeto metálico usado na porta era uma chave de fenda que ele levou de casa.'] }
    ],
    segredo_acu: ['O laudo da fechadura mostra que a porta foi forçada por mais de 10 minutos — não foi um impulso.', 'Há uma farmácia 24h a 2,5km do local, que aceita "fiado" para clientes conhecidos.'],
    segredo_def: ['Em conversa reservada, Marcos contou que levou a filha à UPA a pé, de madrugada, depois de ser solto — por isso o registro é das 4h02.', 'Marcos tem carteira de trabalho com 10 anos de registros: nunca esteve desempregado tanto tempo.'],
    fatos_ocultos: [
      'Relatório da UPA: a febre da criança era de uma infecção que, sem remédio, poderia causar convulsão.',
      'Registro da farmácia 24h: estava fechada naquela noite por falta de energia.',
      'Ficha do mercado: Marcos tem uma "conta fiado" de R$43, quitada há 4 meses.'
    ],
    reviravolta: { titulo: 'O dono quer conversar', texto: 'Seu Joaquim protocola uma petição: aceitou R$470 da igreja do bairro como reparação total do dano (fechadura + produtos) e declara que não tem interesse na punição de Marcos.' },
    dicas_acu: ['A qualificadora do rompimento (§4º, I) dobra a pena: prove que a porta foi arrombada.', 'Pergunte se havia alternativas: farmácia, UPA, vizinhos.'],
    dicas_def: ['Estado de necessidade (Art. 24): perigo atual + não havia outro jeito + sacrifício razoável.', 'Pergunte ao policial o que Marcos disse na hora da prisão.']
  },

  '02': {
    rito: 'juri', acordo: false,
    testemunhas: [
      { id: 'sonia', nome: 'Sônia Ferraz', emoji: '😢', papel: 'testemunha', papel_txt: 'mãe de Diego (vítima)', arrolada_por: 'acusacao',
        perfil: 'Professora aposentada de 66 anos, de luto, revoltada, defende o filho e acusa Renata de manipuladora.',
        depoimento: 'O filho tinha mudado, estava fazendo terapia. Renata foi até o apartamento armada. "Ela foi lá para matar."',
        segredos: ['Diego confessou a ela que tinha empurrado Renata na escada no ano anterior.', 'Diego tinha uma arma de fogo guardada no apartamento.'] },
      { id: 'helio', nome: 'Hélio (vizinho de Diego)', emoji: '🧔', papel: 'testemunha', papel_txt: 'vizinho de porta de Diego', arrolada_por: 'acusacao',
        perfil: 'Motorista de app de 45 anos, direto, não quer se envolver, mas ouviu tudo.',
        depoimento: 'Ouviu uma discussão alta por uns 5 minutos. Ouviu Renata gritando "você não vai mais me ameaçar". Depois um baque.',
        segredos: ['Antes do baque, ouviu Diego gritando "eu vou te matar aqui mesmo".', 'Viu Diego chegar em casa às 22h bem alterado, cheirando a álcool.'] },
      { id: 'dra_luiza', nome: 'Dra. Luíza Campos', emoji: '🩺', papel: 'perito', papel_txt: 'psicóloga perita', arrolada_por: 'defesa',
        perfil: 'Psicóloga forense de 50 anos, técnica, calma, explica conceitos de forma didática.',
        depoimento: 'Diagnosticou Síndrome da Mulher Agredida: hipervigilância, medo constante de morte, percepção de perigo ampliada.',
        segredos: ['Na avaliação, Renata disse que "pensou em acabar com aquilo de uma vez" — frase ambígua.', 'Em casos de SMA, a vítima frequentemente antecipa o ataque por acreditar que não há como fugir.'] },
      { id: 'renata', nome: 'Renata Oliveira', emoji: '😰', papel: 'reu', papel_txt: 'ré', arrolada_por: 'juizo',
        perfil: 'Auxiliar administrativa de 38 anos, traumatizada, alterna entre firmeza e choro.',
        depoimento: 'Foi até lá para pedir que ele parasse, levou a faca por medo. Ele a agarrou pelo pescoço e ela reagiu.',
        segredos: ['Ela mandou uma mensagem para a irmã às 22h30: "hoje isso acaba".', 'Diego estava com a mão dentro da gaveta da cômoda quando ela golpeou.'] }
    ],
    segredo_acu: ['A irmã de Renata entregou à polícia a mensagem "hoje isso acaba", enviada às 22h30.'],
    segredo_def: ['Renata te contou que a gaveta onde Diego mexia era a da arma — e que ele já tinha apontado a arma para ela antes.'],
    fatos_ocultos: [
      'Perícia no apartamento: dentro da gaveta da cômoda havia um revólver calibre .38 carregado, com as digitais de Diego.',
      'Laudo complementar do IML: Renata tinha marcas de esganadura recentes no pescoço, fotografadas na delegacia.',
      'Histórico de ligações: Renata ligou para o 190 duas vezes naquela noite; a segunda ligação, às 22h35, não foi atendida.'
    ],
    reviravolta: { titulo: 'O revólver na gaveta', texto: 'A perícia complementar encontra um revólver carregado dentro da gaveta que Diego abria no momento dos golpes.' },
    dicas_acu: ['O ponto fraco da defesa é a iminência: ela foi até ele, 2h depois da ameaça.', 'No Júri, fale com os jurados como pessoas comuns: "ela levou uma faca na bolsa".'],
    dicas_def: ['Legítima defesa putativa (Art. 20, §1º): ela acreditou, com razão, que ia morrer.', 'Pergunte à perita como a SMA altera a percepção de perigo.']
  },

  '03': {
    rito: 'comum', acordo: true,
    testemunhas: [
      { id: 'joana', nome: 'Joana Ribeiro', emoji: '💔', papel: 'vitima', papel_txt: 'vítima', arrolada_por: 'acusacao',
        perfil: 'Viúva de 52 anos, envergonhada, ainda confusa entre raiva e saudade do "Dr. Rafael".',
        depoimento: 'Achava que tinha encontrado o amor de novo. Transferiu tudo o que tinha guardado. Só percebeu quando a filha mostrou as fotos falsas.',
        segredos: ['Ela chegou a desconfiar no mês 3, mas continuou mandando dinheiro "porque estava sozinha".', 'Ela também mandou R$5.000 para outro golpista, um ano antes.'] },
      { id: 'delegado', nome: 'Delegado Paulo Sena', emoji: '🕵️', papel: 'policial', papel_txt: 'delegado de crimes cibernéticos', arrolada_por: 'acusacao',
        perfil: 'Delegado de 48 anos, técnico, orgulhoso da investigação, usa jargão de tecnologia.',
        depoimento: 'Rastreou as contas dos PIX até os comparsas, que entregaram Felipe. No celular dele havia 4 perfis falsos e um roteiro de mensagens.',
        segredos: ['A quebra de sigilo das contas dos comparsas foi feita antes da autorização judicial chegar — por 2 dias.', 'Há pelo menos mais 3 vítimas identificadas em outros estados.'] },
      { id: 'kelly', nome: 'Kelly (comparsa)', emoji: '😬', papel: 'testemunha', papel_txt: 'corré colaboradora', arrolada_por: 'acusacao',
        perfil: 'Jovem de 23 anos, emprestou a conta, nervosa, quer se livrar da culpa jogando tudo em Felipe.',
        depoimento: 'Felipe pagava 20% para ela emprestar a conta. Ele mandava tudo, ela só repassava.',
        segredos: ['Ela mesma conversava com Joana às vezes, fingindo ser o "Dr. Rafael".'] },
      { id: 'felipe', nome: 'Felipe Duarte', emoji: '😏', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Ex-vendedor de 34 anos, carismático, manipulador, se faz de vítima das circunstâncias.',
        depoimento: 'Diz que o relacionamento começou de verdade e que Joana "dava dinheiro de livre vontade, como presente".',
        segredos: ['Ele sabia que Joana era viúva e morava sozinha — escolheu o perfil dela por isso.'] }
    ],
    segredo_acu: ['A filha de Joana encontrou no celular da mãe áudios de Felipe dizendo "se você não mandar, vou me matar".'],
    segredo_def: ['A quebra de sigilo das contas foi feita antes da autorização judicial — isso pode tornar a prova ilícita (Art. 157 CPP).'],
    fatos_ocultos: [
      'Ofício do banco: a quebra de sigilo foi executada 2 dias antes da decisão judicial que a autorizou.',
      'Perícia no celular: o "roteiro de mensagens" foi escrito por Kelly, não por Felipe.',
      'Joana devolveu R$3.000 a Felipe no mês 5, a pedido dele — o valor líquido do golpe é R$44.000.'
    ],
    reviravolta: { titulo: 'A prova pode ser ilícita?', texto: 'O banco envia um ofício: as contas dos comparsas foram rastreadas 2 dias ANTES da autorização judicial. A defesa pode pedir a exclusão de toda a prova derivada (teoria dos frutos da árvore envenenada).' },
    dicas_acu: ['O §5º (fraude eletrônica) aumenta muito a pena e é pacífico para PIX + app.', 'Combata a tese do "presente": pergunte sobre os motivos inventados para cada pedido.'],
    dicas_def: ['Crime continuado (Art. 71) junta os 23 PIX em um crime só, com aumento — muito melhor que somar 23 penas.', 'Investigue como a polícia conseguiu os dados bancários.']
  },

  '04': {
    rito: 'comum', acordo: false,
    testemunhas: [
      { id: 'lucas', nome: 'Lucas Moreira', emoji: '🤕', papel: 'vitima', papel_txt: 'vítima', arrolada_por: 'acusacao',
        perfil: 'Jovem de 19 anos, revoltado, desconfiado de qualquer autoridade, fala gírias e às vezes perde a calma.',
        depoimento: 'Estava algemado no chão quando o cabo começou a bater com o cassetete. Pedia para parar.',
        segredos: ['Antes das agressões, ele cuspiu no rosto do cabo Ronaldo.', 'Ele tinha tentado chutar a porta da cela.'] },
      { id: 'detento', nome: 'Wellington (detento)', emoji: '🧍', papel: 'testemunha', papel_txt: 'preso que estava na mesma cela', arrolada_por: 'acusacao',
        perfil: 'Homem de 35 anos, com medo de retaliação, responde de forma curta e olha para o chão.',
        depoimento: 'Lucas estava no chão, algemado, quando começaram a bater.',
        segredos: ['Foi ele quem avisou a ONG, porque "já tinha apanhado do mesmo policial".'] },
      { id: 'sgt_ana', nome: 'Sargento Ana Beatriz', emoji: '👮‍♀️', papel: 'policial', papel_txt: 'colega de plantão de Ronaldo', arrolada_por: 'defesa',
        perfil: 'Policial de 40 anos, corporativista, mas honesta quando pressionada.',
        depoimento: 'Ronaldo é um bom policial. Ouviu barulho na cela, como se alguém estivesse tentando fugir.',
        segredos: ['Ela viu a cena pela câmera ao vivo e não interveio.', 'Ronaldo disse a ela depois: "esse aí aprendeu a lição".'] },
      { id: 'ronaldo', nome: 'Cabo Ronaldo Teixeira', emoji: '🪖', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'PM de 29 anos, tenso, fala em tom militar, acredita que estava fazendo o trabalho dele.',
        depoimento: 'Lucas o agrediu e tentou fugir; usou a força necessária para contê-lo.',
        segredos: ['Ele estava no 3º plantão seguido, sem dormir.'] }
    ],
    segredo_acu: ['A Corregedoria tem uma segunda gravação, com áudio, onde se ouve Ronaldo dizendo "isso é pra você aprender".'],
    segredo_def: ['Ronaldo te contou que Lucas cuspiu no rosto dele e tentou arrancar a arma de um colega na entrada.'],
    fatos_ocultos: [
      'Áudio da câmera da cela: "isso é pra você aprender a respeitar polícia" — voz de Ronaldo.',
      'Escala de serviço: Ronaldo estava em seu 3º plantão consecutivo, 36 horas sem descanso.',
      'Laudo do IML de Ronaldo: arranhão no rosto compatível com luta corporal na entrada da delegacia.'
    ],
    reviravolta: { titulo: 'A câmera tinha áudio', texto: 'A Corregedoria descobre que a câmera da cela também gravava áudio. Em meio às agressões, ouve-se: "isso é pra você aprender a respeitar polícia".' },
    dicas_acu: ['Tortura-castigo (Lei 9.455, art. 1º, II): sofrimento intenso como punição de quem está sob sua guarda.', 'O vídeo mostra Lucas algemado: não havia agressão a repelir.'],
    dicas_def: ['Se não for tortura, pode ser lesão corporal (Art. 129) — pena muito menor.', 'Explore o contexto: luta corporal antes, cansaço extremo.']
  },

  '05': {
    rito: 'comum', acordo: false,
    testemunhas: [
      { id: 'auditora', nome: 'Auditora Fiscal Regina Lopes', emoji: '📊', papel: 'perito', papel_txt: 'auditora da Receita Federal', arrolada_por: 'acusacao',
        perfil: 'Auditora de 52 anos, precisa, adora números, impaciente com perguntas vagas.',
        depoimento: 'O cruzamento identificou 14 empresas sem funcionários, sede ou atividade, que só emitiam notas para o fundo.',
        segredos: ['Duas das 14 empresas tinham atividade real pequena antes de serem usadas no esquema.'] },
      { id: 'irmao', nome: 'Roberto (irmão de Marcelo)', emoji: '😟', papel: 'testemunha', papel_txt: 'irmão do réu, também investigado', arrolada_por: 'acusacao',
        perfil: 'Motorista de 40 anos, magoado com o irmão, mas ainda o ama; dividido entre a verdade e a família.',
        depoimento: 'Assinou papéis achando que era para uma empresa de consultoria. Nunca viu dinheiro.',
        segredos: ['Marcelo pagou o tratamento de câncer da mãe deles com parte do dinheiro.', 'Ele recebeu R$5.000 de Marcelo "de presente" no Natal.'] },
      { id: 'gestor', nome: 'Sr. Afonso Brandão', emoji: '💼', papel: 'testemunha', papel_txt: 'ex-presidente do fundo de pensão', arrolada_por: 'defesa',
        perfil: 'Gestor de 61 anos, evasivo, preocupado com a própria reputação.',
        depoimento: 'Confiava em Marcelo. Os pagamentos passavam por aprovação de rotina.',
        segredos: ['Ele assinava as aprovações sem ler, e o auditor interno o alertou em dez/2022.', 'Ele indicou Marcelo para o cargo — são amigos de infância.'] },
      { id: 'marcelo', nome: 'Marcelo Antunes', emoji: '🧮', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Contador de 44 anos, frio, articulado, tenta parecer colaborativo.',
        depoimento: 'Diz que os serviços foram prestados por terceirizados e que houve "erro de documentação".',
        segredos: ['Ele estava devendo R$120.000 a agiotas quando começou o esquema.'] }
    ],
    segredo_acu: ['O auditor interno do fundo enviou um e-mail em dez/2022 alertando a presidência; Marcelo respondeu com uma planilha falsa.'],
    segredo_def: ['Marcelo te contou que o presidente do fundo sabia de tudo e ficava com parte do dinheiro.'],
    fatos_ocultos: [
      'Quebra de sigilo do presidente do fundo: recebeu R$40.000 de uma das empresas fantasmas.',
      'Laudo contábil complementar: R$62.000 do valor desviado foram pagos a um hospital oncológico.',
      'Registros de agiotagem: Marcelo pagou R$120.000 a um agiota entre 2022 e 2023.'
    ],
    reviravolta: { titulo: 'O presidente também lucrou', texto: 'A quebra de sigilo revela que o presidente do fundo, Sr. Afonso, recebeu R$40.000 de uma das empresas fantasmas. Marcelo agiu sozinho mesmo?' },
    dicas_acu: ['Lavagem (Lei 9.613) é crime autônomo: as 6 contas usadas para "esconder" o dinheiro são a prova.', 'Crime continuado vale para as notas frias, mas a lavagem soma.'],
    dicas_def: ['Ataque a autoria exclusiva: quem mais tinha acesso e lucrou?', 'Peça o crime continuado para unificar as 312 notas.']
  },

  '06': {
    rito: 'juri', acordo: false,
    testemunhas: [
      { id: 'fabio', nome: 'Fábio (amigo do racha)', emoji: '🏎️', papel: 'testemunha', papel_txt: 'amigo que disputava o racha', arrolada_por: 'acusacao',
        perfil: 'Universitário de 22 anos, arrogante no início, assustado quando pressionado, quer se proteger.',
        depoimento: 'O racha foi ideia do grupo. Bruno estava "meio alto". Ele mesmo parou antes do cruzamento.',
        segredos: ['Bruno disse antes da largada: "hoje eu não freio pra nada".', 'Fábio também tinha bebido e fugiu antes da polícia.'] },
      { id: 'marta', nome: 'Marta Souza', emoji: '😨', papel: 'testemunha', papel_txt: 'pedestre que viu o atropelamento', arrolada_por: 'acusacao',
        perfil: 'Enfermeira de 38 anos, voltando do plantão, ainda traumatizada; tenta prestar socorro em tudo o que fala.',
        depoimento: 'O carro veio em velocidade absurda, nem freou. O senhor estava na faixa. Ela tentou socorrer, mas ele já estava morto.',
        segredos: ['O semáforo de pedestres estava amarelo piscante (com defeito) naquela noite.'] },
      { id: 'perito_transito', nome: 'Perito Carlos Viana', emoji: '📐', papel: 'perito', papel_txt: 'perito criminal de trânsito', arrolada_por: 'defesa',
        perfil: 'Engenheiro de 55 anos, técnico e neutro, fala em números e distâncias.',
        depoimento: 'Velocidade de 127km/h. Não há marcas de frenagem antes do impacto.',
        segredos: ['A 60km/h, o carro teria parado a tempo. A 127km/h, nem um piloto profissional pararia.', 'A iluminação do trecho estava com 3 postes apagados.'] },
      { id: 'bruno_r', nome: 'Bruno Carvalho', emoji: '😶', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Estudante de 22 anos, arrependido, mas muito orientado pelos advogados; fala pouco e de forma ensaiada.',
        depoimento: 'Não viu o senhor. Entrou em pânico e fugiu. Se arrepende todos os dias.',
        segredos: ['Viu o pedestre "no último segundo" e pensou "ele vai sair da frente".', 'Ligou para o pai antes de ligar para qualquer socorro.'] }
    ],
    segredo_acu: ['No grupo de WhatsApp, Bruno escreveu às 22h58: "hoje vou bater meu recorde, nem que eu atropele alguém kkk".'],
    segredo_def: ['Bruno te contou que o semáforo de pedestres estava com defeito, piscando amarelo — Renato pode ter atravessado sem a preferência clara.'],
    fatos_ocultos: [
      'Laudo do semáforo: o sinal de pedestres estava com defeito, em amarelo piscante, havia 3 dias.',
      'Perícia no celular de Bruno: mensagem às 22h58 — "hoje vou bater meu recorde, nem que eu atropele alguém kkk".',
      'Exame toxicológico complementar: Renato havia tomado um remédio que causa sonolência.'
    ],
    reviravolta: { titulo: 'A mensagem apagada', texto: 'A perícia recupera uma mensagem apagada do celular de Bruno, enviada 16 minutos antes do atropelamento: "hoje vou bater meu recorde, nem que eu atropele alguém kkk".' },
    dicas_acu: ['Dolo eventual: ele assumiu o risco de matar (racha + álcool + 127km/h). Isso leva o caso ao Júri.', 'A fuga sem socorro mostra indiferença com a vida.'],
    dicas_def: ['Lute pela desclassificação para homicídio culposo de trânsito (Art. 302 CTB): pena bem menor e sem Júri.', 'Imprudência gravíssima ainda é culpa, não dolo: ele não QUERIA matar.']
  },

  '07': {
    rito: 'comum', acordo: false,
    testemunhas: [
      { id: 'patricia', nome: 'Dra. Patrícia Nascimento', emoji: '👩🏾‍⚕️', papel: 'vitima', papel_txt: 'vítima, médica cardiologista', arrolada_por: 'acusacao',
        perfil: 'Médica de 36 anos, digna, firme, emocionada ao lembrar das mensagens de ódio.',
        depoimento: 'Recusou segui-lo e, à noite, virou alvo de milhares de pessoas. Teve síndrome do pânico e se afastou do trabalho.',
        segredos: ['Pacientes cancelaram consultas depois do post.', 'Caio já tinha mandado mensagens para ela antes, insistindo para ser seguido, por 3 semanas.'] },
      { id: 'social_media', nome: 'Gabi (social media de Caio)', emoji: '📱', papel: 'testemunha', papel_txt: 'ex-funcionária de Caio', arrolada_por: 'acusacao',
        perfil: 'Jovem de 25 anos, saiu da equipe de Caio depois do caso, ressentida mas cuidadosa com o que fala.',
        depoimento: 'Caio publica os próprios stories. Naquela noite ele estava com raiva e não quis esperar a revisão.',
        segredos: ['Caio pediu a ela para "segurar o post até bombar" antes de apagar.', 'Ele mantém uma planilha de "inimigos" que recusaram parcerias.'] },
      { id: 'amigo_caio', nome: 'Rafa (amigo de Caio)', emoji: '🤙', papel: 'testemunha', papel_txt: 'amigo do réu', arrolada_por: 'defesa',
        perfil: 'Influencer de 30 anos, defende o amigo, minimiza tudo como "humor ácido".',
        depoimento: 'Caio é "zoeiro", não é racista, tem amigos negros. Foi uma piada de mau gosto.',
        segredos: ['Ele mesmo compartilhou o story com a legenda "kkkkk mito".'] },
      { id: 'caio', nome: 'Caio Mendonça', emoji: '🤳', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Influencer de 31 anos, vaidoso, defensivo, alterna arrogância e desculpas ensaiadas.',
        depoimento: 'Foi uma brincadeira, estava nervoso, apagou e pediu desculpas publicamente.',
        segredos: ['Ele ganhou 12 mil seguidores nas 14 horas em que o post ficou no ar.'] }
    ],
    segredo_acu: ['A equipe de Caio monitorou o engajamento do post e o manteve no ar de propósito: o perfil ganhou 12 mil seguidores naquela noite.'],
    segredo_def: ['Caio te contou que fez um curso de letramento racial depois do caso e doou R$20.000 a uma ONG antirracista.'],
    fatos_ocultos: [
      'Métricas do Instagram: +12.400 seguidores e +R$8.000 em publiposts nas 14 horas em que o story ficou no ar.',
      'Mensagens de Caio para Gabi às 2h: "segura que tá bombando".',
      'Recibo: doação de R$20.000 de Caio a uma ONG antirracista, 10 dias depois do caso.'
    ],
    reviravolta: { titulo: '"Segura que tá bombando"', texto: 'A ex-funcionária entrega prints: às 2h da manhã, Caio mandou "segura que tá bombando" — ele sabia do alcance e manteve o post no ar de propósito.' },
    dicas_acu: ['Desde 2023 a injúria racial é equiparada ao racismo: é imprescritível e inafiançável.', 'Calúnia (Art. 138): ele imputou falsamente um crime (diploma falso).'],
    dicas_def: ['Explore o arrependimento: apagou o post, pediu desculpas, fez reparação.', 'Questione a calúnia: insinuar não é imputar um fato determinado.']
  },

  '08': {
    rito: 'juri', acordo: false,
    testemunhas: [
      { id: 'osvaldo', nome: 'Seu Osvaldo Lima', emoji: '👴', papel: 'vitima', papel_txt: 'vítima, pai do réu', arrolada_por: 'acusacao',
        perfil: 'Aposentado de 71 anos, fragilizado, dividido entre o amor de pai e a mágoa; às vezes defende o filho sem querer.',
        depoimento: 'Eduardo sempre trazia o chá. Ele começou a passar mal e o filho dizia que era a idade.',
        segredos: ['Ele mesmo comprou um suplemento chinês pela internet meses antes.', 'Ele tinha alterado o testamento para deixar metade da herança para a igreja — e contou ao filho 1 mês antes.'] },
      { id: 'vizinha', nome: 'Dona Lurdes', emoji: '👀', papel: 'testemunha', papel_txt: 'vizinha que chamou o SAMU', arrolada_por: 'acusacao',
        perfil: 'Aposentada de 68 anos, fofoqueira, observadora, adora detalhes.',
        depoimento: 'Achou Osvaldo caído no quintal e chamou o SAMU. Eduardo "nem parecia preocupado".',
        segredos: ['Viu Eduardo jogando um frasco no lixo reciclável na véspera da internação.'] },
      { id: 'toxicologista', nome: 'Dr. Henrique Sato', emoji: '🧪', papel: 'perito', papel_txt: 'perito toxicologista', arrolada_por: 'defesa',
        perfil: 'Médico de 58 anos, extremamente técnico, honesto, não toma partido.',
        depoimento: 'O arsênico no sangue indica exposição crônica de semanas. A concentração é tóxica.',
        segredos: ['Alguns suplementos importados irregulares contêm arsênico — mas em concentração muito menor que a encontrada.', 'O padrão de exposição indica doses diárias e crescentes, o que é incompatível com uma contaminação acidental.'] },
      { id: 'eduardo', nome: 'Eduardo Lima', emoji: '😐', papel: 'reu', papel_txt: 'réu', arrolada_por: 'juizo',
        perfil: 'Ex-gerente de banco de 38 anos, frio, controlado, responde com precisão calculada.',
        depoimento: 'Nega tudo. O pai comprava suplementos duvidosos. Ele só cuidava do pai.',
        segredos: ['O arsênico comprado era, segundo ele, "para matar cupins da casa".'] }
    ],
    segredo_acu: ['Osvaldo tinha mudado o testamento e contado ao filho 1 mês antes da primeira compra de arsênico.'],
    segredo_def: ['Eduardo te contou que o pai importava um suplemento chinês e que a casa realmente tinha cupins — há um orçamento de dedetização.'],
    fatos_ocultos: [
      'Análise do suplemento chinês de Osvaldo: contém arsênico, mas 40 vezes menos que a dose encontrada no sangue.',
      'Orçamento de dedetização contra cupins, pedido por Eduardo 2 dias antes da compra do arsênico.',
      'Frasco recuperado do lixo reciclável com resíduo de trióxido de arsênio e digitais de Eduardo.'
    ],
    reviravolta: { titulo: 'O testamento', texto: 'O tabelião informa: um mês antes da primeira compra de arsênico, Osvaldo alterou o testamento, deixando metade da herança para a igreja — e avisou Eduardo.' },
    dicas_acu: ['Duas qualificadoras: veneno (§2º, III) e motivo torpe (§2º, I, a herança). Pena de 12 a 30 anos, reduzida pela tentativa.', 'Fale ao Júri sobre a traição: o filho que preparava o chá.'],
    dicas_def: ['Dúvida razoável: o suplemento importado também tinha arsênico.', 'No Júri basta convencer 4 dos 7 jurados de que há dúvida.']
  }
};

// Jurados possíveis (7 são sorteados por julgamento)
export const JURADOS = [
  { nome: 'Dona Cleusa', perfil: 'professora aposentada, 67 anos, religiosa, muito sensível a histórias de família e maternidade', emoji: '👩‍🏫' },
  { nome: 'Jefferson', perfil: 'motorista de aplicativo, 34 anos, prático, desconfiado de "conversa de advogado", quer fatos', emoji: '🚗' },
  { nome: 'Marina', perfil: 'estudante de psicologia, 22 anos, empática, presta atenção em traumas e contexto', emoji: '🎓' },
  { nome: 'Seu Antônio', perfil: 'comerciante, 58 anos, conservador, linha-dura com crimes, já foi assaltado', emoji: '🏪' },
  { nome: 'Priscila', perfil: 'enfermeira, 41 anos, valoriza laudos médicos e provas técnicas', emoji: '🩺' },
  { nome: 'Rodrigo', perfil: 'engenheiro, 45 anos, extremamente lógico, odeia contradições', emoji: '📐' },
  { nome: 'Tânia', perfil: 'dona de casa, 52 anos, mãe de 3, se coloca no lugar das vítimas', emoji: '🏠' },
  { nome: 'Léo', perfil: 'músico, 29 anos, desconfia da polícia e do sistema, garantista', emoji: '🎸' },
  { nome: 'Sra. Helena', perfil: 'advogada trabalhista aposentada, 70 anos, atenta à forma e às regras', emoji: '⚖️' },
  { nome: 'Wagner', perfil: 'policial civil aposentado, 63 anos, acredita nas investigações', emoji: '🕶️' },
  { nome: 'Bianca', perfil: 'influenciadora digital, 27 anos, impressionada por quem fala bem e com emoção', emoji: '📱' },
  { nome: 'Seu Raimundo', perfil: 'pedreiro, 55 anos, simples e justo, desconfia de quem "fala difícil"', emoji: '🧱' }
];

// A Câmara Criminal do Tribunal de Justiça
export const DESEMBARGADORES = [
  { nome: 'Des. Helena Prado', papel: 'relator', perfil: 'garantista convicta: rigorosa com provas ilícitas e com qualquer dúvida, favorece o réu na dúvida, cita a Constituição', emoji: '👩‍⚖️' },
  { nome: 'Des. Rubens Albuquerque', papel: 'revisor', perfil: 'linha-dura: valoriza a palavra da vítima e da polícia, preocupado com a impunidade, mas respeita a lei', emoji: '👨‍⚖️' },
  { nome: 'Des. Marcos Tavares', papel: 'vogal', perfil: 'técnico e pragmático: segue a jurisprudência do STJ ao pé da letra e costuma desempatar pela dosimetria', emoji: '🧑‍⚖️' }
];
