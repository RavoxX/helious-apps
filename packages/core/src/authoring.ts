import { isAlias, isMap, parseDocument, visit } from 'yaml';
import { normalizeNotePath } from './paths.js';
import type { PropertyValue } from './markdown.js';

const limit = 1_000_000;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);

export function localDate(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Choose a valid date.');
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dailyNotePath(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error('Choose a valid calendar date.');
  return normalizeNotePath(`Daily/${day}.md`);
}

/** Literal substitution only. Secret references and unknown variables stay untouched. */
export function expandTemplate(
  source: string,
  title: string,
  now = new Date(),
  day = localDate(now),
): string {
  dailyNotePath(day);
  if (!Number.isFinite(now.getTime()) || source.length > limit || title.length > 1024)
    throw new Error('Template, title or date is invalid.');
  const values: Record<string, string> = {
    title,
    date: day,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    datetime: now.toISOString(),
    cursor: '',
  };
  const result = source.replace(
    /\{\{(title|date|time|datetime|cursor)\}\}/g,
    (_, name: string) => values[name]!,
  );
  if (result.length > limit) throw new Error('Expanded template exceeds the note size limit.');
  return result;
}

function validateValue(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): asserts value is PropertyValue {
  if (depth > 16) throw new Error('Properties are nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value))
    throw new Error('Use finite JSON-compatible property values.');
  seen.add(value);
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error('Use plain property objects.');
  const entries = Object.entries(value);
  if (entries.length > 1000) throw new Error('Property collection is too large.');
  for (const [key, child] of entries) {
    if (reserved.has(key)) throw new Error('Reserved property name.');
    validateValue(child, depth + 1, seen);
  }
  seen.delete(value);
}

/** Update an existing YAML document, preserving untouched nodes/comments and body bytes. */
export function replaceProperties(source: string, values: Record<string, PropertyValue>): string {
  if (source.length > limit) throw new Error('Note exceeds the size limit.');
  validateValue(values);
  for (const name of Object.keys(values)) {
    if (!name.trim() || name.length > 100 || reserved.has(name))
      throw new Error('Use a property name of 1–100 characters.');
  }
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const content = source.slice(bom.length);
  const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (/^---(?:\r?\n|$)/.test(content) && !front)
    throw new Error('Fix the unclosed frontmatter in Source mode first.');
  const doc = parseDocument(front?.[1] ?? '', { schema: 'core', uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length || (doc.contents && !isMap(doc.contents)))
    throw new Error('Fix unsupported or invalid frontmatter in Source mode first.');
  visit(doc, (_, node) => {
    if (isAlias(node) || (node && typeof node === 'object' && 'anchor' in node && node.anchor))
      throw new Error('Edit YAML anchors and aliases in Source mode.');
  });
  const old: unknown = doc.toJS({ maxAliasCount: 0 }) ?? {};
  validateValue(old);
  const previous = old as Record<string, PropertyValue>;
  for (const name of Object.keys(previous)) if (!Object.hasOwn(values, name)) doc.delete(name);
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(previous, name) || JSON.stringify(previous[name]) !== JSON.stringify(value))
      doc.set(name, value);
  }
  // An unchanged edit must not normalize the source or remove comments.
  if (JSON.stringify(previous) === JSON.stringify(values)) return source;
  const newline = front?.[0].includes('\r\n') ? '\r\n' : '\n';
  const yaml = doc.toString({ lineWidth: 0 }).replace(/\r?\n/g, newline);
  if (yaml.length > 65_536) throw new Error('Properties exceed the 64 KiB frontmatter limit.');
  const result = `${bom}---${newline}${yaml}---${newline}${content.slice(front?.[0].length ?? 0)}`;
  if (result.length > limit) throw new Error('Note exceeds the size limit.');
  return result;
}
