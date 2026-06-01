import { LocalJudge } from './judge_local.js';
import { askProxy, askGeminiDirect, askCerebrasDirect, askCloudflareDirect } from './modules/ai_client.js';

function getKey(){ return localStorage.getItem('tribunal_gemini_key') || window.DEFAULT_GEMINI_KEY || ''; }
function getCerebrasKey(){ return localStorage.getItem('tribunal_cerebras_key') || window.DEFAULT_CEREBRAS_KEY || ''; }
function getCloudflareKey(){ return localStorage.getItem('tribunal_cloudflare_key') || window.DEFAULT_CLOUDFLARE_KEY || ''; }

async function tryFallbackAIs(caseObj, messages){
  // proxy first (Vercel with env var fallback chain: Gemini → Cerebras → Cloudflare)
  try{
    const txt = await askProxy(caseObj, messages);
    if(txt) return txt;
  }catch(e){ console.warn('proxy failed', e.message||e); }

  // fallback local (no browser API calls to avoid quota/auth issues)
  const local = LocalJudge.generateIntervention(caseObj, messages);
  return `${local.text}\n\n(placar simulado: ${local.score.acusacao}×${local.score.defesa})`;
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
  return await tryFallbackAIs(caseObj, messages);
}

// Backwards-compatible global bindings used by inline scripts
if(typeof window !== 'undefined'){
  window.askJudge = askJudge;
  window.AIJudge = { ask: askJudge };
  // override older helpers if present
  window.callGemini = async function(system, userPrompt, maxTokens){
    const fallbackCase = { titulo: 'Caso genérico', context_juiz: userPrompt };
    return await askJudge(fallbackCase, [{ sender: 'Usuário', role: 'user', text: userPrompt }]);
  };
  window.callAI = askAI;
}
