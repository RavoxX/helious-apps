import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { detectReadingMedia, readingFragment, resolveReadingFile } from '@helious/core';
import { api } from './api';
import { fetchReadingFile, type ReadingAttachment, type ReadingContext } from './reading-files';
const MarkdownReading = lazy(() =>
  import('./MarkdownReading').then((module) => ({ default: module.MarkdownReading })),
);
const ReadingPdf = lazy(() =>
  import('./ReadingPdf').then((module) => ({ default: module.ReadingPdf })),
);

export function ReadingEmbed({
  raw,
  syntax,
  alt,
  context,
  openLink,
  allowEmbeds,
}: {
  raw: string;
  syntax: 'wiki' | 'markdown';
  alt: string;
  context?: ReadingContext;
  openLink: (raw: string) => void;
  allowEmbeds: boolean;
}) {
  if (!raw.trim() || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw.trim()))
    return (
      <span className="reading-unavailable">External or unsupported media is not loaded.</span>
    );
  if (!context || !allowEmbeds)
    return (
      <span className="reading-unavailable">
        Embedded reference: {alt || raw}. Open its note or attachment from the explorer.
      </span>
    );
  return <ScopedEmbed raw={raw} syntax={syntax} alt={alt} context={context} openLink={openLink} />;
}
function ScopedEmbed({
  raw,
  syntax,
  alt,
  context,
  openLink,
}: {
  raw: string;
  syntax: 'wiki' | 'markdown';
  alt: string;
  context: ReadingContext;
  openLink: (raw: string) => void;
}) {
  const attachments = useQuery({
    queryKey: ['attachments', context.vaultId, context.spaceId],
    queryFn: () =>
      api<{ attachments: ReadingAttachment[] }>(
        `/vaults/${context.vaultId}/attachments?spaceId=${encodeURIComponent(context.spaceId)}`,
      ),
  });
  const notes = useMemo(
    () => resolveReadingFile(context.path, raw, syntax, context.spaceId, context.notes),
    [context.path, context.spaceId, context.notes, raw, syntax],
  );
  const match = useMemo(
    () =>
      resolveReadingFile(
        context.path,
        raw,
        syntax,
        context.spaceId,
        attachments.data?.attachments ?? [],
      ),
    [context.path, context.spaceId, raw, syntax, attachments.data],
  );
  if (notes)
    return (
      <EmbeddedNote
        context={context}
        id={notes.file.id}
        path={notes.file.path}
        fragment={notes.fragment}
        openLink={openLink}
      />
    );
  if (attachments.isPending) return <span role="status">Finding attachment…</span>;
  if (!match || attachments.error)
    return (
      <span className="reading-unavailable">
        Unavailable in this Space: {alt || raw}. Use a full vault path for ambiguous names.
      </span>
    );
  const file = attachments.data!.attachments.find((file) => file.id === match.file.id)!;
  return (
    <EmbeddedAttachment
      key={`${context.vaultId}:${file.id}`}
      vaultId={context.vaultId}
      file={file}
      alt={alt}
    />
  );
}
function EmbeddedNote({
  context,
  id,
  path,
  fragment,
  openLink,
}: {
  context: ReadingContext;
  id: string;
  path: string;
  fragment: string | null;
  openLink: (raw: string) => void;
}) {
  const note = useQuery({
    queryKey: ['note', context.vaultId, id, 'embed', context.spaceId],
    queryFn: () =>
      api<{ note: { markdown: string; spaceId: string } }>(
        `/vaults/${context.vaultId}/notes/${id}?spaceId=${encodeURIComponent(context.spaceId)}`,
      ),
  });
  const content = useMemo(() => {
    try {
      return {
        value:
          note.data?.note.spaceId === context.spaceId
            ? readingFragment(note.data.note.markdown, fragment)
            : null,
        error: '',
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'Open this note directly.',
      };
    }
  }, [note.data, fragment, context.spaceId]);
  return (
    <section className="reading-note-embed" aria-label={`Embedded note ${path}`}>
      <div className="reading-embed-title">
        <span>
          {path}
          {fragment ? `#${fragment}` : ''}
        </span>
        <button type="button" onClick={() => openLink(`/${path}${fragment ? `#${fragment}` : ''}`)}>
          Open note
        </button>
      </div>
      {note.isPending ? (
        <p role="status">Loading note…</p>
      ) : note.error || content.value === null ? (
        <p>{content.error || 'This note or fragment is unavailable in this Space.'}</p>
      ) : (
        <Suspense fallback={<p>Preparing embedded note…</p>}>
          <MarkdownReading
            value={content.value}
            context={{ ...context, path }}
            openLink={openLink}
            allowEmbeds={false}
          />
        </Suspense>
      )}
    </section>
  );
}
function EmbeddedAttachment({
  vaultId,
  file,
  alt,
}: {
  vaultId: string;
  file: ReadingAttachment;
  alt: string;
}) {
  const host = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false),
    [requested, setRequested] = useState(false),
    [error, setError] = useState(''),
    [url, setUrl] = useState('');
  const smallImage = /\.(?:png|jpe?g|gif|webp)$/i.test(file.path) && file.size <= 5 * 1024 * 1024;
  useEffect(() => {
    if (!smallImage || !host.current) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [smallImage]);
  const data = useQuery({
    queryKey: ['reading-file', vaultId, file.spaceId, file.id],
    enabled: requested || (smallImage && visible),
    queryFn: ({ signal }) => fetchReadingFile(vaultId, file, signal),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const media = useMemo(() => {
    try {
      return { value: data.data ? detectReadingMedia(data.data) : null, error: '' };
    } catch (cause) {
      return {
        value: null,
        error: cause instanceof Error ? cause.message : 'Unsupported attachment.',
      };
    }
  }, [data.data]);
  useEffect(() => {
    if (!data.data || !media.value || media.value.kind === 'pdf') return;
    const objectUrl = URL.createObjectURL(
      new Blob([new Uint8Array(data.data)], { type: media.value.mime }),
    );
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl('');
    };
  }, [data.data, media]);
  const download = `/api/vaults/${vaultId}/attachments/${file.id}?spaceId=${encodeURIComponent(file.spaceId)}`;
  return (
    <figure className="reading-attachment" ref={host} aria-label={`Attachment ${file.path}`}>
      <figcaption>
        {alt || file.path} <a href={download}>Download original</a>
      </figcaption>
      {error || media.error || data.error ? (
        <p role="alert">{error || media.error || data.error?.message}</p>
      ) : data.isFetching ? (
        <p role="status">Loading attachment…</p>
      ) : !data.data ? (
        <button type="button" onClick={() => setRequested(true)}>
          Preview {file.path.split('/').at(-1)}
        </button>
      ) : !media.value ? (
        <p>This file type has no inline preview. Download the original to open it.</p>
      ) : media.value.kind === 'image' ? (
        url && (
          <img
            src={url}
            alt={alt || file.path}
            decoding="async"
            onError={() =>
              setError('This image could not be decoded. Download the original to inspect it.')
            }
          />
        )
      ) : media.value.kind === 'audio' ? (
        url && (
          <audio
            src={url}
            controls
            preload="metadata"
            aria-label={alt || file.path}
            onError={() =>
              setError('Your browser could not play this audio. Download the original instead.')
            }
          />
        )
      ) : (
        <Suspense fallback={<p role="status">Loading PDF viewer…</p>}>
          <ReadingPdf bytes={data.data} label={alt || file.path} />
        </Suspense>
      )}
    </figure>
  );
}
