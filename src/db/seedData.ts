export interface SeedWord {
  polish: string;
  russian: string;
}

export interface SeedCategory {
  name: string;
  words: SeedWord[];
}

/**
 * Стартовый системный словарь (ownerId = null).
 * В каждой категории минимум 10 слов и различные русские переводы
 * после нормализации — иначе категория не участвует в Тесте (§4.3).
 */
export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: 'Цвета',
    words: [
      { polish: 'czerwony', russian: 'красный' },
      { polish: 'niebieski', russian: 'синий' },
      { polish: 'zielony', russian: 'зелёный' },
      { polish: 'żółty', russian: 'жёлтый' },
      { polish: 'czarny', russian: 'чёрный' },
      { polish: 'biały', russian: 'белый' },
      { polish: 'szary', russian: 'серый' },
      { polish: 'brązowy', russian: 'коричневый' },
      { polish: 'różowy', russian: 'розовый' },
      { polish: 'pomarańczowy', russian: 'оранжевый' },
    ],
  },
  {
    name: 'Еда',
    words: [
      { polish: 'chleb', russian: 'хлеб' },
      { polish: 'mleko', russian: 'молоко' },
      { polish: 'ser', russian: 'сыр' },
      { polish: 'masło', russian: 'сливочное масло' },
      { polish: 'jajko', russian: 'яйцо' },
      { polish: 'mięso', russian: 'мясо' },
      { polish: 'ryba', russian: 'рыба' },
      { polish: 'zupa', russian: 'суп' },
      { polish: 'woda', russian: 'вода' },
      { polish: 'herbata', russian: 'чай' },
      { polish: 'kawa', russian: 'кофе' },
      { polish: 'cukier', russian: 'сахар' },
    ],
  },
  {
    name: 'Семья',
    words: [
      { polish: 'mama', russian: 'мама' },
      { polish: 'tata', russian: 'папа' },
      { polish: 'siostra', russian: 'сестра' },
      { polish: 'brat', russian: 'брат' },
      { polish: 'babcia', russian: 'бабушка' },
      { polish: 'dziadek', russian: 'дедушка' },
      { polish: 'córka', russian: 'дочь' },
      { polish: 'syn', russian: 'сын' },
      { polish: 'żona', russian: 'жена' },
      { polish: 'mąż', russian: 'муж' },
    ],
  },
  {
    name: 'Дом',
    words: [
      { polish: 'dom', russian: 'дом' },
      { polish: 'drzwi', russian: 'дверь' },
      { polish: 'okno', russian: 'окно' },
      { polish: 'stół', russian: 'стол' },
      { polish: 'krzesło', russian: 'стул' },
      { polish: 'łóżko', russian: 'кровать' },
      { polish: 'kuchnia', russian: 'кухня' },
      { polish: 'pokój', russian: 'комната' },
      { polish: 'lampa', russian: 'лампа' },
      { polish: 'klucz', russian: 'ключ' },
    ],
  },
  {
    name: 'Животные',
    words: [
      { polish: 'kot', russian: 'кот' },
      { polish: 'pies', russian: 'собака' },
      { polish: 'ptak', russian: 'птица' },
      { polish: 'koń', russian: 'лошадь' },
      { polish: 'krowa', russian: 'корова' },
      { polish: 'świnia', russian: 'свинья' },
      { polish: 'owca', russian: 'овца' },
      { polish: 'mysz', russian: 'мышь' },
      { polish: 'lis', russian: 'лиса' },
      { polish: 'wilk', russian: 'волк' },
    ],
  },
];
