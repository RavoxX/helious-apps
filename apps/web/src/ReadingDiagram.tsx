import { useEffect, useState } from 'react';
import { useTheme } from './theme';
import { renderReadingDiagram } from './reading-diagram';
export function ReadingDiagram({ source }: { source: string }) {
  const { theme } = useTheme();
  const [requested, setRequested] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!requested) return;
    let cancelled = false,
      objectUrl = '';
    setUrl('');
    setError('');
    const timer = window.setTimeout(() => {
      void renderReadingDiagram(source, theme === 'dark' ? 'dark' : 'light')
        .then((svg) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          setUrl(objectUrl);
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setError(
              cause instanceof Error &&
                /^(?:Diagrams are|Use a |Diagram configuration)/.test(cause.message)
                ? cause.message
                : 'Unable to render this diagram. Check its syntax and size.',
            );
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, theme, requested]);
  return (
    <figure className="reading-diagram">
      <figcaption>Mermaid diagram</figcaption>
      {!requested ? (
        <button type="button" onClick={() => setRequested(true)}>
          Render diagram
        </button>
      ) : url ? (
        <img src={url} alt="Rendered Mermaid diagram; its text source is available below." />
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <p role="status">Rendering diagram…</p>
      )}
      <details>
        <summary>Diagram source</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
