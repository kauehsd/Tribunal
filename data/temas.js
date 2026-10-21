// data/temas.js — temas sorteados para a IA criar casos inéditos.
// Só crimes graves e complexos (homicídios, latrocínios, roubos de grande porte, sequestros...).
// O sorteio evita temas que o casal já jogou; quando acabarem, recomeça (com casos diferentes).

export const TEMAS = [
  'latrocínio num assalto a uma joalheria de shopping, com um segurança morto',
  'roubo a carro-forte numa rodovia, com troca de tiros e um refém',
  'extorsão mediante sequestro de um empresário, libertado após o pagamento do resgate',
  'homicídio por encomenda: o réu é acusado de ser o mandante, e o executor virou delator',
  'morte de um sócio dentro de uma construtora: acidente de obra ou homicídio planejado?',
  'empresário encontrado morto em casa trancada: suicídio ou homicídio?',
  'incêndio criminoso em um galpão que mata o vigia noturno',
  'homicídio depois de uma briga numa festa universitária, com versões contraditórias',
  'policial de folga que mata um homem num bar alegando legítima defesa',
  'execução de um informante do tráfico numa comunidade',
  'sequestro relâmpago que termina com a morte da vítima',
  'sócio de uma empresa de criptomoedas desaparece e o outro sócio é acusado de homicídio sem cadáver',
  'roubo de obras de arte de um museu com seguranças rendidos e um deles baleado',
  'atropelamento proposital depois de uma discussão de trânsito',
  'morte de uma paciente numa clínica de estética clandestina: erro ou homicídio com dolo eventual?',
  'assalto a uma casa com reféns que termina com a morte do proprietário que reagiu',
  'homicídio na saída de uma boate envolvendo seguranças da casa',
  'morte de um preso dentro da cela: briga entre detentos ou execução encomendada?',
  'roubo de cargas com caminhoneiro morto e uso de documentos falsos',
  'milícia que extorque comerciantes e mata quem se recusa a pagar',
  'atentado a tiros contra um promotor de justiça que investigava uma quadrilha',
  'explosão de caixa eletrônico de madrugada que mata um morador vizinho',
  'duplo homicídio num sítio por disputa de terras entre irmãos',
  'latrocínio de um motorista de aplicativo numa corrida de madrugada',
  'morte de um torcedor num confronto entre torcidas organizadas',
  'desabamento de um prédio irregular que mata três moradores: homicídio doloso ou culposo do construtor?',
  'envenenamento de um sócio com remédio controlado para ficar com a empresa',
  'tentativa de homicídio de uma testemunha que ia depor contra um traficante',
  'roubo a uma agência bancária com reféns e negociação de horas com a polícia',
  'morte de um jovem durante uma abordagem policial: legítima defesa ou execução?'
];

export function pickTema(usados = []){
  const livres = TEMAS.filter(t => !usados.includes(t));
  const pool = livres.length ? livres : TEMAS;
  return pool[Math.floor(Math.random() * pool.length)];
}
