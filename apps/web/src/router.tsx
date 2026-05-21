import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useLocation,
} from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from './components/AppShell';
import { LocaleSwitcher } from './components/LocaleSwitcher';
import { useDirection } from './hooks/useDirection';
import { api } from './lib/api';
import { DashboardPage } from './pages/Dashboard';
import { LessonDetailPage } from './pages/LessonDetail';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { PlayGamePage } from './pages/PlayGame';
import { PublicStudentPage } from './pages/PublicStudent';
import { SchedulePage } from './pages/Schedule';
import { SettingsPage } from './pages/Settings';
import { SettingsIntegrationsPage } from './pages/SettingsIntegrations';
import { StudentDetailPage } from './pages/StudentDetail';
import { StudentsListPage } from './pages/StudentsList';
import { StudentsTrashPage } from './pages/StudentsTrash';

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    // Send authed users to /dashboard, anonymous to /login.
    try {
      await api.me();
      throw redirect({ to: '/dashboard' });
    } catch {
      throw redirect({ to: '/login' });
    }
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  beforeLoad: async () => {
    try {
      await api.me();
    } catch {
      throw redirect({ to: '/login' });
    }
  },
  component: DashboardPage,
});

async function requireAuth(): Promise<void> {
  try {
    await api.me();
  } catch {
    throw redirect({ to: '/login' });
  }
}

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: requireAuth,
  component: SettingsPage,
});

const settingsIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/integrations',
  beforeLoad: requireAuth,
  component: SettingsIntegrationsPage,
});

const scheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/schedule',
  beforeLoad: requireAuth,
  component: SchedulePage,
});

// Back-compat: the previous URL was /calendar. Bookmarks redirect to /schedule.
const calendarRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  beforeLoad: () => {
    throw redirect({ to: '/schedule' });
  },
  component: () => null,
});

const lessonDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lessons/$id',
  beforeLoad: requireAuth,
  component: LessonDetailPage,
});

// --- Students -------------------------------------------------------------

const studentsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/students',
  beforeLoad: requireAuth,
  component: StudentsListPage,
});

const studentsTrashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/students/trash',
  beforeLoad: requireAuth,
  component: StudentsTrashPage,
});

const studentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/students/$id',
  beforeLoad: requireAuth,
  component: StudentDetailPage,
});

// Public student dashboard — NO auth wall, token-only.
const publicStudentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$shareToken',
  component: PublicStudentPage,
});

// Public play screen — same token gate, per-game route.
const publicPlayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$shareToken/play/$gameId',
  component: PlayGamePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  dashboardRoute,
  // Order matters: "/settings/integrations" before "/settings" so the literal wins
  // (and "/students/trash" before "/students/$id" likewise).
  settingsIntegrationsRoute,
  settingsRoute,
  scheduleRoute,
  calendarRedirectRoute,
  lessonDetailRoute,
  studentsListRoute,
  studentsTrashRoute,
  studentDetailRoute,
  publicStudentRoute,
  publicPlayRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}

function RootLayout() {
  useDirection();
  const location = useLocation();
  // Public routes keep the bare layout — no sidebar.
  const isPublic =
    location.pathname === '/' ||
    location.pathname === '/login' ||
    location.pathname.startsWith('/s/');
  if (isPublic) return <BareLayout />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function BareLayout() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-surface-muted text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold">
            {t('app.title')}
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
