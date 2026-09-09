import { InlineKeyboard } from 'grammy';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { schedulerRegistry } from '../../scheduler/registry.js';
import { backToMenuKeyboard, CALLBACK, reminderHourCallback } from '../keyboards.js';
import { editOrReply } from '../ui.js';

const HOURS_PER_ROW = 4;
export const reminderHourSchema = z.number().int().min(0).max(23);

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export async function showSettings(ctx: AppContext): Promise<void> {
  const keyboard = new InlineKeyboard();

  for (let hour = 0; hour < 24; hour += 1) {
    keyboard.text(
      hour === ctx.appUser.reminderHour ? `✅ ${formatHour(hour)}` : formatHour(hour),
      reminderHourCallback(hour),
    );
    if ((hour + 1) % HOURS_PER_ROW === 0) {
      keyboard.row();
    }
  }
  keyboard.text('⬅️ В меню', CALLBACK.menuRoot);

  await editOrReply(
    ctx,
    `⚙️ Во сколько присылать утреннее напоминание?\n\nСейчас: <b>${formatHour(ctx.appUser.reminderHour)}</b>`,
    keyboard,
  );
}

/** Новое значение применяется со следующего тика, без перезапуска (§4.7). */
export async function setReminderHour(ctx: AppContext, rawHour: number): Promise<void> {
  const parsed = reminderHourSchema.safeParse(rawHour);
  if (!parsed.success) {
    await editOrReply(ctx, 'Такого часа не бывает 🙂', backToMenuKeyboard());
    return;
  }

  const hour = parsed.data;
  await ctx.services.prisma.user.update({
    where: { id: ctx.appUser.id },
    data: { reminderHour: hour },
  });

  ctx.appUser.reminderHour = hour;
  schedulerRegistry.updateReminderHour(ctx.appUser.id, hour);

  await showSettings(ctx);
}
