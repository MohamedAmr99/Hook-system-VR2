import { useMutation } from "@tanstack/react-query";
import { useOrders } from "@/features/orders/hooks/useOrders";
import { useReturns } from "@/features/returns/hooks/useReturns";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useStore } from "@/shared/store/useStore";
import { SettlementService, type SettlementPreview } from "../services/settlement.service";

/**
 * Preview (parse + reconcile, no writes) and confirm (idempotent save + order status) mutations.
 * After a successful confirm, the local order store is patched with the same settlement fields
 * that were written to Firestore (financial fields only — status is untouched, so no stock effect).
 */
export function useSettlementImport() {
  const { data: orders = [] } = useOrders();
  const { returns = [] } = useReturns();
  const { user } = useAuthStore();
  const updateOrder = useStore((s) => s.updateOrder);

  const preview = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("not_authenticated");
      const text = await file.text();
      return SettlementService.previewAmazonStatement(text, { orders, returns, userId: user.uid });
    },
  });

  const confirm = useMutation({
    mutationFn: async (data: SettlementPreview) => {
      if (!user) throw new Error("not_authenticated");
      return SettlementService.confirmAmazonStatement(data, user.uid);
    },
    onSuccess: (outcome) => {
      const written = new Set(outcome.updatedOrderIds);
      for (const u of outcome.updates) {
        if (!written.has(u.orderId)) continue;
        updateOrder(u.orderId, {
          financialStatus: u.financialStatus,
          actualPayout: u.actualPayout,
          settledAt: u.settledAt,
          settlementId: u.settlementId,
        });
      }
    },
  });

  return { preview, confirm };
}
