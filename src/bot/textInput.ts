import type { AppContext } from './context.js';
import { handleAdminInput } from './screens/admin.js';
import { handleVocabularyInput } from './screens/vocabulary.js';
import { pendingInput } from './state.js';

/** Единая точка обработки свободного текста: бот отвечает только когда ждёт ввод. */
export async function handleTextInput(ctx: AppContext, text: string): Promise<boolean> {
  const pending = pendingInput.get(ctx.appUser.id);
  if (!pending) {
    return false;
  }

  if (pending.kind === 'ADD_WORD' || pending.kind === 'NEW_CATEGORY') {
    return handleVocabularyInput(ctx, pending, text);
  }

  if (!ctx.isAdmin) {
    pendingInput.clear(ctx.appUser.id);
    return false;
  }

  return handleAdminInput(ctx, pending, text);
}
