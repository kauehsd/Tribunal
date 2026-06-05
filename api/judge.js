// server.js — Backend Express para o Render
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const SYSTEM = `Você é Dr. Augusto Melo, Juiz de Direito experiente em Direito Penal Brasileiro.

Analise o debate entre Acusação e Defesa e responda SEMPRE neste formato exato:

## PERGUNTAS DO JUIZ
**Para a Acusação:** [pergunta direta e técnica]
**Para a Defesa:** [pergunta direta e técnica]

## ANÁLISE
[2-3 parágrafos avaliando os argumentos de cada lado com base nos artigos do CP. Seja técnico e cite artigos específicos.]

## PLACAR PARCIAL
Acusação: [0-10] pontos
Defesa: [0-10] pontos
Justificativa: [1 frase explicando o placar]

## VEREDITO PRELIMINAR
[ACUSAÇÃO VENCE / DEFESA VENCE / EMPATE] — [motivo técnico em 1 frase]

Seja incisivo, justo e educativo. Nunca favoreça um lado sem argumentos técnicos.`;

function buildDebate(caseObj, messages) {
  const title = caseObj?.titulo || 'Caso genérico';
  const ctx = caseObj?.context_juiz || caseObj?.corpo || '';
  const debate = (messages || [])
    .map(m => `${m.sender || m.role || 'Usuário'}: ${m.text || m.content || ''}`)
    .join('\n') || 'Nenhum argumento ainda.';
  return `CASO: ${title}\n${ctx}\n\nDEBATE ATUAL:\n${debate}\n\nAnalise este debate e responda no formato solicitado, incluindo o PLACAR PARCIAL baseado na qualidade técnica dos argumentos apresentados.`;
}

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

app.post('/api/judge', async (req, res) => {
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
});

app.post('/api/recurso', async (req, res) => {
  const { caseObj, messages, recursoAcu, recursoDef } = req.body || {};

  const recursoPrompt = `Você é Dr. Augusto Melo. As partes interpuseram recurso após o veredito preliminar.

ARGUMENTO DE RECURSO DA ACUSAÇÃO: ${recursoAcu || 'Sem recurso da acusação.'}
ARGUMENTO DE RECURSO DA DEFESA: ${recursoDef || 'Sem recurso da defesa.'}

Analise os novos argumentos e emita o VEREDITO FINAL no formato:

## VEREDITO FINAL
[ACUSAÇÃO VENCE / DEFESA VENCE / EMPATE]

## FUNDAMENTAÇÃO
[2 parágrafos: avalie os recursos com base nos artigos do CP. Qual lado trouxe argumento novo e relevante?]

## PLACAR FINAL
Acusação: [0-10] pontos
Defesa: [0-10] pontos

## SENTENÇA SUGERIDA
[1 parágrafo com a pena sugerida e regime, baseado no debate completo]`;

  const groqKey = process.env.GROQ_KEY;
  if (groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: recursoPrompt }],
          max_tokens: 800, temperature: 0.7
        })
      });
      const data = await r.json();
      if (r.ok) {
        const text = data?.choices?.[0]?.message?.content;
        if (text) return res.json({ text, final: true });
      }
    } catch (e) { console.warn('[recurso] groq failed:', e.message); }
  }

  const cerebrasKey = process.env.CEREBRAS_KEY;
  if (cerebrasKey) {
    try {
      const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cerebrasKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b',
          messages: [{ role: 'user', content: recursoPrompt }],
          max_tokens: 800, temperature: 0.7
        })
      });
      const data = await r.json();
      if (r.ok) {
        const text = data?.choices?.[0]?.message?.content;
        if (text) return res.json({ text, final: true });
      }
    } catch (e) { console.warn('[recurso] cerebras failed:', e.message); }
  }

  return res.status(503).json({ error: 'recurso_failed' });
});

app.get('/', (req, res) => res.send('Tribunal do Casal — API online ✅'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));