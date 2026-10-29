/** Cross-boundary public contracts. Database-only fields never belong in these types. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

export interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
}

export const PRODUCT_NAME = 'Helious';
export * from './paths.js';
export * from './markdown.js';
export * from './graph.js';
export * from './search.js';
export * from './moves.js';
export * from './insights.js';
export * from './permissions.js';
export * from './sync.js';
