import { LocalJudge } from './judge_local.js';
import { askProxy } from './modules/ai_client.js';

async function tryFallbackAIs(caseObj, messages){
  // proxy Render (única fonte de IA — chaves ficam no servidor)
  try{
    const result = await askProxy(caseObj, messages);
    if(result && result.text) return result; // { text, provider }
  }catch(e){ console.warn('proxy failed', e.message||e); }

  // fallback local (offline)
  const local = LocalJudge.generateIntervention(caseObj, messages);
  return { text: local.text, provider: 'local', localScore: local.score };
}

export async function askJudge(caseObj, messages){
  try{
    return await tryFallbackAIs(caseObj, messages);
  }catch(e){
    console.error('all judge providers failed', e);
    throw new Error('all_judges_failed');
  }
}

export async function askAI(systemPrompt, userPrompt, maxTokens=800, history=[]){
  const messages = [...history, { sender:'Usuário', role:'user', text:userPrompt }];
  const caseObj = { titulo:'Assistente IA', context_juiz:userPrompt };
  const result = await tryFallbackAIs(caseObj, messages);
  return (result && result.text) ? result.text : result;
}

if(typeof window !== 'undefined'){
  window.askJudge = askJudge;
  window.AIJudge = { ask: askJudge };
  window.callAI = askAI;
  window.callGemini = async function(system, userPrompt){
    return await askAI(system, userPrompt);
  };
}
