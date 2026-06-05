// modules/ai_client.js
// O frontend só fala com o backend no Render.
// Todas as chaves de API ficam lá — nunca no browser.

const RENDER_URL = 'https://tribunal-do-casal-api.onrender.com';

export async function askProxy(caseObj, messages) {
  const r = await fetch(`${RENDER_URL}/api/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseObj, messages })
  });
  if (!r.ok) throw new Error('proxy_failed');
  const data = await r.json();
  // Retorna objeto com text e provider para exibir badge
  return { text: data.text || null, provider: data.provider || null };
}

export async function askGeminiDirect(caseObj, messages, key) {
  return askProxy(caseObj, messages);
}

export async function askCerebrasDirect(caseObj, messages, key) {
  return askProxy(caseObj, messages);
}

export async function askCloudflareDirect(caseObj, messages, key) {
  return askProxy(caseObj, messages);
}
