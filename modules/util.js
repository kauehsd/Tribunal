// modules/util.js — utilitários de interface usados em todo o app

export function $(id){ return document.getElementById(id); }

export function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function nl2br(s){ return escapeHtml(s).replace(/\n/g, '<br>'); }

export const ROLE_LABEL = { acusacao:'Acusação', defesa:'Defesa' };
export const ROLE_ICON = { acusacao:'⚔️', defesa:'🛡️' };
export function otherRole(role){ return role === 'acusacao' ? 'defesa' : 'acusacao'; }

export function slug(name){
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anonimo';
}

export function fmtClock(ms){
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let toastTimer = null;
export function toast(msg, duration = 3200){
  const t = $('sync-toast');
  if(!t){ console.info(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), duration);
}

const MODERATION_BLOCKLIST = ['merda','porra','filho da puta','puta','viado','otário','escroto','imbecil','piranha'];
export function moderate(text){
  const normalized = (text || '').toLowerCase();
  const found = MODERATION_BLOCKLIST.find(w => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'iu').test(normalized));
  return { blocked: Boolean(found), word: found };
}

// Rascunhos de texto sobrevivem a re-renderizações e recarregamentos da página
export function saveDraft(key, value){ try{ sessionStorage.setItem('draft_' + key, value); }catch(e){} }
export function loadDraft(key){ try{ return sessionStorage.getItem('draft_' + key) || ''; }catch(e){ return ''; } }
export function clearDraft(key){ try{ sessionStorage.removeItem('draft_' + key); }catch(e){} }

export function autoGrow(ta, max = 220){ ta.style.height = 'auto'; ta.style.height = Math.min(max, ta.scrollHeight) + 'px'; }

// ── Sons (Web Audio API — sem arquivos) ──
let audioCtx = null;
export function playSound(type){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx, t = ctx.currentTime;
    const tones = {
      message:{ f:[[880,0]], end:660, vol:0.10, dur:0.2 },
      judge:{ f:[[440,0],[554,0.1],[659,0.2]], vol:0.14, dur:0.45 },
      gavel:{ f:[[180,0],[120,0.08]], vol:0.3, dur:0.25, wave:'square' },
      twist:{ f:[[330,0],[415,0.15],[523,0.3],[659,0.45]], vol:0.14, dur:0.7, wave:'triangle' },
      protest:{ f:[[740,0],[370,0.12]], vol:0.18, dur:0.3, wave:'sawtooth' },
      tick:{ f:[[1200,0]], vol:0.07, dur:0.08 },
      win:{ f:[[523,0],[659,0.15],[784,0.3],[1046,0.45]], vol:0.16, dur:0.9, wave:'triangle' }
    }[type];
    if(!tones) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if(tones.wave) osc.type = tones.wave;
    tones.f.forEach(([f, at]) => osc.frequency.setValueAtTime(f, t + at));
    if(tones.end) osc.frequency.exponentialRampToValueAtTime(tones.end, t + tones.dur * 0.75);
    gain.gain.setValueAtTime(tones.vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + tones.dur);
    osc.start(t); osc.stop(t + tones.dur);
  }catch(e){ /* sem áudio, sem problema */ }
}

// Popover do glossário: toque/clique num termo sublinhado
export function initGlossaryPopover(){
  const pop = document.createElement('div');
  pop.className = 'gl-pop';
  document.body.appendChild(pop);
  const hide = () => pop.classList.remove('show');
  document.addEventListener('click', e => {
    const term = e.target.closest('.gl');
    if(!term){ hide(); return; }
    pop.innerHTML = `<strong>${escapeHtml(term.textContent)}</strong>${escapeHtml(term.dataset.def)}`;
    const r = term.getBoundingClientRect();
    pop.classList.add('show');
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    pop.style.top = (r.bottom + 8 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + 'px';
  });
  window.addEventListener('scroll', hide, true);
}
