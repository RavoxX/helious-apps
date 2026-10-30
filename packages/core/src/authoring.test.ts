import { describe, expect, it } from 'vitest';
import { dailyNotePath, expandTemplate, localDate, replaceProperties } from './authoring.js';
import { parseMarkdown } from './markdown.js';

describe('authoring', () => {
  it('validates calendar days without rolling invalid dates forward', () => {
    expect(dailyNotePath('2024-02-29')).toBe('Daily/2024-02-29.md');
    expect(dailyNotePath('0099-01-01')).toBe('Daily/0099-01-01.md');
    for (const day of ['2025-02-29', '2026-04-31', '', '2026-13-01', '2026-1-01', '../today'])
      expect(() => dailyNotePath(day)).toThrow('calendar');
    const date = new Date(2026, 1, 3, 23, 59);
    expect(localDate(date)).toBe('2026-02-03');
    expect(() => localDate(new Date('bad'))).toThrow('valid');
  });
  it('uses the chosen day but the actual clock, and substitutes literally', () => {
    const now = new Date(2026, 4, 6, 23, 42);
    expect(
      expandTemplate(
        '{{title}} {{date}} {{time}} {{datetime}} {{cursor}} {{secret:key}} {{unknown}}',
        '$&',
        now,
        '2026-01-02',
      ),
    ).toBe(`$& 2026-01-02 23:42 ${now.toISOString()}  {{secret:key}} {{unknown}}`);
    expect(() => expandTemplate('{{title}}'.repeat(110000), 'a'.repeat(1024))).toThrow('limit');
  });
  it('preserves YAML comments, unchanged values, CRLF and the exact Markdown body', () => {
    const body = '\r\n# Body\r\n\r\nA  \r\n{{secret:key}}\r\n';
    const source = `---\r\n# Keep this comment\r\nstatus: draft # workflow\r\ncount: 2\r\nnested: {a: [1, true]}\r\n---\r\n${body}`;
    const properties = parseMarkdown(source).properties;
    expect(replaceProperties(source, properties)).toBe(source);
    const result = replaceProperties(source, { ...properties, count: 3, approved: false });
    expect(result).toContain('# Keep this comment\r\nstatus: draft # workflow');
    expect(result.endsWith(body)).toBe(true);
    expect(parseMarkdown(result).properties).toEqual({ ...properties, count: 3, approved: false });
    expect(replaceProperties(result, { status: 'done' })).not.toContain('nested:');
  });
  it('adds properties to a plain note and preserves null, dates, lists and nested types', () => {
    const values = {
      date: '2026-10-30',
      empty: null,
      tags: ['one', 'a,b'],
      count: 3,
      nested: { list: [true, 2] },
    };
    const result = replaceProperties('# Original\n', values);
    expect(parseMarkdown(result).properties).toEqual(values);
    expect(result.endsWith('# Original\n')).toBe(true);
    expect(replaceProperties('\uFEFF# Original\r\n', values)).toMatch(/^\uFEFF---/);
  });
  it('refuses lossy rewrites and unsafe property values', () => {
    for (const source of [
      '---\nx: 1',
      '---\nx: 1\nx: 2\n---\nbody',
      '---\nx: &a 2\ny: *a\n---\nbody',
      '---\nx: !custom abc\n---\nbody',
      '---\n- item\n---\nbody',
    ])
      expect(() => replaceProperties(source, { a: 1 })).toThrow();
    for (const values of [
      { a: Infinity },
      JSON.parse('{"__proto__":1}') as { a: number },
      { a: 'x'.repeat(66000) },
    ])
      expect(() => replaceProperties('body', values)).toThrow();
    expect(() =>
      replaceProperties('body', { nested: JSON.parse('{"constructor":1}') as { a: number } }),
    ).toThrow('Reserved');
  });
});
