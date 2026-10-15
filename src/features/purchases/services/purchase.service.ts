import { db } from "@/lib/firebase/config";
import { collection, doc, runTransaction, DocumentReference } from "firebase/firestore";
import { purchaseRepository } from "../repositories/purchase.repository";
import { Purchase, PurchaseItem } from "../types/purchase.types";
import { Product } from "@/features/products/types";
import { InventoryMovement, CostHistory } from "@/features/inventory/types/inventory.types";
import { ActivityService } from "@/shared/services/activity.service";
import { aggregateByProduct, computeNetChange, effectiveItems, ProductStockChange } from "./purchase.logic";
import { ledgerService } from "@/features/finance/services/ledger.service";

const PURCHASES_COLLECTION = "purchases";
const PRODUCTS_COLLECTION = "products";
const MOVEMENTS_COLLECTION = "inventoryMovements";
const COST_HISTORY_COLLECTION = "costHistory";

interface Actor {
  userId: string;
  userDisplayName: string;
}

const EMPTY_ITEMS_ERROR = "يجب أن يحتوي أمر الشراء على صنف واحد على الأقل.";

type CommitMode = "create" | "existing";

/** Thrown when the purchase doc is not in Firestore (e.g. an old order that only exists locally). */
export class PurchaseMissingError extends Error {
  constructor() {
    super("أمر الشراء غير موجود أو تم حذفه. أعد تحميل الصفحة وحاول مرة أخرى.");
    this.name = "PurchaseMissingError";
  }
}

/**
 * Core atomic routine. Computes the NET stock/WAC change between the receipt persisted in
 * Firestore (`before`, if it was Received) and the receipt of the new version, validates only the
 * final state, and writes products, movements, cost history and the purchase document in one
 * transaction. `buildAfter` returns null to delete the purchase.
 *
 * Idempotent: the old effect is derived from the status persisted in Firestore, so saving a
 * Received purchase as Received with the same lines changes nothing.
 *
 * Only `create` may proceed when the purchase doc is missing; every other mode requires it so a
 * stale tab cannot reverse stock twice or resurrect a deleted purchase.
 */
async function commitPurchase(
  purchaseId: string,
  buildAfter: (before: Purchase | null) => Purchase | null,
  actor: Actor,
  mode: CommitMode,
  legacyLocalCopy?: Purchase,
): Promise<Purchase | null> {
  const purchaseRef = doc(db, PURCHASES_COLLECTION, purchaseId);

  return await runTransaction(db, async (tx) => {
    // ---- READS (all before any write) ----
    const purchaseSnap = await tx.get(purchaseRef);
    // Legacy path (delete only): doc missing in Firestore but the caller supplied the local copy.
    const legacy = mode === "existing" && !purchaseSnap.exists() && !!legacyLocalCopy;
    if (mode === "existing" && !purchaseSnap.exists() && !legacy) {
      throw new PurchaseMissingError();
    }
    const before: Purchase | null = purchaseSnap.exists()
      ? ({ ...purchaseSnap.data(), id: purchaseSnap.id } as Purchase)
      : legacy
        ? (legacyLocalCopy as Purchase)
        : null;
    const after = buildAfter(before);

    const oldAgg = aggregateByProduct(effectiveItems(before));
    const newAgg = aggregateByProduct(effectiveItems(after));

    const productIds = Array.from(new Set([...oldAgg.keys(), ...newAgg.keys()]));
    const empty = { qty: 0, value: 0 };
    const itemMeta = new Map<string, PurchaseItem>();
    for (const i of [...effectiveItems(before), ...effectiveItems(after)]) itemMeta.set(i.productId, i);

    const loaded: { ref: DocumentReference; change: ProductStockChange }[] = [];
    for (const productId of productIds) {
      const ref = doc(db, PRODUCTS_COLLECTION, productId);
      const snap = await tx.get(ref);
      const o = oldAgg.get(productId) ?? empty;
      const n = newAgg.get(productId) ?? empty;
      if (!snap.exists()) {
        if (n.qty > 0 && o.qty !== n.qty) {
          throw new Error(`المنتج غير موجود: "${itemMeta.get(productId)?.name ?? productId}"`);
        }
        continue; // product deleted; nothing to reverse
      }
      const data = snap.data() as Product;
      const change = computeNetChange(
        productId,
        {
          name: data.productName,
          quantity: Number(data.quantity || 0),
          costPrice: Number(data.costPrice || 0),
          reservedQuantity: Number(data.reservedQuantity || 0),
          unavailableQuantity: Number(data.unavailableQuantity || 0),
        },
        o,
        n,
        { legacy },
      );
      if (change) loaded.push({ ref, change });
    }

    const now = Date.now();

    // ---- WRITES ----
    for (const { ref, change } of loaded) {
      const meta = itemMeta.get(change.productId);
      tx.update(ref, {
        quantity: change.newStock,
        costPrice: change.newWac,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      const unitCost = change.qtyDelta !== 0 ? change.valueDelta / change.qtyDelta : 0;
      if (change.qtyDelta !== 0) {
        tx.set(doc(collection(db, MOVEMENTS_COLLECTION)), {
          productId: change.productId,
          sku: meta?.sku ?? "",
          type: change.qtyDelta > 0 ? "PURCHASE_RECEIVE" : "ADJUSTMENT_SUBTRACT",
          quantity: change.qtyDelta,
          referenceId: purchaseId,
          unitCost,
          previousStock: change.previousStock,
          newStock: change.newStock,
          ...(change.qtyDelta < 0
            ? { notes: legacy ? "Legacy local-only purchase receipt reversed (deleted)" : after ? "Purchase receipt reduced/reversed (edit/status change)" : "Purchase receipt reversed (deleted)" }
            : {}),
          createdAt: now,
          createdBy: actor.userId,
        } as Omit<InventoryMovement, "id">);
      }
      tx.set(doc(collection(db, COST_HISTORY_COLLECTION)), {
        productId: change.productId,
        date: now,
        newWeightedAverageCost: change.newWac,
        previousStock: change.previousStock,
        previousWac: change.previousWac,
        addedQuantity: change.qtyDelta,
        addedUnitCost: unitCost,
        newTotalStock: change.newStock,
        referenceId: purchaseId,
        isEstimated: false,
      } as Omit<CostHistory, "id">);
    }

    if (!after) {
      tx.delete(purchaseRef);
      return null;
    }
    const persisted: Purchase = {
      ...after,
      id: purchaseId,
      createdAt: before?.createdAt ?? after.createdAt ?? now,
      createdBy: before?.createdBy ?? after.createdBy ?? actor.userId,
      updatedAt: now,
      updatedBy: actor.userId,
    };
    tx.set(purchaseRef, persisted);
    return persisted;
  });
}

async function logPurchase(
  actor: Actor,
  actionType: "create" | "update" | "delete",
  purchase: Purchase,
  description: string,
): Promise<void> {
  await ActivityService.logAction({
    userId: actor.userId,
    userDisplayName: actor.userDisplayName,
    actionType,
    entityType: "system",
    entityId: purchase.id,
    entityName: `Purchase ${purchase.supplierName}`,
    description,
  });
}

export const PurchaseService = {
  async getPurchases(): Promise<Purchase[]> {
    return await purchaseRepository.getAll();
  },

  async getPurchaseById(id: string): Promise<Purchase | null> {
    return await purchaseRepository.getById(id);
  },

  /**
   * Creates a purchase. Stock/WAC change only if it is created directly as Received.
   * Returns the persisted purchase (callers mirror it into the local store).
   */
  async createPurchaseAtomic(purchase: Purchase, actor: Actor): Promise<Purchase> {
    if (!purchase.items || purchase.items.length === 0) {
      throw new Error(EMPTY_ITEMS_ERROR);
    }
    const saved = (await commitPurchase(purchase.id, () => purchase, actor, "create")) as Purchase;
    await logPurchase(actor, "create", saved, `Created purchase (${saved.status}) from ${saved.supplierName}.`);
    return saved;
  },

  /**
   * Replaces a purchase with its edited version. The previous state is read from Firestore inside
   * the transaction; the net stock change is applied. Throws if the purchase doc no longer exists.
   */
  async updatePurchaseAtomic(updated: Purchase, actor: Actor): Promise<Purchase> {
    if (!updated.items || updated.items.length === 0) {
      throw new Error(EMPTY_ITEMS_ERROR);
    }
    const saved = (await commitPurchase(updated.id, () => updated, actor, "existing")) as Purchase;
    await logPurchase(actor, "update", saved, `Updated purchase (${saved.status}) from ${saved.supplierName}.`);
    return saved;
  },

  /**
   * Changes only the status; Pending->Received adds stock, Received->other reverts it.
   * The "after" document is built from the Firestore snapshot read inside the transaction,
   * never from a possibly stale local copy.
   */
  async updatePurchaseStatusAtomic(
    purchaseId: string,
    status: Purchase["status"],
    actor: Actor,
  ): Promise<Purchase> {
    const saved = (await commitPurchase(
      purchaseId,
      (before) => ({ ...(before as Purchase), status }),
      actor,
      "existing",
    )) as Purchase;
    await logPurchase(actor, "update", saved, `Purchase status changed to ${status}.`);
    return saved;
  },

  /**
   * Deletes a purchase, reversing its stock/WAC effect first if it was Received.
   * `legacyLocalCopy` is used ONLY when the Firestore doc is missing: a Received local copy has its
   * quantity deducted (WAC left unchanged); a non-Received one just resolves with no stock change.
   * Without it, a missing doc throws PurchaseMissingError.
   */
  async deletePurchaseAtomic(
    purchaseId: string,
    actor: Actor,
    options: { legacyLocalCopy?: Purchase } = {},
  ): Promise<void> {
    let deleted: Purchase | null = null;
    await commitPurchase(
      purchaseId,
      (before) => {
        deleted = before;
        return null;
      },
      actor,
      "existing",
      options.legacyLocalCopy,
    );
    if (deleted) await logPurchase(actor, "delete", deleted, `Deleted purchase from ${(deleted as Purchase).supplierName}.`);
  },

  /**
   * Posts the Dr Inventory / Cr Supplier Payable entry for a received purchase.
   * NOT called automatically yet: ledger treatment of shipping/tax and reversal on
   * un-receive must be agreed with the finance owner first.
   */
  async postReceiptLedger(purchase: Purchase): Promise<void> {
    await ledgerService.postTransaction(
      {
        type: "PurchasePayment",
        referenceId: purchase.id,
        date: purchase.purchaseDate,
        description: `Purchase Received from ${purchase.supplierName}`,
        createdBy: purchase.createdBy,
        createdAt: Date.now(),
      },
      [
        { accountId: "inventory_asset", amount: purchase.totalCost, debit: purchase.totalCost, credit: 0 },
        { accountId: "supplier_payable", amount: -purchase.totalCost, debit: 0, credit: purchase.totalCost },
      ],
    );
  },
};
