// modules/game.js — o processo em fases:
//   sorteio → acordo → denúncia → instrução → (pronúncia) → debates → julgamento → recurso → fim
//
// Tudo o que acontece fica na sala do Firebase (rooms/{código}). Cada aparelho:
//   1. escuta a sala inteira e redesenha a tela (render)
//   2. roda o "piloto automático" (autopilot): quando chega a hora de um personagem de IA
//      falar (juiz, testemunha, jurados, desembargadores, roteirista ou o rival do modo treino),
//      um dos aparelhos pega a trava `judge_busy` e faz a chamada — nunca os dois ao mesmo tempo.
import { ask } from '../ai-bridge.js';
import { CASES } from '../data/cases.js';
import { DOSSIES, JURADOS, DESEMBARGADORES } from '../data/dossies.js';
import { pickTema } from '../data/temas.js';
import { applyGlossary } from '../data/glossario.js';
import { $, escapeHtml, nl2br, toast, playSound, vibrate, ROLE_LABEL, ROLE_ICON, otherRole, fmtClock, saveDraft, loadDraft, clearDraft, autoGrow, moderate, slug } from './util.js';
import { computeResult, saveCareer, careerCardHtml } from './career.js';

export const G = { db:null, roomRef:null, code:'', room:null, me:{ name:'', role:'' }, serverOffset:0, onCase:null };

const PROTEST_WINDOW_MS = 9000;     // tempo que o adversário tem para gritar "Protesto!"
const LOCK_MS = 80000;              // trava da IA expira sozinha se um aparelho cair no meio
const STALE_MS = 30000;             // se quem deveria agir sumiu, o outro aparelho assume
const MAX_PROTESTOS = 3;
const MAX_CONTRADICOES = 2;
const MAX_QO = 3;                   // questões de ordem por lado, por caso
const PECAS_FISCAIS = ['denuncia', 'resposta', 'alegacao', 'apelacao', 'contrarrazoes'];
const LIMITE_PERGUNTAS = { estagiario:5, advogado:4, jurista:4 };
const AI_PERGUNTAS = 2;             // perguntas do rival no modo treino
const ASSIST_LIMITE = { estagiario:Infinity, advogado:5, jurista:0 };

export const TURNOS = [
  { role:'acusacao', tipo:'alegacao', seg:180, titulo:'Alegações finais da Acusação' },
  { role:'defesa', tipo:'alegacao', seg:180, titulo:'Alegações finais da Defesa' },
  { role:'acusacao', tipo:'replica', seg:90, titulo:'Réplica da Acusação' },
  { role:'defesa', tipo:'treplica', seg:90, titulo:'Tréplica da Defesa' }
];

export const FASES = {
  sorteio: { nome:'Sorteio', icon:'🎲', o_que:'O caso é sorteado entre os que vocês ainda não jogaram.' },
  acordo: { nome:'Acordo', icon:'🤝', o_que:'Antes de o processo começar, a Acusação pode oferecer um acordo (ANPP) em crimes sem violência com pena mínima menor que 4 anos: o réu confessa, cumpre condições e o processo nem começa.', acusacao:'Decida se oferece um acordo e com quais condições. Condições firmes e justas valem pontos.', defesa:'Se vier uma proposta, decida: aceitar e encerrar o caso, ou arriscar o julgamento.' },
  denuncia: { nome:'Denúncia', icon:'📜', o_que:'A Acusação apresenta a denúncia: conta o que aconteceu, diz qual é o crime e pede a condenação. A Defesa responde apontando falhas e teses. O juiz decide se o processo segue.', acusacao:'Narre o fato, diga qual é o crime (com o artigo) e peça a condenação.', defesa:'Leia a denúncia e responda: aponte provas fracas, nulidades e a sua tese.' },
  instrucao: { nome:'Instrução', icon:'🎙️', o_que:'A audiência: testemunhas, vítima, perito e, por último, o réu são ouvidos. Vocês perguntam diretamente (Art. 212 CPP). O adversário pode protestar, e quem pegar uma testemunha em contradição ganha pontos.', acusacao:'Arranque das testemunhas o que prova a culpa. Perguntas certeiras revelam segredos (+2) e contradições valem +3.', defesa:'Mostre contradições e dúvidas. Proteste contra perguntas que induzem a resposta.' },
  pronuncia: { nome:'Pronúncia', icon:'🔨', o_que:'Nos crimes contra a vida, o juiz decide se o caso vai ao Júri Popular (7 cidadãos comuns) ou se o crime é outro, julgado por ele mesmo.' },
  debates: { nome:'Debates', icon:'🗣️', o_que:'As alegações finais: cada lado tem um tempo para resumir as provas e convencer quem vai julgar. Depois vêm a réplica e a tréplica.', acusacao:'Junte tudo o que foi provado e faça o seu pedido de pena.', defesa:'Mostre as dúvidas e peça a absolvição (ou a pena mínima).' },
  julgamento: { nome:'Julgamento', icon:'⚖️', o_que:'O juiz dá a sentença — ou, no Júri, os 7 jurados votam e o juiz calcula a pena.' },
  recurso: { nome:'Recurso', icon:'🏛️', o_que:'Quem perdeu pode apelar ao Tribunal de Justiça. Três desembargadores, cada um com seu jeito de pensar, revisam a sentença e votam.' },
  fim: { nome:'Fim', icon:'🏁', o_que:'O processo terminou. Veja o placar, as conquistas e a sua carreira.' }
};

const MOTIVOS_PROTESTO = [
  { id:'indutiva', label:'Indutiva', desc:'já sugere a resposta' },
  { id:'impertinente', label:'Fora do caso', desc:'não tem a ver com os fatos' },
  { id:'repetida', label:'Repetida', desc:'já foi respondida' },
  { id:'especulativa', label:'Pede opinião', desc:'testemunha não especula' },
  { id:'ofensiva', label:'Ofensiva', desc:'constrange a testemunha' },
  { id:'premissa', label:'Premissa falsa', desc:'afirma fato fora dos autos' }
];

// ══════════════════════════════════════════════════════
// Acesso ao estado
// ══════════════════════════════════════════════════════
const now = () => Date.now() + G.serverOffset;
const TS = () => firebase.database.ServerValue.TIMESTAMP;
const me = () => G.me.role;
const caseOf = room => room.caseData || {};
const dossieOf = room => room.caseData?.dossie || { testemunhas:[], reviravoltas:[], fatos_ocultos:[] };
const aiRole = room => room.solo && me() ? otherRole(me()) : null;
const isAI = (room, role) => Boolean(room.solo) && role === aiRole(room);
const nameOf = (room, role) => isAI(room, role) ? 'IA' : (room.players?.[role]?.name || ROLE_LABEL[role]);
const nivelOf = (room, role) => room.players?.[role]?.nivel || 'advogado';
const witnessOf = (room, id) => dossieOf(room).testemunhas.find(t => t.id === id);
const autosList = room => Object.entries(room.autos || {}).map(([k, v]) => ({ key:k, ...v }));
const twistsOf = room => { const d = dossieOf(room); return d.reviravoltas?.length ? d.reviravoltas : [d.reviravolta].filter(Boolean); };

export function roleOf(room, name){
  return ['acusacao', 'defesa'].find(r => room?.players?.[r]?.name === name) || '';
}

// Estado de um caso novo (chamado no sorteio). caseData = caso + dossiê
function caseState(caseData){
  const d = caseData.dossie;
  const phase = d.acordo ? 'acordo' : 'denuncia';
  return {
    caseData, rito: d.rito, phase,
    acordo: d.acordo ? { status:'proposta' } : null,
    score: { acusacao:0, defesa:0 },
    cartas: { acusacao:{ diligencia:1, pergunta:1, tempo:1 }, defesa:{ diligencia:1, pergunta:1, tempo:1 } },
    // chave que ordena antes de qualquer push do Firebase: a faixa da primeira fase abre os autos
    autos: { '-0000inicio': { tipo:'fase', fase: phase, por:'sistema', ts:0 } },
    reveal: now()
  };
}

// Tudo o que é zerado ao começar outro caso na mesma sala
export const CLEAR_CASE = {
  caseData:null, rito:null, acordo:null, score:null, cartas:null, autos:null, pecas:null, recebimento:null,
  instrucao:null, pronuncia:null, debates:null, julgamento:null, recurso:null, final:null, judge_busy:null,
  fatosRevelados:null, assistUses:null, ia_chat_acusacao:null, ia_chat_defesa:null, reveal:null,
  fiscal:null, desconsiderados:null, qo:null, impugnacoes:null
};

// ══════════════════════════════════════════════════════
// Escrita no Firebase
// ══════════════════════════════════════════════════════
function pushAuto(entry){ return G.roomRef.child('autos').push({ ...entry, ts: TS() }); }

// Peças com afirmações de fato passam pelo fiscal dos autos antes de qualquer decisão
async function pushPeca(entry){
  const ref = await pushAuto(entry);
  await G.roomRef.child(`fiscal/${ref.key}`).set(true);
  return ref;
}

async function addScore(points){
  if(!points) return;
  await G.roomRef.child('score').transaction(s => {
    s = s || { acusacao:0, defesa:0 };
    s.acusacao = (s.acusacao || 0) + (points.acusacao || 0);
    s.defesa = (s.defesa || 0) + (points.defesa || 0);
    return s;
  });
}

// Muda de fase só se ainda estivermos na fase esperada (os dois aparelhos podem tentar ao mesmo tempo)
// Os dados da nova fase são gravados ANTES da troca, para nenhum aparelho ver a fase nova sem os dados dela.
// (As transições com dados acontecem sob a trava da IA, então não há dois aparelhos fazendo isso ao mesmo tempo.)
async function setPhase(from, to, updates = {}){
  if(Object.keys(updates).length){
    if((await G.roomRef.child('phase').once('value')).val() !== from) return false;
    await G.roomRef.update(updates);
  }
  const tx = await G.roomRef.child('phase').transaction(p => p === from ? to : undefined);
  if(!tx.committed) return false;
  await pushAuto({ tipo:'fase', fase:to, por:'sistema' });
  return true;
}

let localBusy = false;
// Executa uma ação de IA com a trava da sala. fn recebe o estado mais recente da sala.
async function withLock(label, fn){
  if(localBusy) return false;
  localBusy = true;
  const ref = G.roomRef.child('judge_busy');
  try{
    const tx = await ref.transaction(v => (v && now() - (v.ts || 0) < LOCK_MS) ? undefined : { ts: now(), label, by: me() || 'sorteio' });
    if(!tx.committed) return false;
    try{
      const room = (await G.roomRef.once('value')).val();
      await fn(room);
    }finally{
      await ref.remove();
    }
    return true;
  }catch(e){
    console.error('[withLock]', label, e);
    toast('Algo deu errado: ' + (e.message || e));
    return false;
  }finally{
    localBusy = false;
  }
}

// ══════════════════════════════════════════════════════
// SORTEIO DO CASO — sem repetir para o mesmo casal
// ══════════════════════════════════════════════════════
function pairKey(room){
  const names = Object.values(room.lobby || {}).map(p => slug(p.name)).sort();
  return (room.solo ? 'solo+' : '') + names.join('+');
}

// Só entram no sorteio crimes graves (pena máxima de 10 anos ou mais). Os casos leves continuam
// no código, mas não são sorteados; o tutorial só aparece quando pedido ao criar a sala.
const casosGraves = jogados => CASES.filter(c => !c.tutorial && c.penaMax >= 10 && !jogados[c.id]);

async function gerarCasoInedito(histRef, hist){
  const tema = pickTema(hist.temas || []);
  const r = await ask('gerar_caso', {}, { tema, evitar: Object.values(hist.casos || {}).map(j => j.titulo) });
  if(!r.caso) return null;
  await histRef.child('temas').transaction(t => [...(t || []), tema].slice(-60));
  return r.caso;
}

async function sortearCaso(room){
  if(room.phase !== 'sorteio') return;
  const histRef = G.db.ref(`history/${pairKey(room)}`);
  const hist = (await histRef.once('value')).val() || {};
  const jogados = hist.casos || {};
  const prontos = casosGraves(jogados);

  let caseData = null;
  if(room.tutorial && !jogados['00']){
    const c = CASES.find(x => x.tutorial);
    caseData = { ...c, dossie: DOSSIES[c.id] };
  } else if(prontos.length){
    const c = prontos[Math.floor(Math.random() * prontos.length)];
    caseData = { ...c, dossie: DOSSIES[c.id] };
  } else if(hist.proximo?.caso){
    // a IA já escreveu este caso em segundo plano durante a partida anterior
    caseData = hist.proximo.caso;
    await histRef.child('proximo').remove();
  } else {
    caseData = await gerarCasoInedito(histRef, hist);
    if(!caseData){
      // sem IA no momento: repete o caso grave jogado há mais tempo (melhor do que travar)
      const antigo = Object.entries(jogados).sort((a, b) => a[1].ts - b[1].ts).map(([id]) => CASES.find(c => c.id === id && c.penaMax >= 10)).find(Boolean) || CASES.find(c => c.id === '02');
      caseData = { ...antigo, dossie: DOSSIES[antigo.id] };
      toast('A IA não respondeu para criar um caso novo. Sorteamos um caso já jogado.');
    }
  }

  // papéis: na primeira rodada, cara ou coroa; depois, os papéis já vêm trocados de "Próximo caso"
  let players = room.players;
  if(!players?.acusacao && !players?.defesa){
    const [a, b] = Object.values(room.lobby || {});
    const flip = Math.random() < 0.5;
    players = room.solo ? { [flip ? 'acusacao' : 'defesa']: a } : { acusacao: flip ? a : b, defesa: flip ? b : a };
  }
  await histRef.child(`casos/${caseData.id}`).set({ titulo: caseData.titulo, ts: Date.now() });
  const st = caseState(caseData);
  const tx = await G.roomRef.child('phase').transaction(p => p === 'sorteio' ? st.phase : undefined);
  if(!tx.committed) return;
  await G.roomRef.update({ ...st, players });
}

// Enquanto vocês jogam, a IA já escreve o PRÓXIMO caso (se não houver mais casos prontos inéditos),
// para o sorteio seguinte não ter espera. Só um aparelho faz isso, uma vez por carregamento.
let preGenTried = false;
async function preGerarProximo(room){
  if(preGenTried) return;
  preGenTried = true;
  try{
    const histRef = G.db.ref(`history/${pairKey(room)}`);
    const hist = (await histRef.once('value')).val() || {};
    if(hist.proximo?.caso || casosGraves(hist.casos || {}).length > 0) return;
    const tx = await histRef.child('gerando').transaction(v => (v && Date.now() - v < 180000) ? undefined : Date.now());
    if(!tx.committed) return;
    const caso = await gerarCasoInedito(histRef, hist);
    if(caso) await histRef.child('proximo').set({ caso, ts: Date.now() });
    await histRef.child('gerando').remove();
  }catch(e){ console.warn('[pré-geração]', e); }
}

// ══════════════════════════════════════════════════════
// Contexto para a IA
// ══════════════════════════════════════════════════════
const PECA_NOME = { denuncia:'DENÚNCIA', resposta:'RESPOSTA À ACUSAÇÃO', alegacao:'ALEGAÇÕES FINAIS', replica:'RÉPLICA', treplica:'TRÉPLICA', apelacao:'APELAÇÃO', contrarrazoes:'CONTRARRAZÕES', acordo_proposta:'PROPOSTA DE ACORDO', acordo_resposta:'RESPOSTA AO ACORDO' };

function autoLine(a){
  const quem = ROLE_LABEL[a.por] || a.por;
  switch(a.tipo){
    case 'fase': return `— fase: ${a.fase} —`;
    case 'depoimento': return `[DEPOIMENTO de ${a.nome}] ${ROLE_LABEL[a.por]} perguntou: "${a.pergunta}" — Resposta: "${a.resposta}"${a.revelou ? ' (revelou fato novo)' : ''}`;
    case 'protesto': return `[PROTESTO da ${ROLE_LABEL[a.protestoPor]} contra pergunta da ${ROLE_LABEL[a.por]} a ${a.nome}: "${a.pergunta}"] Motivo: ${a.motivo}. Decisão: ${a.decisao} — ${a.texto}`;
    case 'contradicao': return `[CONTRADIÇÃO apontada pela ${quem} no depoimento de ${a.nome}: "${a.alegacao}"] Juiz: ${a.procede ? 'PROCEDE' : 'NÃO PROCEDE'} — ${a.texto}`;
    case 'diligencia': return `[DILIGÊNCIA pedida pela ${quem}: "${a.pedido}"] Resultado: ${a.texto}`;
    case 'reviravolta': return `[FATO NOVO NOS AUTOS — ${a.titulo}] ${a.texto}`;
    case 'alegacao': return `[${PECA_NOME[a.subtipo] || 'ALEGAÇÕES'} — ${quem}] ${a.texto}${a.pedido ? ` (Pedido: ${a.pedido})` : ''}`;
    case 'sentenca': case 'juri': return `[${a.tipo === 'juri' ? 'VEREDITO DO JÚRI' : 'SENTENÇA'}] ${a.decisao}: ${a.texto}${a.dosimetria?.pena_final ? ` Pena: ${a.dosimetria.pena_final}, regime ${a.dosimetria.regime}` : ''}`;
    case 'acordao': return `[ACÓRDÃO] ${a.resultado}: ${a.texto}`;
    case 'advertencia': return `[ADVERTÊNCIA DO JUIZ à ${ROLE_LABEL[a.alvo]} (${a.nivel}ª): ${(a.violacoes || []).map(v => `${ROLE_LABEL[a.alvo]} afirmou sem base nos autos "${v.trecho}" (${v.tipo.replace('_', ' ')}) — DESCONSIDERADO`).join('; ')}. ${a.nivel >= 3 ? 'Litigância de má-fé reconhecida.' : ''}]`;
    case 'questao_ordem': return `[QUESTÃO DE ORDEM da ${quem} contra a ${ROLE_LABEL[a.alvo]}: "${a.alegacao}"] Juiz: ${a.procede ? `PROCEDE — trecho "${a.trecho}" desconsiderado` : 'NÃO PROCEDE'} — ${a.texto}`;
    case 'nota': return `[${a.texto}]`;
    default:
      if(PECA_NOME[a.tipo]) return `[${PECA_NOME[a.tipo]} — ${quem}] ${a.texto}`;
      return `[${a.titulo || 'JUIZ'}] ${a.texto || ''}`;
  }
}

// Tira das peças os trechos que o juiz desconsiderou (fiscal ou questão de ordem), para nenhuma
// IA levá-los em conta depois — nem o juiz na sentença, nem os jurados, nem os desembargadores.
function semTrechosDesconsiderados(room, a){
  const trechos = room.desconsiderados?.[a.key];
  if(!trechos || !a.texto) return a;
  let texto = a.texto;
  for(const t of Object.values(trechos)) texto = texto.split(t).join('[trecho desconsiderado pelo juiz]');
  return { ...a, texto };
}

function aiContext(room){
  const autos = autosList(room).filter(a => a.tipo !== 'fase').map(a => semTrechosDesconsiderados(room, a));
  const d = dossieOf(room);
  return {
    // fatos verdadeiros que cada lado sabia em sigilo: citá-los não é "inventar"
    segredos_partes: { acusacao: d.segredo_acu || [], defesa: d.segredo_def || [] },
    autos: autos.map(autoLine),
    niveis: { acusacao: nivelOf(room, 'acusacao'), defesa: nivelOf(room, 'defesa') },
    // falas das partes, para o motor local pontuar quando a IA estiver fora
    localMsgs: autos.filter(a => a.por === 'acusacao' || a.por === 'defesa')
      .map(a => ({ role:a.por, text: a.tipo === 'depoimento' ? a.pergunta : (a.texto || a.alegacao || '') }))
  };
}

// ══════════════════════════════════════════════════════
// AÇÕES DOS JOGADORES
// (sempre: primeiro a peça entra nos autos, depois o estado avança — senão o outro lado
//  pode reagir antes de a peça aparecer na tela dele)
// ══════════════════════════════════════════════════════
function checkText(text, min = 10){
  if(!text || text.trim().length < min){ toast(`Escreva um pouco mais (mínimo ${min} caracteres).`); return false; }
  const m = moderate(text);
  if(m.blocked){ toast(`Linguagem imprópria para o tribunal: "${m.word}"`); return false; }
  return true;
}

export const actions = {
  // ── Acordo ──
  async proporAcordo(termos){
    if(!checkText(termos)) return false;
    await pushAuto({ tipo:'acordo_proposta', por:'acusacao', texto:termos });
    await G.roomRef.child('acordo').update({ status:'resposta', termos });
    clearDraft('acordo');
    return true;
  },
  async semAcordo(){
    await pushAuto({ tipo:'nota', por:'sistema', texto:'A Acusação decidiu não oferecer acordo. O processo segue.' });
    await setPhase('acordo', 'denuncia');
    return true;
  },
  async responderAcordo(aceita){
    await pushAuto({ tipo:'acordo_resposta', por:'defesa', texto: aceita ? 'A Defesa ACEITA o acordo.' : 'A Defesa RECUSA o acordo e vai a julgamento.' });
    if(aceita) await G.roomRef.child('acordo/status').set('homologando');
    else await setPhase('acordo', 'denuncia');
    return true;
  },

  // ── Denúncia ──
  async enviarPeca(tipo, texto){
    if(!checkText(texto, 30)) return false;
    await pushPeca({ tipo, por: tipo === 'denuncia' ? 'acusacao' : 'defesa', texto });
    await G.roomRef.child(`pecas/${tipo}`).set(texto);
    clearDraft(tipo);
    return true;
  },

  // ── Instrução ──
  async perguntar(testemunhaId, pergunta){
    if(!testemunhaId){ toast('Escolha quem vai responder.'); return false; }
    if(!checkText(pergunta, 8)) return false;
    const role = me();
    if((G.room.instrucao.perguntas?.[role] || 0) >= G.room.instrucao.limite[role]){ toast('Você já usou todas as suas perguntas.'); return false; }
    const ok = await createPending(role, testemunhaId, pergunta);
    if(!ok){ toast('Aguarde: ainda há uma pergunta sendo respondida.'); return false; }
    clearDraft('pergunta');
    return true;
  },
  async protestar(motivo){
    const role = me();
    const tx = await G.roomRef.child('instrucao').transaction(ins => {
      if(!ins?.pending || ins.pending.por === role || ins.pending.protesto) return undefined;
      if(now() > ins.pending.ts + PROTEST_WINDOW_MS) return undefined;
      ins.protestos = ins.protestos || {};
      if((ins.protestos[role] || 0) >= MAX_PROTESTOS) return undefined;
      ins.protestos[role] = (ins.protestos[role] || 0) + 1;
      ins.pending.protesto = { por: role, motivo };
      return ins;
    });
    if(tx.committed){ playSound('protest'); vibrate([60, 40, 60]); }
    else toast('Tarde demais para protestar!');
  },
  async apontarContradicao(testemunhaId, alegacao){
    if(!testemunhaId){ toast('Escolha de quem é a contradição.'); return false; }
    if(!checkText(alegacao, 15)) return false;
    const role = me();
    const tx = await G.roomRef.child(`instrucao/contradicoes/${role}`).transaction(v => (v || 0) < MAX_CONTRADICOES ? (v || 0) + 1 : undefined);
    if(!tx.committed){ toast('Você já usou suas duas acusações de contradição.'); return false; }
    const ok = await withLock('O juiz confere a contradição nos autos…', room => runContradicao(room, role, testemunhaId, alegacao));
    if(!ok){
      await G.roomRef.child(`instrucao/contradicoes/${role}`).transaction(v => Math.max(0, (v || 1) - 1));
      toast('O tribunal está ocupado. Tente de novo em instantes.');
      return false;
    }
    clearDraft('contradicao');
    return true;
  },
  async questaoDeOrdem(pecaKey, alegacao){
    const role = me();
    const a = G.room.autos?.[pecaKey];
    if(!a || a.por === role || !PECAS_FISCAIS.includes(a.tipo)){ toast('Só dá para impugnar uma peça do adversário.'); return false; }
    if(G.room.qo?.[pecaKey]){ toast('Essa peça já foi impugnada.'); return false; }
    if(!checkText(alegacao, 12)) return false;
    const tx = await G.roomRef.child(`impugnacoes/${role}`).transaction(v => (v || 0) < MAX_QO ? (v || 0) + 1 : undefined);
    if(!tx.committed){ toast(`Você já usou suas ${MAX_QO} questões de ordem neste caso.`); return false; }
    let ok = false;
    const locked = await withLock('O juiz confere a questão de ordem nos autos…', async room => { ok = await runImpugnacao(room, role, pecaKey, alegacao); });
    if(!locked || !ok){
      await G.roomRef.child(`impugnacoes/${role}`).transaction(v => Math.max(0, (v || 1) - 1));
      if(!locked) toast('O tribunal está ocupado. Tente de novo em instantes.');
      return false;
    }
    return true;
  },
  async encerrarPerguntas(){ await G.roomRef.child(`instrucao/pronto/${me()}`).set(true); return true; },
  async toggleSilencio(v){
    await pushAuto({ tipo:'nota', por:'sistema', texto: v ? 'A Defesa orientou o réu a exercer o direito ao silêncio diante das perguntas da Acusação (Art. 5º, LXIII, CF).' : 'O réu vai responder a todas as perguntas.' });
    await G.roomRef.child('instrucao/silencio').set(v);
  },

  // ── Cartas ──
  async cartaPergunta(){
    if(!await useCard('pergunta')) return false;
    await pushAuto({ tipo:'nota', por:'sistema', texto:`🃏 ${ROLE_LABEL[me()]} usou a carta "Perguntas extras" (+2 perguntas).` });
    await G.roomRef.child(`instrucao/limite/${me()}`).transaction(v => (v || 0) + 2);
    return true;
  },
  async cartaTempo(){
    if(!await useCard('tempo')) return false;
    await pushAuto({ tipo:'nota', por:'sistema', texto:`🃏 ${ROLE_LABEL[me()]} usou a carta "Mais tempo" (+90 segundos).` });
    await G.roomRef.child('debates/extra').transaction(v => (v || 0) + 90);
    return true;
  },
  async cartaDiligencia(pedido){
    if(!checkText(pedido, 10)) return false;
    const role = me();
    if(!(G.room.cartas?.[role]?.diligencia > 0)){ toast('Você não tem mais essa carta.'); return false; }
    const ok = await withLock('O juiz analisa o pedido de diligência…', async room => {
      if(!await useCard('diligencia')) return;
      await runDiligencia(room, role, pedido);
    });
    if(!ok){ toast('O tribunal está ocupado. Tente de novo em instantes.'); return false; }
    clearDraft('diligencia');
    return true;
  },

  // ── Debates ──
  async enviarAlegacao(texto, pedido, auto = false){
    const t = G.room.debates.turno;
    const turno = TURNOS[t];
    if(!auto && !checkText(texto, 20)) return false;
    if(!auto && turno.tipo === 'alegacao' && !pedido?.trim()){ toast('Diga o que você pede ao juiz (ex.: "absolvição" ou "4 anos").'); return false; }
    await submitTurn(t, turno.role, texto || '(o tempo acabou sem manifestação)', pedido);
    clearDraft('alegacao_' + t); clearDraft('pedido');
    return true;
  },
  async dispensarReplica(){
    const tx = await G.roomRef.child('debates/turno').transaction(t => t === 2 ? 4 : undefined);
    if(tx.committed) await pushAuto({ tipo:'nota', por:'sistema', texto:'A Acusação dispensou a réplica — por isso não há tréplica (Art. 476 CPP).' });
    return true;
  },

  // ── Recurso ──
  async apelar(){
    const role = me();
    const tx = await G.roomRef.child('recurso').transaction(r => {
      if(!r || r.status !== 'decidir') return undefined;
      r.status = 'razoes'; r.apelante = role;
      return r;
    });
    if(tx.committed) await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_ICON[role]} ${ROLE_LABEL[role]} interpôs APELAÇÃO ao Tribunal de Justiça.` });
    return true;
  },
  async aceitarDecisao(){
    const role = me();
    await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_ICON[role]} ${ROLE_LABEL[role]} aceitou a decisão.` });
    await G.roomRef.child(`recurso/aceitou/${role}`).set(true);
    return true;
  },
  async enviarRazoes(texto){
    if(!checkText(texto, 30)) return false;
    await pushPeca({ tipo:'apelacao', por: me(), texto });
    await G.roomRef.child('recurso').update({ razoes:texto, status:'contrarrazoes' });
    clearDraft('razoes');
    return true;
  },
  async enviarContrarrazoes(texto, dispensar = false){
    if(!dispensar && !checkText(texto, 20)) return false;
    if(dispensar) await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_LABEL[me()]} não apresentou contrarrazões.` });
    else await pushPeca({ tipo:'contrarrazoes', por: me(), texto });
    await G.roomRef.child('recurso').update({ contrarrazoes: dispensar ? '' : texto, status:'julgando' });
    clearDraft('contrarrazoes');
    return true;
  },

  // ── Fim: próximo caso (sorteado), com os papéis trocados ──
  async novoCaso(){
    const room = G.room;
    const players = { acusacao: room.players?.defesa || null, defesa: room.players?.acusacao || null };
    await G.roomRef.update({ ...CLEAR_CASE, phase:'sorteio', players, tutorial:false, round:(room.round || 0) + 1 });
    // o listener de 'round' (main.js) recarrega os dois aparelhos
  }
};

async function useCard(card){
  const tx = await G.roomRef.child(`cartas/${me()}/${card}`).transaction(v => (v || 0) > 0 ? v - 1 : undefined);
  if(!tx.committed) toast('Você não tem mais essa carta.');
  return tx.committed;
}

async function createPending(role, testemunhaId, pergunta){
  const tx = await G.roomRef.child('instrucao').transaction(ins => {
    if(!ins || ins.pending) return undefined;
    ins.perguntas = ins.perguntas || {};
    if((ins.perguntas[role] || 0) >= ins.limite[role]) return undefined;
    ins.perguntas[role] = (ins.perguntas[role] || 0) + 1;
    ins.pending = { id: Math.random().toString(36).slice(2, 9), testemunhaId, por: role, pergunta, ts: now(), protesto: null };
    return ins;
  });
  return tx.committed;
}

async function submitTurn(t, role, texto, pedido){
  const atual = (await G.roomRef.child('debates/turno').once('value')).val();
  if(atual !== t) return;
  await pushPeca({ tipo:'alegacao', subtipo: TURNOS[t].tipo, por: role, texto, pedido: pedido || null });
  await G.roomRef.child('debates').transaction(d => {
    if(!d || d.turno !== t) return undefined;
    d.turno = t + 1; d.inicio = now(); d.extra = 0;
    if(pedido){ d.pedidos = d.pedidos || {}; d.pedidos[role] = pedido; }
    return d;
  });
}

async function runDiligencia(room, role, pedido){
  const d = dossieOf(room);
  const revelados = room.fatosRevelados || [];
  const ocultos = (d.fatos_ocultos || []).map((f, i) => ({ f, i })).filter(x => !revelados.includes(x.i));
  const r = await ask('diligencia', caseOf(room), { ...aiContext(room), por: role, pedido, fatos_ocultos: ocultos.map(x => x.f) });
  const usado = r.fato_usado >= 0 && ocultos[r.fato_usado] ? ocultos[r.fato_usado].i : null;
  await pushAuto({ tipo:'diligencia', por: role, pedido, texto: r.text, em_resumo: r.em_resumo, provider: r.provider });
  if(usado !== null) await G.roomRef.child('fatosRevelados').set([...revelados, usado]);
}

async function runContradicao(room, role, testemunhaId, alegacao){
  const t = witnessOf(room, testemunhaId);
  const depoimentos = autosList(room).filter(a => a.tipo === 'depoimento' && a.testemunhaId === t.id).map(a => ({ pergunta:a.pergunta, resposta:a.resposta }));
  const r = await ask('contradicao', caseOf(room), { ...aiContext(room), por: role, testemunha: t, depoimentos, alegacao });
  await pushAuto({ tipo:'contradicao', por: role, testemunhaId: t.id, nome: t.nome, emoji: t.emoji, alegacao, procede: r.procede, texto: r.text, em_resumo: r.em_resumo, provider: r.provider });
  await addScore({ [role]: r.procede ? 3 : -1 });
  playSound(r.procede ? 'twist' : 'gavel');
}

// ══════════════════════════════════════════════════════
// FISCAL DOS AUTOS — só vale o que está no processo
// ══════════════════════════════════════════════════════
// dois trechos falam da mesma coisa? (metade ou mais das palavras relevantes em comum)
function sobrepoe(a, b){
  const w = t => new Set((String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{4,}/g) || []));
  const A = w(a), B = w(b);
  if(!A.size || !B.size) return false;
  return [...A].filter(x => B.has(x)).length >= Math.ceil(Math.min(A.size, B.size) / 2);
}

const PENALIDADE = n => n >= 3 ? { perde:5, ganha:2 } : n === 2 ? { perde:3, ganha:1 } : { perde:2, ganha:1 };

async function runFiscal(room, key){
  if(!room.fiscal?.[key]) return;
  await G.roomRef.child(`fiscal/${key}`).remove();
  const a = room.autos?.[key];
  if(!a?.texto) return;
  const r = await ask('fiscal', caseOf(room), { ...aiContext(room), peca: { tipo: PECA_NOME[a.subtipo || a.tipo] || a.tipo, por: a.por, texto: a.texto } });
  if(!r.violacoes?.length) return;
  const nivel = autosList(room).filter(x => x.tipo === 'advertencia' && x.alvo === a.por).length + 1;
  const calunia = r.violacoes.some(v => v.tipo === 'calunia');
  let { perde, ganha } = PENALIDADE(nivel);
  if(calunia){ perde = Math.max(perde, 4); ganha = 2; }  // acusar alguém de crime sem prova volta contra quem acusou
  await G.roomRef.child(`desconsiderados/${key}`).update(Object.fromEntries(r.violacoes.map((v, i) => [`f${i}`, v.trecho])));
  await pushAuto({ tipo:'advertencia', por:'juiz', alvo:a.por, pecaKey:key, nivel, calunia, violacoes:r.violacoes, texto:r.text, em_resumo:r.em_resumo, perde, ganha, provider:r.provider });
  await addScore({ [a.por]: -perde, [otherRole(a.por)]: ganha });
  playSound('gavel');
}

async function runImpugnacao(room, role, key, alegacao){
  const a = room.autos?.[key];
  if(!a || room.qo?.[key]) return false;
  const r = await ask('impugnacao', caseOf(room), { ...aiContext(room), por: role, peca: { tipo: PECA_NOME[a.subtipo || a.tipo] || a.tipo, por: a.por, texto: a.texto }, alegacao });
  if(r.provider === 'local'){
    // sem IA não dá para conferir com justiça: devolve a questão de ordem, sem ponto para ninguém
    await pushAuto({ tipo:'nota', por:'sistema', texto:'O juiz não conseguiu analisar a questão de ordem agora. Ela foi devolvida: tente de novo em instantes.' });
    return false;
  }
  // o fiscal já tinha riscado esse trecho: não pune duas vezes, e devolve a questão de ordem
  const jaRiscados = Object.values(room.desconsiderados?.[key] || {});
  if(r.procede && r.trecho && jaRiscados.some(t => sobrepoe(t, r.trecho))){
    await pushAuto({ tipo:'nota', por:'sistema', texto:`Questão de ordem prejudicada: o juiz já havia desconsiderado esse trecho ("${r.trecho}"). Ela foi devolvida, sem ponto para ninguém.` });
    return false;
  }
  await G.roomRef.child(`qo/${key}`).set(role);
  if(r.procede && r.trecho) await G.roomRef.child(`desconsiderados/${key}/q`).set(r.trecho);
  await pushAuto({ tipo:'questao_ordem', por: role, alvo: a.por, pecaKey: key, alegacao, procede: r.procede, trecho: r.trecho || '', texto: r.text, em_resumo: r.em_resumo, provider: r.provider });
  await addScore(r.procede ? { [role]: 2, [a.por]: -2 } : { [role]: -1 });
  playSound(r.procede ? 'twist' : 'gavel');
  return true;
}

// ══════════════════════════════════════════════════════
// PILOTO AUTOMÁTICO — o que os personagens de IA fazem, e quando
// ══════════════════════════════════════════════════════
let autopilotRunning = false;
export async function autopilot(){
  const room = G.room;
  if(!room || autopilotRunning || localBusy) return;
  if(room.judge_busy && now() - (room.judge_busy.ts || 0) < LOCK_MS) return;
  autopilotRunning = true;
  try{ await step(room); }
  catch(e){ console.error('[autopilot]', e); }
  finally{ autopilotRunning = false; }
}

async function step(room){
  if(room.phase === 'sorteio'){
    const prontos = Object.keys(room.lobby || {}).length >= (room.solo ? 1 : 2);
    if(prontos) return withLock('Sorteando o caso…', sortearCaso);
    return;
  }
  if(!me()) return;
  const c = caseOf(room);
  const ai = aiRole(room);

  // o próximo caso inédito é escrito em segundo plano (não bloqueia nada)
  if(room.caseData) preGerarProximo(room);

  // antes de qualquer decisão, o juiz confere as peças que acabaram de chegar
  const fila = Object.keys(room.fiscal || {});
  if(fila.length) return withLock('O juiz confere a peça…', r => runFiscal(r, fila[0]));

  switch(room.phase){
    case 'acordo': {
      const a = room.acordo || {};
      if(a.status === 'homologando') return withLock('O juiz analisa o acordo…', homologarAcordo);
      if(ai === 'acusacao' && a.status === 'proposta') return withLock('A Acusação (IA) está pensando…', async r => {
        const o = await ask('oponente', c, { ...aiContext(r), papel:'acusacao', tarefa:'acordo_proposta', segredos: dossieOf(r).segredo_acu, nivel_humano: nivelOf(r, me()) });
        if(o.aceita && o.text){ await pushAuto({ tipo:'acordo_proposta', por:'acusacao', texto:o.text }); await G.roomRef.child('acordo').update({ status:'resposta', termos:o.text }); }
        else { await pushAuto({ tipo:'nota', por:'sistema', texto:'A Acusação decidiu não oferecer acordo.' }); await setPhase('acordo', 'denuncia'); }
      });
      if(ai === 'defesa' && a.status === 'resposta') return withLock('A Defesa (IA) avalia a proposta…', async r => {
        const o = await ask('oponente', c, { ...aiContext(r), papel:'defesa', tarefa:'acordo_resposta', termos: r.acordo.termos, nivel_humano: nivelOf(r, me()) });
        await pushAuto({ tipo:'acordo_resposta', por:'defesa', texto: (o.aceita ? 'A Defesa ACEITA o acordo. ' : 'A Defesa RECUSA o acordo. ') + (o.text || '') });
        if(o.aceita) await G.roomRef.child('acordo/status').set('homologando');
        else await setPhase('acordo', 'denuncia');
      });
      return;
    }

    case 'denuncia': {
      const p = room.pecas || {};
      if(p.denuncia && p.resposta && !room.recebimento) return withLock('O juiz analisa a denúncia e a resposta…', receberDenuncia);
      if(ai === 'acusacao' && !p.denuncia) return withLock('A Acusação (IA) redige a denúncia…', r => aiPeca(r, 'acusacao', 'denuncia'));
      if(ai === 'defesa' && p.denuncia && !p.resposta) return withLock('A Defesa (IA) redige a resposta…', r => aiPeca(r, 'defesa', 'resposta'));
      return;
    }

    case 'instrucao': {
      const ins = room.instrucao || {};
      const pend = ins.pending;
      if(pend){
        const windowClosed = pend.protesto || now() > pend.ts + PROTEST_WINDOW_MS;
        const mineToRun = pend.por === me() || isAI(room, pend.por) || now() > pend.ts + STALE_MS;
        if(windowClosed && mineToRun) return withLock(pend.protesto ? 'O juiz decide o protesto…' : `${witnessOf(room, pend.testemunhaId)?.nome || 'A testemunha'} está respondendo…`, processPending);
        return;
      }
      if(instrucaoDone(room)) return withLock(room.rito === 'juri' && !room.pronuncia ? 'O juiz decide se o caso vai a Júri…' : 'Encerrando a instrução…', encerrarInstrucao);
      if(ai){
        const aiAsked = ins.perguntas?.[ai] || 0;
        const humanAsked = ins.perguntas?.[me()] || 0;
        const humanDone = ins.pronto?.[me()] || humanAsked >= ins.limite[me()];
        if(aiAsked < ins.limite[ai] && (humanAsked >= aiAsked * 2 + 1 || humanDone)) return withLock(`A ${ROLE_LABEL[ai]} (IA) prepara uma pergunta…`, aiPergunta);
      }
      return;
    }

    case 'debates': {
      const d = room.debates;
      if(!d) return;
      if(d.turno >= TURNOS.length) return setPhase('debates', 'julgamento');
      const turno = TURNOS[d.turno];
      if(isAI(room, turno.role)) return withLock(`A ${ROLE_LABEL[turno.role]} (IA) está falando…`, r => aiAlegacao(r, d.turno));
      const deadline = d.inicio + (turno.seg + (d.extra || 0)) * 1000;
      // quem está com a palavra deixou o tempo acabar: envia o rascunho; se sumiu, o outro aparelho encerra o turno
      if(now() > deadline && turno.role === me()) return actions.enviarAlegacao(loadDraft('alegacao_' + d.turno), loadDraft('pedido') || 'conforme exposto', true);
      if(now() > deadline + 20000) return submitTurn(d.turno, turno.role, '(não se manifestou no prazo)', null);
      return;
    }

    case 'julgamento':
      if(!room.julgamento) return withLock(room.rito === 'juri' ? 'Os jurados estão votando em sala secreta…' : 'O juiz está redigindo a sentença…', julgar);
      return;

    case 'recurso': {
      const r = room.recurso || {};
      if(r.status === 'julgando') return withLock('A Câmara Criminal está em sessão…', julgarRecurso);
      const perdedores = r.perdedor === 'ambos' ? ['acusacao', 'defesa'] : [r.perdedor];
      if(r.status === 'decidir'){
        if(perdedores.every(p => r.aceitou?.[p])) return withLock('Encerrando o processo…', fr => finalizar(fr, fr.julgamento.vencedor, 'Ninguém recorreu: a sentença transitou em julgado.'));
        if(ai && perdedores.includes(ai) && !r.aceitou?.[ai]) return withLock(`A ${ROLE_LABEL[ai]} (IA) prepara a apelação…`, async fr => {
          if(fr.recurso?.status !== 'decidir') return;
          const o = await ask('oponente', caseOf(fr), { ...aiContext(fr), papel: ai, tarefa:'apelacao', nivel_humano: nivelOf(fr, me()) });
          await pushAuto({ tipo:'nota', por:'sistema', texto:`${ROLE_ICON[ai]} ${ROLE_LABEL[ai]} interpôs APELAÇÃO ao Tribunal de Justiça.` });
          await pushPeca({ tipo:'apelacao', por: ai, texto: o.text });
          await G.roomRef.child('recurso').update({ status:'contrarrazoes', apelante: ai, razoes: o.text });
        });
      }
      if(r.status === 'contrarrazoes' && ai && r.apelante !== ai) return withLock(`A ${ROLE_LABEL[ai]} (IA) responde ao recurso…`, async fr => {
        if(fr.recurso?.status !== 'contrarrazoes') return;
        const o = await ask('oponente', caseOf(fr), { ...aiContext(fr), papel: ai, tarefa:'contrarrazoes', nivel_humano: nivelOf(fr, me()) });
        await pushPeca({ tipo:'contrarrazoes', por: ai, texto: o.text });
        await G.roomRef.child('recurso').update({ contrarrazoes: o.text, status:'julgando' });
      });
      return;
    }
  }
}

function instrucaoDone(room){
  const ins = room.instrucao || {};
  return ['acusacao', 'defesa'].every(role => ins.pronto?.[role] || (ins.perguntas?.[role] || 0) >= ins.limite?.[role]);
}

// ── Passos de IA ──

async function homologarAcordo(room){
  if(room.phase !== 'acordo' || room.acordo?.status !== 'homologando') return;
  const r = await ask('acordo', caseOf(room), { ...aiContext(room), termos: room.acordo.termos });
  await pushAuto({ tipo:'acordo_decisao', por:'juiz', titulo:'Homologação do acordo', homologado:r.homologado, texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
  await addScore(r.pontos);
  if(r.homologado){
    const s = (await G.roomRef.child('score').once('value')).val() || {};
    const vencedor = s.acusacao === s.defesa ? 'empate' : (s.acusacao > s.defesa ? 'acusacao' : 'defesa');
    await G.roomRef.child('acordo/status').set('feito');
    await G.roomRef.child('final').set({ vencedor, bonus:false, texto:'O processo terminou em acordo homologado: vence quem negociou melhor.' });
    await setPhase('acordo', 'fim');
  } else {
    await G.roomRef.child('acordo/status').set('negado');
    await setPhase('acordo', 'denuncia');
  }
}

async function aiPeca(room, role, tipo){
  const p = room.pecas || {};
  if(room.phase !== 'denuncia' || p[tipo]) return;
  const d = dossieOf(room);
  const o = await ask('oponente', caseOf(room), { ...aiContext(room), papel: role, tarefa: tipo, segredos: role === 'acusacao' ? d.segredo_acu : d.segredo_def, nivel_humano: nivelOf(room, me()) });
  await pushPeca({ tipo, por: role, texto: o.text });
  await G.roomRef.child(`pecas/${tipo}`).set(o.text);
}

async function receberDenuncia(room){
  if(room.phase !== 'denuncia' || room.recebimento) return;
  const r = await ask('recebimento', caseOf(room), { ...aiContext(room), denuncia: room.pecas.denuncia, resposta: room.pecas.resposta });
  await G.roomRef.child('recebimento').set(true);
  await pushAuto({ tipo:'decisao', por:'juiz', titulo:'Recebimento da denúncia', texto:r.text, em_resumo:r.em_resumo, comentarios:{ acusacao:r.comentario_acusacao, defesa:r.comentario_defesa }, pontos:r.pontos, provider:r.provider });
  await addScore(r.pontos);
  const lim = role => isAI(room, role) ? AI_PERGUNTAS : LIMITE_PERGUNTAS[nivelOf(room, role)];
  await setPhase('denuncia', 'instrucao', { instrucao: { limite:{ acusacao: lim('acusacao'), defesa: lim('defesa') }, perguntas:{ acusacao:0, defesa:0 }, protestos:{ acusacao:0, defesa:0 }, contradicoes:{ acusacao:0, defesa:0 }, pronto:{}, pending:null, silencio:false, reviravolta:false } });
}

async function processPending(room){
  const pend = room.instrucao?.pending;
  if(room.phase !== 'instrucao' || !pend) return;
  const t = witnessOf(room, pend.testemunhaId);
  const c = caseOf(room);
  const ctx = aiContext(room);
  let protestoIndeferido = null;

  if(pend.protesto){
    const motivo = MOTIVOS_PROTESTO.find(m => m.id === pend.protesto.motivo)?.label || pend.protesto.motivo;
    const r = await ask('protesto', c, { ...ctx, testemunha_nome: t.nome, por: pend.por, contra: pend.protesto.por, pergunta: pend.pergunta, motivo });
    await addScore({ [pend.protesto.por]: r.decisao === 'deferido' ? 1 : -1 });
    if(r.decisao === 'deferido'){
      await pushAuto({ tipo:'protesto', por: pend.por, protestoPor: pend.protesto.por, nome: t.nome, emoji: t.emoji, pergunta: pend.pergunta, motivo, decisao:'deferido', texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
      await G.roomRef.child('instrucao/pending').remove();
      playSound('gavel');
      return;
    }
    protestoIndeferido = { por: pend.protesto.por, motivo, texto: r.text };
  }

  let resp;
  if(t.papel === 'reu' && room.instrucao.silencio && pend.por === 'acusacao'){
    resp = { text:'Excelência, por orientação da minha defesa, vou exercer o meu direito de permanecer em silêncio.', tom:'firme', revelou_segredo:false, provider:'regra' };
  } else {
    const anteriores = autosList(room).filter(a => a.tipo === 'depoimento' && a.testemunhaId === t.id);
    const historico = anteriores.map(a => ({ por:a.por, pergunta:a.pergunta, resposta:a.resposta }));
    resp = await ask('testemunha', c, { ...ctx, testemunha: t, pergunta: pend.pergunta, por: pend.por, historico });
    // cada segredo só pontua uma vez: a testemunha não pode "revelar" mais segredos do que tem
    if(anteriores.filter(a => a.revelou).length >= (t.segredos || []).length) resp.revelou_segredo = false;
  }
  await pushAuto({ tipo:'depoimento', por: pend.por, testemunhaId: t.id, nome: t.nome, emoji: t.emoji, papel: t.papel_txt, pergunta: pend.pergunta, resposta: resp.text, tom: resp.tom, revelou: Boolean(resp.revelou_segredo), protestoIndeferido, provider: resp.provider });
  if(resp.revelou_segredo) await addScore({ [pend.por]: 2 });
  await G.roomRef.child('instrucao/pending').remove();

  // 1ª reviravolta: na metade das perguntas
  const ins = (await G.roomRef.child('instrucao').once('value')).val();
  const feitas = (ins.perguntas?.acusacao || 0) + (ins.perguntas?.defesa || 0);
  const total = (ins.limite?.acusacao || 0) + (ins.limite?.defesa || 0);
  const rv = twistsOf(room)[0];
  if(rv && !ins.reviravolta && feitas >= Math.ceil(total / 2)){
    await G.roomRef.child('instrucao/reviravolta').set(true);
    await pushAuto({ tipo:'reviravolta', por:'sistema', titulo: rv.titulo, texto: rv.texto });
  }
}

async function aiPergunta(room){
  const ai = aiRole(room);
  if(room.phase !== 'instrucao' || room.instrucao?.pending) return;
  const d = dossieOf(room);
  const o = await ask('oponente', caseOf(room), { ...aiContext(room), papel: ai, tarefa:'pergunta', testemunhas: d.testemunhas.map(t => ({ id:t.id, nome:t.nome, papel_txt:t.papel_txt })), segredos: ai === 'acusacao' ? d.segredo_acu : d.segredo_def, nivel_humano: nivelOf(room, me()) });
  const tid = d.testemunhas.some(t => t.id === o.testemunha_id) ? o.testemunha_id : d.testemunhas[(room.instrucao.perguntas?.[ai] || 0) % d.testemunhas.length].id;
  await createPending(ai, tid, o.text);
}

async function encerrarInstrucao(room){
  if(room.phase !== 'instrucao' || !instrucaoDone(room) || room.instrucao?.pending) return;
  let rito = room.rito;
  if(rito === 'juri' && !room.pronuncia){
    const r = await ask('pronuncia', caseOf(room), aiContext(room));
    rito = r.decisao === 'pronuncia' ? 'juri' : 'comum';
    await pushAuto({ tipo:'pronuncia', por:'juiz', titulo: r.decisao === 'pronuncia' ? 'PRONÚNCIA — o réu vai a Júri' : 'DESCLASSIFICAÇÃO — sem Júri', decisao:r.decisao, crime:r.crime, texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
    await G.roomRef.update({ pronuncia: { decisao:r.decisao, crime:r.crime }, rito });
    await addScore(r.pontos);
    playSound('gavel');
  }
  const ok = await setPhase('instrucao', 'debates', { debates: { turno:0, inicio: now() + 4000, extra:0, pedidos:{} } });
  // 2ª reviravolta: chega antes dos debates, para virar as alegações de cabeça para baixo
  const rv2 = twistsOf(room)[1];
  if(ok && rv2) await pushAuto({ tipo:'reviravolta', por:'sistema', titulo: rv2.titulo, texto: rv2.texto });
}

async function aiAlegacao(room, t){
  if(room.phase !== 'debates' || room.debates?.turno !== t) return;
  const turno = TURNOS[t];
  const d = dossieOf(room);
  const o = await ask('oponente', caseOf(room), { ...aiContext(room), papel: turno.role, tarefa: turno.tipo === 'alegacao' ? 'alegacao' : 'replica', segredos: turno.role === 'acusacao' ? d.segredo_acu : d.segredo_def, nivel_humano: nivelOf(room, me()) });
  await submitTurn(t, turno.role, o.text, turno.tipo === 'alegacao' ? (o.pedido || (turno.role === 'acusacao' ? 'condenação' : 'absolvição')) : null);
}

function pickJurados(room){
  // sorteio estável por sala/rodada, para os dois aparelhos verem os mesmos jurados
  let seed = [...(G.code + (room.round || 0))].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return [...JURADOS].map(j => ({ j, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, 7).map(x => x.j);
}

async function julgar(room){
  if(room.phase !== 'julgamento' || room.julgamento) return;
  const c = caseOf(room);
  const ctx = aiContext(room);
  const pedidos = room.debates?.pedidos || {};
  let r;
  if(room.rito === 'juri'){
    const jurados = pickJurados(room);
    r = await ask('juri', c, { ...ctx, jurados, crime: room.pronuncia?.crime });
    r.votos = (r.votos || []).map((v, i) => ({ ...v, emoji: jurados[i]?.emoji || '🧑' }));
    await pushAuto({ tipo:'juri', por:'jurados', decisao:r.decisao, votos:r.votos, texto:r.text, dosimetria:r.dosimetria, em_resumo:r.em_resumo, melhor:{ acusacao:r.melhor_momento_acusacao, defesa:r.melhor_momento_defesa }, provider:r.provider });
  } else {
    r = await ask('sentenca', c, { ...ctx, pedidos });
    await pushAuto({ tipo:'sentenca', por:'juiz', decisao:r.decisao, texto:r.text, dosimetria:r.dosimetria, em_resumo:r.em_resumo, melhor:{ acusacao:r.melhor_momento_acusacao, defesa:r.melhor_momento_defesa }, provider:r.provider });
  }
  playSound('gavel');
  await addScore(r.pontos);
  const dec = String(r.decisao || '');
  const vencedor = /ABSOLV/.test(dec) ? 'defesa' : /PARCIAL|DESCLASSIF/.test(dec) ? 'empate' : 'acusacao';
  const perdedor = vencedor === 'empate' ? 'ambos' : otherRole(vencedor);
  const resumo = `${dec}${r.dosimetria?.pena_final ? ` — ${r.dosimetria.pena_final} (${r.dosimetria.regime})` : ''}`;
  await G.roomRef.child('julgamento').set({ decisao: dec, vencedor, resumo, texto: r.text });
  await setPhase('julgamento', 'recurso', { recurso: { status:'decidir', perdedor, aceitou:{} } });
}

async function julgarRecurso(room){
  if(room.phase !== 'recurso' || room.recurso?.status !== 'julgando') return;
  const rec = room.recurso;
  const r = await ask('acordao', caseOf(room), {
    ...aiContext(room), desembargadores: DESEMBARGADORES, apelante: rec.apelante,
    sentenca: `${room.julgamento.resumo}. ${room.julgamento.texto}${room.rito === 'juri' ? ' (Decisão do Tribunal do Júri: pela soberania dos veredictos, o Tribunal só pode mandar o réu a novo Júri se a decisão for manifestamente contrária à prova dos autos; a dosimetria pode ser corrigida diretamente.)' : ''}`,
    razoes: rec.razoes, contrarrazoes: rec.contrarrazoes
  });
  r.votos = (r.votos || []).map((v, i) => ({ ...v, emoji: DESEMBARGADORES[i]?.emoji || '🧑‍⚖️' }));
  await pushAuto({ tipo:'acordao', por:'tribunal', resultado:r.resultado, votos:r.votos, texto:r.text, em_resumo:r.em_resumo, provider:r.provider });
  playSound('gavel');
  await addScore(r.pontos);
  const vencedor = r.resultado === 'provido' ? rec.apelante : r.resultado === 'desprovido' ? otherRole(rec.apelante) : 'empate';
  await finalizar(room, vencedor, `Acórdão: recurso ${r.resultado}. ${r.text}`);
}

async function finalizar(room, vencedor, texto){
  if(room.phase === 'fim') return;
  const bonus = vencedor === 'acusacao' || vencedor === 'defesa';
  if(bonus) await addScore({ [vencedor]: 5 });
  await G.roomRef.child('final').set({ vencedor, bonus, texto });
  await setPhase(room.phase, 'fim');
}

// ══════════════════════════════════════════════════════
// RENDERIZAÇÃO
// ══════════════════════════════════════════════════════
const renderedAutos = new Set();
let firstAutosRender = true;
let lastCaseId = null;

export function render(){
  const room = G.room; if(!room) return;
  if(room.caseData && room.caseData.id !== lastCaseId){
    lastCaseId = room.caseData.id;
    G.onCase?.(room);
  }
  renderTop(room);
  renderAutos(room);
  syncAutosMarks(room);
  renderPending(room);
  renderBusy(room);
  renderPanel(room);
  renderReveal(room);
}

export function newEvidence(room = G.room){
  return autosList(room).filter(a => a.tipo === 'diligencia' || a.tipo === 'reviravolta').map(a => a.tipo === 'reviravolta' ? `${a.titulo}: ${a.texto}` : a.texto);
}

function renderTop(room){
  const s = room.score || {};
  const mine = me();
  $('top-score').innerHTML = mine
    ? `<span class="sc ${mine}">${s[mine] || 0}</span><span class="sc-x">×</span><span class="sc ${otherRole(mine)}">${s[otherRole(mine)] || 0}</span>`
    : '';
  $('sc-acu').textContent = s.acusacao || 0;
  $('sc-def').textContent = s.defesa || 0;
  $('sc-acu-label').textContent = nameOf(room, 'acusacao');
  $('sc-def-label').textContent = nameOf(room, 'defesa');
  $('gtb-title').textContent = room.caseData?.nome || 'Sorteando…';

  const d = dossieOf(room);
  const steps = [d.acordo && 'acordo', 'denuncia', 'instrucao', d.rito === 'juri' && 'pronuncia', 'debates', 'julgamento', 'recurso', 'fim'].filter(Boolean);
  const order = ['acordo', 'denuncia', 'instrucao', 'pronuncia', 'debates', 'julgamento', 'recurso', 'fim'];
  const cur = room.phase === 'instrucao' && room.pronuncia ? 'debates' : room.phase;
  const curIdx = order.indexOf(cur);
  $('phase-stepper').innerHTML = room.phase === 'sorteio' ? '' : steps.map(p => {
    const i = order.indexOf(p);
    const st = i < curIdx || (p === 'pronuncia' && room.pronuncia) ? 'done' : p === cur ? 'now' : '';
    return `<div class="step ${st}" title="${FASES[p].nome}"><i></i>${p === cur ? `<span>${FASES[p].nome}</span>` : ''}</div>`;
  }).join('');
}

function roleBubbleClass(role){ return `${role} ${role === me() ? 'mine' : 'theirs'}`; }
function providerTag(p){ return p && p !== 'regra' ? `<span class="prov">${p === 'local' ? 'offline' : escapeHtml(p)}</span>` : ''; }
function resumoHtml(t){ return t ? `<div class="em-resumo"><b>Em resumo</b>${escapeHtml(t)}</div>` : ''; }
function avatar(emoji, cls = ''){ return `<span class="avatar ${cls}">${emoji || '🧑'}</span>`; }
function dosimetriaHtml(d){
  if(!d || !d.pena_final) return '';
  return `<div class="dosi"><div class="dosi-title">Dosimetria</div>
    ${d.fase1 ? `<div class="dosi-row"><span>1ª</span>${escapeHtml(d.fase1)}</div>` : ''}
    ${d.fase2 ? `<div class="dosi-row"><span>2ª</span>${escapeHtml(d.fase2)}</div>` : ''}
    ${d.fase3 ? `<div class="dosi-row"><span>3ª</span>${escapeHtml(d.fase3)}</div>` : ''}
    <div class="dosi-final">${escapeHtml(d.pena_final)}${d.regime ? `<small>regime ${escapeHtml(d.regime)}</small>` : ''}</div></div>`;
}

function autoHtml(a){
  const room = G.room;
  const who = r => `<b class="who ${r}">${escapeHtml(nameOf(room, r))}</b>`;
  switch(a.tipo){
    case 'fase': {
      const f = FASES[a.fase]; if(!f) return '';
      const meu = f[me()];
      return `<div class="phase-card"><div class="pc-icon">${f.icon}</div><div class="pc-name">${f.nome}</div><div class="pc-text">${escapeHtml(f.o_que)}</div>${meu ? `<div class="pc-goal"><b>Seu objetivo</b>${escapeHtml(meu)}</div>` : ''}</div>`;
    }
    case 'nota': return `<div class="auto-nota">${escapeHtml(a.texto)}</div>`;
    case 'denuncia': case 'resposta': case 'apelacao': case 'contrarrazoes': case 'acordo_proposta': case 'acordo_resposta': case 'alegacao': {
      const nome = a.tipo === 'alegacao' ? (PECA_NOME[a.subtipo] || 'ALEGAÇÕES') : (PECA_NOME[a.tipo] || 'MANIFESTAÇÃO');
      const qo = PECAS_FISCAIS.includes(a.tipo) && a.por !== me() && me() ? `<button type="button" class="qo-btn" data-qo="${a.key}">Questão de ordem</button>` : '';
      return `<div class="bubble ${roleBubbleClass(a.por)}"><div class="b-head">${who(a.por)}<span>${nome.toLowerCase()}</span></div><div class="b-body">${nl2br(a.texto)}</div>${a.pedido ? `<div class="b-pedido">Pede <b>${escapeHtml(a.pedido)}</b></div>` : ''}${qo}</div>`;
    }
    case 'decisao': case 'acordo_decisao': case 'pronuncia': {
      const com = a.comentarios ? ['acusacao', 'defesa'].filter(r => a.comentarios[r]).map(r => `<div class="fb ${r}"><span>${escapeHtml(nameOf(room, r))}${a.pontos ? ` <b>+${a.pontos[r] || 0}</b>` : ''}</span>${escapeHtml(a.comentarios[r])}</div>`).join('') : '';
      return `<div class="judge gloss"><div class="j-head">${avatar('🧑‍⚖️', 'judge')}<div><b>Dr. Augusto Melo</b><small>${escapeHtml(a.titulo || 'Decisão')}</small></div>${providerTag(a.provider)}</div><div class="j-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}${com}</div>`;
    }
    case 'depoimento': {
      const ind = a.protestoIndeferido ? `<div class="ruling no">Protesto da ${ROLE_LABEL[a.protestoIndeferido.por]} (${escapeHtml(a.protestoIndeferido.motivo)}) <b>indeferido</b> — ${escapeHtml(a.protestoIndeferido.texto)}</div>` : '';
      return `<div class="bubble q ${roleBubbleClass(a.por)}"><div class="b-head">${who(a.por)}<span>para ${escapeHtml(a.nome)}</span></div><div class="b-body">${nl2br(a.pergunta)}</div></div>${ind}
        <div class="witness gloss"><div class="w-head">${avatar(a.emoji)}<div><b>${escapeHtml(a.nome)}</b><small>${escapeHtml(a.papel || '')}${a.tom ? ` · ${escapeHtml(a.tom)}` : ''}</small></div>${providerTag(a.provider)}</div><div class="w-body">${nl2br(a.resposta)}</div>${a.revelou ? `<div class="reveal">Segredo revelado · <b>+2</b> ${ROLE_LABEL[a.por]}</div>` : ''}</div>`;
    }
    case 'protesto':
      return `<div class="bubble q struck ${roleBubbleClass(a.por)}"><div class="b-head">${who(a.por)}<span>para ${escapeHtml(a.nome)}</span></div><div class="b-body">${nl2br(a.pergunta)}</div></div>
        <div class="judge alert gloss"><div class="j-head">${avatar('✋', 'alert')}<div><b>Protesto deferido</b><small>${ROLE_LABEL[a.protestoPor]} · ${escapeHtml(a.motivo)}</small></div>${providerTag(a.provider)}</div><div class="j-body">${escapeHtml(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    case 'contradicao':
      return `<div class="judge ${a.procede ? 'win' : 'alert'} gloss"><div class="j-head">${avatar('🎯', a.procede ? 'win' : 'alert')}<div><b>Contradição ${a.procede ? 'confirmada' : 'rejeitada'}</b><small>${escapeHtml(nameOf(room, a.por))} sobre ${escapeHtml(a.nome)} · ${a.procede ? '+3' : '−1'}</small></div>${providerTag(a.provider)}</div><div class="j-quote">“${escapeHtml(a.alegacao)}”</div><div class="j-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    case 'advertencia': {
      const titulo = a.calunia ? 'Acusação sem prova' : a.nivel >= 3 ? 'Litigância de má-fé' : `Advertência${a.nivel > 1 ? ` (${a.nivel}ª)` : ''}`;
      return `<div class="judge alert gloss"><div class="j-head">${avatar('⚠️', 'alert')}<div><b>${titulo}</b><small>à ${ROLE_LABEL[a.alvo]} · só vale o que está nos autos</small></div>${providerTag(a.provider)}</div>${(a.violacoes || []).map(v => `<div class="j-quote"><del>${escapeHtml(v.trecho)}</del><small>${escapeHtml(v.explicacao || '')}</small></div>`).join('')}<div class="j-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}<div class="penalty"><span class="${a.alvo}">−${a.perde} ${escapeHtml(nameOf(room, a.alvo))}</span><span class="${otherRole(a.alvo)}">+${a.ganha} ${escapeHtml(nameOf(room, otherRole(a.alvo)))}</span></div></div>`;
    }
    case 'questao_ordem':
      return `<div class="judge ${a.procede ? 'win' : 'alert'} gloss"><div class="j-head">${avatar('☝️', a.procede ? 'win' : 'alert')}<div><b>Questão de ordem ${a.procede ? 'acolhida' : 'rejeitada'}</b><small>${escapeHtml(nameOf(room, a.por))} contra a ${ROLE_LABEL[a.alvo]}</small></div>${providerTag(a.provider)}</div><div class="j-quote">“${escapeHtml(a.alegacao)}”</div>${a.procede && a.trecho ? `<div class="j-quote"><del>${escapeHtml(a.trecho)}</del></div>` : ''}<div class="j-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}<div class="penalty">${a.procede ? `<span class="${a.por}">+2 ${escapeHtml(nameOf(room, a.por))}</span><span class="${a.alvo}">−2 ${escapeHtml(nameOf(room, a.alvo))}</span>` : `<span class="${a.por}">−1 ${escapeHtml(nameOf(room, a.por))}</span>`}</div></div>`;
    case 'diligencia':
      return `<div class="judge dilig gloss"><div class="j-head">${avatar('🔍', 'dilig')}<div><b>Diligência</b><small>pedida pela ${ROLE_LABEL[a.por]}</small></div>${providerTag(a.provider)}</div><div class="j-quote">“${escapeHtml(a.pedido)}”</div><div class="j-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    case 'reviravolta':
      return `<div class="twist"><div class="t-kicker">Reviravolta</div><div class="t-title">${escapeHtml(a.titulo)}</div><div class="t-body">${escapeHtml(a.texto)}</div></div>`;
    case 'sentenca':
      return `<div class="judge verdict gloss"><div class="j-head">${avatar('🔨', 'judge')}<div><b>Sentença</b><small>Dr. Augusto Melo</small></div>${providerTag(a.provider)}</div><div class="v-dec">${escapeHtml(a.decisao)}</div><div class="j-body">${nl2br(a.texto)}</div>${dosimetriaHtml(a.dosimetria)}${resumoHtml(a.em_resumo)}${melhoresHtml(a.melhor)}</div>`;
    case 'juri': {
      const condena = (a.votos || []).filter(v => v.voto === 'condena').length;
      const votos = (a.votos || []).map((v, i) => `<div class="juror ${v.voto}" style="animation-delay:${i * 0.45}s">${avatar(v.emoji)}<b>${escapeHtml(v.nome)}</b><span class="vote">${v.voto === 'condena' ? 'Condena' : 'Absolve'}</span>${v.pensamento ? `<small>“${escapeHtml(v.pensamento)}”</small>` : ''}</div>`).join('');
      return `<div class="judge verdict gloss"><div class="j-head">${avatar('👥', 'judge')}<div><b>Conselho de Sentença</b><small>7 jurados</small></div>${providerTag(a.provider)}</div><div class="jury">${votos}</div><div class="v-dec">${escapeHtml(a.decisao)} <small>${Math.max(condena, 7 - condena)} a ${Math.min(condena, 7 - condena)}</small></div><div class="j-body">${nl2br(a.texto)}</div>${dosimetriaHtml(a.dosimetria)}${resumoHtml(a.em_resumo)}${melhoresHtml(a.melhor)}</div>`;
    }
    case 'acordao': {
      const votos = (a.votos || []).map((v, i) => `<div class="des ${v.voto.replace(/\s/g, '-')}" style="animation-delay:${i * 0.6}s"><div class="d-head">${avatar(v.emoji)}<div><b>${escapeHtml(v.nome)}</b><small>${escapeHtml(v.papel)}</small></div><span class="d-vote">${escapeHtml(v.voto)}</span></div><div class="d-body">${escapeHtml(v.fundamento)}</div></div>`).join('');
      return `<div class="judge verdict gloss"><div class="j-head">${avatar('🏛️', 'judge')}<div><b>Tribunal de Justiça</b><small>1ª Câmara Criminal</small></div>${providerTag(a.provider)}</div>${votos}<div class="v-dec">Recurso ${escapeHtml(a.resultado)}</div><div class="j-body">${nl2br(a.texto)}</div>${resumoHtml(a.em_resumo)}</div>`;
    }
    default: return `<div class="auto-nota">${escapeHtml(a.texto || '')}</div>`;
  }
}

function melhoresHtml(m){
  if(!m || (!m.acusacao && !m.defesa)) return '';
  return `<div class="best">${['acusacao', 'defesa'].filter(r => m[r]).map(r => `<div class="fb ${r}"><span>Melhor momento · ${escapeHtml(nameOf(G.room, r))}</span>${escapeHtml(m[r])}</div>`).join('')}</div>`;
}

function renderAutos(room){
  const box = $('autos'); if(!box) return;
  let added = 0, lastTipo = '';
  for(const a of autosList(room)){
    if(renderedAutos.has(a.key)) continue;
    renderedAutos.add(a.key);
    const html = autoHtml(a);
    if(!html) continue;
    const el = document.createElement('div');
    el.className = 'auto-item' + (firstAutosRender ? '' : ' new');
    el.dataset.key = a.key;
    el.innerHTML = html;
    el.querySelectorAll('.gloss').forEach(applyGlossary);
    box.appendChild(el);
    added++; lastTipo = a.tipo;
  }
  if(!added) return;
  const wasFirst = firstAutosRender;
  firstAutosRender = false;
  scrollAutos(!wasFirst);
  if(wasFirst) return;
  if(lastTipo === 'reviravolta'){ playSound('twist'); vibrate([90, 60, 90, 60, 160]); }
  else if(['sentenca', 'juri', 'acordao'].includes(lastTipo)){ vibrate([200, 80, 200]); }
  else if(['decisao', 'pronuncia', 'acordo_decisao', 'diligencia'].includes(lastTipo)) playSound('judge');
  else if(lastTipo !== 'fase') playSound('message');
  if(!document.querySelector('.nav-btn[data-tab="audiencia"]')?.classList.contains('active')) $('aud-notif')?.classList.add('show');
}

// Risca nas peças os trechos desconsiderados e esconde os botões de questão de ordem que já não valem
function syncAutosMarks(room){
  for(const [key, trechos] of Object.entries(room.desconsiderados || {})){
    const body = document.querySelector(`.auto-item[data-key="${key}"] .b-body`);
    if(!body) continue;
    for(const t of Object.values(trechos)){
      const h = escapeHtml(t);
      if(h && body.innerHTML.includes(h) && !body.innerHTML.includes(`<del>${h}</del>`)) body.innerHTML = body.innerHTML.split(h).join(`<del>${h}</del>`);
    }
  }
  const esgotou = (room.impugnacoes?.[me()] || 0) >= MAX_QO || room.phase === 'fim';
  document.querySelectorAll('.qo-btn').forEach(b => { b.hidden = esgotou || Boolean(room.qo?.[b.dataset.qo]); });
}

function scrollAutos(smooth){
  const box = $('autos-scroll'); if(!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function renderPending(room){
  const slot = $('pending-slot'); if(!slot) return;
  const pend = room.phase === 'instrucao' ? room.instrucao?.pending : null;
  if(!pend){ if(slot.dataset.key){ slot.innerHTML = ''; slot.dataset.key = ''; } return; }
  const open = !pend.protesto && now() < pend.ts + PROTEST_WINDOW_MS;
  const canProtest = open && pend.por !== me() && (room.instrucao.protestos?.[me()] || 0) < MAX_PROTESTOS;
  const key = `${pend.id}|${open}|${Boolean(pend.protesto)}|${canProtest}`;
  if(slot.dataset.key === key) return;
  const isNew = !slot.dataset.key?.startsWith(pend.id);
  slot.dataset.key = key;
  const t = witnessOf(room, pend.testemunhaId);
  const status = pend.protesto
    ? `<div class="pend-status hot">Protesto da ${ROLE_LABEL[pend.protesto.por]}! O juiz vai decidir…</div>`
    : open ? `<div class="pend-status">${pend.por === me() ? 'O adversário pode protestar' : 'Você pode protestar'} <b data-until="${pend.ts + PROTEST_WINDOW_MS}"></b></div>`
    : `<div class="pend-status">${escapeHtml(t?.nome || 'A testemunha')} está pensando…</div>`;
  const protest = canProtest ? `<div class="protest"><button class="protest-btn" type="button">Protesto, Excelência!</button><div class="motivos">${MOTIVOS_PROTESTO.map(m => `<button type="button" class="motivo" data-motivo="${m.id}"><b>${m.label}</b><small>${m.desc}</small></button>`).join('')}</div><small class="protest-left">Restam ${MAX_PROTESTOS - (room.instrucao.protestos?.[me()] || 0)} · protesto sem razão custa 1 ponto</small></div>` : '';
  slot.innerHTML = `<div class="pending ${roleBubbleClass(pend.por)}"><div class="b-head"><b class="who ${pend.por}">${escapeHtml(nameOf(room, pend.por))}</b><span>para ${t?.emoji || ''} ${escapeHtml(t?.nome || '')}</span></div><div class="b-body">${nl2br(pend.pergunta)}</div>${status}${protest}</div>`;
  if(canProtest){
    const box = slot.querySelector('.protest');
    slot.querySelector('.protest-btn').addEventListener('click', () => box.classList.add('open'));
    slot.querySelectorAll('.motivo').forEach(b => b.addEventListener('click', () => actions.protestar(b.dataset.motivo)));
    if(isNew){ playSound('tick'); vibrate(80); }
  }
  scrollAutos(true);
}

function renderBusy(room){
  const b = room.judge_busy;
  const show = b && now() - (b.ts || 0) < LOCK_MS;
  const html = show ? `<div class="busy"><span class="dots"><i></i><i></i><i></i></span>${escapeHtml(b.label || 'O tribunal está deliberando…')}</div>` : '';
  if($('busy-slot').innerHTML !== html){ $('busy-slot').innerHTML = html; if(html) scrollAutos(true); }
}

// ── Revelação do caso sorteado ("abertura do envelope") ──
function renderReveal(room){
  const el = $('reveal'); if(!el) return;
  if(room.phase === 'sorteio'){
    el.className = 'reveal-screen show drawing';
    el.innerHTML = `<div class="envelope"><div class="env-flap"></div><div class="env-body">⚖️</div></div><div class="rv-title">Sorteando o caso…</div><div class="rv-sub">${room.solo ? 'Você contra a IA' : 'Nenhum de vocês sabe qual vai ser'}</div>`;
    return;
  }
  const key = `reveal_${G.code}_${room.round || 0}`;
  if(!room.caseData || !me() || sessionStorage.getItem(key)) { if(el.classList.contains('drawing')) el.className = 'reveal-screen'; return; }
  sessionStorage.setItem(key, '1');
  const c = room.caseData;
  el.className = 'reveal-screen show opened';
  el.innerHTML = `<div class="rv-card">
      <div class="rv-kicker">${c.gerado ? 'Caso inédito' : c.tutorial ? 'Caso de treino' : `Caso ${escapeHtml(c.id)}`}</div>
      <div class="rv-name">${escapeHtml(c.nome)}</div>
      <div class="rv-tags">${(c.tags || []).map(t => `<span>${escapeHtml(t.t)}</span>`).join('')}</div>
      <div class="rv-role ${me()}"><small>Você é a</small>${ROLE_LABEL[me()]}</div>
      <div class="rv-vs">contra <b>${escapeHtml(nameOf(room, otherRole(me())))}</b></div>
      <button class="btn btn-primary" type="button" data-close>Abrir o processo</button>
    </div>`;
  playSound('twist'); vibrate([80, 50, 80]);
  el.querySelector('[data-close]').addEventListener('click', () => { el.className = 'reveal-screen'; G.onRevealClosed?.(); });
}

// ══════════════════════════════════════════════════════
// BARRA DE VEZ + GAVETA DE AÇÃO
// ══════════════════════════════════════════════════════
let panelKey = '';
let lastMine = false;
let currentPanel = null;

function renderPanel(room){
  const p = room.phase === 'sorteio' ? { key:'sorteio', mine:false, title:'Sorteando o caso…', html:'' } : panelFor(room);
  currentPanel = p;
  const key = `${room.phase}|${p.key}`;
  renderBar(p);
  if(p.mine && !lastMine){ vibrate([70, 40, 70]); playSound('turn'); flashTitle(); }
  lastMine = p.mine;
  if(key === panelKey) return;
  panelKey = key;
  const el = $('action-panel');
  el.innerHTML = p.html || '';
  // restaura rascunhos e liga os campos de texto
  el.querySelectorAll('textarea[data-draft], input[data-draft]').forEach(ta => {
    ta.value = loadDraft(ta.dataset.draft);
    ta.addEventListener('input', () => { saveDraft(ta.dataset.draft, ta.value); if(ta.tagName === 'TEXTAREA') autoGrow(ta, 260); });
    if(ta.tagName === 'TEXTAREA') autoGrow(ta, 260);
  });
  p.bind?.(el);
  // a gaveta só fica aberta se ainda houver algo para eu fazer nela
  if(!p.html) closeSheet();
  if(p.autoOpen) openSheet();
}

function renderBar(p){
  const bar = $('action-bar'); if(!bar) return;
  bar.className = `action-bar ${p.mine ? 'mine' : ''} ${p.html ? 'has-sheet' : ''}`;
  const html = `<div class="ab-text">${p.mine ? '<span class="ab-kicker">Sua vez</span>' : ''}<span class="ab-title">${p.title || ''}</span>${p.status ? `<span class="ab-status">${p.status}</span>` : ''}</div>${p.html ? `<button class="btn ${p.mine ? 'btn-primary' : 'btn-ghost'} ab-open" type="button">${p.cta || 'Abrir'}</button>` : '<span class="ab-wait"><i></i><i></i><i></i></span>'}`;
  if(bar.dataset.html === html) return;
  bar.dataset.html = html;
  bar.innerHTML = html;
  bar.querySelector('.ab-open')?.addEventListener('click', openSheet);
}

export function openSheet(){
  const s = $('sheet'); if(!s || !currentPanel?.html) return;
  s.classList.add('open');
  document.body.classList.add('sheet-open');
  setTimeout(() => s.querySelector('textarea:not([disabled])')?.focus({ preventScroll:true }), 260);
}
export function closeSheet(){
  $('sheet')?.classList.remove('open');
  document.body.classList.remove('sheet-open');
  document.activeElement?.blur?.();
}

let titleTimer = null;
function flashTitle(){
  if(!document.hidden) return;
  const base = document.title;
  let on = false;
  clearInterval(titleTimer);
  titleTimer = setInterval(() => { document.title = (on = !on) ? '⚖️ Sua vez!' : base; }, 900);
  const stop = () => { if(!document.hidden){ clearInterval(titleTimer); document.title = base; document.removeEventListener('visibilitychange', stop); } };
  document.addEventListener('visibilitychange', stop);
}

function waitP(key, title, status){ return { key, mine:false, title, status, html:'' }; }
function btn(id, label, cls = 'btn-primary'){ return `<button type="button" class="btn ${cls}" data-act="${id}">${label}</button>`; }
function textarea(draft, ph, rows = 4){ return `<textarea class="field" data-draft="${draft}" rows="${rows}" placeholder="${escapeHtml(ph)}"></textarea>`; }
// liga um botão a uma ação; se a ação der certo, fecha a gaveta
function on(el, act, fn){
  el.querySelector(`[data-act="${act}"]`)?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.classList.add('loading');
    try{ const ok = await fn(); if(ok) closeSheet(); }
    finally{ b.disabled = false; b.classList.remove('loading'); }
  });
}
const val = (el, draft) => el.querySelector(`[data-draft="${draft}"]`)?.value.trim() || '';
const sheetHead = (title, hint) => `<div class="sh-title">${title}</div>${hint ? `<div class="sh-hint">${hint}</div>` : ''}`;

function cartasHtml(room, allowed){
  const c = room.cartas?.[me()] || {};
  const cards = [
    { id:'diligencia', icon:'🔍', nome:'Diligência', desc:'investigação extra' },
    { id:'pergunta', icon:'➕', nome:'+2 perguntas', desc:'na instrução' },
    { id:'tempo', icon:'⏱', nome:'+90 segundos', desc:'na sua fala' }
  ].filter(k => allowed.includes(k.id));
  return `<div class="cards">${cards.map(k => `<button type="button" class="gcard ${c[k.id] > 0 ? '' : 'used'}" data-card="${k.id}" ${c[k.id] > 0 ? '' : 'disabled'}><span>${k.icon}</span><b>${k.nome}</b><small>${c[k.id] > 0 ? k.desc : 'usada'}</small></button>`).join('')}</div>`;
}

function bindCartas(el){
  el.querySelectorAll('.gcard').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.card;
    if(k === 'pergunta') return actions.cartaPergunta();
    if(k === 'tempo') return actions.cartaTempo();
    if(k === 'diligencia'){ const box = el.querySelector('.sub-form.dilig'); box.classList.toggle('open'); box.querySelector('textarea')?.focus(); }
  }));
  on(el, 'diligencia', () => actions.cartaDiligencia(val(el, 'diligencia')));
}
const diligFormHtml = () => `<div class="sub-form dilig">${textarea('diligencia', 'O que deve ser investigado? Ex.: "perícia no celular do réu", "imagens da câmera do corredor"', 2)}${btn('diligencia', 'Requerer diligência', 'btn-secondary')}</div>`;

function panelFor(room){
  const role = me();
  if(!role) return waitP('?', 'Assistindo', '');
  const opp = otherRole(role);
  const oppName = escapeHtml(nameOf(room, opp));

  switch(room.phase){
    case 'acordo': {
      const a = room.acordo || {};
      if(a.status === 'proposta'){
        if(role === 'acusacao') return { key:'acu-proposta', mine:true, title:'Oferecer acordo?', cta:'Decidir', html:`
          ${sheetHead('Oferecer acordo de não persecução penal?', 'Cabe em crime sem violência, com pena mínima menor que 4 anos e confissão. Condições comuns: prestação de serviços, reparação do dano, multa.')}
          ${textarea('acordo', 'Ex.: confissão, reparação integral do dano em 30 dias e 8 meses de prestação de serviços à comunidade', 3)}
          <div class="row">${btn('sem', 'Não oferecer', 'btn-secondary')}${btn('propor', 'Propor acordo')}</div>`,
          bind: el => { on(el, 'propor', () => actions.proporAcordo(val(el, 'acordo'))); on(el, 'sem', () => actions.semAcordo()); } };
        return waitP('def-espera-proposta', `${oppName} decide se oferece acordo`, 'Leia o caso enquanto isso');
      }
      if(a.status === 'resposta'){
        if(role === 'defesa') return { key:'def-resposta', mine:true, title:'Proposta de acordo recebida', cta:'Responder', autoOpen:true, html:`
          ${sheetHead('A Acusação ofereceu um acordo', 'Se aceitar, o réu confessa, cumpre as condições e o processo acaba aqui (o juiz ainda precisa homologar). Se recusar, vai a julgamento.')}
          <div class="offer">${nl2br(a.termos)}</div>
          <div class="row">${btn('recusar', 'Recusar', 'btn-secondary')}${btn('aceitar', 'Aceitar acordo')}</div>`,
          bind: el => { on(el, 'aceitar', () => actions.responderAcordo(true)); on(el, 'recusar', () => actions.responderAcordo(false)); } };
        return waitP('acu-espera-resposta', `${oppName} avalia a sua proposta`, '');
      }
      return waitP('acordo-' + a.status, 'O juiz analisa o acordo', '');
    }

    case 'denuncia': {
      const p = room.pecas || {};
      if(!p.denuncia){
        if(role === 'acusacao') return { key:'acu-denuncia', mine:true, title:'Escrever a denúncia', cta:'Escrever', html:`
          ${sheetHead('Denúncia', 'Diga <b>quem</b> fez, <b>o que</b> fez, <b>quando e onde</b>, <b>qual crime</b> (artigo) e peça a <b>condenação</b>.')}
          ${textarea('denuncia', 'O Ministério Público denuncia… porque no dia… A conduta configura o crime do Art. … Requer o recebimento da denúncia e a condenação.', 7)}
          <div class="row">${btn('modelo', 'Usar modelo', 'btn-secondary')}${btn('enviar', 'Denunciar')}</div>`,
          bind: el => {
            el.querySelector('[data-act="modelo"]').addEventListener('click', () => {
              const ta = el.querySelector('[data-draft="denuncia"]');
              if(!ta.value){ ta.value = `O Ministério Público denuncia o réu porque, no dia dos fatos, [descreva o que ele fez].\nA conduta se enquadra no ${caseOf(room).arts_rapidos?.[0] || 'Art. ___ do Código Penal'}.\nRequer o recebimento da denúncia, a citação do réu e, ao final, a condenação.`; saveDraft('denuncia', ta.value); autoGrow(ta, 260); }
            });
            on(el, 'enviar', () => actions.enviarPeca('denuncia', val(el, 'denuncia')));
          } };
        return waitP('def-espera-denuncia', `${oppName} escreve a denúncia`, 'Estude o caso e o vade mecum');
      }
      if(!p.resposta){
        if(role === 'defesa') return { key:'def-resposta', mine:true, title:'Responder à acusação', cta:'Escrever', html:`
          ${sheetHead('Resposta à acusação', 'Aponte <b>provas fracas</b>, <b>nulidades</b> (algo feito errado na investigação), <b>excludentes</b> (legítima defesa, estado de necessidade…) e o que você vai provar.')}
          ${textarea('resposta', 'A defesa responde: preliminarmente… No mérito… Requer a absolvição.', 7)}
          <div class="row">${btn('enviar', 'Apresentar resposta')}</div>`,
          bind: el => on(el, 'enviar', () => actions.enviarPeca('resposta', val(el, 'resposta'))) };
        return waitP('acu-espera-resposta', `${oppName} prepara a resposta`, '');
      }
      return waitP('den-juiz', 'O juiz analisa as peças', '');
    }

    case 'instrucao': {
      if(!room.instrucao?.limite) return waitP('ins-wait', 'Abrindo a audiência', '');
      const ins = room.instrucao;
      const d = dossieOf(room);
      const feitas = ins.perguntas?.[role] || 0;
      const lim = ins.limite?.[role] || 0;
      const pronto = ins.pronto?.[role] || feitas >= lim;
      const oppDone = ins.pronto?.[opp] || (ins.perguntas?.[opp] || 0) >= (ins.limite?.[opp] || 0);
      const contrLeft = MAX_CONTRADICOES - (ins.contradicoes?.[role] || 0);
      const ouvidas = [...new Set(autosList(room).filter(a => a.tipo === 'depoimento').map(a => a.testemunhaId))];
      const silencio = role === 'defesa' ? `<label class="toggle"><input type="checkbox" data-silencio ${ins.silencio ? 'checked' : ''}><span></span>Réu em silêncio diante da Acusação</label>` : '';
      const contrForm = contrLeft > 0 && ouvidas.length ? `<div class="sub-form contr">
          <div class="sf-title">Excelência, há uma contradição!</div>
          <div class="chips">${ouvidas.map(id => { const t = witnessOf(room, id); return `<button type="button" class="chip" data-contr="${id}">${t.emoji} ${escapeHtml(t.nome.split(' ')[0])}</button>`; }).join('')}</div>
          ${textarea('contradicao', 'O que ela disse e o que a prova mostra? Ex.: "Ele disse que chegou às 2h, mas a mensagem no grupo é das 2h55."', 2)}
          ${btn('contradicao', `Apontar contradição (+3 / −1) · restam ${contrLeft}`, 'btn-secondary')}</div>` : '';
      const key = `ins|${feitas}|${lim}|${pronto}|${oppDone}|${ins.silencio}|${contrLeft}|${ouvidas.length}|${JSON.stringify(room.cartas?.[role])}`;
      if(pronto) return { key, mine:false, title: oppDone ? 'Encerrando a instrução' : `${oppName} ainda está perguntando`, status: 'Você pode protestar contra as perguntas', cta:'Opções',
        html: silencio || contrForm ? `${sheetHead('Suas perguntas acabaram', 'Você ainda pode apontar contradições ou orientar o silêncio do réu.')}${contrForm}${silencio}` : '',
        bind: el => { bindContr(el); el.querySelector('[data-silencio]')?.addEventListener('change', e => actions.toggleSilencio(e.target.checked)); } };
      return { key, mine:true, title:`Perguntar às testemunhas`, status:`${feitas} de ${lim} perguntas`, cta:'Perguntar', html:`
        ${sheetHead('Quem vai responder?', '')}
        <div class="wit-pick">${d.testemunhas.map(t => {
          const n = autosList(room).filter(a => a.tipo === 'depoimento' && a.testemunhaId === t.id).length;
          return `<button type="button" class="wit" data-wit="${t.id}">${avatar(t.emoji)}<b>${escapeHtml(t.nome)}</b><small>${escapeHtml(t.papel_txt)}${n ? ` · ${n}x` : ''}</small></button>`;
        }).join('')}</div>
        ${textarea('pergunta', 'Sua pergunta. Perguntas específicas arrancam segredos; "não é verdade que…?" pode levar protesto.', 2)}
        <div class="row">${btn('encerrar', 'Encerrar', 'btn-secondary')}${btn('perguntar', 'Perguntar')}</div>
        ${contrForm}
        ${silencio}
        <div class="sf-label">Suas cartas</div>${cartasHtml(room, ['diligencia', 'pergunta'])}${diligFormHtml()}`,
        bind: el => {
          let sel = sessionStorage.getItem('wit_sel') || '';
          const mark = () => el.querySelectorAll('.wit').forEach(b => b.classList.toggle('sel', b.dataset.wit === sel));
          el.querySelectorAll('.wit').forEach(b => b.addEventListener('click', () => { sel = b.dataset.wit; sessionStorage.setItem('wit_sel', sel); mark(); el.querySelector('[data-draft="pergunta"]').focus(); }));
          mark();
          on(el, 'perguntar', () => actions.perguntar(sel, val(el, 'pergunta')));
          on(el, 'encerrar', async () => confirm('Encerrar suas perguntas? Você não poderá perguntar mais nesta audiência.') && actions.encerrarPerguntas());
          el.querySelector('[data-silencio]')?.addEventListener('change', e => actions.toggleSilencio(e.target.checked));
          bindContr(el);
          bindCartas(el);
        } };
    }

    case 'debates': {
      const d = room.debates;
      if(!d || !TURNOS[d.turno]) return waitP('deb-fim', d ? 'Debates encerrados' : 'Preparando os debates', '');
      const turno = TURNOS[d.turno];
      const deadline = d.inicio + (turno.seg + (d.extra || 0)) * 1000;
      const juri = room.rito === 'juri';
      const key = `deb|${d.turno}|${d.extra}|${JSON.stringify(room.cartas?.[role])}`;
      const clock = `<b class="clock" data-until="${deadline}"></b>`;
      if(turno.role !== role) return { ...waitP(key, `${escapeHtml(nameOf(room, turno.role))} está com a palavra`, clock) };
      const primeira = turno.tipo === 'alegacao';
      return { key, mine:true, title: turno.titulo.replace(/ da (Acusação|Defesa)/, ''), status: clock, cta:'Falar', autoOpen:true, html:`
        ${sheetHead(`${escapeHtml(turno.titulo)} · ${clock}`, juri ? 'Você fala para <b>7 jurados</b>: gente comum, que decide pela emoção e pela clareza. Conte uma história, mostre as provas.' : 'Você fala para o juiz: retome as provas e os depoimentos, e rebata o adversário.')}
        ${textarea('alegacao_' + d.turno, primeira ? (juri ? 'Senhores jurados, imaginem a cena…' : 'Excelência, as provas mostram que…') : 'Rebata o último argumento do adversário…', 7)}
        ${primeira ? `<input class="field" data-draft="pedido" maxlength="80" placeholder="${role === 'acusacao' ? 'Seu pedido: ex. condenação a 4 anos, semiaberto' : 'Seu pedido: ex. absolvição'}">` : ''}
        <div class="row">${d.turno === 2 ? btn('dispensar', 'Dispensar réplica', 'btn-secondary') : ''}${btn('enviar', 'Encerrar minha fala')}</div>
        <div class="sh-foot">Quando o tempo acabar, o que estiver escrito é enviado.</div>
        ${cartasHtml(room, ['tempo'])}`,
        bind: el => {
          on(el, 'enviar', () => actions.enviarAlegacao(val(el, 'alegacao_' + d.turno), primeira ? val(el, 'pedido') : null));
          on(el, 'dispensar', () => actions.dispensarReplica());
          bindCartas(el);
        } };
    }

    case 'julgamento':
      return waitP('julg', room.rito === 'juri' ? 'Os jurados estão votando' : 'O juiz redige a sentença', '');

    case 'recurso': {
      if(!room.recurso) return waitP('rec-wait', 'Abrindo o prazo de recurso', '');
      const r = room.recurso;
      const perdedores = r.perdedor === 'ambos' ? ['acusacao', 'defesa'] : [r.perdedor];
      const souPerdedor = perdedores.includes(role);
      if(r.status === 'decidir'){
        if(souPerdedor && !r.aceitou?.[role]) return { key:'rec-decidir', mine:true, title: r.perdedor === 'ambos' ? 'Decisão parcial: recorrer?' : 'Apelar da sentença?', cta:'Decidir', autoOpen:true, html:`
          ${sheetHead(r.perdedor === 'ambos' ? 'A decisão foi parcial. Quer recorrer?' : 'Você perdeu. Quer apelar ao Tribunal?', 'Três desembargadores vão revisar: uma garantista, um linha-dura e um técnico.')}
          <div class="offer">${escapeHtml(room.julgamento?.resumo || '')}</div>
          <div class="row">${btn('aceitar', 'Aceitar', 'btn-secondary')}${btn('apelar', 'Apelar')}</div>`,
          bind: el => { on(el, 'apelar', () => actions.apelar()); on(el, 'aceitar', () => actions.aceitarDecisao()); } };
        return waitP('rec-espera', souPerdedor ? 'Aguardando o outro lado decidir' : `${oppName} decide se apela`, '');
      }
      if(r.status === 'razoes'){
        if(r.apelante === role) return { key:'rec-razoes', mine:true, title:'Escrever a apelação', cta:'Escrever', autoOpen:true, html:`
          ${sheetHead('Razões de apelação', 'Mostre o que o juiz errou: prova mal avaliada, pena exagerada (ou branda demais), nulidade…')}
          ${textarea('razoes', 'Egrégio Tribunal, a sentença merece reforma porque…', 7)}
          <div class="row">${btn('enviar', 'Enviar apelação')}</div>`,
          bind: el => on(el, 'enviar', () => actions.enviarRazoes(val(el, 'razoes'))) };
        return waitP('rec-espera-razoes', `${escapeHtml(nameOf(room, r.apelante))} escreve a apelação`, '');
      }
      if(r.status === 'contrarrazoes'){
        if(r.apelante !== role) return { key:'rec-contra', mine:true, title:'Responder ao recurso', cta:'Escrever', autoOpen:true, html:`
          ${sheetHead('Contrarrazões', 'O adversário recorreu. Mostre por que o juiz acertou.')}
          ${textarea('contrarrazoes', 'A sentença deve ser mantida porque…', 6)}
          <div class="row">${btn('dispensar', 'Não apresentar', 'btn-secondary')}${btn('enviar', 'Enviar')}</div>`,
          bind: el => { on(el, 'enviar', () => actions.enviarContrarrazoes(val(el, 'contrarrazoes'))); on(el, 'dispensar', () => actions.enviarContrarrazoes('', true)); } };
        return waitP('rec-espera-contra', `${oppName} responde ao seu recurso`, '');
      }
      return waitP('rec-julgando', 'A Câmara Criminal está reunida', '');
    }

    case 'fim': return finalPanel(room);
  }
  return waitP('?', '', '');
}

function bindContr(el){
  let sel = '';
  el.querySelectorAll('[data-contr]').forEach(b => b.addEventListener('click', () => { sel = b.dataset.contr; el.querySelectorAll('[data-contr]').forEach(x => x.classList.toggle('sel', x === b)); }));
  on(el, 'contradicao', () => actions.apontarContradicao(sel, val(el, 'contradicao')));
}

let careerSaved = false;
function finalPanel(room){
  const s = room.score || {};
  const role = me();
  const res = computeResult(room, role);
  const vencedor = room.final?.vencedor;
  const placarWin = s.acusacao === s.defesa ? null : (s.acusacao > s.defesa ? 'acusacao' : 'defesa');
  const titulo = placarWin === role ? 'Você venceu!' : placarWin ? `${escapeHtml(nameOf(room, placarWin))} venceu` : 'Empate';
  return { key:'fim', mine:true, title: titulo, cta:'Resultado', autoOpen:true, html:`
    <div class="final">
      <div class="f-kicker">${escapeHtml(room.caseData?.nome || '')}</div>
      <div class="f-title ${placarWin === role ? 'win' : ''}">${titulo}</div>
      <div class="f-score"><div class="fs acusacao"><b>${s.acusacao || 0}</b><small>${escapeHtml(nameOf(room, 'acusacao'))}</small><span>Acusação</span></div><div class="fs defesa"><b>${s.defesa || 0}</b><small>${escapeHtml(nameOf(room, 'defesa'))}</small><span>Defesa</span></div></div>
      <div class="f-proc">${escapeHtml(room.final?.texto || '')}${room.final?.bonus ? ` <b>A causa foi ganha pela ${ROLE_LABEL[vencedor]} (+5).</b>` : vencedor === 'empate' ? ' <b>Resultado dividido.</b>' : ''}</div>
      ${res.conquistas.length ? `<div class="sf-label">Conquistas</div><div class="achs">${res.conquistas.map(c => `<div class="ach"><span>${c.emoji}</span><b>${c.nome}</b><small>${c.desc}</small></div>`).join('')}</div>` : ''}
      <div class="xp">+${res.xp} XP</div>
      <div id="final-career"></div>
      <div class="row">${btn('novo', 'Sortear próximo caso')}</div>
      <div class="sh-foot">No próximo caso, vocês trocam de papel.</div>
    </div>`,
    bind: el => {
      playSound(placarWin === role ? 'win' : 'gavel');
      on(el, 'novo', async () => { if(confirm('Sortear o próximo caso? Vocês trocam de papel.')) await actions.novoCaso(); return false; });
      if(!careerSaved && G.me.name){
        careerSaved = true;
        // se a carreira já foi somada (ex.: recarregou a página no fim), só mostra a atual
        saveCareer(G.db, G.me.name, { ...room, code: G.code }, role, res)
          .then(c => c || G.db.ref(`career/${slug(G.me.name)}`).once('value').then(s => s.val()))
          .then(c => { if(c && $('final-career')) $('final-career').innerHTML = careerCardHtml(c); })
          .catch(e => console.warn('carreira', e));
      }
    } };
}

// Atualiza relógios e reavalia o painel (janela de protesto, prazos)
export function tick(){
  const room = G.room; if(!room) return;
  document.querySelectorAll('[data-until]').forEach(el => {
    const left = Number(el.dataset.until) - now();
    el.textContent = fmtClock(left);
    el.classList.toggle('urgent', left < 20000);
  });
  renderPending(room);
  renderBusy(room);
  autopilot();
}

// Contexto extra para o assistente privado
export function assistContext(){
  const room = G.room;
  const d = dossieOf(room);
  const nivel = nivelOf(room, me());
  return {
    extra: { ...aiContext(room), fase: FASES[room.phase]?.nome, nivel, segredos: me() === 'acusacao' ? d.segredo_acu : d.segredo_def },
    limite: ASSIST_LIMITE[nivel], usados: room.assistUses?.[me()] || 0,
    caseObj: caseOf(room)
  };
}
export async function countAssistUse(){ await G.roomRef.child(`assistUses/${me()}`).transaction(v => (v || 0) + 1); }
