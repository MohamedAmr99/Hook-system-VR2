import { ReturnRepository } from "../repositories/return.repository";
import { Return } from "../types/return.types";
import { isPlaceholderReturnId, buildMaterializePayload } from "./return.logic";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, getDocs, collection, query, where, runTransaction } from "firebase/firestore";
import type { Order } from "@/features/orders/types/order.types";
import { Product } from "@/features/products/types";
// useStore exposes a Zustand store instance — getState/setState are valid outside React
import { useStore } from "@/shared/store/useStore";

const PRODUCTS_COLLECTION = "products";
const RETURNS_COLLECTION = "returns";
const ORDERS_COLLECTION = "orders";

/** Counts existing return docs of an order. Runs before a transaction (no queries inside). */
async function countOrderReturns(orderId: string): Promise<number> {
  const snap = await getDocs(query(collection(db, RETURNS_COLLECTION), where("orderId", "==", orderId)));
  return snap.size;
}

async function adjustProductStock(productId: string | undefined, sku: string | undefined, quantityChange: number) {
  if (!productId && !sku) return;

  // 1. Resolve the product doc ref BEFORE entering the transaction.
  //    Firestore prohibits non-transactional getDocs() calls inside runTransaction(),
  //    so the SKU fallback query must run outside.
  let resolvedRef: ReturnType<typeof doc> | null = productId
    ? doc(db, PRODUCTS_COLLECTION, productId)
    : null;

  if (!resolvedRef && sku) {
    const q = query(collection(db, PRODUCTS_COLLECTION), where("sku", "==", sku));
    const snap = await getDocs(q);
    if (!snap.empty) resolvedRef = snap.docs[0].ref as ReturnType<typeof doc>;
  }

  if (!resolvedRef) return;

  // 2. Transaction only performs transactional reads + one write — no extra queries.
  try {
    const ref = resolvedRef;
    await runTransaction(db, async (transaction) => {
      const pSnap = await transaction.get(ref);
      if (!pSnap.exists()) return;

      const currentQty = Number((pSnap.data() as Product).quantity || 0);
      const newQty = Math.max(0, currentQty + quantityChange);

      transaction.update(ref, {
        quantity: newQty,
        updatedAt: Date.now(),
      });
    });
  } catch (err) {
    console.warn("Firestore transaction stock update warning:", err);
  }

  // 3. Mirror the change in the local Zustand cache so the UI updates immediately.
  try {
    const state = useStore.getState();
    if (state.products && state.products.length > 0) {
      const updatedProducts = state.products.map((p) => {
        const item = p as typeof p & { id?: string };
        if ((productId && item.id === productId) || (sku && item.sku === sku)) {
          return {
            ...p,
            quantity: Math.max(0, Number(p.quantity || 0) + quantityChange),
          };
        }
        return p;
      });
      useStore.setState({ products: updatedProducts });
    }
  } catch (err) {
    console.warn("Local store stock update warning:", err);
  }
}

export const ReturnService = {
  async getAllReturns(): Promise<Return[]> {
    return ReturnRepository.getAll();
  },

  async createReturn(data: Omit<Return, "id" | "createdAt" | "updatedAt">): Promise<Return> {
    // Legacy orders have no counter yet: seed it from the existing return docs (queried before the tx).
    const existingCount = data.orderId ? await countOrderReturns(data.orderId) : 0;
    const now = Date.now();
    const returnRef = doc(collection(db, RETURNS_COLLECTION));
    const created: Return = { ...data, id: returnRef.id, createdAt: now, updatedAt: now };

    await runTransaction(db, async (transaction) => {
      // All reads before writes.
      const orderRef = data.orderId ? doc(db, ORDERS_COLLECTION, data.orderId) : null;
      const orderSnap = orderRef ? await transaction.get(orderRef) : null;

      transaction.set(returnRef, created);
      if (orderRef && orderSnap?.exists()) {
        const current = (orderSnap.data() as Order).returnCount;
        const nextCount = (typeof current === "number" ? current : existingCount) + 1;
        transaction.update(orderRef, { returnCount: nextCount, hasReturn: true, updatedAt: now });
      }
    });

    if (created.returnCondition === "healthy" && created.restocked) {
      await adjustProductStock(created.productId, created.sku, Number(created.quantity || 1));
    }

    return created;
  },

  async updateReturn(id: string, updates: Partial<Return>, currentReturn?: Return): Promise<void> {
    try {
      await ReturnService.applyReturnUpdate(id, updates, currentReturn);
    } catch (err) {
      console.error("Failed to update return:", err);
      throw new Error("تعذر حفظ المرتجع. يرجى تحديث الصفحة والمحاولة مرة أخرى.", { cause: err });
    }
  },

  async applyReturnUpdate(id: string, updates: Partial<Return>, currentReturn?: Return): Promise<void> {
    if (isPlaceholderReturnId(id)) {
      const stored = await getDoc(doc(db, RETURNS_COLLECTION, id));
      if (!stored.exists()) {
        if (!currentReturn) throw new Error(`Placeholder return ${id} has no source data to materialize`);
        // Materialize as a real doc. createReturn restocks exactly once (healthy && restocked),
        // so the restock-toggle adjustment below must not run on this path.
        await ReturnService.createReturn(buildMaterializePayload(currentReturn, updates));
        return;
      }
    }

    await ReturnRepository.update(id, updates);

    const isRestockToggled = updates.restocked !== undefined && (!currentReturn || updates.restocked !== currentReturn.restocked);

    const effectiveCondition = updates.returnCondition || currentReturn?.returnCondition;

    if (isRestockToggled) {
      const productId = updates.productId || currentReturn?.productId;
      const sku = updates.sku || currentReturn?.sku;
      const qty = Number(updates.quantity || currentReturn?.quantity || 1);

      if (updates.restocked && effectiveCondition === "healthy") {
        // Restock → Increment inventory only for healthy returns
        await adjustProductStock(productId, sku, qty);
      } else if (!updates.restocked && currentReturn?.restocked && currentReturn?.returnCondition === "healthy") {
        // Undo restock → Decrement previously restocked inventory
        await adjustProductStock(productId, sku, -qty);
      }
    }
  },

  async deleteReturn(id: string, currentReturn?: Return): Promise<void> {
    // The caller may not pass the return (useReturns does not), so resolve it from the stored doc.
    const storedReturn = await getDoc(doc(db, RETURNS_COLLECTION, id));
    // Fabricated placeholder: nothing exists in Firestore, so there is nothing to delete or restock back.
    if (isPlaceholderReturnId(id) && !storedReturn.exists()) return;

    const orderId = currentReturn?.orderId ?? (storedReturn.exists() ? (storedReturn.data() as Return).orderId : undefined);
    // Legacy orders have no counter yet: it is seeded from the docs that exist before this delete.
    const existingCount = orderId ? await countOrderReturns(orderId) : 0;

    await runTransaction(db, async (transaction) => {
      // All reads before writes.
      const orderRef = orderId ? doc(db, ORDERS_COLLECTION, orderId) : null;
      const returnRef = doc(db, RETURNS_COLLECTION, id);
      const returnSnap = await transaction.get(returnRef);
      const orderSnap = orderRef ? await transaction.get(orderRef) : null;

      transaction.delete(returnRef);
      // Only decrement when the return doc really existed (idempotent against double deletes).
      if (orderRef && orderSnap?.exists() && returnSnap.exists()) {
        const current = (orderSnap.data() as Order).returnCount;
        const nextCount = Math.max(0, (typeof current === "number" ? current : existingCount) - 1);
        transaction.update(orderRef, { returnCount: nextCount, hasReturn: nextCount > 0, updatedAt: Date.now() });
      }
    });

    // Undo stock for restocked healthy returns.
    // Fall back to the stored Firestore doc if the caller did not supply currentReturn —
    // this prevents a silent stock integrity failure when useReturns omits it.
    const returnData: Return | undefined =
      currentReturn ?? (storedReturn.exists() ? (storedReturn.data() as Return) : undefined);

    if (returnData?.restocked && returnData?.returnCondition === "healthy") {
      await adjustProductStock(
        returnData.productId,
        returnData.sku,
        -Number(returnData.quantity || 1)
      );
    }
  },
};
