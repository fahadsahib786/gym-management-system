import { lazy } from "react";
import { createHashRouter } from "react-router";
import { AppShell } from "./AppShell";
import { NotFound, RouteError } from "./RouteError";

// Route-level code splitting keeps start-up light; each screen loads on first visit.
const DashboardPage = lazy(() =>
  import("@/features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const MembersPage = lazy(() =>
  import("@/features/members/MembersPage").then((m) => ({ default: m.MembersPage })),
);
const RegisterMemberPage = lazy(() =>
  import("@/features/members/RegisterMemberPage").then((m) => ({ default: m.RegisterMemberPage })),
);
const EditMemberPage = lazy(() =>
  import("@/features/members/EditMemberPage").then((m) => ({ default: m.EditMemberPage })),
);
const MemberProfilePage = lazy(() =>
  import("@/features/members/MemberProfilePage").then((m) => ({ default: m.MemberProfilePage })),
);
const CheckInPage = lazy(() =>
  import("@/features/attendance/CheckInPage").then((m) => ({ default: m.CheckInPage })),
);
const PaymentsPage = lazy(() =>
  import("@/features/payments/PaymentsPage").then((m) => ({ default: m.PaymentsPage })),
);
const DuesPage = lazy(() => import("@/features/payments/DuesPage").then((m) => ({ default: m.DuesPage })));
const ExpensesPage = lazy(() =>
  import("@/features/expenses/ExpensesPage").then((m) => ({ default: m.ExpensesPage })),
);
const PlansPage = lazy(() => import("@/features/plans/PlansPage").then((m) => ({ default: m.PlansPage })));
const ReportsPage = lazy(() =>
  import("@/features/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const MessagesPage = lazy(() =>
  import("@/features/messages/MessagesPage").then((m) => ({ default: m.MessagesPage })),
);
const ActivityPage = lazy(() =>
  import("@/features/activity/ActivityPage").then((m) => ({ default: m.ActivityPage })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

export const router = createHashRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "members", element: <MembersPage /> },
      { path: "members/new", element: <RegisterMemberPage /> },
      { path: "members/:id", element: <MemberProfilePage /> },
      { path: "members/:id/edit", element: <EditMemberPage /> },
      { path: "check-in", element: <CheckInPage /> },
      { path: "payments", element: <PaymentsPage /> },
      { path: "dues", element: <DuesPage /> },
      { path: "expenses", element: <ExpensesPage /> },
      { path: "plans", element: <PlansPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "messages", element: <MessagesPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
