// data/glossario.js — termos jurídicos com tradução para quem não é da área.
// Aparecem sublinhados no texto; ao tocar, mostra a explicação.

export const GLOSSARIO = {
  'acórdão': 'A decisão de um tribunal tomada por vários juízes (desembargadores) juntos.',
  'acordo de não persecução penal': 'Um acordo em que o réu confessa e cumpre condições (como prestar serviços) e, em troca, o processo nem começa.',
  'ANPP': 'Acordo de não persecução penal: o réu confessa e cumpre condições, e o processo nem começa.',
  'agravante': 'Circunstância que deixa a pena mais alta (ex.: crime cometido contra idoso).',
  'atenuante': 'Circunstância que deixa a pena mais baixa (ex.: confessar o crime).',
  'alegações finais': 'O último discurso de cada lado antes do juiz decidir, resumindo tudo o que foi provado.',
  'apelação': 'Recurso para um tribunal maior revisar a sentença do juiz.',
  'arrependimento posterior': 'Quando a pessoa devolve ou paga o prejuízo antes do processo começar: a pena diminui.',
  'autoria': 'Quem cometeu o crime.',
  'calúnia': 'Acusar falsamente alguém de ter cometido um crime.',
  'contrarrazões': 'A resposta de quem ganhou ao recurso de quem perdeu.',
  'crime continuado': 'Vários crimes iguais, do mesmo jeito, em sequência: são tratados como um só, com pena aumentada.',
  'culpa': 'Quando a pessoa causa o resultado sem querer, por descuido, imprudência ou falta de habilidade.',
  'culposo': 'Sem intenção: o resultado aconteceu por descuido ou imprudência.',
  'denúncia': 'O documento em que o promotor acusa formalmente alguém de um crime e pede que ele seja julgado.',
  'desclassificação': 'Quando o juiz entende que o crime é outro, mais leve, do que o da acusação.',
  'desembargador': 'Juiz de um Tribunal de Justiça, que julga os recursos contra as sentenças.',
  'diligência': 'Uma investigação extra pedida durante o processo (perícia, busca de documento, etc.).',
  'dolo eventual': 'Quando a pessoa não quer o resultado, mas sabe que pode acontecer e não se importa ("se morrer, morreu").',
  'dolo': 'Intenção: a pessoa quis fazer aquilo, ou aceitou o risco.',
  'doloso': 'Com intenção.',
  'dosimetria': 'O cálculo da pena, feito em 3 etapas: pena-base, agravantes/atenuantes e aumentos/diminuições.',
  'estado de necessidade': 'Cometer um ato proibido para salvar alguém de um perigo que não tinha outro jeito de evitar. Pode tirar o crime.',
  'excludente': 'Situação que faz o ato deixar de ser crime (ex.: legítima defesa).',
  'flagrante': 'Quando a pessoa é presa no momento do crime ou logo depois.',
  'in dubio pro reo': 'Na dúvida, a favor do réu: sem certeza, não se pode condenar.',
  'injúria racial': 'Ofender alguém usando a raça ou cor dessa pessoa. Hoje é tratada como racismo.',
  'insignificância': 'Quando o prejuízo é tão pequeno que não vale a pena tratar como crime.',
  'instrução': 'A fase do processo em que se ouvem testemunhas e se produzem as provas.',
  'júri': 'Julgamento feito por 7 cidadãos comuns (jurados), usado nos crimes contra a vida com intenção.',
  'jurisprudência': 'O entendimento que os tribunais já firmaram em casos parecidos.',
  'legítima defesa putativa': 'Quando a pessoa ACREDITA, com bons motivos, que está sendo atacada, mesmo que na verdade não estivesse.',
  'legítima defesa': 'Usar a força necessária para se defender de uma agressão que está acontecendo ou prestes a acontecer.',
  'materialidade': 'A prova de que o crime realmente aconteceu.',
  'nulidade': 'Um erro no processo tão grave que anula o ato (ou a prova).',
  'perito': 'Especialista que analisa provas técnicas (laudos médicos, contábeis, de trânsito...).',
  'preliminar': 'Uma questão que a defesa levanta logo no início, antes de discutir o mérito (ex.: prova ilegal).',
  'pronúncia': 'Decisão do juiz que manda o réu a julgamento pelo Júri.',
  'prova ilícita': 'Prova obtida de forma ilegal. Não pode ser usada no processo.',
  'qualificadora': 'Detalhe do crime que o torna mais grave e aumenta bastante a pena (ex.: arrombamento no furto).',
  'reincidente': 'Quem já foi condenado antes por outro crime.',
  'réu primário': 'Quem nunca foi condenado antes.',
  'regime': 'Como a pena de prisão é cumprida: fechado (presídio), semiaberto (sai para trabalhar) ou aberto (em casa à noite).',
  'sentença': 'A decisão final do juiz: condena ou absolve.',
  'tipificação': 'Dizer qual crime, de acordo com a lei, o fato representa.',
  'trânsito em julgado': 'Quando não cabe mais nenhum recurso: a decisão é definitiva.',
  'tortura': 'Causar sofrimento físico ou mental intenso, por exemplo como castigo de alguém sob sua guarda.'
};

// Termos ordenados do mais longo para o mais curto (para "legítima defesa putativa" vencer "legítima defesa")
const TERMS = Object.keys(GLOSSARIO).sort((a, b) => b.length - a.length);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GLOSS_RE = new RegExp(`(^|[^\\p{L}])(${TERMS.map(escapeRe).join('|')})(?=$|[^\\p{L}])`, 'giu');

// Percorre os nós de texto de um elemento e marca os termos do glossário.
// Cada termo é marcado só na primeira vez em que aparece no elemento.
export function applyGlossary(root) {
  if (!root) return;
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement?.closest('.gl, button, textarea, input, .no-gloss') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    GLOSS_RE.lastIndex = 0;
    if (!GLOSS_RE.test(text)) continue;
    GLOSS_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = GLOSS_RE.exec(text))) {
      const term = m[2];
      const key = TERMS.find(t => t.toLowerCase() === term.toLowerCase());
      const start = m.index + m[1].length;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      frag.append(text.slice(last, start));
      const span = document.createElement('span');
      span.className = 'gl';
      span.tabIndex = 0;
      span.dataset.def = GLOSSARIO[key];
      span.textContent = term;
      frag.append(span);
      last = start + term.length;
    }
    if (last === 0) continue;
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}
