import { describe, expect, it } from 'vitest';
import { extractPlaceholders, validateTemplate } from '../src/content/keys.js';
import { escapeHtml, renderTemplate } from '../src/content/service.js';

describe('runtime-тексты', () => {
  it('находит placeholders в шаблоне', () => {
    expect(extractPlaceholders('Серия {streak} и {currency}')).toEqual(['streak', 'currency']);
  });

  it('запрещает неизвестный placeholder', () => {
    const errors = validateTemplate('streak.current', 'Серия {streak} и {unknown}');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown');
  });

  it('запрещает пустой текст', () => {
    expect(validateTemplate('streak.lost', '   ')).toContain('пустой текст запрещён');
  });

  it('разрешает корректный шаблон', () => {
    expect(validateTemplate('streak.current', '🔥 {streak} дней подряд')).toEqual([]);
  });

  it('экранирует динамические значения', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(renderTemplate('Привет, {name}', { name: '<script>' })).toBe(
      'Привет, &lt;script&gt;',
    );
  });

  it('оставляет неизвестный placeholder нетронутым при рендере', () => {
    expect(renderTemplate('Серия {streak}', {})).toBe('Серия {streak}');
  });
});
