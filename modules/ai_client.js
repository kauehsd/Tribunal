// modules/ai_client.js — cliente que tenta proxy, luego Gemini, Cerebras, Cloudflare e fallback local
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
  const url = 'https://api.cerebras.net/v1/generate';
  const headers = { 'Content-Type':'application/json' };
  if(key) headers.Authorization = `Bearer ${key}`;
  const body = { model:'llama-3.3', input: buildJudgePrompt(caseObj, messages), max_output_tokens:800, temperature:0.8, top_p:0.95 };
  const resp = await fetch(url, { method:'POST', headers, body:JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.error?.message || 'cerebras_error');
  return parseAiResponse(data);
}

async function resolveCloudflareAccountId(apiToken){
  const url = 'https://api.cloudflare.com/client/v4/accounts';
  const resp = await fetch(url, { method:'GET', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${apiToken}` } });
  const data = await resp.json();
  if(!resp.ok) throw new Error(data?.errors?.[0]?.message || data?.error || 'cloudflare_account_lookup_failed');
  const accountId = data?.result?.[0]?.id;
  if(!accountId) throw new Error('cloudflare_no_account_found');
  return accountId;
}

export async function askCloudflareDirect(caseObj, messages, key){
  if(!key) throw new Error('missing_cloudflare_key');
  let accountId = key;
  if(/^cfut_/.test(key) || /^pk_/.test(key) || /^sk_/.test(key)){
    accountId = await resolveCloudflareAccountId(key);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/text/generate`;
  const body = { model:'gpt-4o-mini', input: buildJudgePrompt(caseObj, messages), max_output_tokens:800, temperature:0.8 };
  const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`}, body:JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data?.errors?.[0]?.message || data?.error || 'cloudflare_error');
  return parseAiResponse(data);
}
