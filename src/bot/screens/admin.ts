import { InlineKeyboard } from 'grammy';
import type { AppContext } from '../context.js';
import { CONTENT_KEYS, type ContentKey, isContentKey } from '../../content/keys.js';
import { escapeHtml } from '../../content/service.js';
import { formatCurrency } from '../../core/economy/currency.js';
import { toLocalDate } from '../../core/time.js';
import { CALLBACK } from '../keyboards.js';
import { logger } from '../../logger.js';
import { pendingConfirm, pendingInput, type PendingInput } from '../state.js';
import { editOrReply } from '../ui.js';

const ECONOMY_FIELDS: { field: string; title: string }[] = [
  { field: 'flashcardReward', title: 'Награда за сессию' },
  { field: 'testReward', title: 'Награда за тест' },
  { field: 'dailyLearningLimit', title: 'Дневной лимит' },
  { field: 'giftSmallPrice', title: 'Маленький подарок' },
  { field: 'giftSpecialPrice', title: 'Особый подарок' },
  { field: 'shieldPrice', title: 'Щит' },
  { field: 'wishPrice', title: 'Желание от тебя' },
];

function adminBack(): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Админ', CALLBACK.menuAdmin);
}

export async function showAdminMenu(ctx: AppContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('👤 Пользователи', CALLBACK.adminUsers)
    .row()
    .text('☀️ Валюта', CALLBACK.adminCurrency)
    .text('💰 Экономика', CALLBACK.adminEconomy)
    .row()
    .text('📝 Тексты', CALLBACK.adminTexts)
    .text('❤️ Слово дня', CALLBACK.adminWordOfDay)
    .row()
    .text('⬅️ В меню', CALLBACK.menuRoot);

  await editOrReply(ctx, '🧑‍💻 Админка', keyboard);
}

export async function showUsers(ctx: AppContext): Promise<void> {
  const users = await ctx.services.admin.listUsers();
  const currency = await ctx.services.config.currency();

  const keyboard = new InlineKeyboard();
  const lines = users.map((user) => {
    const displayName = userDisplayName(user);
    keyboard.text(displayName, `admin:user:${user.id}`).row();
    return `<b>${escapeHtml(displayName)}</b> (<code>${user.telegramId}</code>) · 🔥 ${user.currentStreak}/${user.maxStreak} · ${formatCurrency(user.currencyBalance, currency)} · 🛡 ${user.shields}`;
  });

  keyboard.text('⬅️ Админ', CALLBACK.menuAdmin);

  await editOrReply(ctx, lines.join('\n') || 'Пользователей пока нет.', keyboard);
}

/** Имя из Telegram, с запасным вариантом на случай отсутствия имени/username. */
function userDisplayName(user: { firstName: string | null; username: string | null; telegramId: bigint }): string {
  if (user.firstName) {
    return user.username ? `${user.firstName} (@${user.username})` : user.firstName;
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return `ID ${user.telegramId}`;
}

export async function showUserCard(ctx: AppContext, targetUserId: number): Promise<void> {
  const user = await ctx.services.admin.getUser(targetUserId);

  const keyboard = new InlineKeyboard()
    .text('☀️ Начислить валюту', `admin:grant:${targetUserId}`)
    .row()
    .text('🔥 Вернуть стрик', `admin:streak:${targetUserId}`)
    .row()
    .text('✉️ Написать', `admin:msg:${targetUserId}`)
    .row()
    .text('⬅️ Пользователи', CALLBACK.adminUsers);

  const title = user ? userDisplayName(user) : `#${targetUserId}`;
  await editOrReply(ctx, `Пользователь: <b>${escapeHtml(title)}</b>`, keyboard);
}

export async function promptMessage(ctx: AppContext, targetUserId: number): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_MESSAGE', targetUserId });
  await editOrReply(ctx, 'Пришли текст сообщения — оно уйдёт от имени бота:', adminBack());
}

export async function promptGrant(ctx: AppContext, targetUserId: number): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_GRANT', targetUserId });
  await editOrReply(ctx, 'Пришли: <code>сумма причина</code>\n\nНапример: <code>10 за старание</code>', adminBack());
}

export async function promptStreak(ctx: AppContext, targetUserId: number): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_STREAK', targetUserId });
  await editOrReply(ctx, 'Пришли: <code>значение причина</code>\n\nНапример: <code>7 сбой связи</code>', adminBack());
}

export async function showCurrencyConfig(ctx: AppContext): Promise<void> {
  const currency = await ctx.services.config.currency();
  const keyboard = new InlineKeyboard()
    .text('✏️ Изменить', CALLBACK.adminCurrencyEdit)
    .row()
    .text('⬅️ Админ', CALLBACK.menuAdmin);

  const text = [
    `Иконка: ${currency.icon}`,
    `1: ${currency.nameOne}`,
    `2–4: ${currency.nameFew}`,
    `5+: ${currency.nameMany}`,
  ].join('\n');

  await editOrReply(ctx, text, keyboard);
}

export async function promptCurrencyEdit(ctx: AppContext): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_CURRENCY' });
  await editOrReply(
    ctx,
    'Пришли четыре значения через запятую:\n<code>☀️, солнышко, солнышка, солнышек</code>',
    adminBack(),
  );
}

export async function showEconomyConfig(ctx: AppContext): Promise<void> {
  const economy = await ctx.services.config.economy();
  const keyboard = new InlineKeyboard();

  for (const item of ECONOMY_FIELDS) {
    const value = economy[item.field as keyof typeof economy];
    keyboard.text(`${item.title}: ${value}`, `admin:econ:${item.field}`).row();
  }
  keyboard.text('⬅️ Админ', CALLBACK.menuAdmin);

  await editOrReply(ctx, 'Экономика — нажми, чтобы изменить:', keyboard);
}

export async function promptEconomyEdit(ctx: AppContext, field: string): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_ECONOMY', field });
  await editOrReply(ctx, 'Пришли новое целое значение (>= 0):', adminBack());
}

export async function showTextGroups(ctx: AppContext): Promise<void> {
  const groups = [...new Set(Object.values(CONTENT_KEYS).map((item) => item.group))];
  const keyboard = new InlineKeyboard();

  for (const group of groups) {
    keyboard.text(group, `admin:tgroup:${group}`).row();
  }
  keyboard.text('⬅️ Админ', CALLBACK.menuAdmin);

  await editOrReply(ctx, 'Выбери группу текстов:', keyboard);
}

export async function showTextKeys(ctx: AppContext, group: string): Promise<void> {
  const keys = Object.entries(CONTENT_KEYS)
    .filter(([, value]) => value.group === group)
    .map(([key]) => key);

  const keyboard = new InlineKeyboard();
  for (const key of keys) {
    keyboard.text(key, `admin:tkey:${key}`).row();
  }
  keyboard.text('⬅️ Группы', CALLBACK.adminTexts);

  await editOrReply(ctx, `Ключи группы ${escapeHtml(group)}:`, keyboard);
}

export async function showTextVariants(ctx: AppContext, key: ContentKey): Promise<void> {
  const variants = await ctx.services.admin.listTextVariants(key);
  const keyboard = new InlineKeyboard();

  const lines = variants.map((variant) => {
    keyboard
      .text(
        `${variant.isActive ? '✅' : '🚫'} #${variant.variant}`,
        `admin:ttoggle:${key}:${variant.variant}`,
      )
      .text('✏️', `admin:tedit:${key}:${variant.variant}`);
    if (variant.isSeed) {
      keyboard.text('↩️ seed', `admin:tseed:${key}:${variant.variant}`);
    }
    keyboard.row();
    return `#${variant.variant} ${variant.isActive ? '' : '(выключен) '}${escapeHtml(variant.text)}`;
  });

  keyboard.text('➕ Новый вариант', `admin:tadd:${key}`).row();
  keyboard.text('⬅️ Назад', `admin:tgroup:${CONTENT_KEYS[key].group}`);

  const allowed = CONTENT_KEYS[key].placeholders;
  const hint = allowed.length > 0 ? `\n\nPlaceholders: ${allowed.map((p) => `{${p}}`).join(', ')}` : '';

  await editOrReply(ctx, `<b>${escapeHtml(key)}</b>\n\n${lines.join('\n\n')}${hint}`, keyboard);
}

export async function showWordOfDay(ctx: AppContext): Promise<void> {
  const today = toLocalDate(ctx.services.clock.now(), ctx.appUser.timezone);
  const entries = await ctx.services.admin.listWordOfDay(today);

  const keyboard = new InlineKeyboard().text('➕ Назначить', CALLBACK.adminWordOfDayAdd).row();
  for (const entry of entries) {
    keyboard.text(`🗑 ${entry.date}`, `admin:wodel:${entry.date}`).row();
  }
  keyboard.text('⬅️ Админ', CALLBACK.menuAdmin);

  const lines = entries.map(
    (entry) => `${entry.date}: ${escapeHtml(entry.polish)} — ${escapeHtml(entry.russian)}`,
  );

  await editOrReply(ctx, lines.join('\n') || 'Слов дня пока нет.', keyboard);
}

export async function promptWordOfDay(ctx: AppContext): Promise<void> {
  pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_WORD_OF_DAY' });
  await editOrReply(
    ctx,
    'Пришли: <code>ГГГГ-ММ-ДД польское_слово</code>\n\nСлово может быть любым, даже ещё не из словаря. Например: <code>2026-09-10 kocham</code>',
    adminBack(),
  );
}

/** Применяет подтверждённое действие; requestId — id кнопки подтверждения (§3.1). */
export async function confirmAdminAction(ctx: AppContext, requestId: string): Promise<void> {
  const pending = pendingConfirm.get(ctx.appUser.id);
  if (!pending) {
    await showAdminMenu(ctx);
    return;
  }

  pendingConfirm.clear(ctx.appUser.id);

  if (pending.kind === 'ADMIN_MESSAGE') {
    await sendAdminMessage(ctx, pending.targetUserId, pending.text, requestId);
    return;
  }

  const result =
    pending.kind === 'ADMIN_GRANT'
      ? await ctx.services.admin.grantCurrency({
          adminTelegramId: ctx.appUser.telegramId,
          userId: pending.targetUserId,
          amount: pending.amount,
          reason: pending.reason,
          requestId,
        })
      : await ctx.services.admin.restoreStreak({
          adminTelegramId: ctx.appUser.telegramId,
          userId: pending.targetUserId,
          value: pending.value,
          reason: pending.reason,
          requestId,
        });

  const text = result.ok
    ? result.alreadyApplied
      ? 'Это действие уже было применено.'
      : 'Готово ✅'
    : 'Не получилось: проверь значения.';

  await editOrReply(ctx, text, adminBack());
}

/** Сообщение резервируется в БД, и только потом вызывается Telegram (§5.1). */
async function sendAdminMessage(
  ctx: AppContext,
  targetUserId: number,
  text: string,
  requestId: string,
): Promise<void> {
  const reserved = await ctx.services.admin.reserveMessage({
    adminTelegramId: ctx.appUser.telegramId,
    userId: targetUserId,
    text,
    requestId,
  });

  if (!reserved.ok) {
    const message =
      reserved.reason === 'ALREADY_SENT'
        ? 'Это сообщение уже отправлено.'
        : reserved.reason === 'USER_NOT_FOUND'
          ? 'Пользователь не найден.'
          : 'Сообщение пустое или слишком длинное.';
    await editOrReply(ctx, message, adminBack());
    return;
  }

  try {
    // Без parse_mode: текст админа уходит как есть и не ломает разметку.
    await ctx.api.sendMessage(reserved.telegramId.toString(), reserved.text);
    await ctx.services.admin.markMessageSent(targetUserId, requestId);
    await editOrReply(ctx, 'Сообщение отправлено ✅', adminBack());
  } catch (error) {
    logger.error({ err: error, targetUserId }, 'Не удалось отправить сообщение пользователю');
    await editOrReply(ctx, 'Не удалось отправить — возможно, пользователь не начинал чат с ботом.', adminBack());
  }
}

export function parseAmountAndReason(
  raw: string,
): { value: number; reason: string } | null {
  const match = raw.trim().match(/^(-?\d+)\s+(.+)$/s);
  if (!match) {
    return null;
  }

  return { value: Number(match[1]), reason: (match[2] ?? '').trim() };
}

/** Ввод админа: значения разбираются здесь, а применяются после подтверждения. */
export async function handleAdminInput(
  ctx: AppContext,
  pending: PendingInput,
  text: string,
): Promise<boolean> {
  const { admin, config, content } = ctx.services;

  switch (pending.kind) {
    case 'ADMIN_GRANT':
    case 'ADMIN_STREAK': {
      const parsed = parseAmountAndReason(text);
      if (!parsed) {
        await ctx.reply('Формат: <code>число причина</code>', { parse_mode: 'HTML' });
        return true;
      }

      pendingInput.clear(ctx.appUser.id);
      pendingConfirm.set(
        ctx.appUser.id,
        pending.kind === 'ADMIN_GRANT'
          ? {
              kind: 'ADMIN_GRANT',
              targetUserId: pending.targetUserId,
              amount: parsed.value,
              reason: parsed.reason,
            }
          : {
              kind: 'ADMIN_STREAK',
              targetUserId: pending.targetUserId,
              value: parsed.value,
              reason: parsed.reason,
            },
      );

      const keyboard = new InlineKeyboard()
        .text('✅ Подтвердить', CALLBACK.adminConfirm)
        .text('Отмена', CALLBACK.menuAdmin);

      await ctx.reply(
        `Проверь: <b>${parsed.value}</b>\nПричина: ${escapeHtml(parsed.reason)}`,
        { parse_mode: 'HTML', reply_markup: keyboard },
      );
      return true;
    }

    case 'ADMIN_CURRENCY': {
      const parts = text.split(',').map((part) => part.trim());
      const [icon, nameOne, nameFew, nameMany] = parts;

      if (parts.length !== 4 || !icon || !nameOne || !nameFew || !nameMany) {
        await ctx.reply('Нужны ровно четыре непустых значения через запятую.');
        return true;
      }

      const ok = await admin.updateCurrencyConfig(
        { icon, nameOne, nameFew, nameMany },
        ctx.appUser.id,
      );

      pendingInput.clear(ctx.appUser.id);
      config.invalidateCurrency();
      await ctx.reply(ok ? 'Валюта обновлена ✅' : 'Значения не подошли.');
      return true;
    }

    case 'ADMIN_ECONOMY': {
      const value = Number(text.trim());
      if (!Number.isInteger(value) || value < 0) {
        await ctx.reply('Нужно целое число >= 0.');
        return true;
      }

      await admin.updateEconomyField(
        pending.field as Parameters<typeof admin.updateEconomyField>[0],
        value,
        ctx.appUser.id,
      );

      pendingInput.clear(ctx.appUser.id);
      config.invalidateEconomy();
      await ctx.reply('Экономика обновлена ✅');
      return true;
    }

    case 'ADMIN_TEXT_ADD':
    case 'ADMIN_TEXT_EDIT': {
      const result =
        pending.kind === 'ADMIN_TEXT_ADD'
          ? await admin.addTextVariant(
              pending.key,
              CONTENT_KEYS[pending.key].group,
              text,
              ctx.appUser.id,
            )
          : await admin.updateTextVariant(pending.key, pending.variant, text, ctx.appUser.id);

      if (!result.ok) {
        await ctx.reply(`Не сохранил: ${result.errors.join('; ')}`);
        return true;
      }

      pendingInput.clear(ctx.appUser.id);
      content.invalidate(pending.key);
      await ctx.reply('Текст сохранён ✅');
      return true;
    }

    case 'ADMIN_MESSAGE': {
      const message = text.trim();
      if (message.length === 0) {
        await ctx.reply('Пустое сообщение отправить нельзя.');
        return true;
      }

      pendingInput.clear(ctx.appUser.id);
      pendingConfirm.set(ctx.appUser.id, {
        kind: 'ADMIN_MESSAGE',
        targetUserId: pending.targetUserId,
        text: message,
      });

      const keyboard = new InlineKeyboard()
        .text('✅ Отправить', CALLBACK.adminConfirm)
        .text('Отмена', CALLBACK.menuAdmin);

      await ctx.reply(`Будет отправлено:\n\n${escapeHtml(message)}`, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return true;
    }

    case 'ADMIN_WORD_OF_DAY': {
      const [date, ...rest] = text.trim().split(/\s+/);
      const polish = rest.join(' ');

      if (!date || !polish) {
        await ctx.reply('Формат: <code>ГГГГ-ММ-ДД слово</code>', { parse_mode: 'HTML' });
        return true;
      }

      pendingInput.set(ctx.appUser.id, { kind: 'ADMIN_WORD_OF_DAY_RUSSIAN', date, polish });
      await ctx.reply(`Теперь пришли перевод слова <b>${escapeHtml(polish)}</b> на русский:`, {
        parse_mode: 'HTML',
      });
      return true;
    }

    case 'ADMIN_WORD_OF_DAY_RUSSIAN': {
      const russian = text.trim();
      const result = await admin.setWordOfDay(pending.date, pending.polish, russian);
      if (!result.ok) {
        await ctx.reply(
          result.reason === 'INVALID_DATE'
            ? 'Дата в формате ГГГГ-ММ-ДД.'
            : 'Слово и перевод должны быть от 1 до 100 символов.',
        );
        return true;
      }

      pendingInput.clear(ctx.appUser.id);
      await ctx.reply('Слово дня назначено ❤️');
      return true;
    }

    default:
      return false;
  }
}

export { CONTENT_KEYS, isContentKey };
