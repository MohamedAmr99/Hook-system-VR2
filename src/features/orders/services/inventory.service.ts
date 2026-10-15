import { db } from "@/lib/firebase/config";
import { collection, doc, getDocs, query, runTransaction, where } from "firebase/firestore";
import { Order, OrderStatus } from "../types/order.types";
import { Product } from "@/features/products/types";
import { ActivityService } from "@/shared/services/activity.service";
import { orderHasReturn, validateOrderStatusChange } from "@/shared/utils/orderCalculations";

const ORDERS_COLLECTION = "orders";
const PRODUCTS_COLLECTION = "products";
const RETURNS_COLLECTION = "returns";

/**
 * Reads the return documents of an order. Must run BEFORE a transaction (queries are not
 * allowed inside client transactions). Only used as a fallback for legacy orders that do not
 * carry the denormalized `returnCount`/`hasReturn` yet.
 */
async function fetchReturnRefs(orderId: string): Promise<{ id: string; orderId: string }[]> {
  const snap = await getDocs(query(collection(db, RETURNS_COLLECTION), where("orderId", "==", orderId)));
  return snap.docs.map((d) => ({ id: d.id, orderId }));
}

/** Decides whether the fresh order doc has a return, using the legacy query only when no flag exists. */
function freshOrderHasReturn(
  fresh: Order,
  legacyReturns: { id: string; orderId: string }[],
): boolean {
  const flagDefined = typeof fresh.returnCount === "number" || typeof fresh.hasReturn === "boolean";
  return orderHasReturn(fresh, flagDefined ? [] : legacyReturns);
}

interface ChangeOrderStatusParams {
  orderId: string;
  newStatus: OrderStatus;
  userId: string;
}

/**
 * Guarded status change: reads the order in a transaction and rejects the change when the
 * order has a return. Stock side effects (cancel/reactivate) stay with the caller and must run
 * only after this resolves. Returns the status that was stored before the change.
 */
export async function changeOrderStatusAtomic({
  orderId,
  newStatus,
  userId,
}: ChangeOrderStatusParams): Promise<OrderStatus> {
  const legacyReturns = await fetchReturnRefs(orderId);
  return runTransaction(db, async (transaction) => {
    const orderRef = doc(db, ORDERS_COLLECTION, orderId);
    const snap = await transaction.get(orderRef);
    if (!snap.exists()) {
      throw new Error("الطلب غير موجود");
    }
    const fresh = { ...(snap.data() as Order), id: orderId };
    const error = validateOrderStatusChange({
      currentStatus: fresh.status,
      nextStatus: newStatus,
      hasReturn: freshOrderHasReturn(fresh, legacyReturns),
    });
    if (error) throw new Error(error);

    transaction.update(orderRef, { status: newStatus, updatedAt: Date.now(), updatedBy: userId });
    return fresh.status;
  });
}

interface CreateOrderAtomicParams {
  order: Order;
  userId: string;
  userDisplayName: string;
}

interface UpdateOrderAtomicParams {
  oldOrder: Order;
  updatedOrder: Order;
  userId: string;
  userDisplayName: string;
}

/**
 * Creates an order inside a Firestore Transaction, ensuring stock reservation is atomic and overselling is prevented.
 */
export async function createOrderAtomic({
  order,
  userId,
  userDisplayName,
}: CreateOrderAtomicParams): Promise<void> {
  await runTransaction(db, async (transaction) => {
    // 1. Validate & Reserve stock for each order item
    for (const item of order.items) {
      const productId = item.productId;
      if (!productId) continue;

      const productRef = doc(db, PRODUCTS_COLLECTION, productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        throw new Error(`المنتج غير موجود: "${item.name}"`);
      }

      const productData = productSnap.data() as Product;
      const currentQty = Number(productData.quantity || 0);
      const reservedQty = Number(productData.reservedQuantity || 0);
      const unavailableQty = Number(productData.unavailableQuantity || 0);

      const availableQty = currentQty - reservedQty - unavailableQty;
      const requestedQty = Number(item.quantity || 1);

      if (availableQty < requestedQty) {
        throw new Error(
          `البيع الزائد مرفوض: المخزون المتاح للمنتج "${productData.productName}" هو ${Math.max(0, availableQty)} فقط، بينما المطلوبة في الطلب ${requestedQty}.`,
        );
      }

      // Update reserved quantity on product
      transaction.update(productRef, {
        reservedQuantity: reservedQty + requestedQty,
        updatedAt: Date.now(),
        updatedBy: userId,
      });
    }

    // 2. Save the order document
    const orderRef = doc(db, ORDERS_COLLECTION, order.id);
    transaction.set(orderRef, {
      ...order,
      stockState: "reserved",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: userId,
      updatedBy: userId,
    });
  });

  // Log activity
  await ActivityService.logAction({
    userId,
    userDisplayName,
    actionType: "create",
    entityType: "order",
    entityId: order.id,
    entityName: `Order ${order.platformOrderId}`,
    description: `Created order ${order.platformOrderId} on ${order.platform} and reserved stock atomically.`,
  }).catch(() => {});
}

/**
 * Updates an order inside a Firestore Transaction, adjusting reserved quantities according to delta.
 */
export async function updateOrderAtomic({
  oldOrder,
  updatedOrder,
  userId,
  userDisplayName,
}: UpdateOrderAtomicParams): Promise<void> {
  const legacyReturns = await fetchReturnRefs(updatedOrder.id);
  await runTransaction(db, async (transaction) => {
    // Guard first (all reads happen before writes): reject a changed status for orders with a return.
    const orderRef = doc(db, ORDERS_COLLECTION, updatedOrder.id);
    const orderSnap = await transaction.get(orderRef);
    if (orderSnap.exists()) {
      const fresh = { ...(orderSnap.data() as Order), id: updatedOrder.id };
      const error = validateOrderStatusChange({
        currentStatus: fresh.status,
        nextStatus: updatedOrder.status,
        hasReturn: freshOrderHasReturn(fresh, legacyReturns),
      });
      if (error) throw new Error(error);
    }

    // Map old item quantities by productId
    const oldQtyMap = new Map<string, number>();
    (oldOrder.items || []).forEach((item) => {
      if (item.productId) {
        oldQtyMap.set(
          item.productId,
          (oldQtyMap.get(item.productId) || 0) + Number(item.quantity || 0),
        );
      }
    });

    // Map updated item quantities by productId
    const newQtyMap = new Map<string, number>();
    (updatedOrder.items || []).forEach((item) => {
      if (item.productId) {
        newQtyMap.set(
          item.productId,
          (newQtyMap.get(item.productId) || 0) + Number(item.quantity || 0),
        );
      }
    });

    // Collect all affected product IDs
    const allProductIds = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);

    for (const productId of allProductIds) {
      const productRef = doc(db, PRODUCTS_COLLECTION, productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) continue;

      const productData = productSnap.data() as Product;
      const currentReserved = Number(productData.reservedQuantity || 0);
      const oldQty = oldQtyMap.get(productId) || 0;
      const newQty = newQtyMap.get(productId) || 0;
      const diff = newQty - oldQty;

      if (diff > 0) {
        // Quantity increased - check available stock
        const currentQty = Number(productData.quantity || 0);
        const unavailableQty = Number(productData.unavailableQuantity || 0);
        const availableQty = currentQty - currentReserved - unavailableQty;

        if (availableQty < diff) {
          throw new Error(
            `البيع الزائد مرفوض: المخزون المتاح للمنتج "${productData.productName}" هو ${Math.max(0, availableQty)} فقط، لا يكفي للزيادة المطلوبة (+${diff}).`,
          );
        }
      }

      const nextReserved = Math.max(0, currentReserved + diff);
      transaction.update(productRef, {
        reservedQuantity: nextReserved,
        updatedAt: Date.now(),
        updatedBy: userId,
      });
    }

    // Update order doc. Return counters are owned by ReturnService: never overwrite them
    // with the (possibly stale) client copy.
    const editableFields: Partial<Order> = { ...updatedOrder };
    delete editableFields.returnCount;
    delete editableFields.hasReturn;
    transaction.update(orderRef, {
      ...editableFields,
      updatedAt: Date.now(),
      updatedBy: userId,
    });
  });

  // Log activity
  await ActivityService.logAction({
    userId,
    userDisplayName,
    actionType: "update",
    entityType: "order",
    entityId: updatedOrder.id,
    entityName: `Order ${updatedOrder.platformOrderId}`,
    description: `Updated order ${updatedOrder.platformOrderId} and adjusted stock reservation atomically.`,
  }).catch(() => {});
}

export interface OrderInventoryContext {
  order: Order;
  products?: Product[];
  userId: string;
  userDisplayName: string;
  wasIntact?: boolean;
}

export async function onOrderCancelled({
  order,
  userId,
}: OrderInventoryContext): Promise<void> {
  await runTransaction(db, async (transaction) => {
    for (const item of order.items || []) {
      if (!item.productId) continue;
      const productRef = doc(db, PRODUCTS_COLLECTION, item.productId);
      const snap = await transaction.get(productRef);
      if (!snap.exists()) continue;
      const p = snap.data() as Product;
      const nextReserved = Math.max(
        0,
        Number(p.reservedQuantity || 0) - Number(item.quantity || 1),
      );
      transaction.update(productRef, {
        reservedQuantity: nextReserved,
        updatedAt: Date.now(),
        updatedBy: userId,
      });
    }
  }).catch(() => {});
}

export async function onOrderReactivated({
  order,
  userId,
}: OrderInventoryContext): Promise<void> {
  await runTransaction(db, async (transaction) => {
    for (const item of order.items || []) {
      if (!item.productId) continue;
      const productRef = doc(db, PRODUCTS_COLLECTION, item.productId);
      const snap = await transaction.get(productRef);
      if (!snap.exists()) continue;
      const p = snap.data() as Product;
      const nextReserved =
        Number(p.reservedQuantity || 0) + Number(item.quantity || 1);
      transaction.update(productRef, {
        reservedQuantity: nextReserved,
        updatedAt: Date.now(),
        updatedBy: userId,
      });
    }
  }).catch(() => {});
}

export async function onOrderDeleted(
  ctx: OrderInventoryContext,
): Promise<void> {
  await onOrderCancelled(ctx);
}

export async function syncOrderStock(
  order: Order,
  _products?: Product[],
  _oldStatus?: OrderStatus,
  _newStatus?: OrderStatus,
  userId?: string,
  _userDisplayName?: string,
  oldCondition?: string,
  newCondition?: string,
): Promise<void> {
  if (!order || !order.items) return;
  const uid = userId || "system";

  await runTransaction(db, async (transaction) => {
    for (const item of order.items) {
      if (!item.productId) continue;
      const productRef = doc(db, PRODUCTS_COLLECTION, item.productId);
      const snap = await transaction.get(productRef);
      if (!snap.exists()) continue;

      const p = snap.data() as Product;
      let qty = Number(p.quantity || 0);
      let reserved = Number(p.reservedQuantity || 0);
      let unavailable = Number(p.unavailableQuantity || 0);
      const itemQty = Number(item.quantity || 1);

      if (newCondition === "Healthy" && oldCondition !== "Healthy") {
        qty += itemQty;
      } else if (
        newCondition &&
        ["Damaged", "MissingParts"].includes(newCondition) &&
        oldCondition === "Healthy"
      ) {
        qty = Math.max(0, qty - itemQty);
        unavailable += itemQty;
      }

      transaction.update(productRef, {
        quantity: qty,
        reservedQuantity: reserved,
        unavailableQuantity: unavailable,
        updatedAt: Date.now(),
        updatedBy: uid,
      });
    }
  }).catch(() => {});
}
