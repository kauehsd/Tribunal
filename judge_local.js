// judge_local.js — Juiz Local Inteligente v2
// Funciona 100% offline, sem APIs externas

export const LocalJudge = (function(){

  // ─── BASE DE CONHECIMENTO JURÍDICO ───────────────────────────────────────

  const TESES_JURIDICAS = {
    estado_necessidade: {
      kws: ['estado de necessidade','fome','filhos','família','criança','sobrevivência','necessidade','desemprego','pobreza'],
      resposta_def: 'A tese de estado de necessidade (Art. 24 CP) exige: (1) perigo atual, (2) inevitabilidade, (3) proporcionalidade. Comprove os três requisitos com fatos concretos.',
      resposta_acu: 'Estado de necessidade não se presume. A acusação deve demonstrar que havia alternativas lícitas disponíveis ao réu.',
      artigo: 'Art. 24 CP'
    },
    insignificancia: {
      kws: ['insignificância','bagatela','valor irrisório','mínimo','pequeno','pouco','r$','reais'],
      resposta_def: 'Princípio da insignificância requer: (1) mínima ofensividade, (2) ausência de periculosidade, (3) reduzido grau de reprovabilidade, (4) inexpressividade da lesão. STF consagrou esses vetores.',
      resposta_acu: 'A insignificância não se aplica automaticamente. Analise o contexto, reincidência e impacto social do ato.',
      artigo: 'STF HC 84.412'
    },
    dolo: {
      kws: ['dolo','intenção','quis','queria','planejou','premeditou','consciência'],
      resposta_def: 'O dolo deve ser provado, não presumido. Questione se havia vontade livre e consciente de praticar o ato típico.',
      resposta_acu: 'Dolo eventual é suficiente para condenação: o agente previu o resultado e assumiu o risco (Art. 18, I CP).',
      artigo: 'Art. 18 CP'
    },
    autoria: {
      kws: ['câmera','câmera','flagrante','testemunha','prova','vídeo','identificado','reconhecimento'],
      resposta_def: 'Reconhecimento fotográfico isolado não basta (STJ Tema 1.159). Exija prova robusta de autoria.',
      resposta_acu: 'Flagrante e prova testemunhal formam conjunto probatório sólido quando coerentes entre si.',
      artigo: 'Art. 155 CPP'
    },
    qualificadora_noturno: {
      kws: ['noturno','madrugada','noite','repouso','2h','3h','4h'],
      resposta_acu: 'Furto noturno qualifica pelo Art. 155 §1° CP — aumento de pena de 1/3. Comprove o horário.',
      resposta_def: 'A qualificadora do repouso noturno exige que a vítima estivesse em efetivo repouso no local.',
      artigo: 'Art. 155 §1° CP'
    },
    arrombamento: {
      kws: ['arrombou','arrombamento','quebrou','forçou','destruiu','porta','janela','rompeu'],
      resposta_acu: 'Rompimento de obstáculo qualifica o furto (Art. 155 §4°, I CP). Prove a destruição.',
      resposta_def: 'O rompimento deve ser de obstáculo relevante — não qualquer dificuldade superada.',
      artigo: 'Art. 155 §4° CP'
    },
    reincidencia: {
      kws: ['reincidente','antecedente','condenado','passagem','ficha','preso antes'],
      resposta_acu: 'Reincidência é agravante obrigatória (Art. 61, I CP) e impede substituição de pena.',
      resposta_def: 'Reincidência deve ser comprovada por certidão cartorária específica (Súmula 636 STJ).',
      artigo: 'Art. 61 CP'
    },
    ru_primario: {
      kws: ['primário','primeira vez','sem antecedente','nunca foi preso','ficha limpa'],
      resposta_def: 'Réu primário e bons antecedentes: circunstâncias judiciais favoráveis (Art. 59 CP). Pena-base no mínimo legal.',
      resposta_acu: 'Primariedade não exclui culpabilidade — apenas mitiga a pena.',
      artigo: 'Art. 59 CP'
    },
    excesso_legitima_defesa: {
      kws: ['legítima defesa','se defendeu','ataque','agrediu primeiro','ameaça','reagiu'],
      resposta_def: 'Legítima defesa (Art. 25 CP) requer: agressão injusta, atual ou iminente, moderação nos meios.',
      resposta_acu: 'Verifique se houve excesso doloso ou culposo — ambos afastam a excludente.',
      artigo: 'Art. 25 CP'
    }
  };

  const PERGUNTAS_POR_CASO = {
    furto: [
      'Qual o valor exato subtraído e como foi apurado?',
      'Havia câmeras ou testemunhas que identificaram o réu?',
      'O local estava em efetivo repouso noturno quando ocorreu o fato?',
      'A defesa invoca alguma excludente — estado de necessidade, insignificância?',
      'Quais as condições econômicas do réu na data do fato?'
    ],
    homicidio: [
      'Qual a prova de autoria — testemunhal, pericial ou material?',
      'Há laudo de necropsia que confirma causa mortis?',
      'O agente agiu com dolo direto ou eventual?',
      'Existe qualificadora provada — motivo torpe, crueldade, emboscada?',
      'Havia relação prévia entre réu e vítima?'
    ],
    trafico: [
      'A substância foi periciada e identificada como ilícita?',
      'Qual quantidade e como estava acondicionada?',
      'O réu alega uso pessoal — há elementos que sustentam ou afastam isso?',
      'Existem provas de tráfico além da posse — dinheiro, caderno, entregadores?',
      'A abordagem policial foi regular?'
    ],
    violencia_domestica: [
      'Há boletim de ocorrência e histórico de violência anterior?',
      'A vítima ratificou as declarações em juízo?',
      'Existe medida protetiva vigente descumprida?',
      'Laudos de lesão corporal foram produzidos?',
      'O réu reconhece os fatos ou apresenta versão divergente?'
    ],
    default: [
      'Qual a principal prova de autoria e materialidade?',
      'A defesa apresentou alguma tese de excludente ou atenuante?',
      'Os artigos invocados são adequados aos fatos narrados?',
      'Há contradição relevante entre as versões das partes?',
      'Qual a consequência prática para a dosimetria da pena?'
    ]
  };

  const INTERVENCOES_JUIZ = [
    'Doutor(a), seja mais objetivo(a) — cite artigos e fatos concretos, não apenas argumentos genéricos.',
    'Atenção: a tese levantada precisa de respaldo probatório. Indique a prova que sustenta esse argumento.',
    'Prossigam — mas a parte contrária deverá responder diretamente a esse ponto na próxima fala.',
    'Esse argumento é relevante. A parte contrária tem 1 rodada para rebater especificamente.',
    'O Juízo observa que a questão central ainda não foi enfrentada diretamente por nenhuma das partes.',
    'Mantenham o foco nos elementos do tipo penal — materialidade e autoria precisam ser endereçadas.',
    'Esse ponto merece atenção da acusação: a defesa levantou dúvida razoável que precisa ser afastada.',
    'A defesa apresentou tese defensável. A acusação deve rebater com fatos, não com suposições.',
  ];

  // ─── ANÁLISE DE MENSAGENS ─────────────────────────────────────────────────

  function detectarTeses(text){
    const teses = [];
    const lower = text.toLowerCase();
    for(const [key, tese] of Object.entries(TESES_JURIDICAS)){
      if(tese.kws.some(kw => lower.includes(kw))){
        teses.push(key);
      }
    }
    return teses;
  }

  function contarArtigos(text){
    const arts = text.match(/art\.?\s?\d+/gi) || [];
    return arts.length;
  }

  function avaliarQualidadeArgumento(text){
    let score = 0;
    const lower = text.toLowerCase();
    // artigos citados
    score += contarArtigos(text) * 2;
    // fatos concretos
    if(/prova|testemun|laudo|perícia|câmera|vídeo|documento/i.test(lower)) score += 3;
    // teses jurídicas reconhecidas
    score += detectarTeses(text).length * 2;
    // comprimento mínimo (argumento desenvolvido)
    if(text.length > 100) score += 1;
    if(text.length > 200) score += 1;
    // termos jurídicos gerais
    if(/tipicidade|culpabilidade|ilicitude|nexo|autoria|materialidade|dosimetria/i.test(lower)) score += 2;
    return score;
  }

  function scoreMessages(messages){
    const score = {acusacao: 0, defesa: 0};
    messages.forEach(m => {
      const q = avaliarQualidadeArgumento(m.text || '');
      if(m.role === 'acusacao') score.acusacao += q;
      if(m.role === 'defesa') score.defesa += q;
    });
    return score;
  }

  function pickTone(score){
    const diff = score.acusacao - score.defesa;
    if(diff >= 4) return 'acusacao';
    if(diff <= -4) return 'defesa';
    return 'balanced';
  }

  function detectarCaso(caseObj){
    const titulo = (caseObj?.titulo || '').toLowerCase();
    const corpo = (caseObj?.corpo || '').toLowerCase();
    const texto = titulo + ' ' + corpo;
    if(/furto|mercado|roubo|subtra/.test(texto)) return 'furto';
    if(/homicídio|matar|morte|assassin/.test(texto)) return 'homicidio';
    if(/tráfico|droga|cocaína|entorpe/.test(texto)) return 'trafico';
    if(/doméstica|ameaça|lesão corporal|violência/.test(texto)) return 'violencia_domestica';
    return 'default';
  }

  // ─── INTERVENÇÃO CONTEXTUAL ───────────────────────────────────────────────

  function generateIntervention(caseObj, messages){
    const score = scoreMessages(messages);
    const tone = pickTone(score);
    const lastMessages = (messages || []).slice(-6);
    const allText = lastMessages.map(m => m.text || '').join(' ');
    const teses = detectarTeses(allText);
    const tipoCaso = detectarCaso(caseObj);

    let text = '';

    // resposta específica a teses detectadas
    if(teses.length > 0){
      const tese = TESES_JURIDICAS[teses[0]];
      const lastRole = lastMessages.length > 0 ? lastMessages[lastMessages.length-1].role : 'balanced';
      if(lastRole === 'defesa' && tese.resposta_def){
        text = `Juiz: ${tese.resposta_def} (${tese.artigo})`;
      } else if(lastRole === 'acusacao' && tese.resposta_acu){
        text = `Juiz: ${tese.resposta_acu} (${tese.artigo})`;
      }
    }

    // fallback por placar
    if(!text){
      const perguntas = PERGUNTAS_POR_CASO[tipoCaso] || PERGUNTAS_POR_CASO.default;
      const idx = messages.length % perguntas.length;
      if(tone === 'acusacao'){
        text = `Juiz: Acusação tem vantagem argumentativa. À defesa: ${perguntas[idx]}`;
      } else if(tone === 'defesa'){
        text = `Juiz: Defesa criou dúvida relevante. À acusação: ${perguntas[idx]}`;
      } else {
        text = `Juiz: Debate equilibrado. Prossigam — ${perguntas[idx]}`;
      }
    }

    return { text, score };
  }

  // ─── VEREDITO FINAL ───────────────────────────────────────────────────────

  function formatVerdict(caseObj, score){
    const tone = pickTone(score);
    const tipoCaso = detectarCaso(caseObj);
    const temVulnerabilidade = /(vulnerável|pobreza|desemprego|monoparental|informal)/i.test(
      (caseObj?.contexto_social || '') + (caseObj?.antecedentes || '')
    );
    const ehPrimario = /(primário|primeira vez|sem antecedente)/i.test(
      caseObj?.antecedentes_criminais || ''
    );

    let nome_resultado, pena, fundamentacao;

    const penaMin = caseObj?.penaMin || 1;
    const penaMax = caseObj?.penaMax || 4;

    if(tone === 'acusacao'){
      nome_resultado = 'CONDENAÇÃO';
      const anos = ehPrimario ? penaMin : Math.ceil((penaMin + penaMax) / 2);
      pena = `${anos} ano(s)${ehPrimario ? ' (pena-base mínima — réu primário)' : ''}`;
    } else if(tone === 'defesa'){
      nome_resultado = 'ABSOLVIÇÃO';
      pena = 'Absolvição — in dubio pro reo (Art. 386, VI CPP)';
    } else {
      nome_resultado = 'CONDENAÇÃO PARCIAL';
      pena = `${penaMin} ano(s) — pena mínima${temVulnerabilidade ? ' com atenuante social (Art. 66 CP)' : ''}`;
    }

    fundamentacao = buildFundamentacao(caseObj, score, tone, tipoCaso, ehPrimario, temVulnerabilidade);

    return { resultado: tone, nome_resultado, pena, fundamentacao, artigos: caseObj?.arts_rapidos || [] };
  }

  function buildFundamentacao(c, score, tone, tipoCaso, ehPrimario, temVulnerabilidade){
    const lines = [];
    lines.push(`RELATÓRIO FINAL — ${c?.titulo || 'Caso'}`);
    lines.push('─'.repeat(40));

    // placar
    lines.push(`📊 Placar argumentativo: Acusação ${score.acusacao}pts × Defesa ${score.defesa}pts`);

    // antecedentes
    if(ehPrimario) lines.push('📋 ANTECEDENTES: Réu primário — favorável na dosimetria (Art. 65, I CP)');
    if(temVulnerabilidade) lines.push('🏘️ CONTEXTO SOCIAL: Vulnerabilidade documentada — atenuante inominada aplicável (Art. 66 CP)');

    lines.push('─'.repeat(40));

    if(tone === 'acusacao'){
      lines.push('⚖️ DECISÃO: CONDENAÇÃO');
      lines.push('A acusação demonstrou com maior consistência os elementos de tipicidade, ilicitude e culpabilidade.');
      lines.push('A defesa não logrou criar dúvida razoável suficiente para afastar a autoria e materialidade.');
      if(tipoCaso === 'furto') lines.push('Consideradas as qualificadoras debatidas (horário noturno, rompimento de obstáculo).');
    } else if(tone === 'defesa'){
      lines.push('⚖️ DECISÃO: ABSOLVIÇÃO');
      lines.push('A defesa criou dúvida razoável sobre elemento essencial da acusação.');
      lines.push('Aplica-se o princípio constitucional do in dubio pro reo (Art. 5°, LVII CF/88).');
      if(tipoCaso === 'furto' && temVulnerabilidade) lines.push('Excludente de estado de necessidade (Art. 24 CP) aparece sustentável diante do conjunto debatido.');
    } else {
      lines.push('⚖️ DECISÃO: CONDENAÇÃO PARCIAL — PENA MÍNIMA');
      lines.push('O debate apresentou argumentos relevantes de ambas as partes sem solução unívoca.');
      lines.push('Aplicam-se as circunstâncias atenuantes e o princípio da proporcionalidade.');
    }

    lines.push('─'.repeat(40));
    lines.push('⚠️ Ações recomendadas para as partes:');
    const perguntas = PERGUNTAS_POR_CASO[tipoCaso] || PERGUNTAS_POR_CASO.default;
    lines.push(`• ${perguntas[0]}`);
    lines.push(`• ${perguntas[1]}`);

    return lines.join('\n');
  }

  return { scoreMessages, generateIntervention, formatVerdict };
})();

if(typeof window !== 'undefined') window.LocalJudge = LocalJudge;

// ─── ANÁLISE ASSÍNCRONA COM STREAMING SIMULADO ────────────────────────────

if(typeof window !== 'undefined'){
  window.localJudgeAnalyze = async function(messages, caseObj={}, onUpdate){
    const lastMessages = (messages || []).slice(-40);
    const tipoCaso = (() => {
      const t = ((caseObj?.titulo||'')+(caseObj?.corpo||'')).toLowerCase();
      if(/furto|mercado|roubo/.test(t)) return 'furto';
      if(/homicídio|matar|morte/.test(t)) return 'homicidio';
      if(/tráfico|droga/.test(t)) return 'trafico';
      if(/doméstica|ameaça/.test(t)) return 'violencia_domestica';
      return 'default';
    })();

    // fase 1 — pensando
    onUpdate?.({ stage:'thinking', text:'⚖️ Juiz está analisando os argumentos...' });
    await new Promise(r => setTimeout(r, 400));

    // fase 2 — perguntas contextuais
    const acuMsgs = lastMessages.filter(m => m.role==='acusacao').map(m => m.text||'');
    const defMsgs = lastMessages.filter(m => m.role==='defesa').map(m => m.text||'');
    const allText = lastMessages.map(m => m.text||'').join(' ').toLowerCase();
    const tesesDetectadas = [];
    for(const [key, tese] of Object.entries({
      estado_necessidade:{kws:['estado de necessidade','fome','filhos','necessidade','pobreza']},
      insignificancia:{kws:['insignificância','bagatela','valor irrisório']},
      dolo:{kws:['dolo','intenção','quis','planejou']},
      autoria:{kws:['câmera','flagrante','testemunha','vídeo']},
    })){
      if(tese.kws.some(kw => allText.includes(kw))) tesesDetectadas.push(key);
    }

    const perguntas = PERGUNTAS_POR_CASO[tipoCaso] || PERGUNTAS_POR_CASO.default;
    const perguntas_acu = [];
    const perguntas_def = [];

    // perguntas baseadas no que cada lado disse
    if(acuMsgs.join('').length > 20){
      perguntas_acu.push(perguntas[0]);
      if(tesesDetectadas.includes('autoria')) perguntas_acu.push('Qual a cadeia de custódia das provas apresentadas?');
      else perguntas_acu.push(perguntas[2] || perguntas[0]);
    } else {
      perguntas_acu.push('A acusação ainda não apresentou argumentos substanciais — apresente provas de autoria e materialidade.');
    }

    if(defMsgs.join('').length > 20){
      perguntas_def.push(perguntas[1]);
      if(tesesDetectadas.includes('estado_necessidade')) perguntas_def.push('Comprove os três requisitos do estado de necessidade (Art. 24 CP) com fatos concretos.');
      else if(tesesDetectadas.includes('insignificancia')) perguntas_def.push('Demonstre os quatro vetores da insignificância conforme STF HC 84.412.');
      else perguntas_def.push(perguntas[3] || perguntas[1]);
    } else {
      perguntas_def.push('A defesa ainda não apresentou tese consistente — apresente excludentes, atenuantes ou questione a prova.');
    }

    onUpdate?.({ stage:'questions', text:'📋 Perguntas do Juiz', meta:{ perguntas_acu, perguntas_def } });
    await new Promise(r => setTimeout(r, 300));

    // fase 3 — intervenção
    const intervention = LocalJudge.generateIntervention(caseObj, lastMessages);
    onUpdate?.({ stage:'intervention', text: intervention.text, meta:{ score: intervention.score } });
    await new Promise(r => setTimeout(r, 350));

    // fase 4 — veredito
    const score = LocalJudge.scoreMessages(lastMessages);
    const verdict = LocalJudge.formatVerdict(caseObj, score);
    const finalText = `${verdict.nome_resultado}\n\n${verdict.fundamentacao}\n\nPena recomendada: ${verdict.pena}`;

    onUpdate?.({ stage:'final', text: finalText, meta:{ verdict } });
    return { text: finalText, verdict };
  };
}