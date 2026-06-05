// api/judge.js — Vercel Serverless Function
// Ordem: Groq → Cerebras → Cloudflare → 503

function buildDebate(caseObj, messages) {
  const title = caseObj?.titulo || 'Caso genérico';
  const ctx = caseObj?.context_juiz || caseObj?.corpo || '';
  const debate = (messages || [])
    .map(m => `${m.sender || m.role || 'Usuário'}: ${m.text || m.content || ''}`)
    .join('\n') || 'Nenhum argumento ainda.';
  return `CASO: ${title}\n${ctx}\n\nDEBATE:\n${debate}\n\nComo Dr. Augusto Melo, Juiz experiente em direito penal: analise os argumentos, faça perguntas cirúrgicas para acusação e defesa, avalie pontos fortes e fracos de cada lado e oriente os próximos passos. Seja direto e específico ao caso.`;
}

const SYSTEM = 'Você é Dr. Augusto Melo, Juiz experiente em direito penal brasileiro. Analise debates jurídicos de forma objetiva, faça perguntas pertinentes e oriente as partes com base no Código Penal.';

async function tryGroq(caseObj, messages, key) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildDebate(caseObj, messages) }
      ],
      max_tokens: 800,
      temperature: 0.8
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `groq_${r.status}`);
  return data?.choices?.[0]?.message?.content || null;
}

async function tryCerebras(caseObj, messages, key) {
  const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [
        { role: 'system', content: SYSTEM },
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
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM },
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

  const groqKey = process.env.GROQ_KEY;
  if (groqKey) {
    try {
      const text = await tryGroq(caseObj, messages, groqKey);
      if (text) return res.json({ text, provider: 'groq' });
    } catch (e) { console.warn('[judge] groq failed:', e.message); }
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

  return res.status(503).json({ error: 'all_providers_failed' });
}