import { Outlet, Link, useLocation } from "react-router-dom";
import { AuthService } from "@/features/auth/services/auth.service";
import { useAuthStore } from "@/features/auth/store/auth.store";
import {
  LayoutDashboard,
  Package,
  Box,
  ShoppingCart,
  ShoppingBag,
  DollarSign,
  Image,
  CheckSquare,
  Bell,
  Globe,
  LogOut,
  RefreshCcw,
  Tags,
  Monitor,
  Settings,
  Receipt,
  Handshake,
  Calculator,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";

export function AppLayout() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.dir = i18n.language === "ar" ? "rtl" : "ltr";
  }, [i18n.language]);

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === "en" ? "ar" : "en");
  };

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar Placeholder */}
      <aside className="w-64 border-r border-border hidden md:flex flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight">Hook System</h1>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          <SidebarItem
            to="/"
            icon={<LayoutDashboard size={18} />}
            label={t("layout.dashboard")}
          />
          <SidebarItem
            to="/products"
            icon={<Package size={18} />}
            label={t("layout.products")}
          />
          <SidebarItem
            to="/inventory"
            icon={<Box size={18} />}
            label={t("layout.inventory")}
          />
          <SidebarItem
            to="/orders"
            icon={<ShoppingCart size={18} />}
            label={t("layout.orders")}
          />
          <SidebarItem
            to="/returns"
            icon={<RefreshCcw size={18} />}
            label={t("layout.returns") || "Returns"}
          />
          <SidebarItem
            to="/purchases"
            icon={<ShoppingBag size={18} />}
            label={t("layout.purchases") || "Purchases"}
          />
          <SidebarItem
            to="/expenses"
            icon={<Receipt size={18} />}
            label={t("finance.expenses", "Expenses")}
          />
          <SidebarItem
            to="/categories"
            icon={<Tags size={18} />}
            label="الفئات"
          />
          <SidebarItem
            to="/platforms"
            icon={<Monitor size={18} />}
            label="المنصات"
          />
          <SidebarItem
            to="/finance"
            icon={<DollarSign size={18} />}
            label={t("layout.finance")}
          />
          <SidebarItem
            to="/finance/collections"
            icon={<DollarSign size={18} />}
            label="التحصيلات"
          />
          <SidebarItem
            to="/media"
            icon={<Image size={18} />}
            label={t("layout.media")}
          />
          <SidebarItem
            to="/tasks"
            icon={<CheckSquare size={18} />}
            label={t("layout.tasks")}
          />
          <SidebarItem
            to="/loans"
            icon={<Handshake size={18} />}
            label="السلف والديون"
          />
          <SidebarItem
            to="/calculator"
            icon={<Calculator size={18} />}
            label="حاسبة التسعير"
          />
          <SidebarItem
            to="/notifications"
            icon={<Bell size={18} />}
            label={t("layout.notifications")}
          />
          <SidebarItem
            to="/settings"
            icon={<Settings size={18} />}
            label={t("layout.settings", "الإعدادات")}
          />
        </nav>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Topbar Placeholder */}
        <header className="h-16 border-b border-border flex items-center px-6 justify-between">
          <div className="md:hidden font-bold">Hook System</div>
          {/* We use flex-1 to allow the flex container to grow, and justify-end to align items to the logical end (left in RTL, right in LTR) */}
          <div className="flex-1 flex justify-end items-center gap-4">
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors text-muted-foreground"
            >
              <Globe size={16} />
              {i18n.language === "ar" ? "English" : "العربية"}
            </button>
            <button
              onClick={async () => {
                const uid = useAuthStore.getState().user?.uid;
                await AuthService.logout(uid);
              }}
              className="flex items-center gap-2 text-sm font-medium hover:text-destructive transition-colors text-muted-foreground"
            >
              <LogOut size={16} />
              {t("layout.logout")}
            </button>
            <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary/30"></div>
          </div>
        </header>
        <div className="flex-1 p-6 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SidebarItem({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  const location = useLocation();
  const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
