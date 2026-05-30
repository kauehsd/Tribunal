// judge_local.js — motor local adaptativo para fallback
export const LocalJudge = (function(){
  // palavras-chave por tema (simplificado)
  const KEYWORDS = {
    homicidio:['homicídio','matar','esfaqueou','tiro','estrangulamento','assassinou'],
    furto:['furto','roubo','arrombou','subtrair','furtou'],
    trafico:['cocaína','droga','tráfico','entrega','dose','balança','PIX'],
    violencia_domestica:['agressão','ameaça','BO','violência','medida protetiva','doméstica'],
  };

  function scoreMessages(messages){
    const score = {acusacao:0, defesa:0};
    messages.forEach(m=>{
      const txt = (m.text||'').toLowerCase();
      // pontos por presença de palavras-chave favoráveis ao autor do argumento
      for(const theme in KEYWORDS){
        for(const kw of KEYWORDS[theme]){
          if(txt.includes(kw)){
            // heurística: se mensagem da acusação e palavra negativa -> +1 acusação
            if(m.role==='acusacao') score.acusacao += 1;
            if(m.role==='defesa') score.defesa += 1;
          }
        }
      }
      // pontos extras por citações de artigos
      const arts = txt.match(/art\.?\s?\d+/g);
      if(arts && arts.length){ if(m.role==='acusacao') score.acusacao += arts.length; else score.defesa += arts.length }
    });
    return score;
  }

  function pickTone(score){
    if(score.acusacao - score.defesa >= 2) return 'acusacao';
    if(score.defesa - score.acusacao >= 2) return 'defesa';
    return 'balanced';
  }

  function formatVerdict(caseObj, score){
    const tone = pickTone(score);
    let nome_resultado = 'EMPATE TÉCNICO';
    let pena = 'Pena a ser avaliada';
    if(tone==='acusacao'){ nome_resultado='CONDENADO'; pena = `${Math.max(1, caseObj.penaMin)} a ${caseObj.penaMax} anos (estimativa)` }
    if(tone==='defesa'){ nome_resultado='ABSOLVIDO'; pena = 'Absolvição (in dubio pro reo)' }
    if(tone==='balanced'){ nome_resultado='CONDENAÇÃO PARCIAL'; pena = `${caseObj.penaMin} anos (pena mínima)` }
    const fundamentacao = buildFundamentacao(caseObj, score, tone);
    return { resultado: tone, nome_resultado, pena, fundamentacao, artigos: caseObj.arts_rapidos || [] };
  }

  function buildFundamentacao(c, score, tone){
    const lines = [];
    lines.push(`RELATÓRIO — Resumo: ${c.titulo}.`);
    lines.push(`Análise sucinta dos argumentos apresentados durante o debate.`);
    if(tone==='acusacao'){
      lines.push(`A Acusação apresentou pontos factuais que se mostraram mais consistentes diante das evidências discutidas (placar simulado ${score.acusacao}×${score.defesa}).`);
      lines.push(`Foram mencionados artigos-chave: ${ (c.arts_rapidos||[]).slice(0,3).join(', ') }.`);
      lines.push(`Conclusão: mantém-se a tipicidade e a autoria, não foram afastadas as qualificadoras essenciais.`);
    } else if(tone==='defesa'){
      lines.push(`A Defesa logrou criar dúvida razoável sobre elementos centrais da tipicidade e/ou autoria (placar simulado ${score.defesa}×${score.acusacao}).`);
      lines.push(`Destaco a ausência de prova robusta de circunstâncias qualificadoras e a presença de teses excludentes.`);
      lines.push(`Conclusão: absolvição por insuficiência probatória.`);
    } else {
      lines.push(`Debate equilibrado; pontos fortes surgiram em ambos os lados e não houve solução unívoca (placar ${score.acusacao}×${score.defesa}).`);
      lines.push(`Sugere-se pena no mínimo legal ou decisão parcial, conforme artigo aplicável.`);
    }
    return lines.join('\n\n');
  }

  // gera intervenção curta (comment) com base nas últimas mensagens
  function generateIntervention(caseObj, messages){
    const score = scoreMessages(messages);
    const tone = pickTone(score);
    const prompts = {
      acusacao: `Juiz: A acusação tem razoável fundamento; fundamentem prova de culpabilidade e qualificadoras. Pontue provas materiais.`,
      defesa: `Juiz: A defesa trouxe dúvida razoável; explique como a prova atinge o núcleo do tipo penal.`,
      balanced: `Juiz: Debate equilibrado. Falta abordagem clara sobre provas materiais e contraprovas; foquem nisso.`
    };
    const intervention = prompts[tone] || prompts.balanced;
    return { text: intervention, score };
  }

  return { scoreMessages, generateIntervention, formatVerdict };
})();

// Para compatibilidade com scripts antigos que esperam `LocalJudge` global
if (typeof window !== 'undefined') window.LocalJudge = LocalJudge;
