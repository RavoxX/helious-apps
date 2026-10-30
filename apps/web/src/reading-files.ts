import type { ReadingFile } from '@helious/core';
export interface ReadingContext {
  vaultId: string;
  path: string;
  spaceId: string;
  notes: ReadingFile[];
}
export interface ReadingAttachment extends ReadingFile {
  size: number;
  mimeType: string;
}
export async function fetchReadingFile(
  vaultId: string,
  file: ReadingAttachment,
  signal: AbortSignal,
) {
  const limit = 20 * 1024 * 1024;
  if (file.size > limit) throw new Error('This attachment exceeds the 20 MiB preview limit.');
  const response = await fetch(
    `/api/vaults/${vaultId}/attachments/${file.id}?spaceId=${encodeURIComponent(file.spaceId)}`,
    { credentials: 'same-origin', signal },
  );
  if (!response.ok || !response.body)
    throw new Error('Attachment unavailable. Reload the note or sign in again.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('This attachment exceeds the 20 MiB preview limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
