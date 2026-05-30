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

## Chave Gemini (opcional)

Se você tiver uma chave Google Gemini válida, cole-a no campo do topo. O frontend tentará usar a API. Se a chave estiver ausente ou sem quota, o sistema usa o `LocalJudge` como fallback.

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

