import { describe, it, expect } from "vitest";
import {
  orderHasReturn,
  validateOrderStatusChange,
  ORDER_HAS_RETURN_STATUS_ERROR,
} from "../orderCalculations";
import type { Order } from "@/features/orders/types/order.types";

type Probe = Pick<Order, "id" | "status" | "hasReturn" | "returnCount" | "returnStatus">;
const base: Probe = { id: "o1", status: "Delivered" };

describe("orderHasReturn", () => {
  it("is false for a plain order", () => {
    expect(orderHasReturn(base, [])).toBe(false);
    expect(orderHasReturn(base)).toBe(false);
  });
  it("is true for hasReturn flag or positive returnCount", () => {
    expect(orderHasReturn({ ...base, hasReturn: true })).toBe(true);
    expect(orderHasReturn({ ...base, returnCount: 2 })).toBe(true);
    expect(orderHasReturn({ ...base, returnCount: 0, hasReturn: false })).toBe(false);
  });
  it("is true for a real return doc of the same order only", () => {
    expect(orderHasReturn(base, [{ id: "abc", orderId: "o1" }])).toBe(true);
    expect(orderHasReturn(base, [{ id: "abc", orderId: "other" }])).toBe(false);
  });
  it("ignores fabricated ret- placeholder entries", () => {
    expect(orderHasReturn(base, [{ id: "ret-o1", orderId: "o1" }])).toBe(false);
  });
  it("detects legacy return status and returnStatus", () => {
    expect(orderHasReturn({ ...base, status: "Returned" })).toBe(true);
    expect(orderHasReturn({ ...base, returnStatus: "Requested" })).toBe(true);
    expect(orderHasReturn({ ...base, returnStatus: "None" })).toBe(false);
  });
});

describe("validateOrderStatusChange", () => {
  it("rejects a changed status when the order has a return", () => {
    expect(
      validateOrderStatusChange({ currentStatus: "Delivered", nextStatus: "Cancelled", hasReturn: true }),
    ).toBe(ORDER_HAS_RETURN_STATUS_ERROR);
  });
  it("allows a changed status when there is no return", () => {
    expect(
      validateOrderStatusChange({ currentStatus: "Pending", nextStatus: "Processing", hasReturn: false }),
    ).toBeNull();
  });
  it("allows edits with an unchanged status even with a return", () => {
    expect(
      validateOrderStatusChange({ currentStatus: "Delivered", nextStatus: "Delivered", hasReturn: true }),
    ).toBeNull();
  });
});
