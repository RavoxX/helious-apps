import { useId } from 'react';
import { compileReadingCss } from './appearance';
export function ReadingAppearance({
  snippet,
  children,
}: {
  snippet: string;
  children: React.ReactNode;
}) {
  const scope = `note-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  let css = '';
  try {
    css = compileReadingCss(snippet, scope);
  } catch {
    /* Invalid stored preferences cannot affect the workspace. */
  }
  return (
    <div data-reading-style={scope} className="reading-appearance">
      {css && <style>{css}</style>}
      {children}
    </div>
  );
}
