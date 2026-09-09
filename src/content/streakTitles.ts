/** Титулы стрика: добавление звания — одна строка, без правок бизнес-логики (§3.2.1). */
export interface StreakTitle {
  streak: number;
  title: string;
}

export const STREAK_TITLES: StreakTitle[] = [
  { streak: 3, title: 'Солнышко моё ☀️' },
  { streak: 7, title: 'Умница-красавица' },
  { streak: 14, title: 'Моя гордость' },
  { streak: 30, title: 'Pani Kochana' },
  { streak: 50, title: 'Najlepsza na świecie' },
].sort((left, right) => left.streak - right.streak);

export function findStreakTitle(streak: number): string | undefined {
  return STREAK_TITLES.find((entry) => entry.streak === streak)?.title;
}

export const STREAK_MILESTONES = [1, 3, 7, 14, 30, 50, 100] as const;

export function isStreakMilestone(streak: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(streak);
}
