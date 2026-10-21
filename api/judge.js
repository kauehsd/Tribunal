// api/judge.js — Vercel Serverless Function: todos os personagens de IA do tribunal
//
// Todas as IAs aqui têm plano gratuito. O servidor tenta uma de cada vez, na
// ordem de PROVIDERS; se uma falhar (sem chave, limite atingido, fora do ar,
// demorou demais), passa para a próxima. Se todas falharem, responde 503 e o
// frontend usa o motor local (ai-bridge.js / judge_local.js).
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   GROQ_KEY        https://console.groq.com/keys
//   GEMINI_KEY      https://aistudio.google.com/app/apikey
//   CEREBRAS_KEY    https://cloud.cerebras.ai
//   OPENROUTER_KEY  https://openrouter.ai/settings/keys
// Opcional: GROQ_MODEL, GEMINI_MODEL, CEREBRAS_MODEL, OPENROUTER_MODEL para trocar o modelo.
//
// POST /api/judge        { mode, caseObj, messages, extra }  (modos em MODES, abaixo)
// GET  /api/judge        → quais IAs estão configuradas (sem mostrar as chaves)
// GET  /api/judge?diag=1 → testa cada IA de verdade e diz qual funciona

import { MODES, PERSONA_JUIZ } from './_prompts.js';

const PROVIDERS = [
  {
    name: 'groq',
    env: 'GROQ_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
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

const PROVIDER_TIMEOUT_MS = 20000;
const TOTAL_BUDGET_MS = 56000;
const COOLDOWN_MS = 60000;

// Quando uma IA responde "limite atingido" (429), pulamos ela por 1 minuto.
// Fica só na memória da instância — é um atalho, não uma garantia.
const cooldownUntil = {};

function clip(value, max) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ─── Chamada às IAs ────────────────────────────────────────────────────────

async function callProvider(provider, prompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const model = provider.model();
    const body = {
      model,
      messages: prompt.messages,
      max_tokens: prompt.maxTokens,
      temperature: prompt.temperature ?? 0.7
    };
    if (prompt.json && provider.jsonMode) body.response_format = { type: 'json_object' };
    // Modelos que "pensam" antes de responder gastam tokens nisso: pensamento curto e margem extra
    if (/gpt-oss/.test(model)) { body.reasoning_effort = 'low'; body.max_tokens += 800; }
    if (provider.name === 'openrouter') { body.max_tokens += 800; body.reasoning = { effort: 'low' }; }

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

// Tenta as IAs em ordem. Se a resposta precisa ser JSON e veio quebrada, tenta a próxima.
export async function askAnyProvider(prompt, validate = () => true) {
  const started = Date.now();
  const errors = [];
  for (const provider of configuredProviders()) {
    if ((cooldownUntil[provider.name] || 0) > Date.now()) { errors.push(`${provider.name} em espera`); continue; }
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 3000) break;
    try {
      const text = await callProvider(provider, prompt, Math.min(prompt.timeoutMs || PROVIDER_TIMEOUT_MS, remaining));
      if (!validate(text)) throw new Error(`${provider.name} respondeu fora do formato`);
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

// Os modelos às vezes embrulham o JSON em ```json ... ``` ou texto extra.
export function parseLooseJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

async function diagnose() {
  const results = {};
  for (const p of PROVIDERS) {
    if (!process.env[p.env]) { results[p.name] = 'sem chave'; continue; }
    const t0 = Date.now();
    try {
      await callProvider(p, { messages: [{ role: 'user', content: 'Responda apenas: ok' }], maxTokens: 60, json: false }, 15000);
      results[p.name] = `ok (${Date.now() - t0}ms, modelo ${p.model()})`;
    } catch (e) {
      results[p.name] = e.name === 'AbortError' ? 'demorou demais' : `erro: ${e.message} (modelo ${p.model()})`;
    }
  }
  return results;
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const wantsDiag = String(req.url || '').includes('diag=1') || req.query?.diag === '1';
    if (wantsDiag) return res.status(200).json({ ok: true, diagnostico: await diagnose() });
    const status = Object.fromEntries(PROVIDERS.map(p => [p.name, Boolean(process.env[p.env])]));
    return res.status(200).json({ ok: true, providers: status, modos: Object.keys(MODES) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = typeof req.body === 'string' ? (parseLooseJson(req.body) || {}) : (req.body || {});
  const mode = MODES[body.mode] ? body.mode : 'judge';
  if (!configuredProviders().length) return res.status(503).json({ error: 'no_providers_configured' });

  const spec = MODES[mode];
  try {
    const prompt = spec.build(body.caseObj || {}, body.messages || [], body.extra || {});
    const validate = prompt.json ? (t => { const d = parseLooseJson(t); return Boolean(d) && (!spec.validate || spec.validate(d)); }) : undefined;
    const { text, provider } = await askAnyProvider(prompt, validate);
    const data = prompt.json ? parseLooseJson(text) : text;
    return res.status(200).json({ ...spec.shape(data, body.extra || {}), provider });
  } catch (e) {
    return res.status(503).json({ error: 'all_providers_failed', details: e.details || [e.message] });
  }
}

export { PERSONA_JUIZ };
