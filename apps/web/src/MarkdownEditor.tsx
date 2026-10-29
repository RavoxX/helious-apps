import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

export interface MarkdownEditorHandle {
  wrap(before: string, after?: string): void;
  line(number: number): void;
}
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  { value: string; onChange: (value: string) => void; paths: string[] }
>(function MarkdownEditor({ value, onChange, paths }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, paths });
  callbacks.current = { onChange, paths };
  useImperativeHandle(
    ref,
    () => ({
      wrap(before, after = '') {
        const editor = view.current;
        if (!editor) return;
        const selection = editor.state.selection.main;
        const selected = editor.state.sliceDoc(selection.from, selection.to);
        editor.dispatch({
          changes: { from: selection.from, to: selection.to, insert: before + selected + after },
          selection: { anchor: selection.from + before.length, head: selection.to + before.length },
          scrollIntoView: true,
        });
        editor.focus();
      },
      line(number) {
        const editor = view.current;
        if (!editor) return;
        const line = editor.state.doc.line(Math.max(1, Math.min(number, editor.state.doc.lines)));
        editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
        editor.focus();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    const complete = (context: CompletionContext) => {
      const match = context.matchBefore(/\[\[[^\]\n]*/);
      if (!match) return null;
      return {
        from: match.from + 2,
        options: callbacks.current.paths.map((path) => ({
          label: path,
          type: 'text',
          apply: (editor: EditorView, _completion: unknown, from: number, to: number) => {
            const close = editor.state.sliceDoc(to, to + 2) === ']]' ? '' : ']]';
            editor.dispatch({
              changes: { from, to, insert: path + close },
              selection: { anchor: from + path.length + 2 },
            });
          },
        })),
        validFor: /^[^\]\n]*$/,
      };
    };
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          highlightSelectionMatches(),
          autocompletion({ override: [complete] }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'Markdown',
            'aria-multiline': 'true',
            spellcheck: 'false',
          }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="codemirror-host" ref={host} />;
});
