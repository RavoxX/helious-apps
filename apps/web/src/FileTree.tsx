import { FileText, Folder, Pencil, Star } from 'lucide-react';
import { useState, type DragEvent, type ReactNode } from 'react';

const mime = 'application/x-helious-note';
type File = { id: string; path: string; revision: number };
export function FileTree({
  notes,
  selected,
  open,
  move,
  bookmarks,
  bookmark,
}: {
  notes: File[];
  selected: string | null;
  open: (id: string) => void;
  move: (id: string, path: string, revision: number) => Promise<void>;
  bookmarks: string[];
  bookmark: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  async function relocate(note: File, destination: string) {
    if (note.path === destination || busy) return;
    setBusy(true);
    try {
      await move(note.id, destination, note.revision);
      setEditing(null);
    } catch {
      /* The library presents the server error without losing this form. */
    } finally {
      setBusy(false);
    }
  }
  function drop(event: DragEvent, prefix: string) {
    if (!event.dataTransfer.types.includes(mime)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    const note = notes.find((item) => item.id === event.dataTransfer.getData(mime));
    if (note) void relocate(note, prefix + note.path.split('/').at(-1));
  }
  function dragOver(event: DragEvent, prefix: string) {
    if (!busy && event.dataTransfer.types.includes(mime)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setOver(prefix);
    }
  }
  function folder(prefix: string): ReactNode {
    const children = new Set<string>();
    const files: File[] = [];
    for (const note of notes) {
      if (!note.path.startsWith(prefix)) continue;
      const remainder = note.path.slice(prefix.length);
      const slash = remainder.indexOf('/');
      if (slash < 0) files.push(note);
      else children.add(remainder.slice(0, slash));
    }
    return (
      <>
        {[...children].sort().map((name) => (
          <details className="file-folder" key={prefix + name} open>
            <summary
              className={over === `${prefix}${name}/` ? 'drop-target' : ''}
              onDragOver={(event) => dragOver(event, `${prefix}${name}/`)}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => drop(event, `${prefix}${name}/`)}
            >
              <Folder size={13} />
              {name}
            </summary>
            <div>{folder(`${prefix}${name}/`)}</div>
          </details>
        ))}
        {files.map((note) => (
          <div className="file-entry" key={note.id}>
            <div className="file-row">
              <button
                type="button"
                className={`note-file ${selected === note.id ? 'current-note' : ''}`}
                aria-label={note.path}
                draggable={!busy}
                onDragStart={(event) => {
                  event.dataTransfer.setData(mime, note.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setOver(null)}
                onClick={() => open(note.id)}
              >
                <FileText size={14} />
                <span>{note.path.slice(prefix.length)}</span>
              </button>
              <button
                className="file-action"
                type="button"
                aria-label={`${bookmarks.includes(note.id) ? 'Remove bookmark' : 'Bookmark'} ${note.path}`}
                aria-pressed={bookmarks.includes(note.id)}
                onClick={() => bookmark(note.id)}
              >
                <Star size={13} />
              </button>
              <button
                className="file-action"
                type="button"
                aria-label={`Rename or move ${note.path}`}
                disabled={busy}
                onClick={() => {
                  setEditing(editing === note.id ? null : note.id);
                  setPath(note.path);
                }}
              >
                <Pencil size={12} />
              </button>
            </div>
            {editing === note.id && (
              <form
                className="file-move-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void relocate(note, path);
                }}
              >
                <label>
                  New path
                  <input
                    aria-label={`New path for ${note.path}`}
                    value={path}
                    maxLength={1024}
                    required
                    onChange={(event) => setPath(event.target.value)}
                    autoFocus
                  />
                </label>
                <div>
                  <button className="secondary-button" disabled={busy || path === note.path}>
                    Move
                  </button>
                  <button className="subtle-button" type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ))}
      </>
    );
  }
  return (
    <div className="note-list" aria-label="Notes">
      <div
        className={`file-root ${over === '' ? 'drop-target' : ''}`}
        onDragOver={(event) => dragOver(event, '')}
        onDragLeave={() => setOver(null)}
        onDrop={(event) => drop(event, '')}
      >
        <Folder size={12} /> Vault root <span>Drop a note here</span>
      </div>
      {folder('')}
    </div>
  );
}
