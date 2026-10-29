import { expect, it } from 'vitest';
import {
  buildGraph,
  createLinkResolver,
  parseMarkdown,
  planNoteMove,
  type MoveNote,
} from '../src/index.js';
const note = (id: string, path: string, markdown: string): MoveNote => ({
  id,
  path,
  markdown,
  parsed: parseMarkdown(markdown),
});

it('preserves aliases, fragments, embeds and code while updating inbound wiki links', () => {
  const notes = [
    note('a', 'A.md', '[[B#Heading|The design]] ![[B#^block]] `[[B]]`\n\n```md\n[[B]]\n```'),
    note('b', 'B.md', '# Heading\nBlock ^block\n[[#Heading]]'),
  ];
  const plan = planNoteMove(notes, 'b', 'Projects/New name.md');
  expect(plan.find((item) => item.id === 'a')!.markdown).toBe(
    '[[/Projects/New name.md#Heading|The design]] ![[/Projects/New name.md#^block]] `[[B]]`\n\n```md\n[[B]]\n```',
  );
  expect(plan.find((item) => item.id === 'b')!.markdown).toContain('[[#Heading]]');
});
it('updates only Markdown destinations, including reference definitions and angle URLs', () => {
  const notes = [
    note(
      'a',
      'Folder/A.md',
      '[label](../B.md#Heading "A title") ![image](<../B.md#^block>) [reference][b]\n\n[b]: ../B.md "Keep title"',
    ),
    note('b', 'B.md', '# Heading'),
  ];
  const changed = planNoteMove(notes, 'b', 'New folder/B.md').find((item) => item.id === 'a')!;
  expect(changed.markdown).toBe(
    '[label](../New%20folder/B.md#Heading "A title") ![image](<../New%20folder/B.md#^block>) [reference][b]\n\n[b]: ../New%20folder/B.md "Keep title"',
  );
});
it('keeps outgoing relative links and attachment paths meaningful when their source moves', () => {
  const notes = [
    note('a', 'Folder/A.md', '[B](B.md) ![image](../Attachments/a.png) [[B]]'),
    note('b', 'Folder/B.md', ''),
  ];
  const changed = planNoteMove(notes, 'a', 'Elsewhere/A.md').find((item) => item.id === 'a')!;
  expect(changed.markdown).toBe('[B](../Folder/B.md) ![image](../Attachments/a.png) [[B]]');
});
it('disambiguates outgoing links after a source move and prevents newly introduced name shadowing', () => {
  const notes = [
    note('a', 'One/A.md', '[[B]]'),
    note('b', 'One/B.md', ''),
    note('c', 'Two/B.md', ''),
  ];
  expect(planNoteMove(notes, 'a', 'Two/A.md').find((item) => item.id === 'a')!.markdown).toBe(
    '[[/One/B.md]]',
  );
});
it('rewrites repeated references once and preserves nested labels and escaped path characters', () => {
  const notes = [
    note('a', 'A.md', '[outer [inner]](B.md) [one][ref] [two][ref]\n\n[ref]: B.md'),
    note('b', 'B.md', ''),
  ];
  const changed = planNoteMove(notes, 'b', 'Names/Hash#tag.md').find((item) => item.id === 'a')!;
  expect(changed.rewrites).toBe(2);
  expect(changed.markdown).toContain('[outer [inner]](Names/Hash%23tag.md)');
  expect(changed.markdown).toContain('[ref]: Names/Hash%23tag.md');
});
it('keeps graph relationships after applying the complete move plan', () => {
  const notes = [note('a', 'A.md', '[[B]] [[B#Heading]]'), note('b', 'B.md', '# Heading')];
  const plan = planNoteMove(notes, 'b', 'Projects/Renamed.md');
  const after = notes.map((item) => {
    const change = plan.find((change) => change.id === item.id);
    return change ? note(item.id, change.path, change.markdown) : item;
  });
  expect(buildGraph(after).edges).toEqual(buildGraph(notes).edges);
  expect(createLinkResolver(after)('A.md', after[0]!.parsed.links[0]!).noteId).toBe('b');
});
it('rejects path collisions and missing source notes before producing any edits', () => {
  const notes = [note('a', 'A.md', ''), note('b', 'B.md', '[[A]]')];
  expect(() => planNoteMove(notes, 'a', 'b.MD')).toThrow(/already exists/);
  expect(() => planNoteMove(notes, 'missing', 'New.md')).toThrow(/not found/);
});
