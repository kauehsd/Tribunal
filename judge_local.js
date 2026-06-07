// judge_local.js — Dr. Augusto Melo v4 — motor local robusto
// API pública idêntica à v3 — drop-in replacement, sem quebrar nada.
// Melhorias: análise contextual mais rica, respostas dinâmicas variadas,
// detecção de contradições, tracking de teses usadas, feedback cirúrgico
// por caso, pontuação mais granular, veredito fundamentado por tipo.

export const LocalJudge = (function () {

  // ─── TESES JURÍDICAS ─────────────────────────────────────────────────────

  const TESES = {
    estado_necessidade: {
      kws: ['estado de necessidade','fome','filhos','família','criança','sobrevivência',
            'necessidade','desemprego','pobreza','não tinha dinheiro','miserável','sustento'],
      acu: 'Estado de necessidade exige prova de perigo atual e inevitabilidade (Art. 24 CP). Demonstre que havia alternativas lícitas disponíveis e que o réu optou pelo crime.',
      def: 'Art. 24 CP exige 3 requisitos cumulativos: (1) perigo atual não provocado, (2) inevitabilidade do sacrifício do bem alheio, (3) proporcionalidade. Comprove cada um com fatos.',
      art: 'Art. 24 CP', peso_def: 4, peso_acu: 0
    },
    insignificancia: {
      kws: ['insignificância','bagatela','irrisório','mínimo','pouco','r$','reais',
            'valor baixo','pequeno valor','inexpressivo','centavos'],
      acu: 'Insignificância não é automática. STF HC 84.412 exige 4 vetores: mínima ofensividade, ausência de periculosidade, reduzido grau de reprovabilidade e inexpressividade da lesão. Analise reincidência e habitualidade do agente.',
      def: 'Prove os 4 vetores do STF HC 84.412 com fatos concretos: valor do bem, contexto econômico da vítima, ausência de antecedentes do réu e impacto social da conduta.',
      art: 'STF HC 84.412', peso_def: 3, peso_acu: 0
    },
    dolo: {
      kws: ['dolo','intenção','quis','queria','planejou','premeditou','consciência',
            'sabia','tinha certeza','deliberado','voluntário'],
      acu: 'Dolo eventual basta para a condenação: o agente previu o resultado como possível e assumiu o risco de produzi-lo (Art. 18, I CP). Não é necessário dolo direto.',
      def: 'Dolo deve ser provado, não presumido. Questione a vontade livre e consciente do agente — culpa consciente afasta o dolo eventual e pode desclassificar o crime.',
      art: 'Art. 18 CP', peso_acu: 3, peso_def: 0
    },
    autoria: {
      kws: ['câmera','flagrante','testemunha','prova','vídeo','identificado',
            'reconhecimento','foi pego','encontrado','flagrado','presenciado'],
      acu: 'Flagrante + prova testemunhal + material formam conjunto probatório sólido quando coerentes e sem contradição. Destaque a coerência dos elementos.',
      def: 'Reconhecimento fotográfico isolado é prova insuficiente (STJ Tema 1.159). Exija prova robusta — a condenação exige certeza, não mera probabilidade.',
      art: 'Art. 155 CPP + STJ Tema 1.159', peso_acu: 4, peso_def: 0
    },
    qualif_noturno: {
      kws: ['noturno','madrugada','noite','repouso','2h','3h','4h','de madrugada','à noite','hora','horário'],
      acu: 'Furto noturno qualifica a pena em 1/3 (Art. 155 §1° CP). Comprove o horário exato e que o estabelecimento estava fechado ao público.',
      def: 'Qualificadora do repouso exige que a vítima (ou responsável) estivesse em efetivo repouso no local — não basta o horário noturno. Questione esse requisito.',
      art: 'Art. 155 §1° CP', peso_acu: 2, peso_def: 0
    },
    arrombamento: {
      kws: ['arrombou','arrombamento','quebrou','forçou','destruiu','porta',
            'janela','rompeu','entrou pela','grade','cadeado','tranca'],
      acu: 'Rompimento de obstáculo qualifica o furto (Art. 155 §4°, I CP). Exija laudo pericial comprovando a destruição e sua relevância para o acesso.',
      def: 'O rompimento deve ser de obstáculo relevante à proteção do bem — dificuldade mínima superada não qualifica. Questione a proporcionalidade.',
      art: 'Art. 155 §4° CP', peso_acu: 3, peso_def: 0
    },
    reincidencia: {
      kws: ['reincidente','antecedente','condenado','passagem','ficha',
            'preso antes','já foi preso','histórico criminal','condenações anteriores'],
      acu: 'Reincidência é agravante obrigatória (Art. 61, I CP) e impede substituição de pena privativa por restritiva de direitos. Junte a certidão cartorária.',
      def: 'Reincidência exige certidão cartorária específica e trânsito em julgado de condenação anterior (Súmula 636 STJ). Sem documento, não há reincidência.',
      art: 'Art. 61 CP + Súm. 636 STJ', peso_acu: 3, peso_def: 0
    },
    primario: {
      kws: ['primário','primeira vez','sem antecedente','nunca foi preso',
            'ficha limpa','sem passagem','não tem passagem','primariedade'],
      acu: 'Primariedade não exclui culpabilidade — apenas mitiga a dosimetria da pena. O crime permanece configurado independentemente dos antecedentes.',
      def: 'Réu primário + bons antecedentes = pena-base no mínimo legal (Art. 59 CP). Explore também a possibilidade de substituição por penas restritivas de direitos (Art. 44 CP).',
      art: 'Art. 59 CP', peso_def: 2, peso_acu: 0
    },
    legitima_defesa: {
      kws: ['legítima defesa','se defendeu','ataque','agrediu primeiro',
            'ameaça','reagiu','em defesa','protegeu','repeliu','provocado'],
      acu: 'Verifique excesso doloso ou culposo — ambos afastam a excludente (Art. 23 §único CP). Questione a moderação dos meios e a proporcionalidade da reação.',
      def: 'Legítima defesa (Art. 25 CP) exige: (1) agressão injusta, (2) atual ou iminente, (3) moderação nos meios necessários. Todos os requisitos precisam estar presentes.',
      art: 'Art. 25 CP', peso_def: 4, peso_acu: 0
    },
    concurso_pessoas: {
      kws: ['comparsa','ajuda','junto','grupo','quadrilha','organizado',
            'mais de um','cúmplice','participação','concurso','coautoria'],
      acu: 'Concurso de pessoas agrava a pena (Art. 29 CP). Prove a divisão de tarefas, o dolo conjunto e a contribuição individual de cada agente.',
      def: 'Autoria e participação exigem prova individualizada do dolo de cada agente. Participação menor pode resultar em pena reduzida (Art. 29 §1° CP).',
      art: 'Art. 29 CP', peso_acu: 2, peso_def: 0
    },
    confissao: {
      kws: ['confessou','admitiu','reconheceu','assumiu','eu fiz','ele admitiu',
            'confissão','confissão espontânea','admitiu os fatos'],
      acu: 'Confissão espontânea é atenuante (Art. 65, III, d CP) mas não exclui a tipicidade nem a ilicitude. A pena é reduzida, não o crime.',
      def: 'Confissão espontânea é atenuante obrigatória (Art. 65, III, d CP). Aplique-a na segunda fase da dosimetria — o juiz não pode deixar de aplicar.',
      art: 'Art. 65 III d CP', peso_def: 2, peso_acu: 0
    },
    pericia: {
      kws: ['laudo','perícia','perito','exame','análise técnica','laudado',
            'exame de corpo de delito','exame toxicológico','resultado da perícia'],
      acu: 'Prova pericial é a mais robusta no processo penal. Destaque a cadeia de custódia e a idoneidade do laudo para solidificar a materialidade.',
      def: 'Questione a cadeia de custódia da perícia (Art. 158-A CPP). Se houver vícios no procedimento, a prova pode ser anulada por ilicitude.',
      art: 'Art. 158 CPP', peso_acu: 3, peso_def: 0
    },
    uso_pessoal: {
      kws: ['uso pessoal','usuário','consumo próprio','viciado','dependente',
            'dependência química','só pra mim','era pra mim','não vendia'],
      acu: 'Uso pessoal não afasta a materialidade quando quantidade, acondicionamento e contexto indicam tráfico. Analise os elementos objetivos (Art. 28 vs Art. 33 Lei 11.343).',
      def: 'Diferença entre usuário e traficante é subjetiva (Art. 28 §2° Lei 11.343). Natureza, quantidade, local, circunstâncias da apreensão e conduta social do réu devem ser considerados.',
      art: 'Art. 28 Lei 11.343/06', peso_def: 3, peso_acu: 0
    },
    nullidade: {
      kws: ['ilegal','inconstitucional','nulidade','prova ilícita','irregularidade',
            'sem mandado','sem autorização','abusivo','violação','ilegalidade'],
      acu: 'Nulidade deve ser arguida com especificidade: qual ato, qual prejuízo (pas de nullité sans grief — Art. 563 CPP). Ato nulo não contamina os demais se independentes.',
      def: 'Prova ilícita é inadmissível (Art. 5°, LVI CF + Art. 157 CPP) e contamina as provas dela derivadas (teoria dos frutos da árvore envenenada). Se procedente, pode derrubar toda a acusação.',
      art: 'Art. 5° LVI CF + Art. 157 CPP', peso_def: 4, peso_acu: 0
    }
  };

  // ─── PERGUNTAS CONTEXTUAIS POR TIPO ──────────────────────────────────────

  const PERGUNTAS = {
    furto: [
      'Qual o valor exato subtraído e como foi apurado — laudo ou arbitramento?',
      'Havia câmeras funcionando ou testemunhas presenciais que identificaram o réu?',
      'O estabelecimento estava em efetivo repouso noturno ou apenas fechado?',
      'A defesa invoca estado de necessidade — com quais provas concretas sustenta os 3 requisitos do Art. 24 CP?',
      'Quais as condições econômicas reais do réu na data dos fatos — renda, emprego, família?',
      'Houve rompimento de obstáculo relevante ou apenas dificuldade mínima superada?',
      'O réu foi preso em flagrante ou identificado posteriormente — como?',
      'Há reincidência comprovada por certidão cartorária específica?',
      'O valor do bem é compatível com a tese de insignificância — os 4 vetores do STF estão presentes?',
      'Havia co-autores identificados e qual foi o papel de cada um?'
    ],
    homicidio: [
      'Qual a prova de autoria — testemunhal, pericial, material ou todas?',
      'O laudo de necropsia confirma causa mortis compatível com a narrativa apresentada?',
      'O agente agiu com dolo direto, eventual ou apenas culpa?',
      'Existe qualificadora provada — motivo torpe, crueldade, emboscada ou meio insidioso?',
      'Havia relação prévia entre réu e vítima que contextualiza o fato?',
      'A defesa alega legítima defesa — os 3 requisitos do Art. 25 CP estão comprovados?',
      'Há testemunhas oculares ou apenas prova indireta e circunstancial?',
      'Existe prova de premeditação ou o fato foi emocional e não planejado?',
      'O réu tem antecedentes de violência contra a mesma vítima?',
      'Houve excesso doloso ou culposo na reação — se legítima defesa for invocada?'
    ],
    trafico: [
      'A substância foi submetida à perícia química e identificada como ilícita?',
      'Qual quantidade exata, como estava acondicionada e em qual local foi encontrada?',
      'O réu alega uso pessoal — os elementos do Art. 28 §2° Lei 11.343 sustentam essa tese?',
      'Existem provas de tráfico além da posse — dinheiro fracionado, cadernos, contatos, embalagens?',
      'A abordagem policial observou as formalidades legais — havia fundada suspeita?',
      'O réu é primário ou reincidente — qual o impacto na pena?',
      'Há co-autores identificados e qual a hierarquia na organização?',
      'A quantidade é compatível com consumo pessoal ou indica comércio?',
      'O local da apreensão — residência, via pública, ponto de tráfico conhecido?',
      'Houve flagrante preparado por agentes ou a abordagem foi espontânea?'
    ],
    violencia_domestica: [
      'Há boletim de ocorrência e histórico de violência anterior documentado?',
      'A vítima ratificou suas declarações em juízo ou houve retratação?',
      'Existe medida protetiva vigente que teria sido descumprida?',
      'Laudos de lesão corporal foram produzidos — e quando em relação ao fato?',
      'O réu reconhece os fatos ou apresenta versão divergente — com que provas?',
      'Há testemunhas do convívio que corroboram os fatos narrados?',
      'A vítima depende economicamente do réu — isso pode explicar eventual retratação?',
      'Havia filhos presentes durante a violência — impacto no §2° do Art. 129 CP?',
      'O réu tem histórico de tratamento para dependência química ou álcool?',
      'Existem registros anteriores de BO que demonstrem habitualidade?'
    ],
    default: [
      'Qual a principal prova de autoria e de materialidade do delito?',
      'A defesa apresentou tese de excludente ou atenuante com provas?',
      'Os artigos invocados são adequados aos fatos narrados — a conduta se amolda ao tipo?',
      'Há contradição relevante entre as versões das partes que precisa ser resolvida?',
      'Qual o impacto das circunstâncias pessoais do réu na dosimetria da pena?',
      'Existe prova pericial que sustenta a narrativa da acusação — com cadeia de custódia?',
      'A conduta se amolda exatamente ao tipo penal invocado ou há desclassificação possível?',
      'Há nulidade processual arguida — e qual o prejuízo concreto para a parte?'
    ]
  };

  // ─── BANCO DE FALAS DO JUIZ ───────────────────────────────────────────────

  const FALAS = {
    pressionar_acu: [
      'A acusação precisa ser mais objetiva. Cite artigos e fatos — não suposições.',
      'Doutor, o argumento carece de respaldo probatório. Qual a prova concreta disso?',
      'A acusação ainda não enfrentou a tese defensiva levantada. Responda diretamente.',
      'Seja mais preciso: qual a qualificadora invocada e qual prova a sustenta?',
      'O Juízo não pode condenar com base em suposição. Qual é a prova objetiva de autoria?',
      'O argumento da acusação é genérico. Especifique: qual ato, qual prova, qual artigo?'
    ],
    pressionar_def: [
      'A defesa levantou tese relevante mas precisa comprová-la com fatos concretos.',
      'Doutora, a excludente invocada exige prova. Como pretende demonstrá-la?',
      'A defesa não respondeu ao principal argumento da acusação. Enfrente-o.',
      'Argumento genérico não é suficiente. Especifique as lacunas probatórias que identifica.',
      'A tese defensiva precisa de lastro factual. Quais provas a sustentam?',
      'Invocar a excludente sem prová-la não cria dúvida razoável. Apresente elementos concretos.'
    ],
    equilibrado: [
      'Debate equilibrado. Ambas as partes devem aprofundar os pontos centrais.',
      'O Juízo observa que a questão de autoria ainda não foi definitivamente enfrentada.',
      'Prossigam — mas foquem nos elementos do tipo penal, não em argumentos periféricos.',
      'O debate está bem conduzido. Partam para a questão da dosimetria.',
      'Ambas as partes apresentaram argumentos relevantes. Avancemos para o ponto central do caso.',
      'Bom nível técnico. Mas a questão central — materialidade e autoria — ainda precisa de mais atenção.'
    ],
    tese_forte_def: [
      'A defesa levantou ponto relevante. A acusação tem direito de réplica específica.',
      'Essa tese merece atenção. Acusação, como afasta essa excludente com fatos?',
      'Ponto importante da defesa. A acusação deve rebater com fatos, não retórica.',
      'A tese defensiva cria dúvida razoável no Juízo. Acusação, é necessária uma resposta objetiva.',
      'Argumento defensivo sólido. Acusação, o in dubio pro reo pode ser aplicado se isso não for rebatido.'
    ],
    tese_forte_acu: [
      'A acusação apresentou prova relevante. Defesa, como contesta esse elemento?',
      'Esse indício é significativo. A defesa precisa criar dúvida razoável sobre ele.',
      'A materialidade parece bem estabelecida. A defesa deve focar na autoria ou na excludente.',
      'Prova robusta da acusação. Defesa, questionar a cadeia de custódia ou contestar diretamente?',
      'O conjunto probatório da acusação é consistente. A defesa precisa de uma tese sólida para rebatê-lo.'
    ],
    contradicao: [
      'O Juízo identificou contradição entre as versões. As partes devem esclarecê-la antes de prosseguir.',
      'Há inconsistência nos fatos narrados. Qual versão é corroborada por prova objetiva?',
      'As narrativas são incompatíveis. Qual das partes tem provas que sustentam sua versão?'
    ],
    sem_artigos: [
      'O debate precisa de mais fundamento legal. Citem artigos e jurisprudência relevante.',
      'Argumentação sem base legal não prospera no processo penal. Artigos, por favor.',
      'Faltam referências normativas. Jurisprudência e doutrina fortalecem qualquer argumento.'
    ],
    muito_curto: [
      'O argumento foi muito breve. Desenvolvam melhor as teses antes de prosseguir.',
      'Argumentação lacônica. O Juízo espera mais profundidade técnica de ambas as partes.',
      'Muito conciso. Desenvolvam os fundamentos jurídicos com mais precisão.'
    ]
  };

  // ─── FUNDAMENTAÇÃO POR TIPO ───────────────────────────────────────────────

  const FUND_TIPO = {
    furto: {
      condenar: [
        'A prova de autoria e materialidade foi suficientemente demonstrada, com conjunto probatório coerente e sem contradições relevantes.',
        'O furto foi demonstrado pelos elementos constantes dos autos — a defesa não criou dúvida razoável sobre os fatos essenciais.',
        'A qualificadora foi devidamente comprovada, tornando a condenação adequada ao grau de ofensividade da conduta.'
      ],
      absolver: [
        'A acusação não logrou demonstrar autoria com certeza — o in dubio pro reo (Art. 386, VI CPP) impõe a absolvição.',
        'A tese de estado de necessidade mostrou-se sustentável no debate, gerando dúvida razoável insuperável.',
        'Os 4 vetores da insignificância foram demonstrados — a conduta não atingiu nível de ofensividade suficiente para condenação.'
      ],
      parcial: [
        'A autoria foi demonstrada, mas as circunstâncias atenuantes — primariedade e contexto social — justificam pena próxima ao mínimo.',
        'A materialidade está provada, mas as qualificadoras não foram suficientemente demonstradas — aplica-se o tipo simples.',
        'A condenação é cabível, mas o estado de necessidade parcial justifica a pena mínima com regime aberto.'
      ]
    },
    homicidio: {
      condenar: [
        'A prova de autoria e o laudo de necropsia confirmam a tese acusatória com suficiente segurança para condenação.',
        'O dolo ficou demonstrado pelas circunstâncias do fato — a conduta foi consciente e voluntária.',
        'A qualificadora restou comprovada, impondo condenação em patamar mais elevado.'
      ],
      absolver: [
        'A legítima defesa apresentou-se como excludente plausível — a dúvida quanto ao excesso impõe absolvição.',
        'A prova de autoria, exclusivamente indireta, não atingiu o grau de certeza necessário para condenação criminal.',
        'O dolo não foi provado com segurança — a hipótese de culpa consciente não pode ser descartada.'
      ],
      parcial: [
        'O homicídio restou configurado, mas a ausência de qualificadoras impõe enquadramento no tipo simples.',
        'A conduta foi demonstrada, mas as atenuantes — primariedade, confissão — reduzem a pena ao mínimo legal.',
        'A excludente de legítima defesa não foi integralmente demonstrada, mas o excesso culposo justifica pena mais branda.'
      ]
    },
    trafico: {
      condenar: [
        'A perícia identificou a substância, e a quantidade e o acondicionamento indicam finalidade mercantil, não uso pessoal.',
        'A prova é robusta: substância periciada, local de apreensão, contexto e ausência de credibilidade da versão defensiva.',
        'O conjunto probatório afasta a tese de uso pessoal com segurança — os elementos objetivos apontam para o tráfico.'
      ],
      absolver: [
        'Os elementos do Art. 28 §2° — quantidade, circunstâncias, conduta social — não permitem afastar com segurança a hipótese de uso pessoal.',
        'Há dúvida insuperável quanto à destinação da substância — o in dubio pro reo impõe a desclassificação para posse.',
        'A abordagem policial apresentou irregularidade capaz de contaminar a prova — nulidade declarada.'
      ],
      parcial: [
        'O tráfico é configurado, mas a primariedade e a cooperação do réu justificam a aplicação da minorante do Art. 33 §4° Lei 11.343.',
        'A substância foi confirmada pela perícia, mas a quantidade é limítrofe — pena reduzida ao mínimo com regime inicial aberto.',
        'A materialidade está demonstrada, mas a quantidade e as circunstâncias pessoais do réu recomendam a minorante.'
      ]
    },
    violencia_domestica: {
      condenar: [
        'O laudo de lesão e as declarações da vítima — corroboradas por histórico documentado — sustentam a condenação.',
        'A violência foi demonstrada por prova técnica e testemunhal consistente, sem contradições relevantes.',
        'O histórico de violência e a existência de medida protetiva violada agravam a situação do réu e justificam condenação.'
      ],
      absolver: [
        'A ausência de laudo e a retratação da vítima, sem outras provas corroborantes, não permitem a condenação com segurança.',
        'A versão do réu não foi contrariada com robustez suficiente — o in dubio pro reo impõe a absolvição.',
        'Sem prova técnica e sem ratificação em juízo, o princípio da presunção de inocência prevalece.'
      ],
      parcial: [
        'A lesão está provada, mas a ausência de agravantes e a primariedade do réu recomendam regime mais brando.',
        'A condenação é devida, mas o contexto de dependência química do réu justifica pena com condição de tratamento.',
        'O fato está provado, mas as circunstâncias atenuantes reduzem a pena ao mínimo legal com regime aberto.'
      ]
    },
    default: {
      condenar: [
        'A acusação demonstrou os elementos essenciais do tipo com conjunto probatório coerente.',
        'A defesa não criou dúvida razoável suficiente para afastar a autoria e a materialidade demonstradas.',
        'Os elementos do tipo foram provados com segurança — a condenação é a medida adequada.'
      ],
      absolver: [
        'A dúvida razoável não foi superada pela acusação — aplica-se o in dubio pro reo.',
        'Os elementos probatórios não atingiram o grau de certeza exigido para a condenação criminal.',
        'A tese defensiva não foi afastada com firmeza — a absolvição é a medida constitucional adequada.'
      ],
      parcial: [
        'O crime foi demonstrado, mas as atenuantes e o contexto pessoal do réu justificam pena no mínimo legal.',
        'A materialidade está provada, mas a ausência de agravantes e a primariedade recomendam regime mais benéfico.',
        'A condenação é devida, mas as circunstâncias do caso justificam aplicação dos benefícios da Lei 9.714/98.'
      ]
    }
  };

  // ─── UTILITÁRIOS ──────────────────────────────────────────────────────────

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ─── DETECÇÃO DE CASO ─────────────────────────────────────────────────────

  function detectarCaso(caseObj) {
    const t = (
      (caseObj?.titulo || '') +
      (caseObj?.corpo || '') +
      (caseObj?.context_juiz || '') +
      (caseObj?.nome || '')
    ).toLowerCase();
    if (/furto|mercado|roubo|subtra|arromb|loja|comércio/.test(t)) return 'furto';
    if (/homicídio|matar|morte|assassin|esfaqueou|tiro|matou|necropsia/.test(t)) return 'homicidio';
    if (/tráfico|droga|cocaína|entorpe|maconha|crack|substância|tóxico/.test(t)) return 'trafico';
    if (/doméstica|ameaça|lesão corporal|violência|agrediu|agressor|maria da penha/.test(t)) return 'violencia_domestica';
    return 'default';
  }

  // ─── DETECÇÃO DE TESES ───────────────────────────────────────────────────

  function detectarTeses(text) {
    const lower = (text || '').toLowerCase();
    return Object.entries(TESES)
      .filter(([, t]) => t.kws.some(kw => lower.includes(kw)))
      .map(([key]) => key);
  }

  // ─── DETECÇÃO DE CONTRADIÇÕES ────────────────────────────────────────────

  function detectarContradicao(messages) {
    const acuAll = (messages || []).filter(m => m.role === 'acusacao').map(m => (m.text || '').toLowerCase()).join(' ');
    const defAll = (messages || []).filter(m => m.role === 'defesa').map(m => (m.text || '').toLowerCase()).join(' ');
    if (/primário|primeira vez|sem antecedente/.test(defAll) && /reincidente|antecedente|condenado/.test(acuAll)) return true;
    if (/legítima defesa|se defendeu/.test(defAll) && /premeditou|planejou|agiu por/.test(acuAll)) return true;
    if (/uso pessoal|usuário/.test(defAll) && /traficante|comércio|venda/.test(acuAll)) return true;
    if (/não estava lá|alibi|prova de alibi/.test(defAll) && /câmera|vídeo|flagrante/.test(acuAll)) return true;
    return false;
  }

  // ─── AVALIAÇÃO DE ARGUMENTO ──────────────────────────────────────────────

  function avaliarArgumento(msg) {
    const text = msg.text || '';
    const lower = text.toLowerCase();
    let pts = 0;

    // Artigos citados
    const arts = (text.match(/art\.?\s?\d+/gi) || []).length;
    pts += Math.min(arts, 5) * 3;

    // Jurisprudência
    if (/\bstf\b|\bstj\b/i.test(lower)) pts += 5;
    if (/súmula|acórdão|precedente|julgado|resp\b|hc\s\d/i.test(lower)) pts += 3;
    if (/doutrina|doutrinador|leciona/i.test(lower)) pts += 2;

    // Provas concretas
    if (/laudo|perícia|câmera|vídeo|testemun/i.test(lower)) pts += 4;
    if (/documento|certidão|boletim|ocorrência|\bBO\b/i.test(lower)) pts += 3;

    // Teses jurídicas reconhecidas
    pts += Math.min(detectarTeses(text).length, 3) * 3;

    // Termos técnicos processuais
    if (/tipicidade|culpabilidade|ilicitude|nexo causal/i.test(lower)) pts += 3;
    if (/autoria|materialidade|dosimetria|elementar|iter criminis/i.test(lower)) pts += 3;
    if (/in dubio pro reo|presunção de inocência|contraditório|ampla defesa/i.test(lower)) pts += 2;

    // Desenvolvimento
    if (text.length > 60)  pts += 1;
    if (text.length > 150) pts += 2;
    if (text.length > 300) pts += 2;
    if (text.length > 500) pts += 1;

    // Penalidade por argumento vazio
    if (text.length < 20) pts -= 3;
    if (text.length < 10) pts -= 5;

    // Bônus por responder à pergunta do juiz
    if (/resposta à pergunta|em resposta ao juiz|conforme perguntado/i.test(lower)) pts += 3;

    return Math.max(0, pts);
  }

  function scoreMessages(messages) {
    const score = { acusacao: 0, defesa: 0, total_acu: 0, total_def: 0 };
    (messages || []).forEach(m => {
      const q = avaliarArgumento(m);
      if (m.role === 'acusacao') { score.acusacao += q; score.total_acu++; }
      if (m.role === 'defesa') { score.defesa += q; score.total_def++; }
    });
    return score;
  }

  function pickTone(score) {
    const diff = score.acusacao - score.defesa;
    if (diff >= 6) return 'acusacao';
    if (diff <= -6) return 'defesa';
    return 'balanced';
  }

  // ─── EXTRAI TRECHO RELEVANTE DA MENSAGEM ─────────────────────────────────

  function extrairTrecho(text, maxLen = 60) {
    if (!text) return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? `"${clean.slice(0, maxLen)}..."` : `"${clean}"`;
  }

  // ─── INTERVENÇÃO DO JUIZ ──────────────────────────────────────────────────

  function generateIntervention(caseObj, messages) {
    const score = scoreMessages(messages);
    const tone = pickTone(score);
    const recent = (messages || []).slice(-4);
    const recentText = recent.map(m => m.text || '').join(' ');
    const allText = (messages || []).map(m => m.text || '').join(' ');
    const tesesRecentes = detectarTeses(recentText);
    const lastMsg = recent.length ? recent[recent.length - 1] : null;
    const lastRole = lastMsg ? lastMsg.role : null;
    const lastText = lastMsg ? (lastMsg.text || '') : '';
    const lastSender = lastMsg ? (lastMsg.sender || (lastRole === 'acusacao' ? 'Acusação' : 'Defesa')) : '';
    const tipoCaso = detectarCaso(caseObj);
    const pergs = PERGUNTAS[tipoCaso] || PERGUNTAS.default;
    const haContradicao = detectarContradicao(messages);
    const pergIdx = Math.floor((messages || []).length / 2) % pergs.length;
    const pergunta = pergs[pergIdx];
    const trecho = extrairTrecho(lastText);

    let text = '';

    // 1. Contradição detectada — cita os dois lados
    if (haContradicao) {
      const acuMsg = (messages || []).filter(m => m.role === 'acusacao').slice(-1)[0];
      const defMsg = (messages || []).filter(m => m.role === 'defesa').slice(-1)[0];
      const trechoAcu = extrairTrecho(acuMsg?.text, 50);
      const trechoDef = extrairTrecho(defMsg?.text, 50);
      text = `⚖️ ${pick(FALAS.contradicao)}\nAcusação afirma ${trechoAcu} enquanto Defesa sustenta ${trechoDef}. Esclareçam essa contradição com provas.\n→ ${pergunta}`;
    }
    // 2. Argumento muito curto — menciona quem foi
    else if (lastText.length < 20 && lastRole) {
      text = `⚖️ ${lastSender}, ${pick(FALAS.muito_curto).toLowerCase()} ${trecho ? `— o argumento ${trecho} precisa ser desenvolvido.` : ''}\n→ ${pergunta}`;
    }
    // 3. Tese específica detectada — responde à tese citando o trecho
    else if (tesesRecentes.length && lastRole) {
      const tese = TESES[tesesRecentes[0]];
      const resp = lastRole === 'defesa' ? tese.def : tese.acu;
      text = `⚖️ ${lastSender} invocou ${tese.art}${trecho ? ` ao afirmar ${trecho}` : ''}.\n${resp}\n→ ${pergunta}`;
    }
    // 4. Falta de artigos — menciona quem não citou
    else if (!(allText.match(/art\.?\s?\d+/gi) || []).length) {
      text = `⚖️ ${pick(FALAS.sem_artigos)}\nNenhuma das partes citou dispositivo legal até agora. Fundamente com artigos do Código Penal.\n→ ${pergunta}`;
    }
    // 5. Baseado no placar — com referência ao último argumento
    else {
      if (tone === 'acusacao') {
        text = `⚖️ ${pick(FALAS.tese_forte_acu)}${trecho ? `\nA Defesa afirmou ${trecho} — isso precisa ser rebatido com prova objetiva.` : ''}\n→ ${pergunta}`;
      } else if (tone === 'defesa') {
        text = `⚖️ ${pick(FALAS.tese_forte_def)}${trecho ? `\nA Acusação afirmou ${trecho} — a Defesa deve criar dúvida razoável sobre isso.` : ''}\n→ ${pergunta}`;
      } else {
        text = `⚖️ ${pick(FALAS.equilibrado)}${trecho ? `\nÚltimo argumento: ${trecho}.` : ''}\n→ ${pergunta}`;
      }
    }

    return { text, score };
  }

  // ─── VEREDITO ─────────────────────────────────────────────────────────────

  function formatVerdict(caseObj, score) {
    const tone = pickTone(score);
    const tipoCaso = detectarCaso(caseObj);
    const ctx = (caseObj?.contexto_social || '') + (caseObj?.antecedentes || '');
    const crim = caseObj?.antecedentes_criminais || '';
    const corpo = caseObj?.corpo || caseObj?.context_juiz || '';
    const todosTextos = ctx + crim + corpo;

    const temVuln = /(vulnerável|pobreza|desemprego|monoparental|informal|miserável|fome|sem renda)/i.test(ctx);
    const ehPrimario = /(primário|primeira vez|sem antecedente|ficha limpa|sem passagem)/i.test(crim);
    const temConfissao = /(confess|admitiu|reconheceu os fatos|assumiu)/i.test(todosTextos);
    const temReincidencia = /(reincidente|antecedentes criminais|condenação anterior)/i.test(crim);

    const penaMin = caseObj?.penaMin || 1;
    const penaMax = caseObj?.penaMax || 4;

    let nome_resultado, pena;
    if (tone === 'acusacao') {
      nome_resultado = 'CONDENAÇÃO';
      let anos = ehPrimario ? penaMin : Math.ceil((penaMin + penaMax) / 2);
      if (temReincidencia) anos = Math.min(anos + 1, penaMax);
      let obs = '';
      if (ehPrimario) obs += ' — pena-base mínima (réu primário, Art. 59 CP)';
      if (temConfissao) obs += obs ? ' + atenuante de confissão (Art. 65 III d CP)' : ' — atenuante de confissão aplicada (Art. 65 III d CP)';
      pena = `${anos} ano(s) de reclusão${obs}`;
    } else if (tone === 'defesa') {
      nome_resultado = 'ABSOLVIÇÃO';
      pena = 'Absolvição — in dubio pro reo (Art. 386, VI CPP / Art. 5°, LVII CF)';
    } else {
      nome_resultado = 'CONDENAÇÃO PARCIAL';
      const anos = penaMin;
      let obs = temVuln ? ' — atenuante social aplicada (Art. 66 CP)' : ' — pena mínima';
      pena = `${anos} ano(s)${obs}`;
    }

    const fundamentacao = buildFundamentacao(caseObj, score, tone, tipoCaso, ehPrimario, temVuln, temConfissao, temReincidencia);
    return { resultado: tone, nome_resultado, pena, fundamentacao, artigos: caseObj?.arts_rapidos || [] };
  }

  function buildFundamentacao(c, score, tone, tipo, primario, vuln, confissao, reincidente) {
    const L = [];
    const tipoCaso = tipo || 'default';
    const fundPool = FUND_TIPO[tipoCaso] || FUND_TIPO.default;

    L.push(`RELATÓRIO FINAL — ${c?.titulo || c?.nome || 'Caso'}`);
    L.push('━'.repeat(46));
    L.push(`📊 Placar argumentativo:`);
    L.push(`   Acusação: ${score.acusacao} pts (${score.total_acu} argumento${score.total_acu !== 1 ? 's' : ''})`);
    L.push(`   Defesa:   ${score.defesa} pts (${score.total_def} argumento${score.total_def !== 1 ? 's' : ''})`);

    if (primario)    L.push('\n📋 ANTECEDENTES: Réu primário — circunstância favorável (Art. 65, I CP)');
    if (reincidente) L.push('\n⚠️ REINCIDÊNCIA: Agravante obrigatória reconhecida (Art. 61, I CP)');
    if (confissao)   L.push('\n🗣️ CONFISSÃO: Atenuante espontânea aplicável (Art. 65, III, d CP)');
    if (vuln)        L.push('\n🏘️ CONTEXTO: Vulnerabilidade social documentada — atenuante inominada (Art. 66 CP)');

    L.push('\n' + '━'.repeat(46));

    if (tone === 'acusacao') {
      L.push('⚖️  DECISÃO: CONDENAÇÃO\n');
      L.push(pick(fundPool.condenar));
      L.push('A Defesa não logrou criar dúvida razoável suficiente para afastar autoria e materialidade.');
      if (tipoCaso === 'furto' && vuln) L.push('A tese de estado de necessidade não foi suficientemente demonstrada.');
      if (tipoCaso === 'trafico') L.push('A quantidade e o acondicionamento da substância são incompatíveis com uso pessoal exclusivo.');
      if (tipoCaso === 'violencia_domestica') L.push('O laudo e o histórico de violência sustentam a materialidade com segurança.');
    } else if (tone === 'defesa') {
      L.push('⚖️  DECISÃO: ABSOLVIÇÃO\n');
      L.push(pick(fundPool.absolver));
      L.push('Aplica-se o princípio constitucional do in dubio pro reo (Art. 5°, LVII CF/88).');
      if (tipoCaso === 'furto' && vuln) L.push('A excludente de estado de necessidade (Art. 24 CP) mostrou-se sustentável no conjunto debatido.');
      if (tipoCaso === 'trafico') L.push('A destinação pessoal da substância não pôde ser afastada com segurança — desclassificação cabível.');
    } else {
      L.push('⚖️  DECISÃO: CONDENAÇÃO PARCIAL — PENA MÍNIMA\n');
      L.push(pick(fundPool.parcial));
      L.push('Aplicam-se as circunstâncias atenuantes disponíveis e o princípio da proporcionalidade.');
      L.push('Regime inicial aberto recomendado, se réu primário e pena ≤ 4 anos (Art. 33 §2° c CP).');
      if (primario) L.push('A substituição por pena restritiva de direitos pode ser considerada (Art. 44 CP).');
    }

    L.push('\n' + '━'.repeat(46));
    const pergs = PERGUNTAS[tipoCaso] || PERGUNTAS.default;
    L.push('📌 Pontos que mereciam mais atenção no debate:');
    L.push(`• ${pergs[0]}`);
    L.push(`• ${pergs[1]}`);
    L.push(`• ${pergs[4] || pergs[2]}`);

    return L.join('\n');
  }

  // ─── SUGESTÕES TÁTICAS ────────────────────────────────────────────────────

  function gerarSugestaoTatica(caseObj, messages, meuPapel) {
    const score = scoreMessages(messages);
    const tone = pickTone(score);
    const tipo = detectarCaso(caseObj);
    const allText = messages.map(m => m.text || '').join(' ');
    const teses = detectarTeses(allText);
    const sugestoes = [];
    const hasArtigos = (allText.match(/art\.?\s?\d+/gi) || []).length > 0;
    const hasJuris = /stf|stj|súmula/i.test(allText);

    if (!hasArtigos) sugestoes.push('💡 Nenhum artigo foi citado ainda. Artigos são o esqueleto de qualquer argumento — cite-os com o número correto.');
    if (!hasJuris)   sugestoes.push('💡 Jurisprudência ainda não foi invocada. STF e STJ fortalecem muito qualquer tese.');

    if (meuPapel === 'acusacao') {
      if (tone === 'defesa') sugestoes.push('🚨 Você está perdendo. Foque em provas materiais e afaste as excludentes com fatos concretos.');
      if (!teses.includes('autoria')) sugestoes.push('💡 Autoria ainda não foi provada de forma robusta. Câmeras, testemunhas ou flagrante?');
      if (tipo === 'furto' && !teses.includes('qualif_noturno')) sugestoes.push('💡 O horário noturno ainda não foi explorado — Art. 155 §1° CP aumenta a pena em 1/3.');
      if (tipo === 'furto' && !teses.includes('arrombamento')) sugestoes.push('💡 O rompimento de obstáculo pode qualificar o furto — Art. 155 §4°, I CP. Exija laudo pericial.');
      if (tipo === 'trafico' && !teses.includes('pericia')) sugestoes.push('💡 A perícia da substância ainda não foi mencionada — sem ela, a materialidade fica frágil.');
      if (!teses.includes('reincidencia')) sugestoes.push('💡 Antecedentes criminais do réu não foram explorados — reincidência é agravante obrigatória.');
      sugestoes.push('⚖️ Lembre: o juiz precisa de certeza para condenar. Seja objetivo, direto e prove cada elemento do tipo.');
    } else if (meuPapel === 'defesa') {
      if (tone === 'acusacao') sugestoes.push('🚨 Você está perdendo. Crie dúvida razoável — questione autoria, invoque excludente ou nulidade.');
      if (!teses.includes('primario') && /(primário|primeira vez)/i.test((caseObj?.antecedentes_criminais || '')))
        sugestoes.push('💡 Explore a primariedade do réu — reduz a pena-base e pode viabilizar substituição (Art. 44 CP).');
      if (!teses.includes('insignificancia') && tipo === 'furto')
        sugestoes.push('💡 Considere invocar a insignificância — prove os 4 vetores do STF HC 84.412 com dados concretos.');
      if (!teses.includes('estado_necessidade') && /(desemprego|pobreza|fome|necessidade)/i.test((caseObj?.contexto_social || '')))
        sugestoes.push('💡 O contexto social do réu pode sustentar estado de necessidade (Art. 24 CP) — prove os 3 requisitos.');
      if (!teses.includes('nullidade') && tipo === 'trafico')
        sugestoes.push('💡 Questione a legalidade da abordagem — irregularidade na busca contamina toda a prova (Art. 157 CPP).');
      if (!teses.includes('autoria'))
        sugestoes.push('💡 Questione a prova de autoria — reconhecimento fotográfico isolado é insuficiente (STJ Tema 1.159).');
      sugestoes.push('⚖️ Lembre: in dubio pro reo — você não precisa provar inocência, só criar dúvida razoável no Juízo.');
    }

    return sugestoes.length ? sugestoes : ['💡 Continue desenvolvendo seus argumentos com artigos, jurisprudência e fatos concretos.'];
  }

  // ─── API PÚBLICA (mesma da v3) ────────────────────────────────────────────

  return {
    scoreMessages,
    generateIntervention,
    formatVerdict,
    gerarSugestaoTatica,
    detectarCaso,
    detectarTeses
  };
})();

if (typeof window !== 'undefined') window.LocalJudge = LocalJudge;

// ─── ANÁLISE ASSÍNCRONA COM STREAMING (mesma assinatura da v3) ────────────

if (typeof window !== 'undefined') {
  window.localJudgeAnalyze = async function (messages, caseObj = {}, onUpdate) {
    const msgs = (messages || []).slice(-50);
    const tipo = LocalJudge.detectarCaso(caseObj);

    const pergMap = {
      furto: [
        'Qual o valor subtraído e como foi apurado?',
        'Havia câmeras ou testemunhas que identificaram o réu?',
        'O local estava em efetivo repouso noturno?',
        'A defesa comprovou os 3 requisitos do estado de necessidade (Art. 24 CP)?'
      ],
      homicidio: [
        'Qual a prova de autoria — testemunhal, pericial ou material?',
        'O dolo foi direto, eventual ou culpa consciente?',
        'Existe qualificadora comprovada por prova objetiva?',
        'A defesa invocou legítima defesa ou outra excludente com provas?'
      ],
      trafico: [
        'A substância foi submetida à perícia química oficial?',
        'A quantidade e o acondicionamento são compatíveis com uso pessoal?',
        'A abordagem policial foi regular — havia fundada suspeita?',
        'Há provas de tráfico além da posse (dinheiro, cadernos, contatos)?'
      ],
      violencia_domestica: [
        'Há boletim de ocorrência e histórico documentado de violência anterior?',
        'A vítima ratificou suas declarações em juízo?',
        'Existe laudo de lesão corporal com data compatível com o fato?',
        'Havia medida protetiva vigente descumprida pelo réu?'
      ],
      default: [
        'Qual a prova de autoria e materialidade do delito?',
        'A defesa apresentou excludente ou atenuante com respaldo probatório?',
        'Os artigos invocados se adequam aos fatos narrados?',
        'Há contradição entre as versões que precise ser esclarecida?'
      ]
    };
    const p = pergMap[tipo] || pergMap.default;

    // FASE 1
    onUpdate?.({ stage: 'thinking', text: '⚖️ Dr. Augusto Melo está analisando o debate...' });
    await new Promise(r => setTimeout(r, 500));

    // FASE 2 — perguntas adaptativas
    const acuTexto = msgs.filter(m => m.role === 'acusacao').map(m => m.text || '').join(' ');
    const defTexto = msgs.filter(m => m.role === 'defesa').map(m => m.text || '').join(' ');
    const allTexto = msgs.map(m => m.text || '').join(' ');
    const tesesDetectadas = LocalJudge.detectarTeses(allTexto);

    const perguntas_acu = acuTexto.length > 20
      ? [
          tesesDetectadas.includes('autoria')
            ? 'Qual a cadeia de custódia das provas apresentadas — há risco de nulidade?'
            : p[0],
          tesesDetectadas.includes('qualif_noturno')
            ? 'Comprove com precisão o horário e que o local estava em efetivo repouso.'
            : p[2]
        ]
      : ['A acusação precisa apresentar provas de autoria e materialidade antes de prosseguir.'];

    const perguntas_def = defTexto.length > 20
      ? [
          p[1],
          tesesDetectadas.includes('estado_necessidade')
            ? 'Comprove os 3 requisitos do Art. 24 CP com fatos específicos — não basta alegar necessidade.'
            : tesesDetectadas.includes('insignificancia')
            ? 'Demonstre os 4 vetores da insignificância (STF HC 84.412) com dados concretos do caso.'
            : tesesDetectadas.includes('nullidade')
            ? 'Especifique o ato nulo e o prejuízo concreto — sem prejuízo, não há nulidade (Art. 563 CPP).'
            : p[3]
        ]
      : ['A defesa precisa apresentar tese consistente — excludente, atenuante ou questionamento probatório com fundamento.'];

    onUpdate?.({ stage: 'questions', text: '📋 Perguntas do Juiz', meta: { perguntas_acu, perguntas_def } });
    await new Promise(r => setTimeout(r, 400));

    // FASE 3 — intervenção contextual
    const interv = LocalJudge.generateIntervention(caseObj, msgs);
    onUpdate?.({ stage: 'intervention', text: interv.text, meta: { score: interv.score } });
    await new Promise(r => setTimeout(r, 450));

    // FASE 4 — veredito final
    const score = LocalJudge.scoreMessages(msgs);
    const verdict = LocalJudge.formatVerdict(caseObj, score);
    const finalText = `${verdict.nome_resultado}\n\n${verdict.fundamentacao}\n\n${'━'.repeat(42)}\nPena recomendada: ${verdict.pena}`;

    onUpdate?.({ stage: 'final', text: finalText, meta: { verdict } });
    return { text: finalText, verdict };
  };
}
