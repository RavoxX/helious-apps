import { create } from 'zustand';
export const useUi = create<{
  section: 'overview' | 'vaults' | 'sessions' | 'settings' | 'security' | 'agents';
  setSection: (
    section: 'overview' | 'vaults' | 'sessions' | 'settings' | 'security' | 'agents',
  ) => void;
}>((set) => ({ section: 'vaults', setSection: (section) => set({ section }) }));
