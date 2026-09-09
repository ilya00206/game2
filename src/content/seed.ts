import type { ContentKey } from './keys.js';
import { CONTENT_KEYS } from './keys.js';

export interface SeedContentText {
  key: ContentKey;
  variant: number;
  group: string;
  text: string;
}

const RAW_SEED: Record<ContentKey, string[]> = {
  'ui.menu.title': ['Привет, солнышко ❤️ Что будем делать?', 'Я тут и очень тебе рад ❤️'],
  'ui.session.no_words': [
    'В этой категории пока нет слов. Давай добавим что-нибудь новенькое?',
  ],
  'ui.session.limit_reached': [
    'Ты сегодня уже заработала максимум {currency}. Давай теперь немного отдохнём, ты умница ❤️',
    'На сегодня {currency} закончились, но ты большая молодец. Отдыхай ❤️',
  ],
  'ui.test.unavailable': [
    'Для теста нужно сначала немного позаниматься карточками. Начнём с них?',
  ],
  'reminder.morning': [
    'Доброе утро ❤️ Твоя серия — {streak}. Начнём день с польского?',
    'Просыпайся, красавица ☀️ Серия: {streak}. Пара минут польского?',
  ],
  'reminder.evening': [
    'Сегодня ещё не занимались. Серия: {streak}. Заглянешь на пару минут?',
    'Вечер — отличное время для польского. Твоя серия: {streak} ❤️',
  ],
  'praise.session_finished': ['Отлично поработала ❤️', 'Ты умница, всё получилось ☀️'],
  'praise.test_finished': ['Тест пройден! Горжусь тобой ❤️', 'Вот это результат ☀️'],
  'praise.session_perfect': ['Ни одной ошибки. Ты невероятная ❤️'],
  'streak.current': ['🔥 {streak} дней подряд', '🔥 Серия: {streak}'],
  'streak.milestone': ['Уже {streak} дней подряд. Это очень круто ❤️'],
  'streak.record': ['🏆 Новый рекорд — {streak} дней!'],
  'streak.lost': ['Ничего страшного. Начнём новую серию? 🔥'],
  'streak.shield_used': ['🛡️ Щит сработал — твой огонь сохранён'],
  'streak.early_offer': [
    '🌙 Ты сегодня уже достаточно постаралась.\nХочешь закрыть завтрашний день заранее?',
  ],
  'streak.early_activated': ['Завтрашний день закрыт заранее. Отдыхай спокойно ❤️'],
  'surprise.random': ['Я просто решил тебя сегодня немного порадовать — держи {amount} {currency} ☀️'],
  'word_of_day.intro': ['Сегодня я хочу, чтобы ты запомнила именно это слово ❤️'],
};

export const SEED_CONTENT_TEXTS: SeedContentText[] = Object.entries(RAW_SEED).flatMap(
  ([key, variants]) =>
    variants.map((text, index) => ({
      key: key as ContentKey,
      variant: index,
      group: CONTENT_KEYS[key as ContentKey].group,
      text,
    })),
);

export function seedTextFor(key: ContentKey, variant = 0): string {
  return RAW_SEED[key][variant] ?? RAW_SEED[key][0] ?? '';
}
