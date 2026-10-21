// tests/bot.js — robô de teste: joga um lado da partida sozinho, usando as mesmas ações dos jogadores.
// Uso (no console do navegador, já dentro de uma sala):
//   const bot = await import('./tests/bot.js');
//   await bot.play({ protestar:true, contradicao:true, apelar:true });   // resolve quando a partida termina
// Não faz parte do jogo; serve para conferir que nada quebrou antes de publicar.
import { G, actions, TURNOS } from '../modules/game.js';

export const log = [];
const say = (...m) => { const line = `[bot ${G.me.role || '?'}] ${m.join(' ')}`; log.push(line); console.info(line); };

const TEXTO = {
  acordo: 'Confissão, reparação integral do dano à vítima em 30 dias e 6 meses de prestação de serviços à comunidade.',
  denuncia: c => `O Ministério Público denuncia o réu pelos fatos narrados: ${stripHtml(c.corpo).slice(0, 300)} A conduta configura ${c.arts_rapidos?.[0] || 'crime previsto no Código Penal'}, com materialidade e autoria comprovadas pelas provas dos autos. Requer o recebimento da denúncia e a condenação.`,
  resposta: c => `A defesa responde à acusação: as provas são frágeis e não demonstram o dolo. ${c.arts_rapidos?.[1] ? `Invoca ${c.arts_rapidos[1]}.` : ''} Há dúvida razoável sobre os fatos. Requer a absolvição e, subsidiariamente, a pena mínima.`,
  pergunta: (role, t, i) => [
    `${t.nome.split(' ')[0]}, conte exatamente o que você viu e a que horas isso aconteceu.`,
    `Você tem certeza do horário que mencionou? Quem mais estava presente?`,
    `Existe algo que você não contou à polícia sobre esse dia?`,
    `Qual era a sua relação com o réu antes dos fatos?`,
    `O que aconteceu logo depois, nos minutos seguintes?`
  ][i % 5],
  alegacao: role => role === 'acusacao'
    ? 'Excelência, a prova é robusta: os depoimentos e os documentos convergem para a autoria, e as contradições da defesa não resistem aos fatos. Peço a condenação.'
    : 'Excelência, os depoimentos se contradizem e as provas deixam dúvida razoável. Ninguém pode ser condenado na dúvida: in dubio pro reo. Peço a absolvição.',
  pedido: role => role === 'acusacao' ? 'condenação a pena intermediária' : 'absolvição',
  replica: role => role === 'acusacao' ? 'A defesa não enfrentou as provas técnicas, só criou ruído.' : 'A acusação ignora as contradições que a própria instrução revelou.',
  razoes: 'A sentença avaliou mal a prova central e merece reforma. As contradições dos depoimentos foram ignoradas e a dosimetria não observou o Art. 59 do CP.',
  contrarrazoes: 'A sentença está bem fundamentada, apreciou toda a prova e deve ser mantida por seus próprios fundamentos.'
};
function stripHtml(s){ return String(s || '').replace(/<[^>]+>/g, ''); }

export function play(opts = {}){
  // mentir: põe um fato inventado e uma acusação sem prova nas alegações (o fiscal tem que punir)
  // impugnar: levanta questão de ordem contra a primeira alegação do adversário
  const o = { protestar:false, contradicao:false, apelar:true, aceitarAcordo:false, proporAcordo:true, mentir:false, impugnar:false, timeoutMin:15, ...opts };
  let busy = false, asked = 0, pointed = false, protestedFor = null, impugnou = false;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if(Date.now() - started > o.timeoutMin * 60000){ clearInterval(timer); reject(new Error('bot: tempo esgotado na fase ' + G.room?.phase)); return; }
      const room = G.room, role = G.me.role;
      if(!room || busy) return;
      if(room.phase === 'fim'){ clearInterval(timer); say('fim', JSON.stringify(room.score)); resolve({ score: room.score, final: room.final, log }); return; }
      if(!role || !room.caseData) return;
      if(room.judge_busy) return;
      busy = true;
      try{ await move(room, role); }
      catch(e){ say('ERRO', e.message); }
      finally{ busy = false; }
    }, 1500);

    async function move(room, role){
      const c = room.caseData;
      switch(room.phase){
        case 'acordo': {
          const a = room.acordo || {};
          if(a.status === 'proposta' && role === 'acusacao'){ say(o.proporAcordo ? 'propõe acordo' : 'sem acordo'); return o.proporAcordo ? actions.proporAcordo(TEXTO.acordo) : actions.semAcordo(); }
          if(a.status === 'resposta' && role === 'defesa'){ say(o.aceitarAcordo ? 'aceita acordo' : 'recusa acordo'); return actions.responderAcordo(o.aceitarAcordo); }
          return;
        }
        case 'denuncia': {
          const p = room.pecas || {};
          if(!p.denuncia && role === 'acusacao'){ say('denúncia'); return actions.enviarPeca('denuncia', TEXTO.denuncia(c)); }
          if(p.denuncia && !p.resposta && role === 'defesa'){ say('resposta'); return actions.enviarPeca('resposta', TEXTO.resposta(c)); }
          return;
        }
        case 'instrucao': {
          const ins = room.instrucao || {};
          const pend = ins.pending;
          if(pend){
            if(o.protestar && pend.por !== role && !pend.protesto && protestedFor !== pend.id){ protestedFor = pend.id; say('PROTESTO'); return actions.protestar('indutiva'); }
            return;
          }
          const ouvidas = [...new Set(Object.values(room.autos || {}).filter(a => a.tipo === 'depoimento').map(a => a.testemunhaId))];
          if(o.contradicao && !pointed && ouvidas.length >= 2){
            const t = c.dossie.testemunhas.find(x => x.id === ouvidas[0]);
            pointed = true;
            say('aponta contradição em', t.nome);
            return actions.apontarContradicao(t.id, t.contradicao || `${t.nome} disse algo diferente do que mostram as provas sobre o horário.`);
          }
          const feitas = ins.perguntas?.[role] || 0;
          if(ins.pronto?.[role] || feitas >= ins.limite?.[role]) return;
          if(feitas >= 3){ say('encerra perguntas'); return actions.encerrarPerguntas(); }
          const ts = c.dossie.testemunhas;
          const t = ts[(asked + (role === 'defesa' ? 1 : 0)) % ts.length];
          const q = TEXTO.pergunta(role, t, asked++);
          say('pergunta a', t.nome);
          return actions.perguntar(t.id, q);
        }
        case 'debates': {
          const d = room.debates;
          if(!d || d.turno >= TURNOS.length) return;
          if(o.impugnar && !impugnou){
            const alvo = Object.entries(room.autos || {}).find(([, a]) => a.tipo === 'alegacao' && a.por !== role);
            if(alvo){ impugnou = true; say('QUESTÃO DE ORDEM'); return actions.questaoDeOrdem(alvo[0], 'O adversário afirmou fatos que não aparecem em nenhuma prova nem depoimento, como o que disse sobre confissões e testemunhas que nunca depuseram.'); }
          }
          const turno = TURNOS[d.turno];
          if(turno.role !== role) return;
          say('fala', turno.tipo, o.mentir ? '(com mentira)' : '');
          const mentira = o.mentir ? ' Além disso, o réu confessou tudo ao porteiro do prédio na manhã seguinte, e o advogado da defesa pagou a testemunha para mentir em juízo.' : '';
          return turno.tipo === 'alegacao' ? actions.enviarAlegacao(TEXTO.alegacao(role) + mentira, TEXTO.pedido(role)) : actions.enviarAlegacao(TEXTO.replica(role), null);
        }
        case 'recurso': {
          const r = room.recurso || {};
          const perdedores = r.perdedor === 'ambos' ? ['acusacao', 'defesa'] : [r.perdedor];
          if(r.status === 'decidir' && perdedores.includes(role) && !r.aceitou?.[role]){ say(o.apelar ? 'apela' : 'aceita'); return o.apelar ? actions.apelar() : actions.aceitarDecisao(); }
          if(r.status === 'razoes' && r.apelante === role){ say('razões'); return actions.enviarRazoes(TEXTO.razoes); }
          if(r.status === 'contrarrazoes' && r.apelante !== role){ say('contrarrazões'); return actions.enviarContrarrazoes(TEXTO.contrarrazoes); }
          return;
        }
      }
    }
  });
}
