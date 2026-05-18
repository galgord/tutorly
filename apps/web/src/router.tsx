import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LocaleSwitcher } from './components/LocaleSwitcher';
import { useDirection } from './hooks/useDirection';
import { api } from './lib/api';
import { CalendarPage } from './pages/Calendar';
import { DashboardPage } from './pages/Dashboard';
import { LessonDetailPage } from './pages/LessonDetail';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { PublicStudentPage } from './pages/PublicStudent';
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

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  beforeLoad: requireAuth,
  component: CalendarPage,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  dashboardRoute,
  // Order matters: "/settings/integrations" before "/settings" so the literal wins
  // (and "/students/trash" before "/students/$id" likewise).
  settingsIntegrationsRoute,
  settingsRoute,
  calendarRoute,
  lessonDetailRoute,
  studentsListRoute,
  studentsTrashRoute,
  studentDetailRoute,
  publicStudentRoute,
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
  const { t } = useTranslation();
  useDirection();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <a href="/" className="text-lg font-semibold">
            {t('app.title')}
          </a>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
