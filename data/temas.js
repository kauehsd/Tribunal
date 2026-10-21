// data/temas.js — temas sorteados para a IA criar casos inéditos.
// O sorteio evita temas que o casal já jogou; quando acabarem, recomeça (com casos diferentes).

export const TEMAS = [
  'receptação de celulares roubados numa loja de assistência técnica',
  'golpe do falso sequestro por telefone contra uma idosa',
  'briga de trânsito que termina em lesão corporal grave',
  'desvio de dinheiro do caixa de uma igreja pelo tesoureiro',
  'perseguição obsessiva (stalking, Art. 147-A) de um ex-namorado nas redes e na rua',
  'roubo a uma farmácia com arma de brinquedo',
  'maus-tratos a cachorros num canil clandestino',
  'falsificação de atestados médicos vendidos pela internet',
  'incêndio em um bar depois de uma discussão com o dono',
  'furto de cobre de uma subestação que deixa um bairro sem energia',
  'corrupção de um fiscal da prefeitura para liberar um alvará',
  'homicídio em uma briga de torcidas organizadas',
  'motorista de aplicativo que some com a mala de uma passageira',
  'clonagem de cartão em uma maquininha de um food truck',
  'lesão corporal numa academia por causa de um aparelho',
  'pirâmide financeira de criptomoedas entre amigos de faculdade',
  'tráfico de drogas em uma república de estudantes: era para uso ou venda?',
  'peculato: servidor que usava o carro oficial para fazer fretes',
  'apropriação indébita de um carro alugado que nunca foi devolvido',
  'homicídio de um vizinho após anos de briga por causa de um muro',
  'invasão de dispositivo e vazamento de fotos íntimas de um casal de influenciadores',
  'crime ambiental: desmatamento ilegal num sítio para fazer um loteamento',
  'estelionato na venda de um carro com quilometragem adulterada',
  'dano qualificado a um carro de luxo num estacionamento',
  'ameaça e injúria entre sócios de uma hamburgueria',
  'contrabando de cigarros escondidos em um caminhão de mudança',
  'omissão de socorro de um salva-vidas numa piscina de clube',
  'tentativa de homicídio por envenenamento de um sócio com remédio controlado',
  'falso testemunho em um processo trabalhista',
  'extorsão com fotos comprometedoras de um vereador'
];

export function pickTema(usados = []){
  const livres = TEMAS.filter(t => !usados.includes(t));
  const pool = livres.length ? livres : TEMAS;
  return pool[Math.floor(Math.random() * pool.length)];
}
