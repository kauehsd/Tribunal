// modules/ai_client.js — ATUALIZADO: aponta pro backend no Render
// ⚠️ Troque a URL abaixo pela URL real do seu serviço no Render
const RENDER_URL = 'https://tribunal-do-casal-api.onrender.com';

export async function askProxy(caseObj, messages) {
  const url = `${RENDER_URL}/api/judge`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseObj, messages })
    });
    if (!r.ok) throw new Error('proxy_failed');
    const data = await r.json();
    return data.text || (data.result && data.result.text) || null;
  } catch(e) {
    throw e;
  }
}

function buildJudgePrompt(caseObj, messages){
  const title = (caseObj?.titulo || caseObj?.nome || 'Caso genérico');
  const caseText = (caseObj?.context_juiz || caseObj?.corpo || '');
  const debate = (messages||[]).map(m => `${m.sender || m.role || 'Usuário'}: ${m.text || m.content || ''}`).join('\n') || 'Nenhum argumento.';
  return `CASO: ${title}\n${caseText}\n\nDEBATE:\n${debate}\n\nResponda como um juiz experiente: indique perguntas para acusação e defesa, avalie pontos fortes e fracos e proponha próximos passos de estratégia.`;
}

function parseAiResponse(data){
  if(!data) return '';
  const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if(candidate) return candidate;
  if(typeof data.text === 'string') return data.text;
  if(Array.isArray(data?.results) && data.results.length){
    const out = data.results.map(r => {
      if(typeof r.output === 'string') return r.output;
      if(Array.isArray(r.output)) return r.output.map(o=>o?.text||'').join('');
      if(Array.isArray(r.content)) return r.content.map(c=>c?.text||'').join('');
      return '';
    }).filter(Boolean).join('\n');
    if(out) return out;
  }
  if(typeof data?.output === 'string') return data.output;
  return JSON.stringify(data);
}

export async function askGeminiDirect(caseObj, messages, key){
  if(!key) throw new Error('missing_key');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const system = `Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal. Analise o caso de forma objetiva e construtiva, como um juiz real. Em sua resposta, indique claramente as perguntas que a acusação e a defesa devem responder, destaque os pontos fortes e fracos de cada lado, e proponha próximos passos estratégicos para o debate.`;
  const debate = buildJudgePrompt(caseObj, messages);
  const body = {
    system_instruction: { parts:[{ text: system }] },
    contents: [ { role: 'user', parts:[{ text: debate }] } ],
    generationConfig:{ maxOutputTokens:800, temperature:0.8 }
  };
  const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || 'gemini_error');
  return parseAiResponse(data);
}

export async function askCerebrasDirect(caseObj, messages, key){
  const url = 'https://api.cerebras.ai/v1/chat/completions';
  const headers = { 'Content-Type':'application/json' };
  if(key) headers.Authorization = `Bearer ${key}`;
  const systemPrompt = 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal. Analise o caso de forma objetiva e construtiva.';
  const debate = buildJudgePrompt(caseObj, messages);
  const body = { model: 'llama-3.3-70b', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: debate }], max_tokens: 800, temperature: 0.8 };
  const resp = await fetch(url, { method:'POST', headers, body:JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || 'cerebras_error');
  return parseAiResponse(data?.choices?.[0]?.message?.content || '');
}