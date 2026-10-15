import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Pencil, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/shared/components/DataTable";
import { Purchase } from "../types/purchase.types";
import { useStore } from "@/shared/store/useStore";
import { PRODUCT_QUERY_KEYS } from "@/features/products/hooks/useProducts";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useQueryClient } from "@tanstack/react-query";
import { PurchaseService, PurchaseMissingError } from "../services/purchase.service";

const NL = String.fromCharCode(10);

const actor = (user: { uid: string; displayName: string | null }) => ({
  userId: user.uid,
  userDisplayName: user.displayName ?? "System",
});

export function PurchaseListPage() {
  const { t } = useTranslation();
  const purchases = useStore(state => state.purchases);
  const updatePurchaseStatus = useStore(state => state.updatePurchaseStatus);
  const deletePurchase = useStore(state => state.deletePurchase);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const currency = t("orders.currency");

  // Status change and delete go through PurchaseService: stock + WAC are adjusted atomically
  // in Firestore (Received adds, leaving Received reverts, delete of Received reverts).
  const handleStatusChange = async (purchase: Purchase, newStatus: Purchase["status"]) => {
    if (purchase.status === newStatus || !user) return;
    setActionError(null);
    try {
      const saved = await PurchaseService.updatePurchaseStatusAtomic(purchase.id, newStatus, actor(user));
      updatePurchaseStatus(saved.id, saved.status);
      queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ["inventoryMovements"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("purchases.statusChangeFailed"));
    }
  };

  const handleDelete = async (purchase: Purchase) => {
    if (!user || !window.confirm(t("orders.deleteConfirm"))) return;
    setActionError(null);
    try {
      try {
        await PurchaseService.deletePurchaseAtomic(purchase.id, actor(user));
      } catch (err) {
        // Cause (a): order exists only in the local store (never persisted to Firestore).
        if (!(err instanceof PurchaseMissingError)) throw err;
        const local = useStore.getState().purchases.find((p) => p.id === purchase.id);
        if (!local) throw err;
        if (local.status === "Received") {
          const lines = local.items.map((i) => `${i.name} × ${i.orderedQuantity}`).join(NL);
          const ok = window.confirm(
            [
              "هذا أمر شراء قديم محفوظ محليًا فقط (غير موجود في قاعدة البيانات).",
              "سيتم حذفه وخصم كمياته من المخزون:",
              lines,
              "",
              "هل تريد المتابعة؟",
            ].join(NL),
          );
          if (!ok) return;
        }
        await PurchaseService.deletePurchaseAtomic(purchase.id, actor(user), { legacyLocalCopy: local });
      }
      deletePurchase(purchase.id);
      queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ["inventoryMovements"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("purchases.deleteFailed"));
    }
  };

  const columns: ColumnDef<Purchase>[] = [
    {
      accessorKey: "supplierName",
      header: t("purchases.columns.supplier"),
      cell: ({ row }) => <span className="font-medium">{row.original.supplierName}</span>
    },
    {
      id: "items",
      header: t("purchases.columns.products"),
      cell: ({ row }) => (
        <div className="space-y-1">
          {row.original.items.map((item, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium">{item.name}</span>
              <span className="text-muted-foreground ml-2">x{item.orderedQuantity} @ {Number(item.unitCost).toFixed(2)} {currency}</span>
            </div>
          ))}
        </div>
      )
    },
    {
      accessorKey: "status",
      header: t("purchases.columns.status"),
      cell: ({ row }) => {
        const statusColors: Record<string, string> = {
          Draft: "bg-gray-100 text-gray-800 border-gray-200",
          Pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
          PartiallyReceived: "bg-blue-100 text-blue-800 border-blue-200",
          Received: "bg-green-100 text-green-800 border-green-200",
          Cancelled: "bg-red-100 text-red-800 border-red-200",
        };
        const colorClass = statusColors[row.original.status] || "";
        return (
          <select
            value={row.original.status}
            onChange={(e) => handleStatusChange(row.original, e.target.value as Purchase["status"])}
            className={`text-xs font-medium rounded-full px-3 py-1 border cursor-pointer ${colorClass} focus:outline-none`}
          >
            <option value="Draft">📝 Draft</option>
            <option value="Pending">⏳ {t("purchases.statuses.Pending")}</option>
            <option value="PartiallyReceived">📦 Partially Received</option>
            <option value="Received">✅ {t("purchases.statuses.Received")}</option>
            <option value="Cancelled">❌ {t("purchases.statuses.Cancelled")}</option>
          </select>
        );
      }
    },
    {
      accessorKey: "subtotal",
      header: t("purchases.columns.itemsCost"),
      cell: ({ row }) => <span className="font-medium">{Number(row.original.subtotal).toFixed(2)} {currency}</span>
    },
    {
      accessorKey: "shippingCost",
      header: t("purchases.columns.shipping"),
      cell: ({ row }) => <span className="text-muted-foreground">{Number(row.original.shippingCost || 0).toFixed(2)} {currency}</span>
    },
    {
      accessorKey: "totalCost",
      header: t("purchases.columns.totalCost"),
      cell: ({ row }) => <span className="font-bold text-primary">{Number(row.original.totalCost).toFixed(2)} {currency}</span>
    },
    {
      accessorKey: "purchaseDate",
      header: t("purchases.columns.date"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.purchaseDate).toLocaleDateString()}
        </span>
      )
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Link
            to={`/purchases/${row.original.id}/view`}
            className="p-2 text-primary hover:bg-primary/10 rounded-md transition-colors"
            title={t("purchases.viewDetails")}
          >
            <Eye size={16} />
          </Link>
          <Link
            to={`/purchases/${row.original.id}/edit`}
            className="p-2 text-primary hover:bg-primary/10 rounded-md transition-colors"
            title={t("purchases.editPurchase")}
          >
            <Pencil size={16} />
          </Link>
          <button
            onClick={() => handleDelete(row.original)}
            className="p-2 text-muted-foreground hover:text-red-600 transition-colors rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
            title={t("orders.deleteConfirm")}
          >
            <Trash2 size={16} />
          </button>
        </div>
      )
    },
  ];

  const totalSpent = purchases
    .filter(p => p.status === "Received")
    .reduce((sum, p) => sum + Number(p.totalCost), 0);
  const received = purchases.filter(p => p.status === "Received").length;
  const pending = purchases.filter(p => p.status === "Pending").length;

  return (
    <div className="space-y-6">
      {actionError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("purchases.title")}</h1>
          <p className="text-muted-foreground">{t("purchases.subtitle")}</p>
        </div>
        <Link
          to="/purchases/new"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("purchases.newPurchase")}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">{t("purchases.totalSpent")}</p>
          <p className="text-2xl font-bold mt-1 text-primary">{totalSpent.toFixed(2)} {currency}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">{t("purchases.received")}</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{received}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">{t("purchases.pending")}</p>
          <p className="text-2xl font-bold mt-1 text-yellow-600">{pending}</p>
        </div>
      </div>

      <DataTable
        data={purchases}
        columns={columns}
        searchKey="supplierName"
        searchPlaceholder={t("purchases.searchSupplier")}
      />
    </div>
  );
}
