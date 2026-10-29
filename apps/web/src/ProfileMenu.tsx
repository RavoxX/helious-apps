import { useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  ShieldCheck,
  PlugZap,
} from 'lucide-react';
import type { User } from './api';
import { useTheme } from './theme';

export function ProfileMenu({
  user,
  navigate,
  signOut,
  pending,
}: {
  user: User;
  navigate: (section: 'settings' | 'sessions' | 'security' | 'agents') => void;
  signOut: () => void;
  pending: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  function go(section: 'settings' | 'sessions' | 'security' | 'agents') {
    panel.current?.hidePopover();
    navigate(section);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.dashboard-content h1')?.focus(),
    );
  }
  return (
    <div className="profile-control">
      <button
        ref={trigger}
        className="profile-trigger"
        popoverTarget="account-menu"
        aria-label={`Profile for ${user.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="account-menu"
      >
        <span className="avatar" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span>Profile</span>
        <ChevronDown size={14} />
      </button>
      <div
        ref={panel}
        id="account-menu"
        popover="auto"
        role="dialog"
        aria-label="Account menu"
        className="profile-menu"
        onToggle={(event) => setOpen(event.newState === 'open')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            panel.current?.hidePopover();
            trigger.current?.focus();
          }
        }}
      >
        <div className="profile-identity">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <nav aria-label="Account shortcuts">
          <button onClick={() => go('settings')}>
            <Settings size={17} />
            Account settings
          </button>
          <button onClick={() => go('sessions')}>
            <Monitor size={17} />
            Active sessions
          </button>
          <button onClick={() => go('security')}>
            <ShieldCheck size={17} />
            Security & access
          </button>
          <button onClick={() => go('agents')}>
            <PlugZap size={17} />
            AI connections
          </button>
          <button onClick={toggle}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            {theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
          </button>
          <a href="/docs/editor">
            <BookOpen size={17} />
            Workspace guide
          </a>
        </nav>
        <button className="profile-signout" disabled={pending} onClick={signOut}>
          <LogOut size={17} />
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
