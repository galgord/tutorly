import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import {
  Calendar,
  LayoutDashboard,
  Menu,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { LocaleSwitcher } from './LocaleSwitcher';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-surface-muted text-ink">
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col md:ms-60">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const { t } = useTranslation();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      void navigate({ to: '/login' });
    },
  });

  const initials = me.data ? initialsFor(me.data.name ?? me.data.email) : '–';
  const displayName = me.data?.name ?? me.data?.email ?? '';

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-scrim md:hidden"
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 z-40 w-60 flex-col border-e border-line bg-surface',
          'inset-inline-start-0',
          mobileOpen ? 'flex' : 'hidden md:flex',
        ].join(' ')}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <Link to="/" className="flex items-center gap-2" onClick={onCloseMobile}>
            <BrandMark />
            <span className="text-base font-semibold text-ink">{t('app.title')}</span>
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3 pb-4" aria-label={t('nav.primary')}>
          <NavItem to="/dashboard" Icon={LayoutDashboard} label={t('nav.dashboard')} onNavigate={onCloseMobile} />
          <NavItem to="/students" Icon={Users} label={t('nav.students')} onNavigate={onCloseMobile} />
          <NavItem to="/schedule" Icon={Calendar} label={t('nav.schedule')} onNavigate={onCloseMobile} />
          <NavItem to="/settings" Icon={Settings} label={t('nav.settings')} onNavigate={onCloseMobile} />
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <Avatar initials={initials} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink" title={displayName}>
                {displayName}
              </p>
              <button
                type="button"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
                className="text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                data-testid="logout-button"
              >
                {logout.isPending ? t('common.workingOn') : t('dashboard.logout')}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

interface NavItemProps {
  to: string;
  Icon: LucideIcon;
  label: string;
  onNavigate?: () => void;
}

function NavItem({ to, Icon, label, onNavigate }: NavItemProps) {
  const location = useLocation();
  const active = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={[
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
        active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
      ].join(' ')}
    >
      <Icon size={18} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

interface TopBarProps {
  onOpenMobileNav: () => void;
}

function TopBar({ onOpenMobileNav }: TopBarProps) {
  const { t } = useTranslation();
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-4 md:px-8">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken md:hidden"
        aria-label={t('nav.openMenu')}
      >
        <Menu size={20} aria-hidden />
      </button>
      <div className="hidden md:block" />
      <div className="flex items-center gap-3">
        <LocaleSwitcher />
      </div>
    </header>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
      {initials}
    </span>
  );
}

function initialsFor(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '–';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '–').toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function BrandMark() {
  return (
    <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-500 text-sm font-bold text-white">
      T
    </span>
  );
}
