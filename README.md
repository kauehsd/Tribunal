# Tribunal do Casal — Demo

Versão demo com fallback local do Juiz IA (motor adaptativo). Objetivo: manter a mecânica original do jogo sem que a ausência de quota em APIs externas quebre a experiência.

## Arquivos principais

- `index.html` — frontend mínimo
- `styles.css` — estilos
- `app.js` — lógica do chat, integração com Gemini quando disponível, fallback local
- `judge_local.js` — motor local adaptativo (heurísticas + templates)

## Como usar localmente

Abra `index.html` no navegador (duplo clique) para testar. Para deploy grátis, use GitHub Pages:

1. Crie um repositório no GitHub
2. Adicione estes arquivos e faça push
3. Em Settings → Pages, ative a branch `main` como source

## Chaves de API e fallback

O projeto suporta uma cadeia de fallback de IA para manter o Juiz estável:

1. proxy `/api/judge` (quando configurado)
2. Google Gemini
3. Cerebras (Llama 3.3)
4. Cloudflare AI
5. `LocalJudge` local como fallback final

As chaves podem ser definidas diretamente no código em `index.html` usando as variáveis globais:

- `window.DEFAULT_GEMINI_KEY`
- `window.DEFAULT_CEREBRAS_KEY`
- `window.DEFAULT_CLOUDFLARE_KEY`

Isso permite que o Juiz seja ativado automaticamente no carregamento, sem precisar inserir a chave manualmente a cada vez.

### Recomendação

- Insira sua chave Gemini para ter o melhor veredito.
- Adicione uma chave Cerebras como fallback rápido e gratuito.
- A chave Cloudflare é opcional e aumenta a disponibilidade adicional.

Se nenhuma chave estiver disponível, o código ainda funciona com `judge_local.js`.

## Próximos passos sugeridos

- Integrar Firebase/Supabase para multiplayer (salas, chat em tempo real)
- Implementar função serverless (Vercel/Render) para atuar como proxy seguro para Gemini
- Melhorar `judge_local.js` com regras específicas por caso e geração de texto mais sofisticada

## Esqueleto de função serverless (proxy)

Incluí um esqueleto em `api_judge_skeleton.js` que demonstra como criar um endpoint seguro para rotear pedidos ao Gemini sem expor a chave no cliente.

Para usar (resumo):

1. Copie `api_judge_skeleton.js` para o caminho `api/judge.js` em um projeto Vercel ou Render.
2. Defina a variável de ambiente `GEMINI_KEY` no painel do provedor.
3. No frontend, aponte as requisições para `https://SEU_HOST/api/judge` (POST JSON `{ caseObj, messages }`).

Observações:
- O esqueleto inclui um rate-limit em memória — substitua por controle distribuído (Redis, etc.) em produção.
- Ainda é recomendável ter o `judge_local.js` como fallback quando o proxy responder com erro ou rate-limit.

