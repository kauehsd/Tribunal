// modules/ai_client.js — cliente que tenta proxy, depois Gemini direto
export async function askProxy(caseObj, messages) {
  const url = '/api/judge';
  try {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ caseObj, messages }) });
    if (!r.ok) throw new Error('proxy_failed');
    const data = await r.json();
    return data.text || (data.result && data.result.text) || null;
  } catch(e){
    throw e;
  }
}

export async function askGeminiDirect(caseObj, messages, key){
  if(!key) throw new Error('missing_key');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const system = `Você é Dr. Augusto Melo, Juiz de direito. Analise e responda de forma direta ao debate abaixo.`;
  const debate = (messages||[]).map(m => `${m.sender || m.role}: ${m.text || m.content || ''}`).join('\n') || 'Nenhum argumento.';
  const body = {
    system_instruction: { parts:[{ text: system }] },
    contents: [ { role: 'user', parts:[{ text: `CASO: ${(caseObj||{}).titulo || (caseObj||{}).nome || 'Caso genérico'}\n${(caseObj||{}).context_juiz||caseObj.corpo||''}\n\nDEBATE:\n${debate}\n\nResponda de forma sucinta.` }] } ],
    generationConfig:{ maxOutputTokens:800, temperature:0.8 }
  };
  const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || 'gemini_error');
  return data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
}
