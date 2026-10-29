import { ObjectId, type ClientSession, type Db } from 'mongodb';
import type { FastifyRequest } from 'fastify';
import {
  canAccessSpace,
  createLinkResolver,
  type KnowledgePrincipal,
  type KnowledgeGraph,
} from '@helious/core';
import { vaultCollections } from './vault-db.js';
import { policy, readableSpaces } from './spaces.js';
import { vaultWriteError } from './vault-writes.js';
import { indexedVaultNotes, vaultKnowledgeGraph } from './insights.js';

export type PrincipalResolver = (request: FastifyRequest) => KnowledgePrincipal;
export type AccessVerifier = (request: FastifyRequest, session?: ClientSession) => Promise<void>;
export const sessionPrincipal: PrincipalResolver = (request) => ({
  kind: 'user',
  ownerId: request.auth!.user._id.toHexString(),
  actorId: request.auth!.user._id.toHexString(),
});
export function createVaultAccess(
  db: Db,
  principal: PrincipalResolver = sessionPrincipal,
  verify?: AccessVerifier,
) {
  const store = vaultCollections(db);
  const owner = (request: FastifyRequest) => new ObjectId(principal(request).ownerId);
  const base = (request: FastifyRequest, vaultId: string) => ({
    ownerId: owner(request),
    vaultId: new ObjectId(vaultId),
  });
  const requireOwner = (request: FastifyRequest) => {
    const actor = principal(request);
    if (actor.kind !== 'user' || actor.actorId !== actor.ownerId)
      throw vaultWriteError('Only the vault owner can manage this setting.', 403);
  };
  async function requireVault(request: FastifyRequest, id: string, includeDeleting = false) {
    const actor = principal(request);
    const vault = await store.vaults.findOne({
      _id: new ObjectId(id),
      ownerId: owner(request),
      ...(!includeDeleting ? { state: 'active' as const } : {}),
    });
    if (
      !vault ||
      (actor.kind === 'user' && actor.actorId !== actor.ownerId) ||
      (actor.kind === 'agent' &&
        (!actor.vaultIds.includes(id) || !(await readableSpaces(db, actor, vault._id)).length))
    )
      throw vaultWriteError('Vault not found', 404);
    return vault;
  }
  async function allowed(
    request: FastifyRequest,
    vaultId: string,
    operation: 'read' | 'write' = 'read',
    session?: ClientSession,
    selected = true,
  ) {
    await verify?.(request, session);
    const spaces = await readableSpaces(
      db,
      principal(request),
      new ObjectId(vaultId),
      operation,
      session,
    );
    const spaceId = selected
      ? (request.query as { spaceId?: string } | undefined)?.spaceId
      : undefined;
    if (spaceId && !spaces.some((space) => space._id.toHexString() === spaceId))
      throw vaultWriteError('Space not found', 404);
    return spaceId ? spaces.filter((space) => space._id.toHexString() === spaceId) : spaces;
  }
  async function scope(
    request: FastifyRequest,
    vaultId: string,
    operation: 'read' | 'write' = 'read',
    session?: ClientSession,
    selected = true,
  ) {
    return {
      ...base(request, vaultId),
      spaceId: {
        $in: (await allowed(request, vaultId, operation, session, selected)).map(
          (space) => space._id,
        ),
      },
    };
  }
  async function requireSpace(
    request: FastifyRequest,
    vaultId: string,
    id?: string,
    operation: 'read' | 'write' = 'write',
    session?: ClientSession,
  ) {
    await verify?.(request, session);
    const space = await store.spaces.findOne(
      { ...base(request, vaultId), ...(id ? { _id: new ObjectId(id) } : { key: 'personal' }) },
      { session },
    );
    if (!space || !canAccessSpace(principal(request), policy(space), operation))
      throw vaultWriteError('Space not found or access is not permitted.', 404);
    return space;
  }
  async function graph(
    request: FastifyRequest,
    vaultId: string,
    existing?: Awaited<ReturnType<typeof vaultKnowledgeGraph>>,
  ): Promise<KnowledgeGraph> {
    const all = existing ?? (await vaultKnowledgeGraph(db, owner(request), new ObjectId(vaultId)));
    const spaces = new Set(
      (await allowed(request, vaultId)).map((space) => space._id.toHexString()),
    );
    const ids = new Set(
      all.nodes
        .filter((node) => node.kind !== 'missing' && spaces.has(node.spaceId ?? ''))
        .map((node) => node.id),
    );
    const ghostIds = new Set(
      all.nodes.filter((node) => node.kind === 'missing').map((node) => node.id),
    );
    const blocked = new Set<string>();
    const hiddenReferences = new Set<string>();
    if (principal(request).kind === 'agent' || (request.query as { spaceId?: string })?.spaceId) {
      const references = await indexedVaultNotes(db, owner(request), new ObjectId(vaultId), true);
      const indexed = references.map((note) => ({
        id: note._id.toHexString(),
        path: note.path,
        parsed: note.parsed,
      }));
      const fullResolve = createLinkResolver(indexed);
      const deletedIds = new Set(
        references.filter((note) => note.deleted).map((note) => note._id.toHexString()),
      );
      const activeResolve = createLinkResolver(indexed.filter((note) => !deletedIds.has(note.id)));
      const privateIds = new Set(
        references
          .filter((note) => !spaces.has(note.spaceId?.toHexString() ?? ''))
          .map((note) => note._id.toHexString()),
      );
      for (const note of indexed.filter((note) => ids.has(note.id)))
        for (const link of note.parsed.links) {
          const hidden = fullResolve(note.path, link).noteId;
          if (hidden && privateIds.has(hidden)) {
            const resolution = activeResolve(note.path, link);
            blocked.add(`${note.id}:missing:${resolution.path ?? `${note.path}:${link.target}`}`);
            hiddenReferences.add(`${note.id}:${link.line}:${link.target}`);
          }
        }
    }
    const edges = all.edges.filter(
      (edge) =>
        ids.has(edge.source) &&
        (ids.has(edge.target) || ghostIds.has(edge.target)) &&
        !blocked.has(`${edge.source}:${edge.target}`),
    );
    for (const edge of edges) ids.add(edge.target);
    const nodes = all.nodes
      .filter((node) => ids.has(node.id))
      .map((node) => ({ ...node, incoming: 0, outgoing: 0 }));
    const lookup = new Map(nodes.map((node) => [node.id, node]));
    const ghostDates = new Map<string, string>();
    for (const edge of edges) {
      lookup.get(edge.source)!.outgoing++;
      lookup.get(edge.target)!.incoming++;
      if (ghostIds.has(edge.target)) {
        const date = lookup.get(edge.source)!.createdAt;
        if (!ghostDates.has(edge.target) || date < ghostDates.get(edge.target)!)
          ghostDates.set(edge.target, date);
      }
    }
    // Missing nodes derive their timestamp solely from visible source notes.
    for (const node of nodes.filter((node) => node.kind === 'missing')) {
      node.createdAt = ghostDates.get(node.id)!;
      node.title = node.path;
      delete node.spaceId;
    }
    return {
      nodes,
      edges,
      unresolved: all.unresolved.filter(
        (link) =>
          ids.has(link.source) &&
          !hiddenReferences.has(`${link.source}:${link.line}:${link.target}`),
      ),
    };
  }
  return {
    principal,
    owner,
    base,
    requireOwner,
    requireVault,
    allowed,
    scope,
    requireSpace,
    graph,
  };
}
export type VaultAccess = ReturnType<typeof createVaultAccess>;
