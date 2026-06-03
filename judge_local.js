// judge_local.js — Dr. Augusto Melo v3 — 100% offline, zero APIs
// Motor jurídico completo: análise contextual, intervenções dinâmicas,
// veredito fundamentado, placar inteligente, sugestões táticas por papel

export const LocalJudge = (function(){

  // ─── BASE JURÍDICA ────────────────────────────────────────────────────────

  const TESES = {
    estado_necessidade:{
      kws:['estado de necessidade','fome','filhos','família','criança','sobrevivência','necessidade','desemprego','pobreza','não tinha dinheiro','miserável'],
      acu:'Estado de necessidade não se presume (Art. 24 CP). Prove que havia alternativas lícitas disponíveis.',
      def:'Comprove os 3 requisitos do Art. 24 CP: (1) perigo atual, (2) inevitabilidade, (3) proporcionalidade.',
      art:'Art. 24 CP', peso_def:4
    },
    insignificancia:{
      kws:['insignificância','bagatela','irrisório','mínimo','pouco','r$','reais','valor baixo','pequeno valor'],
      acu:'Insignificância não é automática. Analise reincidência, habitualidade e impacto social (STF HC 84.412).',
      def:'Prove os 4 vetores do STF: mínima ofensividade, ausência de periculosidade, reduzido grau de reprovabilidade, inexpressividade da lesão.',
      art:'STF HC 84.412', peso_def:3
    },
    dolo:{
      kws:['dolo','intenção','quis','queria','planejou','premeditou','consciência','sabia','tinha certeza'],
      acu:'Dolo eventual basta: o agente previu o resultado e assumiu o risco (Art. 18, I CP).',
      def:'Dolo deve ser provado, não presumido. Questione a vontade livre e consciente do agente.',
      art:'Art. 18 CP', peso_acu:3
    },
    autoria:{
      kws:['câmera','flagrante','testemunha','prova','vídeo','identificado','reconhecimento','foi pego','encontrado'],
      acu:'Flagrante + prova testemunhal = conjunto probatório sólido quando coerentes.',
      def:'Reconhecimento fotográfico isolado é insuficiente (STJ Tema 1.159). Exija prova robusta.',
      art:'Art. 155 CPP + STJ Tema 1.159', peso_acu:4
    },
    qualif_noturno:{
      kws:['noturno','madrugada','noite','repouso','2h','3h','4h','de madrugada','à noite'],
      acu:'Furto noturno qualifica pelo Art. 155 §1° CP — aumento de 1/3. Comprove o horário exato.',
      def:'Qualificadora do repouso exige vítima em efetivo repouso no local. Questione esse ponto.',
      art:'Art. 155 §1° CP', peso_acu:2
    },
    arrombamento:{
      kws:['arrombou','arrombamento','quebrou','forçou','destruiu','porta','janela','rompeu','entrou pela'],
      acu:'Rompimento de obstáculo qualifica o furto (Art. 155 §4°, I CP). Prove a destruição com laudo.',
      def:'O rompimento deve ser de obstáculo relevante — não qualquer dificuldade superada.',
      art:'Art. 155 §4° CP', peso_acu:3
    },
    reincidencia:{
      kws:['reincidente','antecedente','condenado','passagem','ficha','preso antes','já foi preso'],
      acu:'Reincidência é agravante obrigatória (Art. 61, I CP) e impede substituição de pena.',
      def:'Reincidência exige certidão cartorária específica (Súmula 636 STJ). Exija a prova documental.',
      art:'Art. 61 CP + Súm. 636 STJ', peso_acu:3
    },
    primario:{
      kws:['primário','primeira vez','sem antecedente','nunca foi preso','ficha limpa','sem passagem'],
      acu:'Primariedade não exclui culpabilidade — apenas mitiga a pena na dosimetria.',
      def:'Réu primário + bons antecedentes = pena-base no mínimo legal (Art. 59 CP). Explore isso.',
      art:'Art. 59 CP', peso_def:2
    },
    legitima_defesa:{
      kws:['legítima defesa','se defendeu','ataque','agrediu primeiro','ameaça','reagiu','em defesa'],
      acu:'Verifique excesso doloso ou culposo — ambos afastam a excludente (Art. 23 §único CP).',
      def:'Legítima defesa (Art. 25 CP): agressão injusta + atual ou iminente + moderação nos meios.',
      art:'Art. 25 CP', peso_def:4
    },
    concurso_pessoas:{
      kws:['comparsa','ajuda','junto','grupo','quadrilha','organizado','mais de um','cúmplice'],
      acu:'Concurso de pessoas agrava a pena (Art. 29 CP). Prove a divisão de tarefas e o dolo conjunto.',
      def:'Autoria e participação exigem prova individualizada do dolo de cada agente.',
      art:'Art. 29 CP', peso_acu:2
    },
    confissao:{
      kws:['confessou','admitiu','reconheceu','assumiu','eu fiz','ele admitiu'],
      acu:'Confissão espontânea é atenuante (Art. 65, III, d CP) mas não exclui tipicidade.',
      def:'Confissão espontânea é atenuante obrigatória (Art. 65, III, d CP). Aplique-a na dosimetria.',
      art:'Art. 65 III d CP', peso_def:2
    }
  };

  const PERGUNTAS = {
    furto:[
      'Qual o valor exato subtraído e como foi apurado?',
      'Havia câmeras ou testemunhas que identificaram o réu no local?',
      'O estabelecimento estava em efetivo repouso noturno?',
      'A defesa invoca estado de necessidade ou insignificância — com quais provas?',
      'Quais as condições econômicas do réu na data dos fatos?',
      'Houve rompimento de obstáculo relevante ou escalada?',
      'O réu foi preso em flagrante ou identificado posteriormente?'
    ],
    homicidio:[
      'Qual a prova de autoria — testemunhal, pericial ou material?',
      'O laudo de necropsia confirma causa mortis compatível com a narrativa?',
      'O agente agiu com dolo direto ou apenas eventual?',
      'Existe qualificadora provada — motivo torpe, crueldade, emboscada?',
      'Havia relação prévia entre réu e vítima que contextualiza o fato?',
      'A defesa alega legítima defesa ou estado de necessidade?',
      'Há testemunhas oculares ou apenas prova indireta?'
    ],
    trafico:[
      'A substância foi submetida à perícia química e identificada como ilícita?',
      'Qual quantidade exata e como estava acondicionada?',
      'O réu alega uso pessoal — há elementos que sustentam ou refutam?',
      'Existem provas de tráfico além da posse — dinheiro, cadernos, contatos?',
      'A abordagem policial observou as formalidades legais?',
      'O réu é primário ou reincidente?',
      'Há co-autores identificados?'
    ],
    violencia_domestica:[
      'Há boletim de ocorrência e histórico de violência anterior documentado?',
      'A vítima ratificou suas declarações em juízo?',
      'Existe medida protetiva vigente que teria sido descumprida?',
      'Laudos de lesão corporal foram produzidos?',
      'O réu reconhece os fatos ou apresenta versão divergente?',
      'Há testemunhas do convívio que corroboram os fatos?',
      'A vítima depende economicamente do réu?'
    ],
    default:[
      'Qual a principal prova de autoria e materialidade?',
      'A defesa apresentou tese de excludente ou atenuante?',
      'Os artigos invocados são adequados aos fatos narrados?',
      'Há contradição relevante entre as versões das partes?',
      'Qual o impacto das circunstâncias pessoais na dosimetria?',
      'Existe prova pericial que sustenta a narrativa da acusação?',
      'A conduta se amolda exatamente ao tipo penal invocado?'
    ]
  };

  // Frases do Juiz durante o debate — variadas para não repetir
  const FALAS_JUIZ = {
    pressionar_acu:[
      'A acusação precisa ser mais objetiva. Cite artigos e fatos — não suposições.',
      'Doutor, o argumento carece de respaldo probatório. Qual a prova concreta?',
      'A acusação ainda não enfrentou a tese defensiva levantada. Responda diretamente.',
      'Seja mais preciso: qual a qualificadora invocada e qual a prova que a sustenta?'
    ],
    pressionar_def:[
      'A defesa levantou tese relevante mas precisa comprová-la com fatos.',
      'Doutora, a excludente invocada exige prova. Como pretende demonstrá-la?',
      'A defesa não respondeu ao principal argumento da acusação. Enfrente-o.',
      'Argumento genérico não é suficiente. Especifique as lacunas probatórias.'
    ],
    equilibrado:[
      'Debate equilibrado. Ambas as partes devem aprofundar os pontos centrais.',
      'O Juízo observa que a questão de autoria ainda não foi definitivamente enfrentada.',
      'Prossigam — mas foquem nos elementos do tipo penal, não em argumentos periféricos.',
      'O debate está bem conduzido. Partam para a questão da dosimetria.',
    ],
    tese_forte_def:[
      'A defesa levantou ponto relevante. A acusação tem direito de réplica específica.',
      'Essa tese merece atenção. Acusação, como afasta essa excludente?',
      'Ponto importante da defesa. A acusação deve rebater com fatos, não retórica.',
    ],
    tese_forte_acu:[
      'A acusação apresentou prova relevante. Defesa, como contesta esse elemento?',
      'Esse indício é significativo. A defesa precisa criar dúvida razoável sobre ele.',
      'A materialidade parece bem estabelecida. A defesa deve focar na autoria ou na excludente.',
    ]
  };

  // ─── DETECÇÃO E ANÁLISE ───────────────────────────────────────────────────

  function detectarCaso(caseObj){
    const t = ((caseObj?.titulo||'')+(caseObj?.corpo||'')+( caseObj?.context_juiz||'')).toLowerCase();
    if(/furto|mercado|roubo|subtra|arromb/.test(t)) return 'furto';
    if(/homicídio|matar|morte|assassin|esfaqueou|tiro/.test(t)) return 'homicidio';
    if(/tráfico|droga|cocaína|entorpe|maconha|crack/.test(t)) return 'trafico';
    if(/doméstica|ameaça|lesão corporal|violência|agrediu|agressor/.test(t)) return 'violencia_domestica';
    return 'default';
  }

  function detectarTeses(text){
    const lower = text.toLowerCase();
    return Object.entries(TESES)
      .filter(([,t]) => t.kws.some(kw => lower.includes(kw)))
      .map(([key]) => key);
  }

  function avaliarArgumento(msg){
    const text = msg.text || '';
    const lower = text.toLowerCase();
    let pts = 0;
    // artigos citados
    const arts = (text.match(/art\.?\s?\d+/gi)||[]).length;
    pts += arts * 3;
    // jurisprudência
    if(/stf|stj|súmula|acórdão|precedente|julgado/i.test(lower)) pts += 4;
    // provas concretas
    if(/laudo|perícia|câmera|vídeo|testemun|documento|certidão/i.test(lower)) pts += 4;
    // teses jurídicas reconhecidas
    pts += detectarTeses(text).length * 3;
    // termos técnicos
    if(/tipicidade|culpabilidade|ilicitude|nexo|autoria|materialidade|dosimetria|elementar/i.test(lower)) pts += 3;
    // argumento desenvolvido
    if(text.length > 80)  pts += 1;
    if(text.length > 180) pts += 2;
    if(text.length > 350) pts += 1;
    // penalidade por argumento vazio
    if(text.length < 20) pts -= 2;
    return Math.max(0, pts);
  }

  function scoreMessages(messages){
    const score = {acusacao:0, defesa:0, total_acu:0, total_def:0};
    (messages||[]).forEach(m => {
      const q = avaliarArgumento(m);
      if(m.role==='acusacao'){ score.acusacao += q; score.total_acu++; }
      if(m.role==='defesa'){   score.defesa   += q; score.total_def++; }
    });
    return score;
  }

  function pickTone(score){
    const diff = score.acusacao - score.defesa;
    if(diff >= 5) return 'acusacao';
    if(diff <= -5) return 'defesa';
    return 'balanced';
  }

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  // ─── INTERVENÇÃO ──────────────────────────────────────────────────────────

  function generateIntervention(caseObj, messages){
    const score = scoreMessages(messages);
    const tone = pickTone(score);
    const recent = (messages||[]).slice(-4);
    const recentText = recent.map(m=>m.text||'').join(' ');
    const teses = detectarTeses(recentText);
    const lastRole = recent.length ? recent[recent.length-1].role : null;
    const tipoCaso = detectarCaso(caseObj);
    const pergs = PERGUNTAS[tipoCaso]||PERGUNTAS.default;
    const pergIdx = Math.floor((messages||[]).length / 2) % pergs.length;

    let text = '';

    // resposta específica à tese detectada na última mensagem
    if(teses.length && lastRole){
      const tese = TESES[teses[0]];
      const resp = lastRole==='defesa' ? tese.def : tese.acu;
      text = `⚖️ Juiz: ${resp} [${tese.art}]`;
    }

    // fallback baseado no placar + pergunta cirúrgica
    if(!text){
      if(tone==='acusacao'){
        text = `⚖️ ${pick(FALAS_JUIZ.tese_forte_acu)} — À defesa: ${pergs[pergIdx]}`;
      } else if(tone==='defesa'){
        text = `⚖️ ${pick(FALAS_JUIZ.tese_forte_def)} — À acusação: ${pergs[pergIdx]}`;
      } else {
        text = `⚖️ ${pick(FALAS_JUIZ.equilibrado)} — ${pergs[pergIdx]}`;
      }
    }

    return { text, score };
  }

  // ─── VEREDITO ─────────────────────────────────────────────────────────────

  function formatVerdict(caseObj, score){
    const tone = pickTone(score);
    const tipoCaso = detectarCaso(caseObj);
    const ctx = (caseObj?.contexto_social||'')+(caseObj?.antecedentes||'');
    const crim = caseObj?.antecedentes_criminais||'';
    const temVuln = /(vulnerável|pobreza|desemprego|monoparental|informal|miserável)/i.test(ctx);
    const ehPrimario = /(primário|primeira vez|sem antecedente|ficha limpa)/i.test(crim);
    const penaMin = caseObj?.penaMin||1;
    const penaMax = caseObj?.penaMax||4;

    let nome_resultado, pena;
    if(tone==='acusacao'){
      nome_resultado = 'CONDENAÇÃO';
      const anos = ehPrimario ? penaMin : Math.ceil((penaMin+penaMax)/2);
      pena = `${anos} ano(s) de reclusão${ehPrimario?' — pena-base mínima (réu primário, Art. 59 CP)':''}`;
    } else if(tone==='defesa'){
      nome_resultado = 'ABSOLVIÇÃO';
      pena = 'Absolvição — in dubio pro reo (Art. 386, VI CPP / Art. 5°, LVII CF)';
    } else {
      nome_resultado = 'CONDENAÇÃO PARCIAL';
      pena = `${penaMin} ano(s)${temVuln?' — atenuante social aplicada (Art. 66 CP)':' — pena mínima'}`;
    }

    const fundamentacao = buildFundamentacao(caseObj, score, tone, tipoCaso, ehPrimario, temVuln);
    return { resultado:tone, nome_resultado, pena, fundamentacao, artigos:caseObj?.arts_rapidos||[] };
  }

  function buildFundamentacao(c, score, tone, tipo, primario, vuln){
    const L = [];
    L.push(`RELATÓRIO FINAL — ${c?.titulo||'Caso'}`);
    L.push('━'.repeat(44));
    L.push(`📊 Placar argumentativo:`);
    L.push(`   Acusação: ${score.acusacao} pts (${score.total_acu} argumento${score.total_acu!==1?'s':''})`);
    L.push(`   Defesa:   ${score.defesa} pts (${score.total_def} argumento${score.total_def!==1?'s':''})`);

    if(primario) L.push('\n📋 ANTECEDENTES: Réu primário — circunstância favorável (Art. 65, I CP)');
    if(vuln)     L.push('🏘️ CONTEXTO: Vulnerabilidade social documentada — atenuante inominada (Art. 66 CP)');

    L.push('\n' + '━'.repeat(44));

    if(tone==='acusacao'){
      L.push('⚖️  DECISÃO: CONDENAÇÃO\n');
      L.push('A Acusação demonstrou com maior consistência os elementos de tipicidade, ilicitude e culpabilidade.');
      L.push('A Defesa não logrou criar dúvida razoável suficiente para afastar autoria e materialidade.');
      if(tipo==='furto') L.push('As qualificadoras debatidas (horário noturno, rompimento de obstáculo) foram consideradas.');
      if(tipo==='trafico') L.push('A quantidade e o acondicionamento da substância são incompatíveis com uso pessoal.');
    } else if(tone==='defesa'){
      L.push('⚖️  DECISÃO: ABSOLVIÇÃO\n');
      L.push('A Defesa criou dúvida razoável sobre elemento essencial da acusação.');
      L.push('Aplica-se o princípio constitucional do in dubio pro reo (Art. 5°, LVII CF/88).');
      if(tipo==='furto' && vuln) L.push('A excludente de estado de necessidade (Art. 24 CP) mostrou-se sustentável no conjunto debatido.');
    } else {
      L.push('⚖️  DECISÃO: CONDENAÇÃO PARCIAL — PENA MÍNIMA\n');
      L.push('O debate apresentou argumentos relevantes de ambas as partes sem solução unívoca.');
      L.push('Aplicam-se as circunstâncias atenuantes disponíveis e o princípio da proporcionalidade.');
      L.push('Regime inicial aberto recomendado, se réu primário e pena ≤ 4 anos (Art. 33 §2° c CP).');
    }

    L.push('\n' + '━'.repeat(44));
    const pergs = PERGUNTAS[tipo]||PERGUNTAS.default;
    L.push('📌 Pontos que deveriam ter sido mais explorados:');
    L.push(`• ${pergs[0]}`);
    L.push(`• ${pergs[1]}`);
    L.push(`• ${pergs[4]||pergs[2]}`);

    return L.join('\n');
  }

  // ─── SUGESTÕES TÁTICAS POR PAPEL ─────────────────────────────────────────

  function gerarSugestaoTatica(caseObj, messages, meuPapel){
    const score = scoreMessages(messages);
    const tone = pickTone(score);
    const tipo = detectarCaso(caseObj);
    const allText = messages.map(m=>m.text||'').join(' ');
    const teses = detectarTeses(allText);

    const sugestoes = [];

    if(meuPapel==='acusacao'){
      if(tone==='defesa') sugestoes.push('🚨 Você está perdendo. Foque em provas materiais — deixe de lado argumentos genéricos.');
      if(!teses.includes('autoria')) sugestoes.push('💡 Você ainda não trouxe prova sólida de autoria. Isso pode custar a condenação.');
      if(tipo==='furto' && !teses.includes('qualif_noturno')) sugestoes.push('💡 Argumento sobre o horário noturno ainda não foi usado — Art. 155 §1° CP.');
      if(tipo==='furto' && !teses.includes('arrombamento')) sugestoes.push('💡 O rompimento da porta ainda pode ser explorado como qualificadora.');
      sugestoes.push('⚖️ Lembre-se: o juiz precisa de certeza para condenar — seja objetivo e direto.');
    } else if(meuPapel==='defesa'){
      if(tone==='acusacao') sugestoes.push('🚨 Você está perdendo. Crie dúvida razoável — questione autoria ou invoque excludente.');
      if(!teses.includes('primario') && /(primário|primeira vez)/i.test((caseObj?.antecedentes_criminais||'')))
        sugestoes.push('💡 Explore a primariedade do réu — reduz a pena-base (Art. 59 CP).');
      if(!teses.includes('insignificancia') && tipo==='furto')
        sugestoes.push('💡 Considere invocar a insignificância se o valor for pequeno (STF HC 84.412).');
      if(!teses.includes('estado_necessidade') && /(desemprego|pobreza|fome)/i.test((caseObj?.contexto_social||'')))
        sugestoes.push('💡 O contexto social do réu pode sustentar estado de necessidade (Art. 24 CP).');
      sugestoes.push('⚖️ Lembre-se: in dubio pro reo — você não precisa provar inocência, só criar dúvida.');
    }

    return sugestoes.length ? sugestoes : ['💡 Continue desenvolvendo seus argumentos com artigos e fatos concretos.'];
  }

  return { scoreMessages, generateIntervention, formatVerdict, gerarSugestaoTatica, detectarCaso, detectarTeses };
})();

if(typeof window !== 'undefined') window.LocalJudge = LocalJudge;

// ─── ANÁLISE ASSÍNCRONA COM STREAMING ────────────────────────────────────

if(typeof window !== 'undefined'){
  window.localJudgeAnalyze = async function(messages, caseObj={}, onUpdate){
    const msgs = (messages||[]).slice(-50);
    const tipo = LocalJudge.detectarCaso(caseObj);
    const pergs = {
      furto:['Qual o valor subtraído e como foi apurado?','Havia câmeras ou testemunhas que identificaram o réu?','O local estava em efetivo repouso noturno?','A defesa comprovou os requisitos do estado de necessidade?'],
      homicidio:['Qual a prova de autoria — testemunhal, pericial ou material?','O dolo foi direto ou eventual?','Existe qualificadora comprovada?','A defesa invocou legítima defesa ou outra excludente?'],
      trafico:['A substância foi periciada?','A quantidade é compatível com uso pessoal?','A abordagem policial foi regular?','Há provas de tráfico além da posse?'],
      violencia_domestica:['Há BO e histórico documentado?','A vítima ratificou em juízo?','Há medida protetiva descumprida?','Existem laudos de lesão corporal?'],
      default:['Qual a prova de autoria e materialidade?','A defesa apresentou excludente ou atenuante?','Os artigos invocados são adequados?','Há contradição entre as versões?']
    };
    const p = pergs[tipo]||pergs.default;

    // FASE 1
    onUpdate?.({ stage:'thinking', text:'⚖️ Dr. Augusto Melo está analisando o debate...' });
    await new Promise(r=>setTimeout(r,500));

    // FASE 2 — perguntas contextuais
    const acuTexto = msgs.filter(m=>m.role==='acusacao').map(m=>m.text||'').join(' ');
    const defTexto = msgs.filter(m=>m.role==='defesa').map(m=>m.text||'').join(' ');
    const allTexto = msgs.map(m=>m.text||'').join(' ');
    const tesesDetectadas = LocalJudge.detectarTeses(allTexto);

    const perguntas_acu = acuTexto.length > 20
      ? [p[0], tesesDetectadas.includes('autoria') ? 'Qual a cadeia de custódia das provas apresentadas?' : p[2]]
      : ['A acusação precisa apresentar provas de autoria e materialidade antes de prosseguir.'];

    const perguntas_def = defTexto.length > 20
      ? [p[1], tesesDetectadas.includes('estado_necessidade')
          ? 'Comprove os 3 requisitos do Art. 24 CP com fatos — não basta alegar necessidade.'
          : tesesDetectadas.includes('insignificancia')
          ? 'Demonstre os 4 vetores da insignificância (STF HC 84.412) com dados concretos.'
          : p[3]]
      : ['A defesa precisa apresentar tese consistente — excludente, atenuante ou questionamento probatório.'];

    onUpdate?.({ stage:'questions', text:'📋 Perguntas do Juiz', meta:{ perguntas_acu, perguntas_def } });
    await new Promise(r=>setTimeout(r,400));

    // FASE 3 — intervenção contextual
    const interv = LocalJudge.generateIntervention(caseObj, msgs);
    onUpdate?.({ stage:'intervention', text: interv.text, meta:{ score: interv.score } });
    await new Promise(r=>setTimeout(r,450));

    // FASE 4 — veredito final
    const score = LocalJudge.scoreMessages(msgs);
    const verdict = LocalJudge.formatVerdict(caseObj, score);
    const finalText = `${verdict.nome_resultado}\n\n${verdict.fundamentacao}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPena recomendada: ${verdict.pena}`;

    onUpdate?.({ stage:'final', text: finalText, meta:{ verdict } });
    return { text: finalText, verdict };
  };
}