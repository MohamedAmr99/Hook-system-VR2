import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "@/shared/layouts/AppLayout";
import { ProtectedRoute, GuestRoute } from "@/features/auth/components/AuthGuards";

// ── Auth pages (small, loaded eagerly since they are the entry point) ──────────
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { RegisterPage } from "@/features/auth/pages/RegisterPage";

// ── Lazy-loaded feature pages (each becomes its own JS chunk) ─────────────────
const DashboardPage        = lazy(() => import("@/features/dashboard/pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const ProductListPage      = lazy(() => import("@/features/products/pages/ProductListPage").then(m => ({ default: m.ProductListPage })));
const ProductCreatePage    = lazy(() => import("@/features/products/pages/ProductCreatePage").then(m => ({ default: m.ProductCreatePage })));
const ProductEditPage      = lazy(() => import("@/features/products/pages/ProductEditPage").then(m => ({ default: m.ProductEditPage })));
const OrderListPage        = lazy(() => import("@/features/orders/pages/OrderListPage").then(m => ({ default: m.OrderListPage })));
const OrderCreatePage      = lazy(() => import("@/features/orders/pages/OrderCreatePage").then(m => ({ default: m.OrderCreatePage })));
const OrderEditPage        = lazy(() => import("@/features/orders/pages/OrderEditPage").then(m => ({ default: m.OrderEditPage })));
const ReturnsPage          = lazy(() => import("@/features/returns/pages/ReturnsPage").then(m => ({ default: m.ReturnsPage })));
const PurchaseListPage     = lazy(() => import("@/features/purchases/pages/PurchaseListPage").then(m => ({ default: m.PurchaseListPage })));
const PurchaseCreatePage   = lazy(() => import("@/features/purchases/pages/PurchaseCreatePage").then(m => ({ default: m.PurchaseCreatePage })));
const PurchaseEditPage     = lazy(() => import("@/features/purchases/pages/PurchaseEditPage").then(m => ({ default: m.PurchaseEditPage })));
const PurchaseDetailsPage  = lazy(() => import("@/features/purchases/pages/PurchaseDetailsPage").then(m => ({ default: m.PurchaseDetailsPage })));
const FinanceDashboardPage = lazy(() => import("@/features/finance/pages/FinanceDashboardPage").then(m => ({ default: m.FinanceDashboardPage })));
const CollectionListPage   = lazy(() => import("@/features/finance/pages/CollectionListPage").then(m => ({ default: m.CollectionListPage })));
const ExpenseListPage      = lazy(() => import("@/features/finance/pages/ExpenseListPage").then(m => ({ default: m.ExpenseListPage })));
const CategoryListPage     = lazy(() => import("@/features/platforms/pages/CategoryListPage").then(m => ({ default: m.CategoryListPage })));
const PlatformListPage     = lazy(() => import("@/features/platforms/pages/PlatformListPage").then(m => ({ default: m.PlatformListPage })));
const SettingsPage         = lazy(() => import("@/features/settings/pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const LoansPage            = lazy(() => import("@/features/loans/pages/LoansPage").then(m => ({ default: m.LoansPage })));
const PricingCalculatorPage = lazy(() => import("@/features/calculator/pages/PricingCalculatorPage").then(m => ({ default: m.PricingCalculatorPage })));

// ── Fallback shown while a lazy chunk is loading ──────────────────────────────
function PageLoader() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[60vh] text-muted-foreground text-sm">
      جارٍ التحميل...
    </div>
  );
}

// ── Wrapper so every route gets Suspense without repeating it ─────────────────
function S({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [
      { path: "/login",    element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/",
        element: <AppLayout />,
        children: [
          { index: true,                   element: <S><DashboardPage /></S> },
          { path: "products",              element: <S><ProductListPage /></S> },
          { path: "products/new",          element: <S><ProductCreatePage /></S> },
          { path: "products/:id/edit",     element: <S><ProductEditPage /></S> },
          { path: "inventory",             element: <div className="text-xl font-bold">Inventory</div> },
          { path: "orders",                element: <S><OrderListPage /></S> },
          { path: "orders/new",            element: <S><OrderCreatePage /></S> },
          { path: "orders/:id/edit",       element: <S><OrderEditPage /></S> },
          { path: "returns",               element: <S><ReturnsPage /></S> },
          { path: "purchases",             element: <S><PurchaseListPage /></S> },
          { path: "purchases/new",         element: <S><PurchaseCreatePage /></S> },
          { path: "purchases/:id/edit",    element: <S><PurchaseEditPage /></S> },
          { path: "purchases/:id/view",    element: <S><PurchaseDetailsPage /></S> },
          { path: "expenses",              element: <S><ExpenseListPage /></S> },
          { path: "categories",            element: <S><CategoryListPage /></S> },
          { path: "platforms",             element: <S><PlatformListPage /></S> },
          { path: "finance",               element: <S><FinanceDashboardPage /></S> },
          { path: "finance/collections",   element: <S><CollectionListPage /></S> },
          { path: "media",                 element: <div className="text-xl font-bold">Media</div> },
          { path: "tasks",                 element: <div className="text-xl font-bold">Tasks</div> },
          { path: "loans",                 element: <S><LoansPage /></S> },
          { path: "calculator",            element: <S><PricingCalculatorPage /></S> },
          { path: "notifications",         element: <div className="text-xl font-bold">Notifications</div> },
          { path: "settings",              element: <S><SettingsPage /></S> },
        ],
      },
    ],
  },
]);
