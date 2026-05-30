// main.js — orquestra o app: Firebase realtime sync, UI handlers, chamadas ao juiz (askJudge)
import './ai-bridge.js'; // garante que askJudge esteja disponível globalmente

// util
function $(id){return document.getElementById(id);} 

let db = null;
let roomRef = null;
let presenceRef = null;
let localClientId = Math.random().toString(36).slice(2,9);

function initFirebase(){
  try{
    if (!window.firebase) throw new Error('Firebase SDK não carregado');
    if (!window.firebase.apps?.length){
      firebase.initializeApp(window.firebaseConfig);
    }
    db = firebase.database();
    return true;
  }catch(e){ console.error('initFirebase', e); return false; }
}

function initUI(){
  // Bindings
  const createBtn = $('btn-create'); if(createBtn) createBtn.addEventListener('click', createRoom);
  const joinBtn = $('btn-join'); if(joinBtn) joinBtn.addEventListener('click', joinRoom);
  const sendBtn = $('btn-send'); if(sendBtn) sendBtn.addEventListener('click', sendMessage);
  const judgeBtn = $('btn-judge'); if(judgeBtn) judgeBtn.addEventListener('click', requestJudge);
  const iaSend = $('ia-send-btn'); if(iaSend) iaSend.addEventListener('click', sendIaMsg);
  const iaInp = $('ia-inp'); if(iaInp) iaInp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendIaMsg(); } });
  const chatInp = $('chat-inp'); if(chatInp) chatInp.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } });

  // populate cases list
  const scroll = $('case-scroll');
  if(scroll && window.CASES){
    scroll.innerHTML = window.CASES.map((c,i)=>`<div class="case-chip ${i===0?'active':''}" data-idx="${i}">${c.id} · ${c.nome}</div>`).join('');
    scroll.querySelectorAll('.case-chip').forEach(el=>el.addEventListener('click', (e)=>{ selectCase(Number(el.dataset.idx)); }));
  }
}

function initLobby(){ if(!initFirebase()){ alert('Erro ao conectar ao Firebase!'); return; } initUI(); initApiKeyUI?.(); }

// state mirrored from inline script
const state = window.state || { roomCode:'', myRole:'', myName:'', partnerName:'', partnerRole:'', caseIdx:0, solo:false };
window.state = state;

function showToast(msg, duration=3000){ const t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c1c27;border:1px solid #c9953a;color:#e8b45a;padding:12px 20px;border-radius:8px;font-family:var(--mono);font-size:12px;z-index:9999;animation:slideUp .3s ease;'; document.body.appendChild(t); setTimeout(()=>{ t.style.animation='slideDown .3s ease'; setTimeout(()=>t.remove(), 300); }, duration); }

async function createRoom(){
  if(!initFirebase()) { showToast('Erro ao inicializar Firebase'); return; }
  const name = $('inp-name-create').value.trim(); if(!name){ showToast('Digite seu nome'); return; }
  if(!state.createRole){ showToast('Escolha seu papel'); return; }
  const btn = $('btn-create'); btn.disabled=true; btn.textContent='CRIANDO...';
  state.myName = name; state.myRole = state.createRole; state.roomCode = Math.random().toString(36).substr(2,4).toUpperCase();
  roomRef = db.ref(`rooms/${state.roomCode}`);
  try{
    const snap = await roomRef.once('value');
    if(snap.exists()){ state.roomCode = Math.random().toString(36).substr(2,4).toUpperCase(); roomRef = db.ref(`rooms/${state.roomCode}`); }
    await roomRef.set({ creator:name, creatorRole:state.myRole, caseIdx:state.caseIdx, scoreAcu:0, scoreDef:0, ready:false, createdAt:firebase.database.ServerValue.TIMESTAMP });
    roomRef.onDisconnect().remove();
    btn.disabled=false; btn.textContent='CRIAR SALA';
    $('room-code-display').textContent = state.roomCode; $('code-display').style.display='block';
    showToast('✓ Sala criada! Aguardando parceiro...');
    showWaiting();
  }catch(e){ btn.disabled=false; btn.textContent='CRIAR SALA'; showToast('Erro: '+e.message); }
}

async function joinRoom(){
  if(!initFirebase()) { showToast('Erro ao inicializar Firebase'); return; }
  const name = $('inp-name-join').value.trim(); const code = $('inp-room-code').value.trim().toUpperCase();
  if(!name){ showToast('Digite seu nome'); return; }
  if(!state.joinRole){ showToast('Escolha seu papel'); return; }
  if(code.length!==4){ showToast('Código deve ter 4 letras'); return; }
  const btn = $('btn-join'); btn.disabled=true; btn.textContent='ENTRANDO...';
  state.myName = name; state.myRole = state.joinRole; state.roomCode = code; roomRef = db.ref(`rooms/${code}`);
  try{
    const snap = await roomRef.once('value'); const room = snap.val();
    if(!room){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Sala não encontrada'); return; }
    if(room.creatorRole === state.myRole){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Papel já ocupado'); return; }
    if(room.partnerName){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Sala cheia'); return; }
    state.caseIdx = room.caseIdx || 0; state.partnerName = room.creator; state.partnerRole = room.creatorRole;
    await roomRef.update({ partnerName:name, partnerRole:state.myRole, ready:true });
    setupRealtimeListeners();
    showToast('✓ Entrando na sala...');
    setTimeout(launchGame, 300);
    btn.disabled=false; btn.textContent='ENTRAR NA SALA';
  }catch(e){ btn.disabled=false; btn.textContent='ENTRAR NA SALA'; showToast('Erro: '+e.message); }
}

function showWaiting(){
  document.getElementById('card-create').style.display='none'; document.querySelectorAll('.divider').forEach(el=>el.style.display='none'); document.getElementById('card-join').style.display='none';
  const cw = $('card-waiting'); cw.style.display='flex'; cw.style.flexDirection='column'; cw.style.alignItems='center';
  $('waiting-code').textContent = state.roomCode; updateWaitingUI();
  roomRef.on('value', snap => { const room = snap.val(); if(!room) return; if(room.ready && room.partnerName){ state.partnerName = room.partnerName; state.partnerRole = room.partnerRole; updateWaitingUI(); roomRef.off(); setupRealtimeListeners(); setTimeout(()=>launchGame(),400); } });
}

function updateWaitingUI(){ const list = $('players-list'); const myLbl = state.myRole==='acusacao'?'⚔️ ACUSAÇÃO':'🛡️ DEFESA'; const partLbl = state.partnerName ? (state.partnerRole==='acusacao'?'⚔️ ACUSAÇÃO':'🛡️ DEFESA') : '...'; list.innerHTML = ` <div class="player-item"><div class="pi-dot ${state.myRole}"></div><div class="pi-name">${state.myName} (você)</div><div class="pi-role">${myLbl}</div></div> <div class="player-item"><div class="pi-dot ${state.partnerName?state.partnerRole:'empty'}"></div><div class="pi-name">${state.partnerName||'Aguardando...'}</div><div class="pi-role">${partLbl}</div></div>`; }

function startAnySolo(){ state.solo=true; state.partnerName='Parceiro'; state.partnerRole = state.myRole==='acusacao'?'defesa':'acusacao'; if(roomRef) roomRef.off(); launchGame(); }

function setupRealtimeListeners(){
  if(!roomRef) return; 
  // chat
  const chatRef = roomRef.child('chat');
  chatRef.on('child_added', snap => {
    const msg = snap.val(); if(!msg) return; appendChatMessage(msg);
  });
  // score
  roomRef.child('scoreAcu').on('value', s => { const v = s.val(); if(v!==null) $('sc-acu').textContent = v; });
  roomRef.child('scoreDef').on('value', s => { const v = s.val(); if(v!==null) $('sc-def').textContent = v; });
  // notes
  roomRef.child('notes').on('value', s => { const v = s.val(); if(v!==null) $('notas-ta').value = v; });
  // verdict
  roomRef.child('verdict').on('value', s=>{ const v = s.val(); if(v) renderVerdict(v); });
  // presence
  presenceRef = roomRef.child('presence/' + localClientId);
  presenceRef.set({ name: state.myName, role: state.myRole, ts: firebase.database.ServerValue.TIMESTAMP });
  presenceRef.onDisconnect().remove();
}

function appendChatMessage(msg){
  const container = $('chat-messages'); if(!container) return;
  const el = document.createElement('div'); el.className = 'msg';
  if(msg.type==='judge') el.classList.add('judge'); else if(msg.sender===state.myName) el.classList.add('mine'); else el.classList.add('theirs');
  const roleCls = msg.role==='acusacao'?'acusacao':(msg.role==='defesa'?'defesa':'');
  if(msg.type!=='judge') el.classList.add(roleCls);
  const header = `<div class="msg-header"><span class="msg-role ${msg.role||''}">${msg.sender}</span><span class="msg-time">${new Date(msg.ts||Date.now()).toLocaleTimeString()}</span></div>`;
  const bubble = `<div class="msg-bubble">${escapeHtml(msg.text).replace(/\n/g,'<br>')}</div>`;
  el.innerHTML = header + bubble;
  container.appendChild(el); container.scrollTop = container.scrollHeight;
}

function escapeHtml(s){ return (s||'').replace(/[&<>\"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

async function sendMessage(){
  const ta = $('chat-inp'); if(!ta) return; const text = ta.value.trim(); if(!text) return; ta.value='';
  const msg = { sender: state.myName, role: state.myRole, text, ts: Date.now() };
  if(roomRef){ await roomRef.child('chat').push({ ...msg, type:'chat' }); }
  else { appendChatMessage(msg); }

  const judgeTrigger = /(?:\bjuiz\b|\bjuí?z\b|@juiz)/i;
  if(judgeTrigger.test(text)){
    requestJudge();
  }
}

async function addScore(side){ if(!roomRef) return; if(side==='acu') roomRef.child('scoreAcu').transaction(v=> (v||0)+1); else roomRef.child('scoreDef').transaction(v=> (v||0)+1); }
function resetScore(){ if(roomRef){ roomRef.child('scoreAcu').set(0); roomRef.child('scoreDef').set(0); } }

async function sendIaMsg(){ const ta = $('ia-inp'); if(!ta) return; const text = ta.value.trim(); if(!text) return; ta.value='';
  // push to ia chat locally
  if(roomRef) await roomRef.child('ia_chat').push({ sender: state.myName, text, ts:Date.now() });
  // call assistant via global callAI / askJudge (ai-bridge exposes callAI too)
  try{
    const resp = await window.callAI?.('Assistente', text, 400, []);
    if(resp){ if(roomRef) await roomRef.child('ia_chat').push({ sender:'Assistente', text:resp, ts:Date.now(), type:'ai' }); }
  }catch(e){ console.warn('assist fail', e); }
}

async function requestJudge(){
  // collect last N messages
  const chatSnapshot = await (roomRef? roomRef.child('chat').limitToLast(50).once('value') : { val: ()=>null });
  const msgs = [];
  if(chatSnapshot && chatSnapshot.val()){ Object.values(chatSnapshot.val()).forEach(m=> msgs.push({ sender:m.sender, role:m.role, text:m.text })); }
  // local case object
  const caseObj = window.CASES && window.CASES[state.caseIdx] ? window.CASES[state.caseIdx] : { titulo:'Caso genérico', context_juiz:'' };
  // append a placeholder judge message
  if(roomRef) await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', text:'(analisando...)', ts:Date.now(), type:'judge' });
  try{
    // Prefer local judge if available (free, sem chaves)
    if(window.localJudgeAnalyze){
      // stream incremental updates
      await window.localJudgeAnalyze(msgs, caseObj, async (update)=>{
        try{
          const text = update?.text || '';
          const meta = update?.meta || {};
          // push partial judge messages so both clients vejam progresso
          if(roomRef) await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', text, ts:Date.now(), type:'judge', _stage:update.stage, _meta:meta });
          else appendChatMessage({ sender:'Juiz', role:'juiz', text, ts:Date.now(), type:'judge' });
        }catch(err){ console.warn('localJudge push failed', err); }
      });
      // after streaming, set latest verdict snapshot
      const final = await window.localJudgeAnalyze(msgs, caseObj, ()=>{});
      if(roomRef) await roomRef.child('verdict').set({ text: final.text, ts: Date.now(), verdict: final.verdict });
    } else {
      // fallback to remote askJudge (ai-bridge)
      const answer = await window.askJudge(caseObj, msgs);
      if(roomRef){ await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', text:answer, ts:Date.now(), type:'judge' }); await roomRef.child('verdict').set({ text: answer, ts: Date.now() }); }
      else { appendChatMessage({ sender:'Juiz', role:'juiz', text:answer, ts:Date.now(), type:'judge' }); }
    }
  }catch(e){
    console.error('judge request failed', e);
    if(roomRef) await roomRef.child('chat').push({ sender:'Juiz', role:'juiz', text:'(Falha ao consultar Juiz — tente novamente)', ts:Date.now(), type:'judge' });
  }
}

function renderVerdict(v){ const wrap = $('verdict-wrap'); if(!wrap) return; wrap.innerHTML = `<div class="verdict-card"><div class="verdict-stamp"><div class="vs-icon">⚖️</div><div><div class="vs-label">Juiz IA</div><div class="vs-name">Veredicto</div></div></div><div class="verdict-fund">${escapeHtml(v.text).replace(/\n/g,'<br>')}</div></div>`; }

function renderCaseDetails(caseObj){
  if(!caseObj) return;
  const tags = caseObj.tags || [];
  $('g-tags').innerHTML = tags.map(t=>`<span class="tag ${escapeHtml(t.c||'tg')}">${escapeHtml(t.t)}</span>`).join('');
  $('g-title').innerHTML = caseObj.titulo || '';
  $('g-body').innerHTML = caseObj.corpo || caseObj.context_juiz || '';

  const guide = $('g-guide');
  const hot = $('g-hot');
  if(guide){
    const sections = [];
    if(caseObj.perguntas_acu?.length){
      sections.push(`<div class="art-strategy-block asb-acu"><div class="asb-label">Perguntas da Acusação</div><div>${caseObj.perguntas_acu.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
    }
    if(caseObj.perguntas_def?.length){
      sections.push(`<div class="art-strategy-block asb-def"><div class="asb-label">Perguntas da Defesa</div><div>${caseObj.perguntas_def.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
    }
    if(!sections.length && caseObj.hot?.length){
      sections.push(`<div class="art-strategy-block"><div class="asb-label">Pontos-chave</div><div>${caseObj.hot.map(p=>`<div class="art-texto">• ${escapeHtml(p)}</div>`).join('')}</div></div>`);
    }
    guide.innerHTML = sections.join('');
  }
  if(hot){
    hot.innerHTML = (caseObj.hot||[]).map(item=>`<div class="art-texto">• ${escapeHtml(item)}</div>`).join('');
  }

  const vadeGrid = $('vade-grid');
  if(vadeGrid){
    vadeGrid.innerHTML = (caseObj.vade||[]).map(item => {
      const roleText = state.myRole==='acusacao' ? item.use_acu : item.use_def;
      return `<div class="art-card expanded">
        <div class="art-header">
          <div class="art-header-content">
            <div class="art-name">${escapeHtml(item.nome)}</div>
            <div class="art-pena">${escapeHtml(item.pena||'')}</div>
          </div>
          <div class="art-chevron">›</div>
        </div>
        <div class="art-body">
          <div class="art-texto">${escapeHtml(item.texto)}</div>
          <div class="art-exp">${escapeHtml(item.exp||'')}</div>
          <div class="art-juris">${escapeHtml(item.juris||'')}</div>
          <div class="art-simple">
            <div class="art-simple-lbl">Estratégia para ${state.myRole==='acusacao'?'Acusação':'Defesa'}</div>
            <div class="art-simple-txt">${escapeHtml(roleText||'')}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }
}

function launchGame(){
  document.getElementById('s-lobby').classList.remove('active'); document.getElementById('s-game').classList.add('active');
  showTab('caso');
  showNotasTab('pad');
  const caseObj = window.CASES && window.CASES[state.caseIdx];
  if(caseObj){
    renderCaseDetails(caseObj);
  }
  $('gtb-title').textContent = `Sala ${state.roomCode} • ${caseObj?caseObj.nome:''}`;
  $('gtb-role-txt').textContent = state.myRole==='acusacao'?'ACUSAÇÃO':'DEFESA';
}

function selectCase(i){ if(window.CASES){ state.caseIdx = i; document.querySelectorAll('.case-chip').forEach((el,j)=>el.classList.toggle('active',j===i)); }}

function selectRole(r){ state.createRole = r; document.getElementById('rc-acu')?.classList.toggle('sel', r==='acusacao'); document.getElementById('rc-def')?.classList.toggle('sel', r==='defesa'); }

function selectJoinRole(r){ state.joinRole = r; document.getElementById('rj-acu')?.classList.toggle('sel', r==='acusacao'); document.getElementById('rj-def')?.classList.toggle('sel', r==='defesa'); }

// expose helpers to global scope for inline handlers
window.createRoom = createRoom; window.joinRoom = joinRoom; window.startAnySolo = startAnySolo; window.sendMessage = sendMessage; window.addScore = addScore; window.resetScore = resetScore; window.requestJudge = requestJudge; window.launchGame = launchGame; window.selectCase = selectCase; window.selectRole = selectRole; window.selectJoinRole = selectJoinRole; window.initLobby = initLobby;

// init on DOM ready
window.addEventListener('DOMContentLoaded', ()=>{ initUI(); initFirebase(); });

// Additional global handlers expected by inline HTML
function backToLobby(){
  document.getElementById('s-game').classList.remove('active'); document.getElementById('s-lobby').classList.add('active');
  if(roomRef) { roomRef.off(); roomRef = null; }
}

function showTab(tab){ document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id===`tab-${tab}`)); document.querySelectorAll('.btab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab)); }

function onChatInput(){ const ta = $('chat-inp'); if(ta) ta.style.height = 'auto'; if(ta) ta.style.height = Math.min(120, ta.scrollHeight)+'px'; }
function onChatKey(e){}
function onIaInpInput(){ const ta = $('ia-inp'); if(ta) ta.style.height='auto'; if(ta) ta.style.height = Math.min(120, ta.scrollHeight)+'px'; }
function onIaInpKey(e){}

function onNotasInput(){ const ta = $('notas-ta'); if(!ta) return; $('notas-chars').textContent = ta.value.length + ' caracteres'; if(roomRef) roomRef.child('notes').set(ta.value); }
function clearNotas(){ const ta = $('notas-ta'); if(ta) ta.value=''; if(roomRef) roomRef.child('notes').set(''); }

function iaQuickAsk(q){ const ta = $('ia-inp'); if(!ta) return; ta.value = q; sendIaMsg(); }

// Expose simple handlers globally
window.backToLobby = backToLobby; window.showTab = showTab; window.onChatInput = onChatInput; window.onChatKey = onChatKey; window.onIaInpInput = onIaInpInput; window.onIaInpKey = onIaInpKey; window.onNotasInput = onNotasInput; window.clearNotas = clearNotas; window.iaQuickAsk = iaQuickAsk;

function showNotasTab(tab){ document.getElementById('notas-panel-pad').classList.toggle('active', tab==='pad'); document.getElementById('notas-panel-ia').classList.toggle('active', tab==='ia'); document.querySelectorAll('.notas-tab').forEach(b=>b.classList.toggle('active', b.textContent.includes(tab==='pad'?'ANOTAÇÕES':'ASSISTENTE'))); }

function clearReply(){ const rb = $('reply-banner'); if(rb){ rb.classList.remove('show'); $('reply-banner-text').textContent=''; } }
window.showNotasTab = showNotasTab; window.clearReply = clearReply;

function onPedidoInput(side){ const el = side==='acu' ? $('pena-acu') : $('pena-def'); const txt = el ? el.value.trim() : ''; if(side==='acu') $('pedido-acu-txt').textContent = txt||'Aguardando...'; else $('pedido-def-txt').textContent = txt||'Aguardando...'; if(roomRef){ roomRef.child('pedidos').update({ [side]: txt }); } }
window.onPedidoInput = onPedidoInput;
