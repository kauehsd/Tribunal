// modules/ai_client.js
// O frontend só conversa com a função /api/judge do próprio site (Vercel).
// As chaves das IAs ficam no servidor — nunca no navegador.

const API_URL = '/api/judge';
const TIMEOUT_MS = 50000;

export async function callJudgeApi(mode, { caseObj, messages, extra } = {}) {
  // Aberto como arquivo (duplo clique no index.html): não há servidor, vai direto pro juiz local.
  if (location.protocol === 'file:') throw new Error('no_server');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, caseObj: slimCase(caseObj), messages: slimMessages(messages), extra }),
      signal: controller.signal
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.text) throw new Error(data.error || `http_${r.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Manda só o que o juiz precisa (o caso inteiro tem vade mecum, calculadora etc.).
function slimCase(c = {}) {
  const { titulo, corpo, context_juiz, antecedentes_criminais, contexto_social, provas, penaMin, penaMax } = c;
  return { titulo, corpo, context_juiz, antecedentes_criminais, contexto_social, provas, penaMin, penaMax };
}

function slimMessages(messages = []) {
  return messages.slice(-40).map(m => ({ sender: m.sender, role: m.role, text: m.text }));
}
