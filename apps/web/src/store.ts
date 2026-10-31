import { create } from 'zustand';
export type Section = 'overview' | 'vaults' | 'sessions' | 'settings' | 'security' | 'agents';

/** URL path under /app/ for each workspace section. */
export const sectionPaths: Record<Section, string> = {
  overview: 'home',
  vaults: 'vaults',
  agents: 'ai-connections',
  settings: 'settings',
  security: 'settings/security',
  sessions: 'settings/sessions',
};
export const sectionForPath = (path: string) =>
  (Object.keys(sectionPaths) as Section[]).find((key) => sectionPaths[key] === path);

// The browser router binds this so section changes become real URLs; the embedded desktop
// workspace has no router and keeps sections in memory.
let navigateTo: ((section: Section, vault?: string, replace?: boolean) => void) | undefined;
export const bindSectionNavigation = (navigate: typeof navigateTo) => {
  navigateTo = navigate;
};

/** Keeps /app/vaults/<id> in step when the library switches vault itself. */
export const replaceVaultUrl = (vault: string) => navigateTo?.('vaults', vault, true);

export const useUi = create<{
  section: Section;
  setSection: (section: Section) => void;
  /** Last server vault opened, so returning to Vaults keeps the reader's place. */
  vault?: string;
  setVault: (vault: string | undefined) => void;
  openVault: (vault: string) => void;
  /** Set by "Add a vault"; the library opens its create form once and clears it. */
  createVaultPending: boolean;
  requestCreateVault: () => void;
}>((set, get) => ({
  section: 'vaults',
  setSection: (section) => (navigateTo ? navigateTo(section) : set({ section })),
  setVault: (vault) => set({ vault }),
  openVault: (vault) => {
    set({ vault });
    if (navigateTo) navigateTo('vaults', vault);
    else set({ section: 'vaults' });
  },
  createVaultPending: false,
  requestCreateVault: () => {
    set({ createVaultPending: true });
    get().setSection('vaults');
  },
}));
