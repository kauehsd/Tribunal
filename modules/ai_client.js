// modules/ai_client.js
// O frontend só conversa com a função /api/judge do próprio site (Vercel).
// As chaves das IAs ficam no servidor — nunca no navegador.

const API_URL = '/api/judge';
const TIMEOUT_MS = 58000;

export async function callJudgeApi(mode, { caseObj, extra } = {}) {
  // Aberto como arquivo (duplo clique no index.html): não há servidor, vai direto pro plano B local.
  if (location.protocol === 'file:') throw new Error('no_server');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, caseObj: slimCase(caseObj), extra }),
      signal: controller.signal
    });
    const data = await r.json().catch(() => ({}));
    // texto vazio é resposta válida (ex.: fiscal sem nenhuma violação); só erro HTTP conta como falha
    if (!r.ok || data.error || !data.provider) throw new Error(data.error || `http_${r.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Manda só o que a IA precisa (o caso inteiro tem vade mecum, calculadora etc.).
function slimCase(c = {}) {
  const { id, titulo, corpo, context_juiz, antecedentes_criminais, contexto_social, provas, linha_tempo, penaMin, penaMax } = c;
  return { id, titulo, corpo, context_juiz, antecedentes_criminais, contexto_social, provas, linha_tempo, penaMin, penaMax };
}
