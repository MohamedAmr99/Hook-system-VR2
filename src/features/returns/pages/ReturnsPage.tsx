import * as React from "react";
import { Link } from "react-router-dom";
import { useReturns } from "@/features/returns/hooks/useReturns";
import { Return, ReturnCondition, ReturnStage, CaseStatus } from "@/features/returns/types/return.types";
import { ReturnEditDialog } from "@/features/returns/components/ReturnEditDialog";
import {
  RotateCcw,
  ShieldCheck,
  CheckCircle,
  Clock,
  AlertTriangle,
  Package,
  Pencil,
  Trash2,
  ExternalLink,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

// ─── Label maps ──────────────────────────────────────────────────────────────
const CONDITION_LABELS: Record<ReturnCondition, { label: string; cls: string }> = {
  healthy: {
    label: "سليم (يعود للمخزون)",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  damaged: {
    label: "تالف (لا يعود للمخزون)",
    cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  },
  wrong_item: {
    label: "منتج خاطئ",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  missing_parts: {
    label: "ناقص أجزاء",
    cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  },
};

const STAGE_LABELS: Record<ReturnStage, { label: string; icon: React.ReactNode; cls: string }> = {
  requested: {
    label: "مطلوب",
    icon: <Clock size={12} />,
    cls: "text-blue-600 bg-blue-50 dark:bg-blue-900/20",
  },
  shipping_to_seller: {
    label: "في الشحن للبائع",
    icon: <Package size={12} />,
    cls: "text-amber-600 bg-amber-50 dark:bg-amber-900/20",
  },
  received: {
    label: "مُستلم",
    icon: <CheckCircle size={12} />,
    cls: "text-teal-600 bg-teal-50 dark:bg-teal-900/20",
  },
  inspected: {
    label: "تم الفحص",
    icon: <CheckCircle size={12} />,
    cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20",
  },
  case_filed: {
    label: "قضية مفتوحة",
    icon: <ShieldCheck size={12} />,
    cls: "text-purple-600 bg-purple-50 dark:bg-purple-900/20",
  },
};

const CASE_STATUS_LABELS: Record<CaseStatus, { label: string; cls: string }> = {
  not_opened: { label: "لا يوجد", cls: "text-muted-foreground" },
  opened: { label: "مفتوحة", cls: "text-blue-600 font-medium" },
  under_review: { label: "قيد المراجعة", cls: "text-amber-600 font-medium" },
  resolved: { label: "تم التعويض 🎉", cls: "text-emerald-600 font-semibold" },
  rejected: { label: "مرفوضة", cls: "text-red-600" },
};

export function ReturnsPage() {
  const { returns, isLoading, updateReturn, deleteReturn } = useReturns();

  const [search, setSearch] = React.useState("");
  const [conditionFilter, setConditionFilter] = React.useState<string>("all");
  const [stageFilter, setStageFilter] = React.useState<string>("all");

  // Edit State
  const [editingReturn, setEditingReturn] = React.useState<Return | null>(null);

  // Delete Confirm State
  const [deletingReturn, setDeletingReturn] = React.useState<Return | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // Filtered List
  const filtered = React.useMemo(() => {
    return returns.filter((r) => {
      // Search
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        r.platformOrderId?.toLowerCase().includes(q) ||
        r.platform?.toLowerCase().includes(q) ||
        r.productName?.toLowerCase().includes(q) ||
        r.sku?.toLowerCase().includes(q) ||
        r.caseReference?.toLowerCase().includes(q) ||
        r.reason?.toLowerCase().includes(q);

      // Condition Filter
      const matchesCondition = conditionFilter === "all" || r.returnCondition === conditionFilter;

      // Stage Filter
      const matchesStage = stageFilter === "all" || r.returnStage === stageFilter;

      return matchesSearch && matchesCondition && matchesStage;
    });
  }, [returns, search, conditionFilter, stageFilter]);

  // Summary stats
  const totalReturns = returns.length;
  const totalRefunds = returns.reduce((s, r) => s + Number(r.customerRefundAmount || 0), 0);
  const totalCompensations = returns.reduce((s, r) => s + Number(r.compensationAmount || 0), 0);
  const totalNetYield = returns.reduce(
    (s, r) =>
      s +
      (Number(r.compensationAmount || 0) -
        Number(r.customerRefundAmount || 0) -
        Number(r.platformFeeRetained || 0) -
        Number(r.shippingCostRetained || 0)),
    0
  );

  const healthyCount = returns.filter((r) => r.returnCondition === "healthy").length;
  const damagedCount = returns.filter((r) => r.returnCondition === "damaged").length;


  // Handle Delete
  const handleDeleteConfirm = async () => {
    if (!deletingReturn) return;
    setIsDeleting(true);
    try {
      await deleteReturn(deletingReturn.id);
      setDeletingReturn(null);
    } catch (e) {
      console.error("Failed to delete return:", e);
    } finally {
      setIsDeleting(false);
    }
  };

  // Quick Restock Toggle
  const handleToggleRestock = async (r: Return) => {
    try {
      if (r.restocked) {
        await updateReturn({ id: r.id, updates: { restocked: false, restockedAt: null } });
      } else {
        await updateReturn({
          id: r.id,
          updates: {
            returnCondition: "healthy",
            returnStage: "inspected",
            restocked: true,
            restockedAt: Date.now(),
          },
        });
      }
    } catch (e) {
      console.error("Failed to toggle restock:", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RotateCcw size={24} className="text-amber-500" />
            إدارة المرتجعات والتعويضات
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            متابعة المرتجعات، تحديد حالة البضاعة المستلمة، التعويضات (SAFE-T)، وإرجاع السليم للمخزون
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium">إجمالي المرتجعات</p>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted font-mono">
              {healthyCount} سليم · {damagedCount} تالف
            </span>
          </div>
          <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{totalReturns}</p>
        </div>

        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">إجمالي المُسترد للعملاء</p>
          <p className="text-2xl font-bold mt-1 text-red-500">{totalRefunds.toFixed(2)} ج.م</p>
        </div>

        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">إجمالي التعويضات المستلمة (SAFE-T)</p>
          <p className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {totalCompensations.toFixed(2)} ج.م
          </p>
        </div>

        <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">صافي العائد (التعويضات - المسترد)</p>
          <p
            className={`text-2xl font-bold mt-1 ${
              totalNetYield > 0
                ? "text-emerald-500"
                : totalNetYield < 0
                ? "text-red-500"
                : "text-foreground"
            }`}
          >
            {totalNetYield > 0 ? `+${totalNetYield.toFixed(2)}` : totalNetYield.toFixed(2)} ج.م
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border/60 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث برقم الطلب، المنصة، اسم المنتج، رقم القضية..."
            className="w-full h-9 rounded-lg border border-border/60 bg-background pr-9 pl-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter size={14} />
            <span>فلترة:</span>
          </div>

          <select
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="h-9 rounded-lg border border-border/60 bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">كل الحالات (سليم / تالف)</option>
            <option value="healthy">سليم فقط (مؤهل للمخزون)</option>
            <option value="damaged">تالف فقط (غير مؤهل)</option>
            <option value="wrong_item">منتج خاطئ</option>
            <option value="missing_parts">ناقص أجزاء</option>
          </select>

          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="h-9 rounded-lg border border-border/60 bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">كل المراحل</option>
            <option value="requested">مطلوب</option>
            <option value="shipping_to_seller">في الشحن</option>
            <option value="received">مُستلم</option>
            <option value="inspected">تم الفحص</option>
            <option value="case_filed">قضية مفتوحة</option>
          </select>

          {(search || conditionFilter !== "all" || stageFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setConditionFilter("all");
                setStageFilter("all");
              }}
              className="h-9 text-xs text-muted-foreground hover:text-foreground"
            >
              إعادة ضبط
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-3">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">جاري تحميل المرتجعات...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground bg-card rounded-xl border border-border/60">
          <RotateCcw size={40} className="opacity-30" />
          <p className="text-sm font-medium">
            {search || conditionFilter !== "all" || stageFilter !== "all"
              ? "لا توجد نتائج مطابقة لخيارات البحث أو الفلترة"
              : "لا توجد مرتجعات مسجلة حتى الآن"}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                  <th className="text-right px-4 py-3 font-semibold">رقم الطلب والمنصة</th>
                  <th className="text-right px-4 py-3 font-semibold">المنتج المُرتجع</th>
                  <th className="text-right px-4 py-3 font-semibold">حالة المنتج</th>
                  <th className="text-right px-4 py-3 font-semibold">مرحلة المرتجع</th>
                  <th className="text-right px-4 py-3 font-semibold">تأثير المخزون</th>
                  <th className="text-right px-4 py-3 font-semibold">المُسترد للعميل</th>
                  <th className="text-right px-4 py-3 font-semibold">الجزء المعوض (SAFE-T)</th>
                  <th className="text-right px-4 py-3 font-semibold">حالة القضية</th>
                  <th className="text-right px-4 py-3 font-semibold">صافي العائد</th>
                  <th className="text-center px-4 py-3 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((r: Return) => {
                  const condMeta = CONDITION_LABELS[r.returnCondition] ?? {
                    label: r.returnCondition,
                    cls: "bg-muted text-foreground border-border",
                  };
                  const stageMeta = STAGE_LABELS[r.returnStage] ?? {
                    label: r.returnStage,
                    icon: null,
                    cls: "bg-muted text-foreground",
                  };
                  const caseMeta = (r.caseStatus ? CASE_STATUS_LABELS[r.caseStatus] : undefined) ?? {
                    label: r.caseStatus ?? "",
                    cls: "",
                  };
                  
                  // Net yield = Compensation - Refund - Retained Fees
                  const netYield =
                    Number(r.compensationAmount || 0) -
                    Number(r.customerRefundAmount || 0) -
                    Number(r.platformFeeRetained || 0) -
                    Number(r.shippingCostRetained || 0);

                  return (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      {/* Order & Platform */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <Link
                            to={`/orders/${r.orderId}/edit`}
                            className="font-mono text-primary hover:underline font-semibold flex items-center gap-1"
                          >
                            <span>{r.platformOrderId}</span>
                            <ExternalLink size={11} className="opacity-60" />
                          </Link>
                          <span className="text-[11px] text-muted-foreground mt-0.5">{r.platform}</span>
                        </div>
                      </td>

                      {/* Product Name */}
                      <td className="px-4 py-3 max-w-[180px]">
                        <div className="truncate">
                          {r.productName ? (
                            <div title={r.productName}>
                              <span className="font-semibold text-foreground">{r.quantity || 1}×</span>{" "}
                              <span>{r.productName}</span>
                              {r.sku && (
                                <p className="font-mono text-[10px] text-muted-foreground">{r.sku}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">من الطلب</span>
                          )}
                        </div>
                      </td>

                      {/* Condition */}
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border",
                            condMeta.cls
                          )}
                        >
                          {condMeta.label}
                        </span>
                      </td>

                      {/* Stage */}
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md",
                            stageMeta.cls
                          )}
                        >
                          {stageMeta.icon}
                          {stageMeta.label}
                        </span>
                      </td>

                      {/* Stock Restock Status */}
                      <td className="px-4 py-3">
                        {r.returnCondition === "healthy" ? (
                          r.restocked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                              <CheckCircle2 size={12} />
                              عادت للمخزون
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleRestock(r)}
                              title="اضغط لإرجاع القطعة للمخزون بعد الفحص"
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-700 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded-md transition-colors"
                            >
                              <ArchiveRestore size={11} />
                              إرجاع للمخزون
                            </button>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <XCircle size={12} className="text-red-400" />
                            لا يُرجع (تالف)
                          </span>
                        )}
                      </td>

                      {/* Customer Refund */}
                      <td className="px-4 py-3 text-red-500 font-medium font-mono">
                        {Number(r.customerRefundAmount || 0).toFixed(2)} ج.م
                      </td>

                      {/* Compensation (SAFE-T) */}
                      <td className="px-4 py-3 font-mono">
                        {Number(r.compensationAmount || 0) > 0 ? (
                          <div className="flex flex-col">
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                              <ShieldCheck size={13} />
                              {Number(r.compensationAmount).toFixed(2)} ج.م
                            </span>
                            {r.caseReference && (
                              <span className="text-[10px] text-muted-foreground font-sans">
                                {r.caseReference}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Case Status */}
                      <td className="px-4 py-3">
                        <span className={cn("text-[11px]", caseMeta.cls)}>{caseMeta.label}</span>
                      </td>

                      {/* Net Yield */}
                      <td className="px-4 py-3 font-mono">
                        <span
                          className={`font-bold text-xs ${
                            netYield > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : netYield < 0
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {netYield > 0 ? `+${netYield.toFixed(2)}` : netYield.toFixed(2)} ج.م
                        </span>
                      </td>


                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingReturn(r)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg"
                            title="تعديل المرتجع"
                          >
                            <Pencil size={13} />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingReturn(r)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                            title="حذف المرتجع"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      {editingReturn && (
        <ReturnEditDialog
          returnItem={editingReturn}
          onClose={() => setEditingReturn(null)}
          onSave={async (updates) => {
            await updateReturn({ id: editingReturn.id, updates });
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingReturn && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setDeletingReturn(null)}
        >
          <div className="bg-card border border-border/60 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">حذف المرتجع</h3>
                <p className="text-xs text-muted-foreground">طلب: {deletingReturn.platformOrderId}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              هل أنت متأكد من رغبتك في حذف هذا المرتجع؟ سيتم مسح بيانات الإرجاع والتعويض المرتبطة به.
              {deletingReturn.restocked && (
                <span className="block mt-1 text-amber-600 font-medium">
                  ملاحظة: سيتم خصم الكمية المسترجعة من المخزون تلقائياً.
                </span>
              )}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeletingReturn(null)}
                disabled={isDeleting}
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    جاري الحذف...
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    تأكيد الحذف
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
