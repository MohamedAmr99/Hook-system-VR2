import { describe, it, expect } from "vitest";
import { isPlaceholderReturnId, buildMaterializePayload } from "../return.logic";
import type { Return } from "../../types/return.types";

const placeholder: Return = {
  id: "ret-order1",
  orderId: "order1",
  productName: "P",
  sku: "S1",
  quantity: 2,
  returnCondition: "healthy",
  returnStage: "requested",
  compensationAmount: 0,
  customerRefundAmount: 100,
  restocked: false,
  restockedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("isPlaceholderReturnId", () => {
  it("detects fabricated ids only", () => {
    expect(isPlaceholderReturnId("ret-order1")).toBe(true);
    expect(isPlaceholderReturnId("Xk3mQ9aB1cD2eF4gH5iJ")).toBe(false);
  });
});

describe("buildMaterializePayload", () => {
  it("strips fake id/timestamps, keeps orderId and merges updates", () => {
    const payload = buildMaterializePayload(placeholder, { restocked: true, returnStage: "inspected" });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
    expect(payload.orderId).toBe("order1");
    expect(payload.restocked).toBe(true);
    expect(payload.returnStage).toBe("inspected");
    expect(payload.sku).toBe("S1");
    expect(payload.quantity).toBe(2);
  });

  it("does not let updates change the orderId", () => {
    expect(buildMaterializePayload(placeholder, { orderId: "other" }).orderId).toBe("order1");
  });
});
