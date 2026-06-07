// modules/ai_client.js
// O frontend só fala com o backend no Render.
// Todas as chaves de API ficam lá — nunca no browser.

const RENDER_URL = 'https://tribunal-do-casal-api.onrender.com';

function fetchWithTimeout(url, options, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export async function askProxy(caseObj, messages) {
  const r = await fetchWithTimeout(`${RENDER_URL}/api/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseObj, messages })
  }, 6000);
  if (!r.ok) throw new Error('proxy_failed');
  const data = await r.json();
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
