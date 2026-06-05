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
  return data.text || null;
}

// Funções abaixo exportadas apenas para satisfazer o import do ai-bridge.js
// Elas jogam de volta pro proxy — não chamam nada diretamente.

export async function askGeminiDirect(caseObj, messages, key) {
  return askProxy(caseObj, messages);
}

export async function askCerebrasDirect(caseObj, messages, key) {
  return askProxy(caseObj, messages);
}

export async function askCloudflareDirect(caseObj, messages, key) {
  return askProxy(caseObj, messages);
}