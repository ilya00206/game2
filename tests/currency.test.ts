import { describe, expect, it } from 'vitest';
import {
  currencyNamePlural,
  formatCurrency,
  pluralizeRu,
  type CurrencyForms,
} from '../src/core/economy/currency.js';

const forms: CurrencyForms = {
  icon: '☀️',
  nameOne: 'солнышко',
  nameFew: 'солнышка',
  nameMany: 'солнышек',
};

describe('склонение валюты', () => {
  it('использует форму "one" для 1, 21, 101', () => {
    expect(pluralizeRu(1, forms)).toBe('солнышко');
    expect(pluralizeRu(21, forms)).toBe('солнышко');
    expect(pluralizeRu(101, forms)).toBe('солнышко');
  });

  it('использует форму "few" для 2-4, 22-24', () => {
    expect(pluralizeRu(2, forms)).toBe('солнышка');
    expect(pluralizeRu(4, forms)).toBe('солнышка');
    expect(pluralizeRu(23, forms)).toBe('солнышка');
  });

  it('использует форму "many" для 0, 5-20, 11-14 и 111', () => {
    expect(pluralizeRu(0, forms)).toBe('солнышек');
    expect(pluralizeRu(5, forms)).toBe('солнышек');
    expect(pluralizeRu(11, forms)).toBe('солнышек');
    expect(pluralizeRu(14, forms)).toBe('солнышек');
    expect(pluralizeRu(111, forms)).toBe('солнышек');
  });

  it('форматирует сумму вместе с иконкой', () => {
    expect(formatCurrency(5, forms)).toBe('5 ☀️ солнышек');
    expect(currencyNamePlural(forms)).toBe('☀️ солнышек');
  });
});
