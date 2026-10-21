// main.js — lobby, sessão, navegação, notas e assistente. O processo em si fica em modules/game.js.
import { ask } from './ai-bridge.js';
import { G, render, tick, assistContext, countAssistUse, roleOf, newEvidence, openSheet, closeSheet } from './modules/game.js';
import { renderCase, renderNewEvidence } from './modules/case_view.js';
import { NIVEIS_JOGO, loadCareers, careerCardHtml } from './modules/career.js';
import { $, escapeHtml, toast, ROLE_LABEL, otherRole, autoGrow, moderate, playSound, initGlossaryPopover, slug } from './modules/util.js';

const SESSION_KEY = 'tribunal_session';
const IN_GAME_KEY = 'tribunal_in_game';
const lobby = { nivelCreate: 'advogado', nivelJoin: 'advogado' };
let waitingHandler = null;

// ══════════════════════════════════════════════════════
// Sessão (por aba no sessionStorage, e no localStorage para o botão "Voltar para a sala")
// ══════════════════════════════════════════════════════
function saveSession(){
  const s = JSON.stringify({ roomCode: G.code, myName: G.me.name });
  try{ localStorage.setItem(SESSION_KEY, s); sessionStorage.setItem(SESSION_KEY, s); }catch(e){}
}
function loadSession(){
  try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){ return null; }
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(IN_GAME_KEY); }catch(e){} }

function newRoomCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I para não confundir
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function initFirebase(){
  try{
    if(G.db) return true;
    if(!window.firebase) throw new Error('Firebase SDK não carregado');
    if(!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    G.db = firebase.database();
    G.db.ref('.info/serverTimeOffset').on('value', s => { G.serverOffset = s.val() || 0; });
    return true;
  }catch(e){ console.error('initFirebase', e); return false; }
}

// ══════════════════════════════════════════════════════
// LOBBY
// ══════════════════════════════════════════════════════
function nivelPicker(target){
  return Object.entries(NIVEIS_JOGO).map(([k, n]) => `<button type="button" class="seg ${k === lobby[target] ? 'sel' : ''}" data-nivel="${k}" data-target="${target}"><span>${n.emoji}</span><b>${n.label}</b></button>`).join('') + `<div class="seg-desc">${NIVEIS_JOGO[lobby[target]].desc}</div>`;
}
function renderNivelPickers(){
  $('nivel-create').innerHTML = nivelPicker('nivelCreate');
  $('nivel-join').innerHTML = nivelPicker('nivelJoin');
  document.querySelectorAll('.seg').forEach(b => b.addEventListener('click', () => { lobby[b.dataset.target] = b.dataset.nivel; renderNivelPickers(); }));
}

function initLobby(){
  renderNivelPickers();
  $('inp-room-code')?.addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('btn-career')?.addEventListener('click', showCareers);
  try{ const n = localStorage.getItem('tribunal_nome'); if(n){ $('inp-name-create').value = n; $('inp-name-join').value = n; } }catch(e){}
  // link de convite: ?sala=ABCD já preenche o código
  const sala = new URLSearchParams(location.search).get('sala');
  if(sala){ $('inp-room-code').value = sala.toUpperCase().slice(0, 4); showLobbyTab('join'); }
  renderResumeCard();
  if(sessionStorage.getItem(IN_GAME_KEY) && loadSession()) resumeSession();
}

function showLobbyTab(t){
  document.querySelectorAll('.lobby-tab').forEach(b => b.classList.toggle('active', b.dataset.lt === t));
  $('card-create').classList.toggle('show', t === 'create');
  $('card-join').classList.toggle('show', t === 'join');
}

function renderResumeCard(){
  const card = $('card-resume');
  const s = loadSession();
  if(!s?.roomCode){ card.style.display = 'none'; return; }
  card.style.display = '';
  $('resume-text').textContent = `Sala ${s.roomCode} · ${s.myName}`;
}

function rememberName(name){ try{ localStorage.setItem('tribunal_nome', name); }catch(e){} }

async function createRoom(){
  if(!initFirebase()){ toast('Erro ao conectar ao servidor do jogo'); return; }
  const name = $('inp-name-create').value.trim();
  if(!name){ toast('Digite seu nome'); $('inp-name-create').focus(); return; }
  const btn = $('btn-create'); btn.disabled = true; btn.classList.add('loading');
  try{
    let code = newRoomCode();
    for(let tries = 0; tries < 5 && (await G.db.ref(`rooms/${code}`).once('value')).exists(); tries++) code = newRoomCode();
    await G.db.ref(`rooms/${code}`).set({
      code, creator: name, round: 0, solo: false, phase: 'sorteio',
      tutorial: $('chk-tutorial').checked,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      lobby: { [slug(name)]: { name, nivel: lobby.nivelCreate } }
    });
    rememberName(name);
    G.code = code; G.me = { name, role: '' };
    G.roomRef = G.db.ref(`rooms/${code}`);
    saveSession();
    showWaiting();
  }catch(e){ toast('Erro: ' + e.message); }
  finally{ btn.disabled = false; btn.classList.remove('loading'); }
}

async function joinRoom(){
  if(!initFirebase()){ toast('Erro ao conectar ao servidor do jogo'); return; }
  const name = $('inp-name-join').value.trim();
  const code = $('inp-room-code').value.trim().toUpperCase();
  if(!name){ toast('Digite seu nome'); $('inp-name-join').focus(); return; }
  if(code.length !== 4){ toast('O código tem 4 caracteres'); return; }
  const btn = $('btn-join'); btn.disabled = true; btn.classList.add('loading');
  try{
    const ref = G.db.ref(`rooms/${code}`);
    const room = (await ref.once('value')).val();
    if(!room){ toast('Sala não encontrada'); return; }
    rememberName(name);
    // quem já está na sala com esse nome volta para ela (ex.: recarregou a página)
    if(room.lobby?.[slug(name)]){ await enterRoom(code, name); return; }
    if(room.solo){ toast('Essa sala está no modo treino (contra a IA)'); return; }
    const tx = await ref.child('lobby').transaction(l => {
      l = l || {};
      if(Object.keys(l).length >= 2) return undefined;
      l[slug(name)] = { name, nivel: lobby.nivelJoin };
      return l;
    });
    if(!tx.committed){ toast('Essa sala já tem dois jogadores'); return; }
    await enterRoom(code, name);
  }catch(e){ toast('Erro: ' + e.message); }
  finally{ btn.disabled = false; btn.classList.remove('loading'); }
}

async function resumeSession(){
  const s = loadSession();
  if(!s) return;
  if(!initFirebase()){ toast('Erro ao conectar ao servidor do jogo'); return; }
  const room = (await G.db.ref(`rooms/${s.roomCode}`).once('value')).val();
  if(!room){ clearSession(); renderResumeCard(); toast('Essa sala não existe mais'); return; }
  await enterRoom(s.roomCode, s.myName);
}

function forgetSession(){ clearSession(); renderResumeCard(); }

async function enterRoom(code, name){
  const ref = G.db.ref(`rooms/${code}`);
  const room = (await ref.once('value')).val() || {};
  if(!room.lobby?.[slug(name)]){ clearSession(); renderResumeCard(); toast('Você não está nesta sala.'); return; }
  G.code = code; G.me = { name, role: roleOf(room, name) }; G.roomRef = ref;
  saveSession();
  if(Object.keys(room.lobby).length < 2 && !room.solo) showWaiting();
  else launchGame(room);
}

function showWaiting(){
  $('lobby-main').style.display = 'none';
  $('card-waiting').style.display = '';
  $('waiting-code').textContent = G.code;
  waitingHandler = G.roomRef.on('value', snap => {
    const room = snap.val(); if(!room) return;
    const players = Object.values(room.lobby || {});
    $('players-list').innerHTML = [0, 1].map(i => {
      const p = players[i];
      return `<div class="player ${p ? '' : 'empty'}"><span class="avatar">${p ? (NIVEIS_JOGO[p.nivel]?.emoji || '🙂') : '…'}</span><b>${p ? escapeHtml(p.name) + (p.name === G.me.name ? ' (você)' : '') : 'Aguardando…'}</b><small>${p ? NIVEIS_JOGO[p.nivel]?.label || '' : ''}</small></div>`;
    }).join('');
    if(players.length >= 2){
      G.roomRef.off('value', waitingHandler); waitingHandler = null;
      setTimeout(() => launchGame(room), 400);
    }
  });
}

async function shareInvite(){
  const url = `${location.origin}${location.pathname}?sala=${G.code}`;
  const text = `Bora jogar Tribunal do Casal? ⚖️ Sala ${G.code}`;
  try{
    if(navigator.share){ await navigator.share({ title: 'Tribunal do Casal', text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Convite copiado!');
  }catch(e){ if(e?.name !== 'AbortError') toast(`Código: ${G.code}`); }
}

async function startSolo(){
  if(waitingHandler){ G.roomRef.off('value', waitingHandler); waitingHandler = null; }
  await G.roomRef.update({ solo: true });
  launchGame((await G.roomRef.once('value')).val());
}

async function showCareers(){
  if(!initFirebase()) return;
  openModal('career-modal');
  $('career-list').innerHTML = '<div class="empty-note">Carregando…</div>';
  try{
    const list = await loadCareers(G.db);
    $('career-list').innerHTML = list.length ? list.map(careerCardHtml).join('') : '<div class="empty-note">Ninguém jogou ainda. Bora ser o primeiro!</div>';
  }catch(e){ $('career-list').innerHTML = '<div class="empty-note">Não foi possível carregar.</div>'; }
}
function openModal(id){ $(id).classList.add('show'); }
function closeModal(id){ $(id).classList.remove('show'); }

function backToLobby(){
  if(!confirm('Sair da sala? Você pode voltar depois pelo botão "Voltar para a sala".')) return;
  sessionStorage.removeItem(IN_GAME_KEY);
  location.href = location.pathname; // recarrega sem ?sala= e limpa os listeners; a sessão fica salva
}

// ══════════════════════════════════════════════════════
// JOGO
// ══════════════════════════════════════════════════════
let launched = false;
function launchGame(room){
  if(launched) return;
  launched = true;
  G.room = room;
  sessionStorage.setItem(IN_GAME_KEY, '1');
  document.body.classList.add('in-game');
  $('s-lobby').classList.remove('active');
  $('s-game').classList.add('active');
  showTab('audiencia');
  keepScreenOn();

  // quando o caso é sorteado (ou já existia), monta as abas CASO/VADE/PENA
  G.onCase = r => {
    G.me.role = roleOf(r, G.me.name);
    const role = G.me.role;
    const nivel = r.players?.[role]?.nivel || 'advogado';
    renderCase(r.caseData, r.caseData.dossie, role, nivel);
    $('gtb-role').className = `role-chip ${role}`;
    $('gtb-role').textContent = ROLE_LABEL[role] || '';
    $('ia-assist-desc').textContent = nivel === 'jurista' ? 'Nível Jurista: você está por conta própria' : nivel === 'advogado' ? 'Privado · até 5 perguntas por caso' : 'Privado · só você vê';
    loadNotas();
    startIaChannel(role);
    startPresence(r, role);
  };

  const round = room.round || 0;
  G.roomRef.on('value', snap => {
    const r = snap.val();
    if(!r){ toast('A sala foi encerrada.'); clearSession(); setTimeout(() => location.href = location.pathname, 1500); return; }
    if((r.round || 0) !== round){ location.reload(); return; } // novo caso: recomeça a tela do zero
    G.room = r;
    G.me.role = roleOf(r, G.me.name);
    render();
    renderNewEvidence(newEvidence(r));
  });
  setInterval(tick, 500);
}

// assistente: canal privado do meu papel
let iaChannelOn = false;
function startIaChannel(role){
  if(iaChannelOn || !role) return;
  iaChannelOn = true;
  G.roomRef.child(`ia_chat_${role}`).on('child_added', snap => { const m = snap.val(); if(m){ iaHistory.push(m); appendIaMessage(m); } });
}

// presença: avisa quando o parceiro entra/sai
let presenceOn = false;
function startPresence(room, role){
  if(presenceOn || !role) return;
  presenceOn = true;
  const meRef = G.roomRef.child(`presence/${role}`);
  meRef.set({ name: G.me.name, online: true });
  meRef.onDisconnect().set({ name: G.me.name, online: false });
  if(room.solo) return;
  let first = true;
  G.roomRef.child(`presence/${otherRole(role)}`).on('value', s => {
    const p = s.val();
    $('gtb-role').classList.toggle('partner-off', !p?.online);
    if(!first && p?.name) toast(p.online ? `${p.name} voltou` : `${p.name} saiu da sala`);
    first = false;
  });
}

// mantém a tela acesa durante a partida
let wakeLock = null;
async function keepScreenOn(){
  try{ if('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && launched) keepScreenOn(); });

function showTab(tab){
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.body.dataset.tab = tab;
  if(tab === 'audiencia'){ $('aud-notif')?.classList.remove('show'); const a = $('autos-scroll'); if(a) a.scrollTop = a.scrollHeight; }
  else closeSheet();
}

function showNotasTab(tab){
  $('notas-panel-pad').classList.toggle('active', tab === 'pad');
  $('notas-panel-ia').classList.toggle('active', tab === 'ia');
  document.querySelectorAll('.notas-tab').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'pad')));
}

// ── Gaveta "Autos": provas, segredo e depoentes sem sair da audiência ──
function openInfo(){
  const r = G.room; if(!r?.caseData) return;
  const c = r.caseData, d = c.dossie, role = G.me.role;
  const segredos = role === 'acusacao' ? d.segredo_acu : d.segredo_def;
  const novas = newEvidence(r);
  $('info-body').innerHTML = `
    <div class="sh-title">${escapeHtml(c.titulo)}</div>
    <div class="info-corpo">${c.corpo}</div>
    ${segredos?.length ? `<div class="secret"><b>Só você sabe</b>${segredos.map(s => `<p>${escapeHtml(s)}</p>`).join('')}</div>` : ''}
    ${novas.length ? `<div class="sf-label">Provas novas</div><ul class="proofs new">${novas.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
    <div class="sf-label">Provas</div><ul class="proofs">${(c.provas || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    <div class="sf-label">Linha do tempo</div><ul class="timeline">${(c.linha_tempo || []).map(e => `<li><b>${escapeHtml(e.hora || e.data || '')}</b>${escapeHtml(e.fato)}</li>`).join('')}</ul>
    <div class="sf-label">Depoentes</div>${d.testemunhas.map(t => `<div class="wit-row"><span class="avatar">${t.emoji}</span><div><b>${escapeHtml(t.nome)}</b><small>${escapeHtml(t.papel_txt)}</small></div></div>`).join('')}`;
  $('info-sheet').classList.add('open');
  document.body.classList.add('sheet-open');
}
function closeInfo(){ $('info-sheet').classList.remove('open'); if(!$('sheet').classList.contains('open')) document.body.classList.remove('sheet-open'); }

// ── Notas (privadas: ficam só neste aparelho) ──
function notasKey(){ return `tribunal_notas_${G.code}_${G.me.role}_${G.room?.round || 0}`; }
function loadNotas(){ const ta = $('notas-ta'); if(!ta) return; try{ ta.value = localStorage.getItem(notasKey()) || ''; }catch(e){} }
let notasSavedTimer = null;
function onNotasInput(){
  const ta = $('notas-ta'); if(!ta) return;
  try{ localStorage.setItem(notasKey(), ta.value); }catch(e){}
  const saved = $('notas-saved'); saved?.classList.add('show');
  clearTimeout(notasSavedTimer); notasSavedTimer = setTimeout(() => saved?.classList.remove('show'), 1200);
}

// ── Assistente IA (privado) ──
let iaHistory = [];
let iaSending = false;
async function sendIaMsg(){
  if(iaSending || !G.roomRef || !G.room?.caseData) return;
  const ta = $('ia-inp'); const text = ta?.value.trim(); if(!text) return;
  const ctx = assistContext();
  if(ctx.usados >= ctx.limite){ toast(ctx.limite === 0 ? 'No nível Jurista não há assistente. Confie no seu taco!' : 'Você já usou as 5 perguntas do assistente neste caso.'); return; }
  if(moderate(text).blocked){ toast('Mensagem bloqueada pela moderação.'); return; }
  iaSending = true;
  const btn = $('ia-send-btn'); btn.disabled = true; btn.classList.add('loading');
  const channel = G.roomRef.child(`ia_chat_${G.me.role}`);
  try{
    ta.value = ''; autoGrow(ta, 120);
    const history = iaHistory.slice(-8);
    await channel.push({ sender: G.me.name, text, ts: Date.now(), type: 'user' });
    await countAssistUse();
    const r = await ask('assist', ctx.caseObj, { ...ctx.extra, role: G.me.role, question: text, history });
    await channel.push({ sender: 'Assistente', text: r.text, ts: Date.now(), type: 'ai', provider: r.provider || 'local' });
  }catch(e){
    console.warn('assistente', e);
    toast('Falha ao consultar o assistente. Tente novamente.');
  }finally{
    iaSending = false; btn.disabled = false; btn.classList.remove('loading');
  }
}
function iaQuickAsk(q){ const ta = $('ia-inp'); if(!ta) return; ta.value = q; sendIaMsg(); }
function appendIaMessage(msg){
  const box = $('ia-chat-msgs'); if(!box) return;
  const el = document.createElement('div');
  el.className = `ia-msg ${msg.type === 'ai' ? 'ai' : 'user'}`;
  el.innerHTML = `<div class="ia-bubble">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ══════════════════════════════════════════════════════
// Teclado do celular: a gaveta sobe junto com o teclado
// ══════════════════════════════════════════════════════
function trackKeyboard(){
  const vv = window.visualViewport; if(!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

// ══════════════════════════════════════════════════════
// Inicialização
// ══════════════════════════════════════════════════════
function initUI(){
  $('ia-send-btn')?.addEventListener('click', sendIaMsg);
  const iaInp = $('ia-inp');
  if(iaInp){ iaInp.addEventListener('keydown', e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendIaMsg(); } }); iaInp.addEventListener('input', () => autoGrow(iaInp, 120)); }
  document.querySelectorAll('.notas-tab').forEach((b, i) => b.addEventListener('click', () => showNotasTab(i === 0 ? 'pad' : 'ia')));
  $('notas-ta')?.addEventListener('input', onNotasInput);
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('.lobby-tab').forEach(b => b.addEventListener('click', () => showLobbyTab(b.dataset.lt)));
  $('sheet-backdrop')?.addEventListener('click', () => { closeSheet(); closeInfo(); });
  document.querySelectorAll('[data-close-sheet]').forEach(b => b.addEventListener('click', () => { closeSheet(); closeInfo(); }));
  $('btn-autos')?.addEventListener('click', openInfo);
  $('career-modal')?.addEventListener('click', e => { if(e.target.id === 'career-modal' || e.target.closest('.modal-close')) closeModal('career-modal'); });
  // desbloqueia o áudio no primeiro toque (exigência dos navegadores de celular)
  document.addEventListener('pointerdown', () => playSound('none'), { once: true });
  initGlossaryPopover();
  trackKeyboard();
  initLobby();
  if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Funções usadas por onclick="" no HTML
Object.assign(window, { createRoom, joinRoom, resumeSession, forgetSession, shareInvite, startSolo, backToLobby, showTab, showNotasTab, iaQuickAsk, openSheet });

initUI();
