// ai-bridge.js — ponto único de acesso às IAs.
// Tenta o Juiz IA do servidor (/api/judge, com fila de IAs gratuitas) e,
// se nada responder, usa o motor local (judge_local.js), que funciona offline.
import { LocalJudge } from './judge_local.js';
import { callJudgeApi } from './modules/ai_client.js';

// Pontuação local é uma soma sem teto; convertemos para a escala 0–10 da IA.
function localScore(messages) {
  const s = LocalJudge.scoreMessages(messages);
  const norm = v => Math.round(10 * v / (v + 30));
  return { acusacao: norm(s.acusacao), defesa: norm(s.defesa) };
}

function pickOne(list) {
  return Array.isArray(list) && list.length ? [list[Math.floor(Math.random() * list.length)]] : [];
}

// Intervenção do juiz durante o debate.
// → { text, perguntas_acu, perguntas_def, placar, provider }
export async function askJudge(caseObj, messages, extra = {}) {
  try {
    return await callJudgeApi('judge', { caseObj, messages, extra });
  } catch (e) {
    console.warn('[juiz] IA indisponível, usando juiz local:', e.message || e);
    const local = LocalJudge.generateIntervention(caseObj, messages);
    return {
      text: local.text,
      perguntas_acu: pickOne(caseObj?.perguntas_acu),
      perguntas_def: pickOne(caseObj?.perguntas_def),
      placar: localScore(messages),
      provider: 'local'
    };
  }
}

// Veredito (preliminar, ou final quando extra.recursos vier preenchido).
// → { text, decisao, pena, placar, provider }
export async function askVerdict(caseObj, messages, extra = {}) {
  try {
    return await callJudgeApi('verdict', { caseObj, messages, extra });
  } catch (e) {
    console.warn('[veredito] IA indisponível, usando juiz local:', e.message || e);
    const v = LocalJudge.formatVerdict(caseObj, LocalJudge.scoreMessages(messages));
    return {
      text: `${v.nome_resultado}\n\n${v.fundamentacao}\n\nPena: ${v.pena}`,
      decisao: v.nome_resultado,
      pena: v.pena,
      placar: localScore(messages),
      provider: 'local'
    };
  }
}

// Assistente privado de estratégia. extra = { role, question, history }
// → { text, provider }
export async function askAssistant(caseObj, messages, extra = {}) {
  try {
    return await callJudgeApi('assist', { caseObj, messages, extra });
  } catch (e) {
    console.warn('[assistente] IA indisponível, usando dicas locais:', e.message || e);
    const dicas = LocalJudge.gerarSugestaoTatica(caseObj, messages || [], extra.role);
    return {
      text: `(Assistente offline: a IA não respondeu, então seguem dicas automáticas.)\n\n${dicas.join('\n')}`,
      provider: 'local'
    };
  }
}
