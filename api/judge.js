// api/judge.js — Vercel Serverless Function do Juiz IA
//
// Todas as IAs aqui têm plano gratuito. O servidor tenta uma de cada vez, na
// ordem de PROVIDERS; se uma falhar (sem chave, limite atingido, fora do ar,
// demorou demais), passa para a próxima. Se todas falharem, responde 503 e o
// frontend usa o juiz local (judge_local.js).
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   GROQ_KEY        https://console.groq.com/keys
//   GEMINI_KEY      https://aistudio.google.com/app/apikey
//   CEREBRAS_KEY    https://cloud.cerebras.ai
//   OPENROUTER_KEY  https://openrouter.ai/settings/keys
// Opcional: GROQ_MODEL, GEMINI_MODEL, CEREBRAS_MODEL, OPENROUTER_MODEL para trocar o modelo.
//
// POST /api/judge  { mode: 'judge' | 'verdict' | 'assist', caseObj, messages, extra }
// GET  /api/judge  → diz quais IAs estão configuradas (sem mostrar as chaves)

const PROVIDERS = [
  {
    name: 'groq',
    env: 'GROQ_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    jsonMode: true
  },
  {
    name: 'gemini',
    env: 'GEMINI_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    jsonMode: false
  },
  {
    name: 'cerebras',
    env: 'CEREBRAS_KEY',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    model: () => process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    jsonMode: true
  },
  {
    name: 'openrouter',
    env: 'OPENROUTER_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: () => process.env.OPENROUTER_MODEL || 'openrouter/free',
    jsonMode: false
  }
];

const PROVIDER_TIMEOUT_MS = 15000;
const TOTAL_BUDGET_MS = 45000;
const COOLDOWN_MS = 60000;

// Quando uma IA responde "limite atingido" (429), pulamos ela por 1 minuto.
// Fica só na memória da instância — é um atalho, não uma garantia.
const cooldownUntil = {};

// ─── Montagem do contexto ──────────────────────────────────────────────────

function clip(value, max) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

function describeCase(caseObj = {}) {
  const parts = [`CASO: ${clip(caseObj.titulo || 'Caso sem título', 120)}`];
  if (caseObj.corpo) parts.push(clip(stripHtml(caseObj.corpo), 1500));
  if (caseObj.context_juiz) parts.push(clip(caseObj.context_juiz, 1500));
  if (caseObj.antecedentes_criminais) parts.push(`Antecedentes: ${clip(caseObj.antecedentes_criminais, 400)}`);
  if (caseObj.contexto_social) parts.push(`Contexto social: ${clip(caseObj.contexto_social, 400)}`);
  if (Array.isArray(caseObj.provas) && caseObj.provas.length) {
    parts.push('PROVAS:\n' + caseObj.provas.slice(0, 12).map(p => `- ${clip(p, 300)}`).join('\n'));
  }
  if (caseObj.penaMin != null && caseObj.penaMax != null) {
    parts.push(`Faixa de pena de referência: ${caseObj.penaMin} a ${caseObj.penaMax} anos.`);
  }
  return parts.join('\n\n');
}

function describeDebate(messages) {
  const lines = (Array.isArray(messages) ? messages : [])
    .slice(-40)
    .map(m => {
      const who = m.role === 'acusacao' ? 'ACUSAÇÃO' : m.role === 'defesa' ? 'DEFESA' : 'JUIZ';
      return `[${who}] ${clip(m.sender || '', 30)}: ${clip(m.text || '', 800)}`;
    });
  return lines.join('\n') || '(nenhum argumento ainda)';
}

const PERSONA = 'Você é o Dr. Augusto Melo, juiz criminal brasileiro experiente, firme e justo, com um toque de humor seco. Você preside um jogo de debate jurídico entre dois jogadores (Acusação e Defesa). Escreva sempre em português do Brasil.';

function buildPrompt(mode, caseObj, messages, extra = {}) {
  const caso = describeCase(caseObj);
  const debate = describeDebate(messages);

  if (mode === 'assist') {
    const papel = extra.role === 'defesa' ? 'Defesa' : 'Acusação';
    const history = (Array.isArray(extra.history) ? extra.history : []).slice(-8)
      .map(h => ({ role: h.type === 'ai' ? 'assistant' : 'user', content: clip(h.text, 1200) }));
    return {
      json: false,
      maxTokens: 600,
      messages: [
        { role: 'system', content: `Você é um assistente jurídico estratégico e PRIVADO do jogador que joga como ${papel} num jogo de debate penal. Ajude o jogador a PENSAR: aponte artigos, jurisprudência, fraquezas do adversário e perguntas para refletir, mas não escreva o argumento pronto. Seja direto e didático, no máximo 3 parágrafos curtos. Português do Brasil.\n\n${caso}\n\nDEBATE ATÉ AGORA:\n${debate}` },
        ...history,
        { role: 'user', content: clip(extra.question || '', 1500) }
      ]
    };
  }

  if (mode === 'verdict') {
    const pedidos = extra.pedidos || {};
    const recursos = extra.recursos || {};
    const final = Boolean(recursos.acu || recursos.def);
    const recursoTxt = final
      ? `\n\nRECURSO DA ACUSAÇÃO: ${clip(recursos.acu || 'não apresentado', 1200)}\nRECURSO DA DEFESA: ${clip(recursos.def || 'não apresentado', 1200)}`
      : '';
    return {
      json: true,
      maxTokens: 900,
      messages: [
        { role: 'system', content: PERSONA },
        { role: 'user', content: `${caso}\n\nDEBATE:\n${debate}\n\nPEDIDOS — Acusação: ${clip(pedidos.acu || 'não informado', 120)} / Defesa: ${clip(pedidos.def || 'não informado', 120)}${recursoTxt}\n\nDê o ${final ? 'VEREDITO FINAL (após os recursos)' : 'VEREDITO'}. Julgue pela qualidade dos argumentos apresentados pelos jogadores, não só pelos fatos do caso. Responda APENAS com um JSON válido neste formato:\n{"decisao": "CONDENAÇÃO" | "ABSOLVIÇÃO" | "CONDENAÇÃO PARCIAL", "fundamentacao": "3 a 5 frases citando os melhores argumentos de cada lado", "pena": "pena e regime, ou 'não se aplica'", "placar": {"acusacao": 0-10, "defesa": 0-10}, "destaque": "uma frase curta e marcante para encerrar a sessão"}` }
      ]
    };
  }

  // mode === 'judge' — intervenção durante o debate
  return {
    json: true,
    maxTokens: 600,
    messages: [
      { role: 'system', content: PERSONA },
      { role: 'user', content: `${caso}\n\nDEBATE:\n${debate}\n\nIntervenha no debate. Comente brevemente o ponto mais forte e o mais fraco que você viu, e faça UMA pergunta curta e afiada para cada lado. Dê também uma nota parcial de 0 a 10 para cada lado, pela qualidade dos argumentos até agora (0 se o lado ainda não argumentou). Responda APENAS com um JSON válido neste formato:\n{"fala": "sua fala ao tribunal, no máximo 4 frases", "pergunta_acusacao": "...", "pergunta_defesa": "...", "placar": {"acusacao": 0-10, "defesa": 0-10}}` }
    ]
  };
}

// ─── Chamada às IAs ────────────────────────────────────────────────────────

async function callProvider(provider, prompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model: provider.model(),
      messages: prompt.messages,
      max_tokens: prompt.maxTokens,
      temperature: 0.7
    };
    if (prompt.json && provider.jsonMode) body.response_format = { type: 'json_object' };

    const r = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[provider.env]}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 429) cooldownUntil[provider.name] = Date.now() + COOLDOWN_MS;
      const msg = data?.error?.message || data?.[0]?.error?.message || '';
      throw new Error(`${provider.name} ${r.status} ${clip(msg, 200)}`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) throw new Error(`${provider.name} resposta vazia`);
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export function configuredProviders() {
  return PROVIDERS.filter(p => process.env[p.env]);
}

export async function askAnyProvider(prompt) {
  const started = Date.now();
  const errors = [];
  for (const provider of configuredProviders()) {
    if ((cooldownUntil[provider.name] || 0) > Date.now()) { errors.push(`${provider.name} em espera`); continue; }
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 3000) break;
    try {
      const text = await callProvider(provider, prompt, Math.min(PROVIDER_TIMEOUT_MS, remaining));
      return { text, provider: provider.name };
    } catch (e) {
      const reason = e.name === 'AbortError' ? `${provider.name} demorou demais` : e.message;
      console.warn('[judge]', reason);
      errors.push(reason);
    }
  }
  const err = new Error('all_providers_failed');
  err.details = errors;
  throw err;
}

// ─── Interpretação das respostas ───────────────────────────────────────────

// Os modelos às vezes embrulham o JSON em ```json ... ``` ou texto extra.
export function parseLooseJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function clampScore(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null;
}

function readScore(placar) {
  if (!placar) return null;
  const acusacao = clampScore(placar.acusacao);
  const defesa = clampScore(placar.defesa);
  return acusacao == null || defesa == null ? null : { acusacao, defesa };
}

export function shapeResponse(mode, raw, provider) {
  if (mode === 'assist') return { text: raw, provider };

  const data = parseLooseJson(raw);
  if (!data) return { text: raw, provider, placar: null, perguntas_acu: [], perguntas_def: [] };

  if (mode === 'verdict') {
    const decisao = String(data.decisao || '').toUpperCase() || 'DECISÃO';
    const lines = [decisao, '', data.fundamentacao || ''];
    if (data.pena) lines.push('', `Pena: ${data.pena}`);
    if (data.destaque) lines.push('', `“${data.destaque}”`);
    return { text: lines.join('\n').trim(), decisao, pena: data.pena || '', placar: readScore(data.placar), provider };
  }

  return {
    text: data.fala || raw,
    perguntas_acu: data.pergunta_acusacao ? [String(data.pergunta_acusacao)] : [],
    perguntas_def: data.pergunta_defesa ? [String(data.pergunta_defesa)] : [],
    placar: readScore(data.placar),
    provider
  };
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const status = Object.fromEntries(PROVIDERS.map(p => [p.name, Boolean(process.env[p.env])]));
    return res.status(200).json({ ok: true, providers: status });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = typeof req.body === 'string' ? (parseLooseJson(req.body) || {}) : (req.body || {});
  const mode = ['judge', 'verdict', 'assist'].includes(body.mode) ? body.mode : 'judge';
  if (!configuredProviders().length) return res.status(503).json({ error: 'no_providers_configured' });

  try {
    const prompt = buildPrompt(mode, body.caseObj || {}, body.messages || [], body.extra || {});
    const { text, provider } = await askAnyProvider(prompt);
    return res.status(200).json(shapeResponse(mode, text, provider));
  } catch (e) {
    return res.status(503).json({ error: 'all_providers_failed', details: e.details || [e.message] });
  }
}
