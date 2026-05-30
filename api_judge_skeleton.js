// Exemplo de função serverless para Vercel / Render / Cloud Functions
// Salve como api/judge.js no deploy (este arquivo é um esqueleto).

// Requisitos:
// - definir variável de ambiente GEMINI_KEY com a chave da Google Cloud
// - deploy em Vercel / Render / outro provider que suporte Node.js

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minuto
const MAX_REQUESTS_PER_WINDOW = 30; // ajuste conforme necessidade
let requestCount = 0;
let windowStart = Date.now(); 

module.exports = async (req, res) => {
  // CORS simples
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Rate limit in-memory (not suitable para produção em escala)
  const now = Date.now();
  if (now - windowStart > RATE_LIMIT_WINDOW_MS) { windowStart = now; requestCount = 0; }
  if (++requestCount > MAX_REQUESTS_PER_WINDOW) return res.status(429).json({ error: 'rate_limited' });

  const key = process.env.GEMINI_KEY;
  if (!key) return res.status(503).json({ error: 'missing_api_key' });

  try {
    const { caseObj, messages } = req.body || {};
    const debate = (messages || []).map(m => `${m.sender} (${m.role}): ${m.text}`).join('\n') || 'Nenhum argumento';
    const system = `Você é Dr. Augusto Melo, Juiz de direito. Analise e responda de forma direta ao debate abaixo.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;

    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [ { role: 'user', parts: [ { text: `CASO: ${(caseObj||{}).titulo || 'Caso genérico'}\n${(caseObj||{}).context_juiz||''}\n\nDEBATE:\n${debate}\n\nResponda.` } ] } ],
      generationConfig: { maxOutputTokens: 800, temperature: 0.8 }
    };

    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error || data });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);
    return res.json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
