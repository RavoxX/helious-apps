import { useEffect, useRef, useState } from 'react';
import { FileText, Search, X } from 'lucide-react';

export function CommandPalette({
  notes,
  openNote,
  selected,
  shortcut,
  create,
}: {
  notes: { id: string; path: string }[];
  openNote: (id: string) => void;
  selected: string | null;
  shortcut: string;
  create: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState(false);
  const show = (files = false) => {
    setQuick(files);
    setQuery('');
    dialog.current?.showModal();
  };
  useEffect(() => {
    const command = (event: Event) => show((event as CustomEvent<{ quick: boolean }>).detail.quick);
    window.addEventListener('helious:command', command);
    return () => window.removeEventListener('helious:command', command);
  }, []);
  const commands = [
    {
      label: 'New note',
      action: create,
    },
    {
      label: 'Save note',
      action: () =>
        document.querySelector<HTMLButtonElement>(`#pane-${selected} button[type=submit]`)?.click(),
    },
    ...['Source', 'Live preview', 'Reading'].map((mode) => ({
      label: `View: ${mode}`,
      action: () =>
        document
          .querySelector<HTMLButtonElement>(`#pane-${selected} button[data-mode="${mode}"]`)
          ?.click(),
    })),
    { label: 'Toggle split pane', action: () => window.dispatchEvent(new Event('helious:split')) },
  ];
  const choose = (action: () => void) => {
    dialog.current?.close();
    action();
  };
  return (
    <>
      <button className="workspace-command" onClick={() => show()}>
        <Search size={14} />
        Commands <kbd>{shortcut.replace('Mod', 'Ctrl/⌘')}</kbd>
      </button>
      <dialog
        className="command-palette"
        ref={dialog}
        aria-label={quick ? 'Quick switcher' : 'Command palette'}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="palette-search">
          <Search size={17} />
          <input
            aria-label="Find a note or command"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={quick ? 'Jump to a note…' : 'Find a note or command…'}
            autoFocus
          />
          <button aria-label="Close command palette" onClick={() => dialog.current?.close()}>
            <X size={17} />
          </button>
        </div>
        <div className="palette-results">
          {!quick &&
            commands
              .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
              .map((item) => (
                <button key={item.label} onClick={() => choose(item.action)}>
                  {item.label}
                  <span>Command</span>
                </button>
              ))}
          {notes
            .filter((note) => note.path.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 30)
            .map((note) => (
              <button key={note.id} onClick={() => choose(() => openNote(note.id))}>
                <FileText size={13} />
                {note.path}
                <span>Note</span>
              </button>
            ))}
          {quick &&
            !notes.some((note) => note.path.toLowerCase().includes(query.toLowerCase())) && (
              <p>No matching notes. Try another part of the path.</p>
            )}
        </div>
        <footer>Tab to navigate · Enter to select · Esc to close</footer>
      </dialog>
    </>
  );
}
