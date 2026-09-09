import type { Context } from 'grammy';
import type { Services } from '../services.js';

export interface AppUser {
  id: number;
  telegramId: bigint;
  timezone: string;
  reminderHour: number;
  currencyBalance: number;
  currentStreak: number;
  maxStreak: number;
  shields: number;
}

export interface AppContext extends Context {
  services: Services;
  /** Заполняется после whitelist- и user-middleware. */
  appUser: AppUser;
  isAdmin: boolean;
}
