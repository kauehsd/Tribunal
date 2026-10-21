// ai-bridge.js — ponto único de acesso às IAs.
// Tenta o servidor (/api/judge, com fila de IAs gratuitas). Se nada responder,
// cada personagem tem um "plano B" local, para a partida nunca travar.
import { LocalJudge } from './judge_local.js';
import { callJudgeApi } from './modules/ai_client.js';

// extra.localMsgs = [{ role, text }] — as falas das partes, para o motor local pontuar
function localScore(msgs = [], max = 10) {
  const s = LocalJudge.scoreMessages(msgs);
  const norm = v => Math.round(max * v / (v + 30));
  return { acusacao: norm(s.acusacao), defesa: norm(s.defesa) };
}

function words(text) {
  return new Set(String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{5,}/g) || []);
}

const LOCAL = {
  recebimento: (c, x) => ({
    text: 'Presentes os requisitos do Art. 41 do CPP, recebo a denúncia. As teses da defesa dependem de prova e serão analisadas após a instrução. Designo audiência de instrução e julgamento.',
    em_resumo: 'A acusação foi aceita e o processo segue: agora vamos ouvir as testemunhas.',
    pontos: localScore(x.localMsgs, 5)
  }),

  testemunha: (c, x) => {
    const t = x.testemunha || {};
    const q = words(x.pergunta);
    // revela um segredo se a pergunta tiver palavras em comum com ele
    const segredo = (t.segredos || []).find(s => [...words(s)].filter(w => q.has(w)).length >= 2);
    return {
      text: segredo ? `(hesita) ... Bom, já que perguntou: ${segredo}` : `Como eu já disse: ${t.depoimento || 'não sei de mais nada.'}`,
      revelou_segredo: Boolean(segredo),
      tom: segredo ? 'nervoso' : 'calmo'
    };
  },

  protesto: (c, x) => {
    const indutiva = /^(n[aã]o [eé] verdade|o senhor confirma|a senhora confirma|n[aã]o [eé] fato)/i.test(String(x.pergunta || '').trim());
    const deferido = (x.motivo === 'indutiva' && indutiva) || x.motivo === 'ofensiva';
    return {
      decisao: deferido ? 'deferido' : 'indeferido',
      text: deferido ? 'Deferido. A pergunta não será respondida; reformule, doutor(a).' : 'Indeferido. A pergunta é pertinente; a testemunha pode responder.',
      em_resumo: deferido ? 'O juiz concordou com o protesto: essa pergunta não vale.' : 'O juiz achou a pergunta válida: a testemunha vai responder.'
    };
  },

  diligencia: (c, x) => {
    const idx = (x.fatos_ocultos || []).length ? 0 : -1;
    return {
      deferida: true,
      text: idx >= 0 ? x.fatos_ocultos[0] : 'A diligência foi realizada, mas não trouxe elementos novos.',
      fato_usado: idx,
      em_resumo: 'O juiz autorizou a investigação extra e o resultado agora faz parte do processo.'
    };
  },

  pronuncia: (c, x) => {
    const fala = (x.localMsgs || []).filter(m => m.role === 'defesa').map(m => m.text).join(' ');
    const desclassifica = c.id === '06' && /culpos|302|desclassific/i.test(fala);
    return {
      decisao: desclassifica ? 'desclassificacao' : 'pronuncia',
      text: desclassifica
        ? 'Não há prova segura de que o réu assumiu o risco de matar. Desclassifico para homicídio culposo de trânsito (Art. 302 do CTB) e remeto ao juízo singular.'
        : 'Há prova da materialidade e indícios suficientes de autoria. Pronuncio o réu, que será submetido a julgamento pelo Tribunal do Júri.',
      crime: desclassifica ? 'homicídio culposo na direção de veículo (Art. 302 CTB)' : 'homicídio (Art. 121 CP)',
      em_resumo: desclassifica ? 'O caso não vai a Júri: o juiz entendeu que não houve intenção de matar.' : 'O caso vai para o Júri Popular: 7 cidadãos vão decidir.',
      pontos: localScore(x.localMsgs, 5)
    };
  },

  sentenca: (c, x) => {
    const v = LocalJudge.formatVerdict(c, LocalJudge.scoreMessages(x.localMsgs || []));
    return {
      decisao: v.nome_resultado,
      text: v.fundamentacao,
      dosimetria: v.resultado === 'defesa' ? null : { fase1: `Pena-base no mínimo legal (${c.penaMin} ano(s)).`, fase2: 'Sem agravantes relevantes.', fase3: 'Sem causas de aumento.', pena_final: v.pena, regime: 'aberto, com substituição por penas restritivas de direitos, se cabível' },
      em_resumo: v.resultado === 'defesa' ? 'O réu foi absolvido: as provas não foram suficientes.' : 'O réu foi condenado, mas com pena baixa.',
      pontos: localScore(x.localMsgs, 10),
      melhor_momento_acusacao: '', melhor_momento_defesa: ''
    };
  },

  juri: (c, x) => {
    const p = localScore(x.localMsgs, 10);
    const condenam = Math.max(0, Math.min(7, 4 + Math.round((p.acusacao - p.defesa) / 2)));
    const votos = (x.jurados || []).slice(0, 7).map((j, i) => ({ nome: j.nome, voto: i < condenam ? 'condena' : 'absolve', pensamento: i < condenam ? 'As provas me convenceram.' : 'Fiquei com dúvida.' }));
    const resultado = condenam >= 4 ? 'condenacao' : 'absolvicao';
    return {
      votos, resultado, decisao: resultado === 'condenacao' ? 'CONDENAÇÃO' : 'ABSOLVIÇÃO',
      text: `O Conselho de Sentença, por ${Math.max(condenam, 7 - condenam)} votos a ${Math.min(condenam, 7 - condenam)}, ${resultado === 'condenacao' ? 'condenou' : 'absolveu'} o acusado.`,
      dosimetria: resultado === 'condenacao' ? { fase1: `Pena-base de ${c.penaMin} anos.`, fase2: '—', fase3: '—', pena_final: `${c.penaMin} anos de reclusão`, regime: c.penaMin > 8 ? 'fechado' : 'semiaberto' } : null,
      em_resumo: resultado === 'condenacao' ? 'Os jurados decidiram que o réu é culpado.' : 'Os jurados decidiram absolver o réu.',
      pontos: p, melhor_momento_acusacao: '', melhor_momento_defesa: ''
    };
  },

  acordao: (c, x) => ({
    votos: (x.desembargadores || []).map((d, i) => ({ nome: d.nome, papel: d.papel, voto: i === 0 ? 'provido' : 'desprovido', fundamento: i === 0 ? 'As razões do apelante merecem acolhida.' : 'A sentença está bem fundamentada e deve ser mantida.' })),
    resultado: 'desprovido',
    text: 'Por maioria, negaram provimento ao recurso. Sentença mantida.',
    em_resumo: 'O tribunal manteve a decisão do juiz (2 votos a 1).',
    pontos: localScore(x.localMsgs, 10)
  }),

  acordo: () => ({
    homologado: true,
    text: 'Presentes os requisitos do Art. 28-A do CPP e sendo as condições adequadas e suficientes, homologo o acordo.',
    em_resumo: 'O juiz aprovou o acordo: não haverá processo se o réu cumprir as condições.',
    pontos: { acusacao: 6, defesa: 6 }
  }),

  oponente: (c, x) => {
    const acu = x.papel === 'acusacao';
    const t = {
      denuncia: `O Ministério Público denuncia o réu pelos fatos narrados, que se amoldam a ${c.arts_rapidos?.[0] || 'tipo penal do caso'}. Há prova da materialidade e indícios de autoria. Requer o recebimento da denúncia e a condenação.`,
      resposta: `A defesa nega a acusação e sustenta ${c.arts_rapidos?.[1] || 'a ausência de provas suficientes'}. Requer a absolvição e, subsidiariamente, a pena mínima.`,
      pergunta: 'O(a) senhor(a) pode contar exatamente o que viu naquela noite?',
      alegacao: acu ? 'As provas são claras: materialidade e autoria demonstradas. Peço a condenação.' : 'Há dúvida razoável em pontos essenciais. In dubio pro reo: peço a absolvição.',
      replica: acu ? 'A defesa não conseguiu desconstruir as provas técnicas.' : 'A acusação se apega a suposições, não a provas.',
      apelacao: acu ? 'A sentença ignorou provas centrais. Peço a reforma.' : 'A sentença desconsiderou a dúvida razoável. Peço a reforma.',
      contrarrazoes: 'A sentença está correta e bem fundamentada. Peço que seja mantida.',
      acordo_proposta: 'Prestação de serviços à comunidade por 6 meses e reparação integral do dano.',
      acordo_resposta: 'A defesa prefere provar a inocência em juízo.'
    };
    return {
      text: t[x.tarefa] || t.replica,
      pedido: acu ? `condenação a ${c.penaMin} ano(s)` : 'absolvição',
      testemunha_id: x.testemunhas?.[0]?.id || '',
      aceita: x.tarefa === 'acordo_proposta'
    };
  },

  assist: (c, x) => ({
    text: `(Assistente offline: a IA não respondeu, então seguem dicas automáticas.)\n\n${LocalJudge.gerarSugestaoTatica(c, x.localMsgs || [], x.role).join('\n')}`
  })
};

// Chama um personagem. Nunca lança erro: se a IA falhar, usa o plano B local.
// → objeto do modo + provider ('groq', 'gemini', ... ou 'local')
export async function ask(mode, caseObj, extra = {}) {
  const { localMsgs, ...payload } = extra;
  try {
    return await callJudgeApi(mode, { caseObj, extra: payload });
  } catch (e) {
    console.warn(`[${mode}] IA indisponível, usando plano B local:`, e.message || e);
    const fallback = LOCAL[mode] || LOCAL.assist;
    return { ...fallback(caseObj || {}, extra), provider: 'local' };
  }
}
