// dev-server.js — roda o jogo no seu computador, sem precisar do Vercel.
//   npm run dev  →  http://localhost:3000
// Serve os arquivos estáticos e a função /api/judge, lendo as chaves de .env.local
// (mesmos nomes das variáveis do Vercel: GROQ_KEY, GEMINI_KEY, ...).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { default: judge } = await import('./api/judge.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Imita o objeto `res` do Vercel (status().json()).
function wrapRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/judge') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    return judge(req, wrapRes(res));
  }
  const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || path.basename(file).startsWith('.') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; return res.end('not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  const configured = ['GROQ_KEY', 'GEMINI_KEY', 'CEREBRAS_KEY', 'OPENROUTER_KEY'].filter(k => process.env[k]);
  console.log(`Tribunal do Casal em http://localhost:${PORT}`);
  console.log(configured.length ? `IAs configuradas: ${configured.join(', ')}` : 'Nenhuma chave de IA em .env.local — o juiz local (offline) será usado.');
});
