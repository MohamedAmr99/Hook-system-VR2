import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/shared/store/useStore";
import { SettlementImportModal } from "@/features/settlements/components/SettlementImportModal";
import { Button } from "@/shared/components/ui/button";
import {
  UploadCloud,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Wallet,
  ShoppingCart,
  Receipt,
  CircleDollarSign,
} from "lucide-react";

// ─── Platform badge colours ─────────────────────────────────────────────────
const PLATFORM_COLORS: Record<
  string,
  { bg: string; text: string; bar: string }
> = {
  Amazon: {
    bg: "bg-orange-100 dark:bg-orange-900/30",
    text: "text-orange-700 dark:text-orange-400",
    bar: "bg-orange-500",
  },
  Noon: {
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    text: "text-yellow-700 dark:text-yellow-400",
    bar: "bg-yellow-500",
  },
  Jumia: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-400",
    bar: "bg-red-500",
  },
  Kenz: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-400",
    bar: "bg-purple-500",
  },
  Raneen: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-400",
    bar: "bg-blue-500",
  },
  "B.TECH": {
    bg: "bg-cyan-100 dark:bg-cyan-900/30",
    text: "text-cyan-700 dark:text-cyan-400",
    bar: "bg-cyan-500",
  },
  "Own Store": {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-400",
    bar: "bg-green-500",
  },
  Other: {
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-700 dark:text-gray-400",
    bar: "bg-gray-400",
  },
};

function fmt(n: number, currency: string) {
  return `${n.toFixed(2)} ${currency}`;
}

export function FinanceDashboardPage() {
  const { t } = useTranslation();
  const orders = useStore((state) => state.orders);
  const purchases = useStore((state) => state.purchases) || [];
  const expenses = useStore((state) => state.expenses) || [];
  const collections = useStore((state) => state.collections) || [];

  const [showImportModal, setShowImportModal] = useState(false);
  const currency = t("orders.currency", "ج.م");

  // ─── Active (non-cancelled) orders ────────────────────────────────────────
  const activeOrders = orders.filter((o) => o.status !== "Cancelled");
  const unsettledOrders = activeOrders.filter(
    (o) => o.financialStatus !== "Settled",
  );

  // ─── Top-level KPIs ───────────────────────────────────────────────────────
  const totalGross = activeOrders.reduce(
    (s, o) => s + Number(o.totalRevenue || 0),
    0,
  );
  const estMarketplaceFees = activeOrders.reduce(
    (s, o) =>
      s +
      Number(o.sellingFees || 0) +
      Number(o.fulfillmentFees || 0) +
      Number(o.otherFees || 0),
    0,
  );
  const totalCogs = activeOrders.reduce(
    (s, o) => s + Number(o.totalCogs || 0),
    0,
  );
  const expectedNet = activeOrders.reduce(
    (s, o) => s + Number(o.netPayoutExpected || 0),
    0,
  );

  const totalPurchasesCost = purchases
    .filter((p) => p.status !== "Cancelled")
    .reduce((s, p) => s + Number(p.totalCost || 0), 0);

  const totalExpensesCost = expenses.reduce(
    (s, e) => s + Number(e.amount || 0),
    0,
  );

  // ─── Returns Financial Impact ───────────────────────────────────────────────
  const totalReturnLosses = orders.reduce((s, o) => {
    if (o.returnStatus && o.returnStatus !== "None") {
      return (
        s +
        Number(o.refundAmount || 0) +
        Number(o.returnShippingCost || 0) -
        Number(o.returnClaimAmount || 0)
      );
    }
    return s;
  }, 0);

  // ─── Bottom Line (Net Profit) ─────────────────────────────────────────────
  // Net Profit = (Gross Revenue - COGS - Fees) - Return Losses - Operating Expenses
  // Note: Purchases are NOT deducted from Net Profit (they are Inventory/Payables)
  const bottomLineProfit = expectedNet - totalReturnLosses - totalExpensesCost;

  // ─── Receivables & Collections ──────────────────────────────────────────────
  const totalMarketplaceReceivables = expectedNet; // All expected payouts
  const totalCollected = collections.reduce(
    (s, c) => s + Number(c.actualAmount || 0),
    0,
  );
  const totalOutstanding = totalMarketplaceReceivables - totalCollected;
  const totalDifferences = collections.reduce(
    (s, c) => s + Number(c.difference || 0),
    0,
  );

  // ─── Platform Breakdown ───────────────────────────────────────────────────
  type PlatformStat = {
    grossSales: number;
    expectedNet: number;
    settledNet: number;
    orderCount: number;
    settledCount: number;
    expenses: number;
  };

  const platformStats: Record<string, PlatformStat> = {};

  activeOrders.forEach((o) => {
    const p = o.platform || "Other";
    if (!platformStats[p]) {
      platformStats[p] = {
        grossSales: 0,
        expectedNet: 0,
        settledNet: 0,
        orderCount: 0,
        settledCount: 0,
        expenses: 0,
      };
    }
    platformStats[p].grossSales += Number(o.totalRevenue || 0);
    platformStats[p].expectedNet += Number(o.netPayoutExpected || 0);
    platformStats[p].orderCount += 1;
    if (o.financialStatus === "Settled") {
      // actualPayout comes from settlement lines; legacy orders (pre-reconciliation import) only have netPayoutExpected.
      platformStats[p].settledNet += Number(o.actualPayout ?? o.netPayoutExpected ?? 0);
      platformStats[p].settledCount += 1;
    }
  });

  // Add platform-linked expenses
  expenses.forEach((e) => {
    if (e.platform && platformStats[e.platform]) {
      platformStats[e.platform].expenses += Number(e.amount || 0);
    }
  });

  const sortedPlatforms = Object.entries(platformStats).sort(
    ([, a], [, b]) => b.grossSales - a.grossSales,
  );

  const maxGross = Math.max(...sortedPlatforms.map(([, s]) => s.grossSales), 1);

  // ─── Expense breakdown by category ────────────────────────────────────────
  const expenseByCategory: Record<string, number> = {};
  expenses.forEach((e) => {
    expenseByCategory[e.category] =
      (expenseByCategory[e.category] || 0) + Number(e.amount || 0);
  });

  // ─── KPI cards config ─────────────────────────────────────────────────────
  const topKpis = [
    {
      title: t("finance.grossSales", "إجمالي المبيعات"),
      value: totalGross,
      icon: <CircleDollarSign size={22} className="text-blue-500" />,
      color: "blue",
      sub: `${activeOrders.length} ${t("orders.title", "طلب")}`,
    },
    {
      title: t("finance.marketplaceFees", "عمولات المنصات"),
      value: estMarketplaceFees,
      icon: <TrendingDown size={22} className="text-red-500" />,
      color: "red",
      sub: `${totalGross > 0 ? ((estMarketplaceFees / totalGross) * 100).toFixed(1) : 0}%`,
    },
    {
      title: t("finance.totalCogs", "تكلفة البضاعة (COGS)"),
      value: totalCogs,
      icon: <ShoppingCart size={22} className="text-orange-500" />,
      color: "orange",
      sub: "",
    },
    {
      title: t("finance.expectedNet", "صافي الربح المتوقع"),
      value: expectedNet,
      icon: <TrendingUp size={22} className="text-emerald-500" />,
      color: "emerald",
      sub: `${totalGross > 0 ? ((expectedNet / totalGross) * 100).toFixed(1) : 0}% هامش`,
    },
    {
      title: t("finance.totalPurchases", "إجمالي المشتريات"),
      value: totalPurchasesCost,
      icon: <ShoppingCart size={22} className="text-amber-600" />,
      color: "amber",
      sub: `${purchases.filter((p) => p.status !== "Cancelled").length} فاتورة`,
    },
    {
      title: t("finance.expenses", "المصروفات التشغيلية"),
      value: totalExpensesCost,
      icon: <Receipt size={22} className="text-rose-500" />,
      color: "rose",
      sub: `${expenses.length} مصروف`,
    },
    {
      title: t("finance.bottomLineProfit", "صافي الربح النهائي"),
      value: bottomLineProfit,
      icon: (
        <Wallet
          size={22}
          className={
            bottomLineProfit >= 0 ? "text-emerald-600" : "text-destructive"
          }
        />
      ),
      color: bottomLineProfit >= 0 ? "emerald" : "red",
      highlight: true,
      sub: `بعد خصم المشتريات والمصروفات`,
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("finance.title", "اللوحة المالية")}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t("finance.subtitle", "تتبع الإيرادات، التسويات، وصافي الأرباح.")}
          </p>
        </div>
        <Button onClick={() => setShowImportModal(true)} className="gap-2">
          <UploadCloud size={16} />
          {t("finance.importSettlement", "استيراد تسوية أمازون")}
        </Button>
      </div>

      {/* ── KPI Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {topKpis.map((kpi, i) => (
          <div
            key={i}
            className={`bg-card border rounded-xl p-4 shadow-sm flex flex-col gap-2 ${
              kpi.highlight
                ? "ring-2 ring-primary col-span-2 sm:col-span-1"
                : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium leading-tight">
                {kpi.title}
              </span>
              <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                {kpi.icon}
              </div>
            </div>
            <p
              className={`text-xl font-bold ${kpi.highlight && kpi.value < 0 ? "text-destructive" : kpi.highlight ? "text-primary" : ""}`}
            >
              {kpi.value.toFixed(2)}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {currency}
              </span>
            </p>
            {kpi.sub && (
              <p className="text-[11px] text-muted-foreground">{kpi.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* ── Settlement & Collections quick stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            Total Receivables
          </p>
          <p className="text-2xl font-bold">
            {fmt(totalMarketplaceReceivables, currency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Expected from all sales
          </p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
            Total Collected
          </p>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {fmt(totalCollected, currency)}
          </p>
          <p className="text-xs text-emerald-600/70 dark:text-emerald-500 mt-1">
            {collections.length} Collections
          </p>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1">
            Total Outstanding
          </p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
            {fmt(totalOutstanding, currency)}
          </p>
          <p className="text-xs text-yellow-600/70 dark:text-yellow-500 mt-1">
            Pending transfer
          </p>
        </div>
        <div
          className={`bg-card border rounded-xl p-4 ${totalDifferences !== 0 ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : ""}`}
        >
          <p
            className={`text-xs font-semibold mb-1 ${totalDifferences !== 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}
          >
            Differences / Losses
          </p>
          <p
            className={`text-2xl font-bold ${totalDifferences !== 0 ? "text-red-700 dark:text-red-400" : ""}`}
          >
            {fmt(totalDifferences, currency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Expected vs Actual
          </p>
        </div>
      </div>

      {/* ── Platform Breakdown + Expenses ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Platform Breakdown — spans 2 columns */}
        <div className="lg:col-span-2 bg-card border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 size={18} className="text-primary" />
            <h3 className="font-semibold text-base">
              {t("finance.platformBreakdown", "حسابات المنصات")}
            </h3>
          </div>

          {sortedPlatforms.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد بيانات</p>
          ) : (
            <div className="space-y-5">
              {sortedPlatforms.map(([platform, stats]) => {
                const color =
                  PLATFORM_COLORS[platform] || PLATFORM_COLORS["Other"];
                const barPct = (stats.grossSales / maxGross) * 100;
                const settledPct =
                  stats.grossSales > 0
                    ? (stats.settledNet / stats.grossSales) * 100
                    : 0;
                const netAfterExpenses = stats.expectedNet - stats.expenses;
                return (
                  <div key={platform}>
                    {/* Platform header */}
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}
                      >
                        {platform}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {stats.orderCount} طلب
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="relative h-2 bg-muted rounded-full overflow-hidden mb-3">
                      <div
                        className={`absolute h-full ${color.bar} rounded-full transition-all`}
                        style={{ width: `${barPct}%` }}
                      />
                      {settledPct > 0 && (
                        <div
                          className="absolute h-full bg-emerald-500 rounded-full opacity-70"
                          style={{
                            width: `${(stats.settledNet / maxGross) * 100}%`,
                          }}
                        />
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-muted/40 rounded-lg p-2">
                        <p className="text-muted-foreground">
                          {t("finance.grossSales", "إجمالي المبيعات")}
                        </p>
                        <p className="font-bold mt-0.5">
                          {stats.grossSales.toFixed(2)}
                        </p>
                      </div>
                      <div className="bg-muted/40 rounded-lg p-2">
                        <p className="text-muted-foreground">
                          {t("finance.totalExpected", "صافي متوقع")}
                        </p>
                        <p className="font-bold mt-0.5">
                          {stats.expectedNet.toFixed(2)}
                        </p>
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2">
                        <p className="text-emerald-700 dark:text-emerald-400">
                          {t("finance.totalSettled", "مسوى فعلاً")}
                        </p>
                        <p className="font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                          {stats.settledNet.toFixed(2)}
                          <span className="text-[10px] font-normal ml-1 opacity-70">
                            ({settledPct.toFixed(0)}%)
                          </span>
                        </p>
                      </div>
                      <div
                        className={`rounded-lg p-2 ${stats.expenses > 0 ? "bg-rose-50 dark:bg-rose-900/20" : "bg-muted/40"}`}
                      >
                        <p
                          className={
                            stats.expenses > 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-muted-foreground"
                          }
                        >
                          {t("finance.netAfterExpenses", "صافي بعد المصروفات")}
                        </p>
                        <p
                          className={`font-bold mt-0.5 ${netAfterExpenses < 0 ? "text-destructive" : ""}`}
                        >
                          {netAfterExpenses.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column: Profit waterfall + Expense categories */}
        <div className="space-y-5">
          {/* Profit Waterfall */}
          <div className="bg-card border rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-base mb-4">
              {t("finance.profitWaterfall", "تفصيل صافي الربح")}
            </h3>
            <div className="space-y-2 text-sm">
              {[
                {
                  label: t("finance.grossSales", "إجمالي المبيعات"),
                  value: totalGross,
                  sign: 1,
                },
                {
                  label: t("finance.marketplaceFees", "عمولات المنصات"),
                  value: -estMarketplaceFees,
                  sign: -1,
                },
                {
                  label: t("finance.totalCogs", "تكلفة البضاعة"),
                  value: -totalCogs,
                  sign: -1,
                },
                {
                  label: t("finance.expectedNet", "صافي متوقع"),
                  value: expectedNet,
                  sign: 1,
                  divider: true,
                },
                {
                  label: t("finance.returnLosses", "خسائر المرتجعات"),
                  value: -totalReturnLosses,
                  sign: -1,
                },
                {
                  label: t("finance.expenses", "المصروفات التشغيلية"),
                  value: -totalExpensesCost,
                  sign: -1,
                },
                {
                  label: t("finance.bottomLineProfit", "صافي الربح النهائي"),
                  value: bottomLineProfit,
                  sign: 1,
                  highlight: true,
                },
              ].map((row, i) => (
                <div key={i}>
                  {row.divider && (
                    <div className="border-t border-dashed my-2" />
                  )}
                  <div
                    className={`flex justify-between items-center py-1 px-2 rounded-md ${row.highlight ? "bg-primary/10 font-bold" : ""}`}
                  >
                    <span
                      className={
                        row.highlight ? "text-primary" : "text-muted-foreground"
                      }
                    >
                      {row.label}
                    </span>
                    <span
                      className={
                        row.highlight
                          ? row.value >= 0
                            ? "text-primary"
                            : "text-destructive"
                          : row.sign < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {row.sign < 0 && row.value !== 0 ? "−" : ""}
                      {Math.abs(row.value).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Expense categories */}
          {Object.keys(expenseByCategory).length > 0 && (
            <div className="bg-card border rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-base mb-3">
                {t("finance.expensesByCategory", "المصروفات حسب الفئة")}
              </h3>
              <div className="space-y-2">
                {Object.entries(expenseByCategory)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, amount]) => (
                    <div
                      key={cat}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {t(`expenses.categories.${cat}`, cat)}
                      </span>
                      <span className="font-medium">
                        {amount.toFixed(2)} {currency}
                      </span>
                    </div>
                  ))}
                <div className="border-t pt-2 flex justify-between text-sm font-bold">
                  <span>{t("common.total", "الإجمالي")}</span>
                  <span className="text-rose-600 dark:text-rose-400">
                    {totalExpensesCost.toFixed(2)} {currency}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Unsettled Table ── */}
      {unsettledOrders.length > 0 && (
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <h3 className="font-semibold text-base mb-4">
            {t("finance.recentUnsettled", "أحدث الطلبات المعلقة")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-right pb-2 font-medium">
                    {t("orders.columns.orderId", "رقم الطلب")}
                  </th>
                  <th className="text-right pb-2 font-medium">
                    {t("orders.columns.platform", "المنصة")}
                  </th>
                  <th className="text-right pb-2 font-medium">
                    {t("orders.columns.date", "التاريخ")}
                  </th>
                  <th className="text-right pb-2 font-medium">
                    {t("orders.columns.netProfit", "صافي الربح")}
                  </th>
                  <th className="text-right pb-2 font-medium">
                    {t("returns.columns.financialStatus", "الحالة المالية")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {unsettledOrders.slice(0, 10).map((o) => (
                  <tr
                    key={o.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-2 font-mono text-xs">
                      {o.platformOrderId}
                    </td>
                    <td className="py-2">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${(PLATFORM_COLORS[o.platform] || PLATFORM_COLORS["Other"]).bg} ${(PLATFORM_COLORS[o.platform] || PLATFORM_COLORS["Other"]).text}`}
                      >
                        {o.platform}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(o.orderDate).toLocaleDateString("ar-EG")}
                    </td>
                    <td className="py-2 font-bold">
                      {Number(o.netPayoutExpected || 0).toFixed(2)}
                    </td>
                    <td className="py-2">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                        {t("finance.unsettled", "غير مسوى")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unsettledOrders.length > 10 && (
              <p className="text-xs text-muted-foreground mt-3 text-center">
                + {unsettledOrders.length - 10} {t("orders.moreItems", "أخرى")}
              </p>
            )}
          </div>
        </div>
      )}

      {showImportModal && (
        <SettlementImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
