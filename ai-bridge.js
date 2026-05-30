import { LocalJudge } from './judge_local.js';
import { askProxy, askGeminiDirect } from './modules/ai_client.js';

function getKey(){ return localStorage.getItem('tribunal_gemini_key') || ''; }

export async function askJudge(caseObj, messages){
  // 1) try same-origin proxy /api/judge
  try{
    const txt = await askProxy(caseObj, messages);
    if(txt) return txt;
  }catch(e){ console.warn('proxy failed', e.message||e); }

  // 2) try direct Gemini with client key (if present)
  const key = getKey();
  if(key){
    try{
      const txt = await askGeminiDirect(caseObj, messages, key);
      if(txt) return txt;
    }catch(e){ console.warn('gemini direct failed', e.message||e); }
  }

  // 3) fallback to local judge
  try{
    const local = LocalJudge.generateIntervention(caseObj, messages);
    return `${local.text}\n\n(placar simulado: ${local.score.acusacao}×${local.score.defesa})`;
  }catch(e){
    console.error('local judge failed', e);
    throw new Error('all_judges_failed');
  }
}

// Backwards-compatible global bindings used by inline scripts
if(typeof window !== 'undefined'){
  window.askJudge = askJudge;
  window.AIJudge = { ask: askJudge };
  // override older helpers if present
  window.callGemini = async function(system, userPrompt, maxTokens){
    // try to map to askJudge using userPrompt as last message
    const fallbackCase = { titulo: 'Caso genérico', context_juiz: userPrompt };
    return await askJudge(fallbackCase, [{ sender: 'Usuário', role: 'user', text: userPrompt }]);
  };
  window.callAI = window.callGemini;
}
