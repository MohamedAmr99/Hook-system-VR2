import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil, Filter, X, UploadCloud, Scale } from "lucide-react";
import { Link } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/shared/components/DataTable";
import { Order, OrderStatus } from "../types/order.types";
import { useStore } from "@/shared/store/useStore";
import { useProducts, PRODUCT_QUERY_KEYS } from "@/features/products/hooks/useProducts";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  changeOrderStatusAtomic,
  onOrderCancelled,
  onOrderDeleted,
  onOrderReactivated,
} from "../services/inventory.service";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { OrderImportModal } from "../components/OrderImportModal";
import { SettlementImportModal } from "@/features/settlements/components/SettlementImportModal";
import { useOrders, deleteOrderFromFirestore, patchOrderInFirestore } from "../hooks/useOrders";
import { calculateOrderFinancials, orderHasReturn } from "@/shared/utils/orderCalculations";
import { toast } from "sonner";
import { useReturns } from "@/features/returns/hooks/useReturns";
import { ReturnCreateDialog } from "@/features/returns/components/ReturnCreateDialog";

const ACTIVE_STATUSES = ["Pending", "Processing", "Shipped", "Delivered"] as const;
const RETURN_STATUSES = ["Returned", "ReturnedToSeller", "ReturningToSeller", "RejectedByBuyer"] as const;

type DateFilter = "all" | "today" | "week" | "month";

function isInDateRange(dateValue: string | Date | number, range: DateFilter): boolean {
  if (range === "all") return true;
  const d = new Date(dateValue);
  const now = new Date();
  if (range === "today") {
    return d.toDateString() === now.toDateString();
  }
  if (range === "week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(now.getDate() - 7);
    return d >= weekAgo;
  }
  if (range === "month") {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  return true;
}

export function OrderListPage() {
  const { t } = useTranslation();
  const { data: orders = [] } = useOrders();
  const { returns = [] } = useReturns();
  const updateOrder = useStore(state => state.updateOrder);
  const updateOrderStatus = useStore(state => state.updateOrderStatus);
  const deleteOrder = useStore(state => state.deleteOrder);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: products = [] } = useProducts();
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [showSettlementModal, setShowSettlementModal] = React.useState(false);
  const [selectedReturnOrder, setSelectedReturnOrder] = React.useState<Order | null>(null);

  // Filters
  const [platformFilter, setPlatformFilter] = React.useState<string>("");
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("all");
  const [showFilters, setShowFilters] = React.useState(false);

  const PLATFORMS = ["Amazon", "Noon", "Jumia", "Kenz", "Raneen", "B.TECH", "Own Store", "Other"];
  const ALL_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled", "Returned", "ReturnedToSeller", "ReturningToSeller", "RejectedByBuyer"];

  const filteredOrders = React.useMemo(() => {
    return orders.filter(o => {
      if (platformFilter && o.platform !== platformFilter) return false;
      if (statusFilter && o.status !== statusFilter) return false;
      if (!isInDateRange(o.orderDate, dateFilter)) return false;
      return true;
    });
  }, [orders, platformFilter, statusFilter, dateFilter]);

  const hasActiveFilters = platformFilter || statusFilter || dateFilter !== "all";

  const clearFilters = () => {
    setPlatformFilter("");
    setStatusFilter("");
    setDateFilter("all");
  };

  const handleStatusChange = async (order: Order, newStatus: OrderStatus) => {
    const oldStatus = order.status;
    if (oldStatus === newStatus) return;

    if (!user) return;

    // Guarded Firestore write first: rejects orders with a return. Local store only after success.
    try {
      await changeOrderStatusAtomic({ orderId: order.id, newStatus, userId: user.uid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("orders.statusLockedByReturn"));
      return;
    }
    updateOrderStatus(order.id, newStatus);

    const ctx = { order, products, userId: user.uid, userDisplayName: user.displayName ?? "System" };

    const wasActive = (ACTIVE_STATUSES as readonly string[]).includes(oldStatus);
    const isNowActive = (ACTIVE_STATUSES as readonly string[]).includes(newStatus);
    const wasReturn = (RETURN_STATUSES as readonly string[]).includes(oldStatus);

    if (wasActive && newStatus === "Cancelled") {
      await onOrderCancelled(ctx);
    } else if (oldStatus === "Cancelled" && isNowActive) {
      await onOrderReactivated(ctx);
    } else if (wasReturn && isNowActive && order.returnStatus === "None") {
      await onOrderReactivated(ctx);
    }

    queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
  };

  const handlePaymentStatusChange = (order: Order, newStatus: any) => {
    const updates: Partial<Order> = { paymentStatus: newStatus };
    if (newStatus === "Paid") {
      if (!order.paidAmount || order.paidAmount === 0) {
        updates.paidAmount = order.totalRevenue;
      }
    } else if (newStatus === "Unpaid") {
      updates.paidAmount = 0;
    } else if (newStatus === "Refunded") {
      updates.refundedAmount = order.paidAmount || order.totalRevenue;
    }
    // Update Zustand (immediate UI)
    updateOrder(order.id, updates);
    // Persist to Firestore
    patchOrderInFirestore(order.id, updates as Record<string, unknown>);
  };

  const handleDelete = async (order: Order) => {
    if (!window.confirm(t("orders.deleteConfirm"))) return;

    // Remove from Zustand (immediate UI)
    deleteOrder(order.id);
    // Remove from Firestore (persisted)
    deleteOrderFromFirestore(order.id);

    if (!user) return;
    await onOrderDeleted({
      order,
      products,
      userId: user.uid,
      userDisplayName: user.displayName ?? "System",
      wasIntact: order.returnStatus === "None",
    });
    queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
  };

  const statusColors: Record<string, string> = {
    Pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    Processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    Shipped: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    Delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    Cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    Returned: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    ReturnedToSeller: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    ReturningToSeller: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    RejectedByBuyer: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  const platformColors: Record<string, string> = {
    Amazon: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    Noon: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    Jumia: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    Kenz: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    Raneen: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "B.TECH": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    "Own Store": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    Other: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  };

  const columns: ColumnDef<Order>[] = [
    {
      accessorKey: "platformOrderId",
      header: t("orders.columns.orderId"),
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium">{row.original.platformOrderId}</span>
      )
    },
    {
      accessorKey: "platform",
      header: t("orders.columns.platform"),
      cell: ({ row }) => {
        const colorClass = platformColors[row.original.platform] || platformColors["Other"];
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
            {row.original.platform}
          </span>
        );
      }
    },
    {
      accessorKey: "status",
      header: t("orders.columns.status"),
      cell: ({ row }) => {
        const colorClass = statusColors[row.original.status] || "";
        if (orderHasReturn(row.original, returns)) {
          return (
            <span
              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium cursor-not-allowed opacity-80 ${colorClass}`}
              title={t("orders.statusLockedByReturn")}
            >
              {t(`orders.statuses.${row.original.status}`)}
            </span>
          );
        }
        return (
          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 ${colorClass}`}>
            <select
              value={row.original.status}
              onChange={(e) => handleStatusChange(row.original, e.target.value as OrderStatus)}
              className="text-xs font-medium bg-transparent border-none outline-none cursor-pointer appearance-none pr-1"
            >
              {ALL_STATUSES.map(s => (
                <option key={s} value={s} className="bg-background text-foreground">{t(`orders.statuses.${s}`)}</option>
              ))}
            </select>
          </span>
        );
      }
    },
    {
      accessorKey: "items",
      header: t("orders.columns.items", "المنتجات"),
      cell: ({ row }) => {
        const items = row.original.items || [];
        return (
          <div className="space-y-0.5 max-w-[180px]">
            {items.slice(0, 2).map((item, i) => (
              <div key={i} className="text-xs text-foreground/80 truncate">
                <span className="font-semibold">{item.name}</span> <span className="text-[11px] text-muted-foreground">x{item.quantity}</span>
              </div>
            ))}
            {items.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{items.length - 2} {t("orders.moreItems", "أخرى")}</span>
            )}
          </div>
        );
      }
    },
    {
      accessorKey: "totalRevenue",
      header: t("orders.columns.sales"),
      cell: ({ row }) => {
        const returnDoc = returns.find(r => r.orderId === row.original.id);
        const fin = calculateOrderFinancials(row.original, returnDoc);
        const origRev = Number(row.original.totalRevenue || 0);
        return (
          <div className="flex flex-col">
            <span className="font-bold text-xs">{fin.effectiveRevenue.toFixed(2)} ج.م</span>
            {fin.effectiveRevenue !== origRev && (
              <span className="text-[10px] text-muted-foreground line-through font-mono">
                {origRev.toFixed(2)} ج.م
              </span>
            )}
          </div>
        );
      }
    },
    {
      accessorKey: "netPayoutExpected",
      header: t("orders.columns.netProfit"),
      cell: ({ row }) => {
        const returnDoc = returns.find(r => r.orderId === row.original.id);
        const fin = calculateOrderFinancials(row.original, returnDoc);
        const net = fin.finalNetProfit;
        return (
          <div className="flex flex-col">
            <span className={`font-bold text-xs ${net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {net.toFixed(2)} ج.م
            </span>
            {fin.hasReturn && (
              <span className="text-[10px] text-muted-foreground font-mono">
                (عند المرتجع: {net.toFixed(2)})
              </span>
            )}
          </div>
        );
      }
    },
    {
      accessorKey: "orderDate",
      header: t("orders.columns.date"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.original.orderDate).toLocaleDateString("zh-Hans-CN").replace(/\//g, "/")}
        </span>
      )
    },
    {
      accessorKey: "paymentStatus",
      header: "حالة الدفع والتحصيل",
      cell: ({ row }) => {
        const payStatus = row.original.paymentStatus || "Unpaid";
        const paymentColors: Record<string, string> = {
          Paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
          Unpaid: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
          PartiallyRefunded: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
          Refunded: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
        };
        const colorCls = paymentColors[payStatus] || paymentColors["Unpaid"];
        return (
          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 ${colorCls}`}>
            <select
              value={payStatus}
              onChange={(e) => handlePaymentStatusChange(row.original, e.target.value)}
              className="text-xs font-medium bg-transparent border-none outline-none cursor-pointer appearance-none pr-1"
            >
              <option value="Unpaid" className="bg-background text-foreground">في انتظار الدفع</option>
              <option value="Paid" className="bg-background text-foreground">تم الدفع</option>
              <option value="PartiallyRefunded" className="bg-background text-foreground">مسترد جزئياً</option>
              <option value="Refunded" className="bg-background text-foreground">مسترد بالكامل</option>
            </select>
          </span>
        );
      }
    },
    {
      id: "actions",
      header: t("orders.columns.actions"),
      cell: ({ row }) => {
        const isReturnStatus = orderHasReturn(row.original, returns);

        return (
          <div className="flex items-center gap-1.5">
            {isReturnStatus ? (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                مرتجع
              </span>
            ) : row.original.status === "Delivered" ? (
              <button
                onClick={() => setSelectedReturnOrder(row.original)}
                className="text-[10px] font-bold text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30 transition-colors"
                title="تسجيل مرتجع لهذا الطلب"
              >
                مرتجع
              </button>
            ) : null}

            <Link
              to={`/orders/${row.original.id}/edit`}
              className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
              title={t("orders.editOrder", "Edit Order")}
            >
              <Pencil size={14} />
            </Link>
            <button
              onClick={() => handleDelete(row.original)}
              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
              title={t("orders.deleteOrder", "Delete Order")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      },
    },
  ];

  // Summary stats from filtered orders (Single Source of Truth)
  const totalSales = filteredOrders.reduce((sum, o) => {
    const returnDoc = returns.find(r => r.orderId === o.id);
    const fin = calculateOrderFinancials(o, returnDoc);
    return sum + fin.effectiveRevenue;
  }, 0);

  const totalNet = filteredOrders.reduce((sum, o) => {
    const returnDoc = returns.find(r => r.orderId === o.id);
    const fin = calculateOrderFinancials(o, returnDoc);
    return sum + fin.finalNetProfit;
  }, 0);

  const returnOrdersCount = filteredOrders.filter(o => {
    const hasDoc = returns.some(r => r.orderId === o.id);
    return hasDoc || (RETURN_STATUSES as readonly string[]).includes(o.status);
  }).length;

  const totalCompensations = returns.reduce((s, r) => s + Number(r.compensationAmount || 0), 0);

  return (
    <div className="space-y-5">
      {/* Header Top Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("orders.title")}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t("orders.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/orders/new"
            className="inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t("orders.newOrder")}
          </Link>
          <Button
            variant="outline"
            className="h-9 gap-1.5 px-3 border-border/80 hover:bg-muted"
            onClick={() => setShowSettlementModal(true)}
          >
            <Scale size={14} />
            <span>{t("settlements.openButton")}</span>
          </Button>
          <Button 
            variant="outline" 
            className="h-9 gap-1.5 px-3 border-border/80 hover:bg-muted"
            onClick={() => setShowImportModal(true)}
          >
            <UploadCloud size={14} />
            <span>استيراد طلبات</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 gap-1.5 border-border/80",
              (showFilters || hasActiveFilters) && "border-primary/50 bg-primary/5 text-primary"
            )}
            onClick={() => setShowFilters(v => !v)}
          >
            <Filter size={13} />
            <span>{t("common.filterStatus")}</span>
            {hasActiveFilters && (
              <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {[platformFilter, statusFilter, dateFilter !== "all"].filter(Boolean).length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 p-4 bg-card border border-border/60 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t("common.filterPlatform")}
            </label>
            <select
              value={platformFilter}
              onChange={e => setPlatformFilter(e.target.value)}
              className="text-xs rounded-md border border-border/60 bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("common.allPlatforms")}</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t("common.filterStatus")}
            </label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-xs rounded-md border border-border/60 bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">{t("common.allStatuses")}</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{t(`orders.statuses.${s}`)}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {t("common.filterDate")}
            </label>
            <div className="flex items-center gap-1">
              {(["all", "today", "week", "month"] as DateFilter[]).map(d => (
                <button
                  key={d}
                  onClick={() => setDateFilter(d)}
                  className={cn(
                    "text-xs px-2.5 py-1.5 rounded-md border transition-all",
                    dateFilter === d
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border/60 hover:bg-muted"
                  )}
                >
                  {t(`common.${d === "all" ? "allTime" : d === "week" ? "thisWeek" : d === "month" ? "thisMonth" : "today"}`)}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors mt-4"
            >
              <X size={12} />
              <span>{t("orders.clearFilters", "مسح الفلاتر")}</span>
            </button>
          )}
        </div>
      )}

      {showImportModal && (
        <OrderImportModal onClose={() => setShowImportModal(false)} />
      )}

      {showSettlementModal && (
        <SettlementImportModal onClose={() => setShowSettlementModal(false)} />
      )}

      {selectedReturnOrder && (
        <ReturnCreateDialog order={selectedReturnOrder} onClose={() => setSelectedReturnOrder(null)} />
      )}

      {/* Summary 4 KPI Cards (Matching Image 2) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">{t("orders.totalOrders")}</p>
          <p className="text-2xl font-bold mt-1">{filteredOrders.length}</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">{t("orders.totalSales")}</p>
          <p className="text-2xl font-bold mt-1 text-foreground">
            {totalSales.toFixed(2)} ج.م
          </p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">{t("orders.totalNetProfit")}</p>
          <p className={`text-2xl font-bold mt-1 ${totalNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
            {totalNet.toFixed(2)} ج.م
          </p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">إجمالي المرتجعات</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-amber-500 mt-1">{returnOrdersCount} <span className="text-xs text-muted-foreground font-normal">طلب</span></p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
              إجمالي التعويضات: {totalCompensations.toFixed(2)} ج.م
            </p>
          </div>
        </div>
      </div>

      <DataTable
        data={filteredOrders}
        columns={columns}
        searchKey="platformOrderId"
        searchPlaceholder={t("orders.search")}
      />
    </div>
  );
}
