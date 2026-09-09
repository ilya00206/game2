import type { AppContext } from '../context.js';
import { escapeHtml } from '../../content/service.js';
import type { DayPart, HeatmapDay, StatsWord, UserStats } from '../../core/stats/statsService.js';
import { backToMenuKeyboard } from '../keyboards.js';
import { editOrReply } from '../ui.js';

const DAY_PART_TITLES: Record<DayPart, string> = {
  MORNING: 'утро',
  AFTERNOON: 'день',
  EVENING: 'вечер',
};

const WEEKDAY_TITLES = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
];

const HEATMAP_SCALE = ['⬜', '🟩', '🟢', '💚'];

export async function showStats(ctx: AppContext): Promise<void> {
  const stats = await ctx.services.stats.userStats(ctx.appUser.id, ctx.appUser.timezone);
  await editOrReply(ctx, renderStats(stats), backToMenuKeyboard());
}

function renderStats(stats: UserStats): string {
  const { totals, streak, time, habits, words } = stats;

  const lines = [
    '📚 <b>Всего</b>',
    `Выучено слов: <b>${totals.learnedWords}</b>`,
    `Изучено карточек: <b>${totals.answeredCards}</b>`,
    `Тестов: <b>${totals.completedTests}</b>`,
    `Правильных ответов: <b>${totals.correctAnswers}</b>`,
    `Процент правильных: <b>${formatPercent(totals.accuracyPercent)}</b>`,
    '',
    '🔥 <b>Серия</b>',
    `Сейчас: <b>${streak.current}</b>`,
    `Максимум: <b>${streak.max}</b>`,
    `Дней обучения: <b>${streak.learningDays}</b>`,
    `Пропущено дней: <b>${streak.missedDays}</b>`,
    `Использовано щитов: <b>${streak.shieldsUsed}</b>`,
    '',
    '⏱️ <b>Время</b>',
    `Всего обучения: <b>${formatDuration(time.totalMs)}</b>`,
    `Средняя сессия: <b>${formatDuration(time.averageMs)}</b>`,
    `Самая длинная: <b>${formatDuration(time.longestMs)}</b>`,
    '',
    '🕐 <b>Привычки</b>',
    `Любимое время: <b>${habits.favoritePart ? DAY_PART_TITLES[habits.favoritePart] : '—'}</b>`,
    `Любимый день: <b>${formatWeekday(habits.favoriteWeekday)}</b>`,
    `Сессий в день: <b>${habits.sessionsPerDay === null ? '—' : habits.sessionsPerDay.toFixed(1)}</b>`,
    '',
    '🧠 <b>Слова</b>',
    `Самое лёгкое: ${formatWord(words.easiest)}`,
    `Самое сложное: ${formatWord(words.hardest)}`,
    `Чаще всего забываешь: ${formatWord(words.mostForgotten)}`,
    `Выучено быстрее всего: ${formatWord(words.fastestLearned)}`,
    `Больше всего повторений: ${formatWord(words.mostRepeated)}`,
    '',
    '🔥 <b>Активность в этом месяце</b>',
    ...formatHeatmap(stats.heatmap),
    '',
    '🎯 <b>Трудные слова</b>',
    ...formatDifficult(stats.difficult),
  ];

  return lines.join('\n');
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }

  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} мин`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}

function formatWeekday(weekday: number | null): string {
  if (weekday === null) {
    return '—';
  }
  return WEEKDAY_TITLES[weekday - 1] ?? '—';
}

function formatWord(word: StatsWord | null): string {
  if (!word) {
    return '<b>—</b>';
  }
  return `<b>${escapeHtml(word.polish)}</b> — ${escapeHtml(word.russian)}`;
}

/** Текстовая шкала по неделям: чем ярче, тем больше полных сессий за день (§4.6). */
function formatHeatmap(days: HeatmapDay[]): string[] {
  if (days.length === 0) {
    return ['—'];
  }

  const cells = days.map(
    (day) => HEATMAP_SCALE[Math.min(day.sessions, HEATMAP_SCALE.length - 1)] ?? HEATMAP_SCALE[0],
  );

  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(cells.slice(index, index + 7).join(''));
  }

  rows.push(
    `${HEATMAP_SCALE[0]} нет · ${HEATMAP_SCALE[1]} 1 · ${HEATMAP_SCALE[2]} 2 · ${HEATMAP_SCALE[3]} 3+`,
  );
  return rows;
}

function formatDifficult(words: StatsWord[]): string[] {
  if (words.length === 0) {
    return ['Пока таких нет — ты молодец ❤️'];
  }

  return words.map(
    (word, index) =>
      `${index + 1}. <b>${escapeHtml(word.polish)}</b> — ${escapeHtml(word.russian)} · ${word.value}`,
  );
}
