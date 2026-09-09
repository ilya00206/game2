export interface CurrencyForms {
  icon: string;
  nameOne: string;
  nameFew: string;
  nameMany: string;
}

/**
 * Русское склонение числительных по остаткам от деления на 10 и 100 (§3.1).
 * Грубые диапазоны вида «5–20» дают неверные окончания для 21, 101 и т.п.
 */
export function pluralizeRu(count: number, forms: CurrencyForms): string {
  const absolute = Math.abs(Math.trunc(count));
  const mod100 = absolute % 100;
  const mod10 = absolute % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return forms.nameMany;
  }
  if (mod10 === 1) {
    return forms.nameOne;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms.nameFew;
  }
  return forms.nameMany;
}

/** «5 ☀️ солнышек» — иконка и название всегда из CurrencyConfig. */
export function formatCurrency(amount: number, forms: CurrencyForms): string {
  return `${amount} ${forms.icon} ${pluralizeRu(amount, forms)}`;
}

/** «☀️ солнышек» без числа — для сообщений о лимите. */
export function currencyNamePlural(forms: CurrencyForms): string {
  return `${forms.icon} ${forms.nameMany}`;
}
