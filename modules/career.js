// modules/career.js — carreira dos jogadores: XP, níveis e conquistas (salvo no Firebase)
import { escapeHtml, slug } from './util.js';

export const NIVEIS_JOGO = {
  estagiario: { label: 'Estagiário', emoji: '🎒', mult: 1, desc: 'Dicas, assistente sem limite e juiz paciente' },
  advogado: { label: 'Advogado', emoji: '💼', mult: 1.5, desc: 'Assistente limitado (5 perguntas) e juiz exigente' },
  jurista: { label: 'Jurista', emoji: '🎓', mult: 2, desc: 'Sem assistente e juiz implacável. XP em dobro' }
};

export const PATENTES = [
  { xp: 0, nome: 'Estagiário(a)', emoji: '🎒' },
  { xp: 300, nome: 'Advogado(a) Júnior', emoji: '📎' },
  { xp: 800, nome: 'Advogado(a)', emoji: '💼' },
  { xp: 1600, nome: 'Advogado(a) Sênior', emoji: '🗂️' },
  { xp: 3000, nome: 'Jurista', emoji: '🎓' },
  { xp: 5000, nome: 'Lenda do Tribunal', emoji: '🏛️' }
];

export function patente(xp = 0){
  let atual = PATENTES[0], prox = null;
  for(const p of PATENTES){ if(xp >= p.xp) atual = p; else { prox = p; break; } }
  return { atual, prox, progresso: prox ? (xp - atual.xp) / (prox.xp - atual.xp) : 1 };
}

const CONQUISTAS = {
  vitoria: { emoji: '🏆', nome: 'Vitória', desc: 'Venceu a partida no placar' },
  processo: { emoji: '⚖️', nome: 'Causa ganha', desc: 'O resultado final do processo foi o que você pediu' },
  protesto: { emoji: '✋', nome: 'Protesto certeiro', desc: 'Teve um protesto deferido pelo juiz' },
  segredo: { emoji: '🔓', nome: 'Segredo arrancado', desc: 'Fez uma testemunha revelar um segredo' },
  detetive: { emoji: '🕵️', nome: 'Detetive', desc: 'Usou uma diligência' },
  acordo: { emoji: '🤝', nome: 'Bom acordo', desc: 'Fechou um acordo homologado' },
  juri: { emoji: '👥', nome: 'Júri convencido', desc: 'Venceu no Júri com 5 votos ou mais' },
  virada: { emoji: '🔄', nome: 'Virada no Tribunal', desc: 'Reverteu a sentença na apelação' },
  unanime: { emoji: '🧱', nome: 'Unanimidade', desc: 'Ganhou o recurso por 3 a 0' }
};

// Calcula as conquistas e o XP de um lado ao fim da partida
export function computeResult(room, role){
  const autos = Object.values(room.autos || {});
  const score = room.score || {};
  const opp = role === 'acusacao' ? 'defesa' : 'acusacao';
  const got = new Set();
  if((score[role] || 0) > (score[opp] || 0)) got.add('vitoria');
  if(room.final?.vencedor === role) got.add('processo');
  if(autos.some(a => a.tipo === 'protesto' && a.protestoPor === role && a.decisao === 'deferido')) got.add('protesto');
  if(autos.some(a => a.tipo === 'depoimento' && a.por === role && a.revelou)) got.add('segredo');
  if(autos.some(a => a.tipo === 'diligencia' && a.por === role)) got.add('detetive');
  if(autos.some(a => a.tipo === 'acordo_decisao' && a.homologado)) got.add('acordo');
  const juri = autos.find(a => a.tipo === 'juri');
  if(juri){
    const condena = (juri.votos || []).filter(v => v.voto === 'condena').length;
    const meus = role === 'acusacao' ? condena : 7 - condena;
    if(meus >= 5) got.add('juri');
  }
  const acordao = autos.find(a => a.tipo === 'acordao');
  if(acordao && room.recurso?.apelante === role && acordao.resultado !== 'desprovido') got.add('virada');
  if(acordao){
    const ganhou = room.recurso?.apelante === role ? 'provido' : 'desprovido';
    if((acordao.votos || []).filter(v => v.voto === ganhou).length === 3) got.add('unanime');
  }
  const nivel = room.players?.[role]?.nivel || 'advogado';
  const base = (score[role] || 0) * 5 + got.size * 25 + (got.has('processo') ? 50 : 0);
  return { conquistas: [...got].map(k => ({ id: k, ...CONQUISTAS[k] })), xp: Math.round(base * NIVEIS_JOGO[nivel].mult) };
}

// Soma o resultado na carreira do jogador (uma vez por rodada, por aparelho)
export async function saveCareer(db, name, room, role, result){
  const key = `career_done_${room.code}_${room.round || 0}_${role}`;
  try{ if(localStorage.getItem(key)) return null; localStorage.setItem(key, '1'); }catch(e){}
  const ref = db.ref(`career/${slug(name)}`);
  const tx = await ref.transaction(c => {
    c = c || { nome: name, xp: 0, partidas: 0, vitorias: 0, conquistas: {} };
    c.nome = name;
    c.xp = (c.xp || 0) + result.xp;
    c.partidas = (c.partidas || 0) + 1;
    if(result.conquistas.some(x => x.id === 'vitoria')) c.vitorias = (c.vitorias || 0) + 1;
    c.conquistas = c.conquistas || {};
    result.conquistas.forEach(x => { c.conquistas[x.id] = (c.conquistas[x.id] || 0) + 1; });
    return c;
  });
  return tx.snapshot.val();
}

export async function loadCareers(db){
  const snap = await db.ref('career').once('value');
  return Object.values(snap.val() || {}).sort((a, b) => (b.xp || 0) - (a.xp || 0));
}

export function careerCardHtml(c){
  const p = patente(c.xp);
  const badges = Object.entries(c.conquistas || {}).map(([k, n]) => CONQUISTAS[k] ? `<span class="badge" title="${escapeHtml(CONQUISTAS[k].desc)}">${CONQUISTAS[k].emoji} ${n > 1 ? `×${n}` : ''}</span>` : '').join('');
  return `<div class="career-card">
    <div class="career-top"><span class="career-emoji">${p.atual.emoji}</span><div><div class="career-name">${escapeHtml(c.nome)}</div><div class="career-rank">${p.atual.nome} · ${c.xp || 0} XP</div></div><div class="career-stats">${c.vitorias || 0}V / ${c.partidas || 0}P</div></div>
    <div class="xp-bar"><div class="xp-fill" style="width:${Math.round(p.progresso * 100)}%"></div></div>
    <div class="career-next">${p.prox ? `Próxima patente: ${p.prox.emoji} ${p.prox.nome} (${p.prox.xp} XP)` : 'Patente máxima!'}</div>
    ${badges ? `<div class="career-badges">${badges}</div>` : ''}
  </div>`;
}
