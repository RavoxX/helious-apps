import type { ReactNode } from 'react';
export function AttachmentLink({
  vaultId,
  id,
  children,
  label,
}: {
  vaultId: string;
  id: string;
  path: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <a aria-label={label} href={`/api/vaults/${vaultId}/attachments/${id}`}>
      {children}
    </a>
  );
}
