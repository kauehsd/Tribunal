// api/judge.js — Vercel Serverless Function
// Proxy seguro: Gemini → Cerebras → Cloudflare
// Env vars no Vercel: GEMINI_KEY, CEREBRAS_KEY, CLOUDFLARE_KEY, CLOUDFLARE_ACCOUNT_ID

function buildDebate(caseObj, messages) {
  const title = caseObj?.titulo || 'Caso genérico';
  const ctx = caseObj?.context_juiz || caseObj?.corpo || '';
  const debate = (messages || [])
    .map(m => `${m.sender || m.role || 'Usuário'}: ${m.text || m.content || ''}`)
    .join('\n') || 'Nenhum argumento.';
  return `CASO: ${title}\n${ctx}\n\nDEBATE:\n${debate}\n\nResponda como Dr. Augusto Melo, Juiz experiente em direito penal: indique perguntas para acusação e defesa, avalie pontos fortes e fracos e proponha próximos passos estratégicos.`;
}

async function tryGemini(caseObj, messages, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal.' }] },
      contents: [{ role: 'user', parts: [{ text: buildDebate(caseObj, messages) }] }],
      generationConfig: { maxOutputTokens: 800, temperature: 0.8 }
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `gemini_${r.status}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function tryCerebras(caseObj, messages, key) {
  const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [
        { role: 'system', content: 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal.' },
        { role: 'user', content: buildDebate(caseObj, messages) }
      ],
      max_tokens: 800,
      temperature: 0.8
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `cerebras_${r.status}`);
  return data?.choices?.[0]?.message?.content || null;
}

async function tryCloudflare(caseObj, messages, key, accountId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal.' },
        { role: 'user', content: buildDebate(caseObj, messages) }
      ],
      max_tokens: 800
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.errors?.[0]?.message || `cloudflare_${r.status}`);
  return data?.result?.response || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { caseObj, messages } = req.body || {};

  // Log para debug (aparece nos Registros do Vercel)
  console.log('[judge] keys present:', {
    gemini: !!process.env.GEMINI_KEY,
    cerebras: !!process.env.CEREBRAS_KEY,
    cloudflare: !!process.env.CLOUDFLARE_KEY,
    cfAccountId: !!process.env.CLOUDFLARE_ACCOUNT_ID
  });

  const geminiKey = process.env.GEMINI_KEY;
  if (geminiKey) {
    try {
      const text = await tryGemini(caseObj, messages, geminiKey);
      if (text) return res.json({ text, provider: 'gemini' });
    } catch (e) { console.warn('[judge] gemini failed:', e.message); }
  }

  const cerebrasKey = process.env.CEREBRAS_KEY;
  if (cerebrasKey) {
    try {
      const text = await tryCerebras(caseObj, messages, cerebrasKey);
      if (text) return res.json({ text, provider: 'cerebras' });
    } catch (e) { console.warn('[judge] cerebras failed:', e.message); }
  }

  const cloudflareKey = process.env.CLOUDFLARE_KEY;
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (cloudflareKey && cloudflareAccountId) {
    try {
      const text = await tryCloudflare(caseObj, messages, cloudflareKey, cloudflareAccountId);
      if (text) return res.json({ text, provider: 'cloudflare' });
    } catch (e) { console.warn('[judge] cloudflare failed:', e.message); }
  }

  return res.status(503).json({ error: 'all_providers_failed', keys: { gemini: !!geminiKey, cerebras: !!cerebrasKey, cloudflare: !!cloudflareKey } });
}
