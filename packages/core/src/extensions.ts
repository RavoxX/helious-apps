import { expandTemplate, replaceProperties } from './authoring.js';
import { parseMarkdown, type PropertyValue } from './markdown.js';
export type ExtensionPermission = 'editor:read' | 'editor:write';
export type ExtensionStep =
  | { op: 'append' | 'prepend'; text: string }
  | { op: 'replace'; find: string; text: string }
  | { op: 'setProperty'; key: string; value: PropertyValue }
  | { op: 'countWords' };
export interface ExtensionManifest {
  api: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: ExtensionPermission[];
  commands: { id: string; name: string; steps: ExtensionStep[] }[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function fields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(
      'Unsupported extension fields. Executable code and extra capabilities are not supported.',
    );
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
/** Validate API v1. Plugins are bounded declarative programs, never executable JS/WASM. */
export function validateExtension(input: unknown): ExtensionManifest {
  if (new TextEncoder().encode(JSON.stringify(input)).length > 65536)
    throw new Error('Extension manifests are limited to 64 KiB.');
  fields(input, ['api', 'id', 'name', 'version', 'description', 'permissions', 'commands']);
  if (
    input.api !== 1 ||
    !id(input.id) ||
    !text(input.name, 80) ||
    !input.name.trim() ||
    !text(input.version, 40) ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(input.version) ||
    (input.description !== undefined && !text(input.description, 2000))
  )
    throw new Error('Use a valid API 1 extension identity, name and version.');
  if (
    !Array.isArray(input.permissions) ||
    !input.permissions.includes('editor:read') ||
    input.permissions.some((p) => !['editor:read', 'editor:write'].includes(p)) ||
    new Set(input.permissions).size !== input.permissions.length
  )
    throw new Error('Only explicit editor:read and editor:write permissions are supported.');
  if (!Array.isArray(input.commands) || !input.commands.length || input.commands.length > 20)
    throw new Error('An extension needs 1–20 commands.');
  const ids = new Set<string>();
  for (const command of input.commands) {
    fields(command, ['id', 'name', 'steps']);
    if (
      !id(command.id) ||
      ids.has(command.id) ||
      !text(command.name, 80) ||
      !command.name.trim() ||
      !Array.isArray(command.steps) ||
      !command.steps.length ||
      command.steps.length > 20
    )
      throw new Error('Use unique command IDs, labelled commands and 1–20 steps.');
    ids.add(command.id);
    for (const step of command.steps) {
      if (!object(step)) throw new Error('Invalid extension step.');
      const op = step.op;
      const allowed =
        op === 'countWords'
          ? ['op']
          : op === 'setProperty'
            ? ['op', 'key', 'value']
            : op === 'replace'
              ? ['op', 'find', 'text']
              : ['op', 'text'];
      fields(step, allowed);
      if (!['append', 'prepend', 'replace', 'setProperty', 'countWords'].includes(String(op)))
        throw new Error('Unsupported extension operation.');
      if (op !== 'countWords' && !input.permissions.includes('editor:write'))
        throw new Error('Editing commands must declare editor:write.');
      if (['append', 'prepend', 'replace'].includes(String(op)) && !text(step.text, 20000))
        throw new Error('Step text is limited to 20,000 characters.');
      if (op === 'replace' && (!text(step.find, 1000) || !step.find))
        throw new Error('Replacement uses a nonempty literal of at most 1,000 characters.');
      if (op === 'setProperty') {
        if (
          !text(step.key, 100) ||
          !step.key.trim() ||
          ['__proto__', 'constructor', 'prototype'].includes(step.key) ||
          !Object.hasOwn(step, 'value')
        )
          throw new Error('Invalid property step.');
        replaceProperties('', { [step.key]: step.value as PropertyValue });
      }
    }
  }
  return input as unknown as ExtensionManifest;
}
export function runExtension(
  input: ExtensionManifest,
  commandId: string,
  granted: readonly ExtensionPermission[],
  context: { source: string; path: string; now?: Date },
) {
  const manifest = validateExtension(input);
  if (manifest.permissions.some((p) => !granted.includes(p)))
    throw new Error('Grant the extension’s declared permissions before running it.');
  const command = manifest.commands.find((c) => c.id === commandId);
  if (!command) throw new Error('Extension command not found.');
  let source = context.source;
  if (source.length > 1_000_000) throw new Error('Draft exceeds the extension size limit.');
  const title = (context.path.split('/').at(-1) ?? '').replace(/\.md$/i, '');
  const expand = (value: string) => expandTemplate(value, title, context.now ?? new Date());
  let message = 'Review the proposal, then apply it to your draft. Save explicitly to keep it.';
  for (const step of command.steps) {
    switch (step.op) {
      case 'append':
        source += expand(step.text);
        break;
      case 'prepend':
        source = expand(step.text) + source;
        break;
      case 'replace': {
        const pieces = source.split(step.find);
        if (pieces.length > 1001) throw new Error('Replacement exceeds the 1,000-match limit.');
        source = pieces.join(expand(step.text));
        break;
      }
      case 'setProperty': {
        // Preserve all unrelated frontmatter through the shared lossless editor.
        const values = parseMarkdown(source).properties;
        source = replaceProperties(source, { ...values, [step.key]: step.value });
        break;
      }
      case 'countWords':
        message = `Words: ${(source.match(/[^\p{White_Space}]+/gu) ?? []).length}`;
        break;
    }
    if (source.length > 1_000_000)
      throw new Error('Extension output exceeds the draft size limit.');
  }
  return { source, message };
}
export const exampleExtension: ExtensionManifest = {
  api: 1,
  id: 'meeting-tools',
  name: 'Meeting tools',
  version: '1.0.0',
  description: 'A timestamped checklist and a read-only word count.',
  permissions: ['editor:read', 'editor:write'],
  commands: [
    {
      id: 'checklist',
      name: 'Append meeting checklist',
      steps: [
        {
          op: 'append',
          text: '\n\n## Meeting · {{date}} {{time}}\n\n- [ ] Decisions\n- [ ] Next steps\n',
        },
      ],
    },
    { id: 'words', name: 'Count words', steps: [{ op: 'countWords' }] },
  ],
};
