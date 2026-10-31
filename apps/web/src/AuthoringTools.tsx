import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dailyNotePath,
  expandTemplate,
  localDate,
  normalizeNotePath,
  pathKey,
} from '@helious/core';
import { api, ApiError } from './api';
import { refreshVault, type Space } from './knowledge';
import './authoring.css';

type Template = { id: string; path: string; spaceId: string };

export function AuthoringTools({
  vaultId,
  spaceId,
  spaces,
  open,
}: {
  vaultId: string;
  spaceId: string;
  spaces: Space[];
  open: (id: string) => void;
}) {
  const client = useQueryClient();
  const [day, setDay] = useState(localDate);
  const [template, setTemplate] = useState('');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const destination =
    spaces.find((space) => space.id === spaceId) ??
    spaces.find((space) => space.kind === 'personal');
  const templates = useQuery({
    queryKey: ['templates', vaultId],
    queryFn: async () => {
      const notes: Template[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await api<{ notes: Template[]; total: number }>(
          `/vaults/${vaultId}/notes?path=Templates&limit=100&offset=${offset}`,
        );
        notes.push(...page.notes.filter((note) => /^Templates\/.+\.md$/i.test(note.path)));
        if (offset + page.notes.length >= page.total) return notes;
        if (offset >= 9900 || !page.notes.length)
          throw new Error(
            'Template listing is limited to the first 10,000 notes. Use the file explorer for larger vaults.',
          );
      }
    },
  });
  const create = useMutation({
    mutationFn: async (kind: 'daily' | 'note' | 'template') => {
      if (!destination) throw new Error('Choose a destination Space first.');
      const target =
        kind === 'daily'
          ? dailyNotePath(day)
          : normalizeNotePath(
              kind === 'template'
                ? `Templates/${name.trim().replace(/\.md$/i, '')}.md`
                : /\.md$/i.test(path)
                  ? path
                  : `${path}.md`,
            );
      const existing = async () => {
        for (let offset = 0; ; offset += 100) {
          const result = await api<{ notes: Template[]; total: number }>(
            `/vaults/${vaultId}/notes?path=Daily&offset=${offset}&limit=100`,
          );
          const match = result.notes.find((note) => pathKey(note.path) === pathKey(target));
          if (match || offset + result.notes.length >= result.total) return match;
          if (!result.notes.length || offset >= 9900)
            throw new Error('Use the file explorer to find daily notes in this large folder.');
        }
      };
      // The server enforces unique paths. Do not move or overwrite an existing daily note.
      if (kind === 'daily') {
        const found = await existing();
        if (found) {
          if (found.spaceId !== destination.id)
            throw new Error(
              'This daily note already belongs to another Space. Select that Space to open it.',
            );
          return found.id;
        }
      }
      const selected = templates.data?.find((item) => item.id === template);
      if (template && !selected && kind !== 'template')
        throw new Error('The selected template is no longer available. Choose another template.');
      const source =
        kind === 'template'
          ? '# {{title}}\n\nCreated {{date}}\n\n{{cursor}}'
          : selected
            ? (await api<{ note: { markdown: string } }>(`/vaults/${vaultId}/notes/${selected.id}`))
                .note.markdown
            : kind === 'daily'
              ? '# {{date}}\n\n## Notes\n\n## Tasks\n\n- [ ] '
              : '# {{title}}\n\n';
      const title = target.split('/').at(-1)!.replace(/\.md$/i, '');
      try {
        const result = await api<{ note: { id: string } }>(`/vaults/${vaultId}/notes`, 'POST', {
          path: target,
          spaceId: destination.id,
          markdown:
            kind === 'template'
              ? source
              : expandTemplate(source, title, new Date(), kind === 'daily' ? day : undefined),
        });
        return result.note.id;
      } catch (error) {
        if (kind === 'daily' && error instanceof ApiError && error.status === 409) {
          const found = await existing();
          if (found?.spaceId === destination.id) return found.id;
        }
        throw error;
      }
    },
    onSuccess: async (id) => {
      await refreshVault(client, vaultId);
      await client.invalidateQueries({ queryKey: ['templates', vaultId] });
      open(id);
      setPath('');
      setName('');
    },
  });
  return (
    <details className="authoring-tools">
      <summary>
        <CalendarDays size={15} aria-hidden="true" />
        Daily notes &amp; templates
      </summary>
      <p>
        Save new notes in <strong>{destination?.name ?? 'a selected Space'}</strong>. Existing notes
        stay in their original Space.
      </p>
      <label>
        Template
        <select
          aria-label="Template"
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
        >
          <option value="">Built-in blank / daily note</option>
          {templates.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.path} · {spaces.find((space) => space.id === item.spaceId)?.name}
            </option>
          ))}
        </select>
      </label>
      <div className="authoring-row">
        <label>
          Daily note date
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={create.isPending || !day}
          onClick={() => create.mutate('daily')}
        >
          Open daily note
        </button>
      </div>
      <div className="authoring-row">
        <label>
          New note from template
          <input
            value={path}
            maxLength={1024}
            placeholder="Projects/My idea.md"
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={create.isPending || !path.trim() || !template}
          onClick={() => create.mutate('note')}
        >
          Create from template
        </button>
      </div>
      <div className="authoring-row">
        <label>
          New template name
          <input
            value={name}
            maxLength={240}
            placeholder="Meeting"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => create.mutate('template')}
        >
          Create template
        </button>
      </div>
      <p>
        Templates are ordinary Markdown in Templates/. Variables:{' '}
        {'{{title}}, {{date}}, {{time}}, {{datetime}}, {{cursor}}'}.
      </p>
      {(create.error || templates.error) && (
        <p role="alert" className="error-message">
          {(create.error ?? templates.error)?.message}
        </p>
      )}
    </details>
  );
}
