// api/judge.js — Vercel Serverless Function
// Proxy seguro para o Juiz IA com fallback: Gemini → Cerebras → Cloudflare
//
// Variáveis de ambiente necessárias no Vercel (Settings → Environment Variables):
//   GEMINI_KEY          — chave da Google AI (Gemini)
//   CEREBRAS_KEY        — chave da Cerebras AI
//   CLOUDFLARE_KEY      — API Token do Cloudflare (com permissão Workers AI)
//   CLOUDFLARE_ACCOUNT_ID — Account ID do Cloudflare (encontrado no dashboard)

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
let requestCount = 0;
let windowStart = Date.now();

// ---------- helpers ----------

function buildDebate(caseObj, messages) {
  const title = caseObj?.titulo || caseObj?.nome || 'Caso genérico';
  const ctx   = caseObj?.context_juiz || caseObj?.corpo || '';
  const debate = (messages || [])
    .map(m => `${m.sender || m.role || 'Usuário'}: ${m.text || m.content || ''}`)
    .join('\n') || 'Nenhum argumento.';
  return `CASO: ${title}\n${ctx}\n\nDEBATE:\n${debate}\n\nResponda como Dr. Augusto Melo, Juiz experiente em direito penal: indique perguntas para acusação e defesa, avalie pontos fortes e fracos e proponha próximos passos estratégicos.`;
}

// ---------- providers ----------

async function tryGemini(caseObj, messages, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
  const body = {
    system_instruction: {
      parts: [{ text: 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal. Analise o caso de forma objetiva e construtiva.' }]
    },
    contents: [{ role: 'user', parts: [{ text: buildDebate(caseObj, messages) }] }],
    generationConfig: { maxOutputTokens: 800, temperature: 0.8 }
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `gemini_${r.status}`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function tryCerebras(caseObj, messages, key) {
  // Endpoint correto: /v1/chat/completions (OpenAI-compatible)
  const url = 'https://api.cerebras.ai/v1/chat/completions';
  const body = {
    model: 'llama-3.3-70b',
    messages: [
      { role: 'system', content: 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal.' },
      { role: 'user',   content: buildDebate(caseObj, messages) }
    ],
    max_tokens: 800,
    temperature: 0.8
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `cerebras_${r.status}`);
  return data?.choices?.[0]?.message?.content || null;
}

async function tryCloudflare(caseObj, messages, key, accountId) {
  // Endpoint correto: Workers AI run
  const model = '@cf/meta/llama-3.1-8b-instruct';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  const body = {
    messages: [
      { role: 'system', content: 'Você é Dr. Augusto Melo, Juiz de direito experiente em direito penal.' },
      { role: 'user',   content: buildDebate(caseObj, messages) }
    ],
    max_tokens: 800
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.errors?.[0]?.message || `cloudflare_${r.status}`);
  return data?.result?.response || null;
}

// ---------- handler ----------

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Rate limit
  const now = Date.now();
  if (now - windowStart > RATE_LIMIT_WINDOW_MS) { windowStart = now; requestCount = 0; }
  if (++requestCount > MAX_REQUESTS_PER_WINDOW) return res.status(429).json({ error: 'rate_limited' });

  const { caseObj, messages } = req.body || {};

  // --- Gemini ---
  const geminiKey = process.env.GEMINI_KEY;
  if (geminiKey) {
    try {
      const text = await tryGemini(caseObj, messages, geminiKey);
      if (text) return res.json({ text, provider: 'gemini' });
    } catch (e) {
      console.warn('[judge] gemini failed:', e.message);
    }
  }

  // --- Cerebras ---
  const cerebrasKey = process.env.CEREBRAS_KEY;
  if (cerebrasKey) {
    try {
      const text = await tryCerebras(caseObj, messages, cerebrasKey);
      if (text) return res.json({ text, provider: 'cerebras' });
    } catch (e) {
      console.warn('[judge] cerebras failed:', e.message);
    }
  }

  // --- Cloudflare ---
  const cloudflareKey       = process.env.CLOUDFLARE_KEY;
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (cloudflareKey && cloudflareAccountId) {
    try {
      const text = await tryCloudflare(caseObj, messages, cloudflareKey, cloudflareAccountId);
      if (text) return res.json({ text, provider: 'cloudflare' });
    } catch (e) {
      console.warn('[judge] cloudflare failed:', e.message);
    }
  }

  // Todos falharam — o frontend vai cair pro LocalJudge
  return res.status(503).json({ error: 'all_providers_failed' });
}
