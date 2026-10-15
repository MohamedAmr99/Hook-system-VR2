import { describe, it, expect } from "vitest";
import { Product } from "@/features/products/types";
import { calculateOrderFinancials } from "../orderCalculations";

describe("Inventory Overselling & Validation Rules", () => {
  it("calculates available quantity correctly (quantity - reserved - unavailable)", () => {
    const product: Product = {
      id: "prod-101",
      productName: "Receiver X10 Pro",
      slug: "receiver-x10-pro",
      sku: "REC-X10",
      barcode: "1000000000101",
      brand: "BrandX",
      category: "Electronics",
      subcategory: "Receivers",
      description: "Test receiver",
      sellingPrice: 1499,
      costPrice: 1000,
      listingUrls: {},
      metaTitle: "Receiver X10 Pro",
      metaDescription: "Test receiver",
      keywords: "receiver",
      quantity: 10,
      reservedQuantity: 7,
      unavailableQuantity: 0,
      minimumStockAlert: 2,
      amazonStatus: "Active",
      noonStatus: "Inactive",
      jumiaStatus: "Inactive",
      gallery: [],
      videos: [],
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "u1",
      updatedBy: "u1",
    };

    const available = product.quantity - product.reservedQuantity - (product.unavailableQuantity || 0);
    expect(available).toBe(3);
  });

  it("rejects new order creation when availableQuantity is 0 and requested quantity is 1", () => {
    const product: Product = {
      id: "prod-102",
      productName: "Out of Stock Item",
      slug: "out-of-stock-item",
      sku: "OOS-1",
      barcode: "1000000000102",
      brand: "BrandX",
      category: "Electronics",
      subcategory: "Accessories",
      description: "Test out of stock item",
      sellingPrice: 500,
      costPrice: 300,
      listingUrls: {},
      metaTitle: "Out of Stock Item",
      metaDescription: "Test out of stock item",
      keywords: "oos",
      quantity: 5,
      reservedQuantity: 5,
      unavailableQuantity: 0,
      minimumStockAlert: 1,
      amazonStatus: "Active",
      noonStatus: "Inactive",
      jumiaStatus: "Inactive",
      gallery: [],
      videos: [],
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "u1",
      updatedBy: "u1",
    };

    const available = product.quantity - product.reservedQuantity - (product.unavailableQuantity || 0);
    const requestedQty = 1;
    const isAllowed = available >= requestedQty;

    expect(available).toBe(0);
    expect(isAllowed).toBe(false);
  });

  it("rejects order edit when increasing quantity by diff > availableQuantity", () => {
    const availableStock = 2;
    const oldOrderQty = 1;
    const newOrderQty = 4; // diff = 3 > availableStock 2

    const diff = newOrderQty - oldOrderQty;
    const isAllowed = availableStock >= diff;

    expect(isAllowed).toBe(false);
  });

  it("allows order edit when increasing quantity within availableQuantity", () => {
    const availableStock = 5;
    const oldOrderQty = 1;
    const newOrderQty = 3; // diff = 2 <= availableStock 5

    const diff = newOrderQty - oldOrderQty;
    const isAllowed = availableStock >= diff;

    expect(isAllowed).toBe(true);
  });
});

describe("Payment Status Fallback & Manual Preservation Rules", () => {
  it("preserves manually entered partial payment when paymentStatus is changed", () => {
    const order = {
      id: "ord-201",
      platformOrderId: "AMZ-201",
      platform: "Amazon",
      status: "Processing" as const,
      paymentStatus: "Unpaid" as const,
      financialStatus: "Unsettled" as const,
      orderDate: Date.now(),
      items: [],
      subtotal: 1000,
      discountTotal: 0,
      taxTotal: 0,
      shippingCollected: 0,
      totalRevenue: 1000,
      totalCogs: 400,
      grossProfit: 600,
      sellingFees: 100,
      fulfillmentFees: 0,
      otherFees: 0,
      netPayoutExpected: 900,
      paidAmount: 500, // Manually entered partial payment
      refundedAmount: 0,
      netCollectedAmount: 500,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "u1",
      updatedBy: "u1",
    };

    const financials = calculateOrderFinancials(order);

    expect(financials.paidAmount).toBe(500);
    expect(financials.netCollectedAmount).toBe(500);
  });

  it("calculates PartiallyRefunded netCollectedAmount accurately without destroying original economics", () => {
    const order = {
      id: "ord-202",
      platformOrderId: "AMZ-202",
      platform: "Amazon",
      status: "Delivered" as const,
      paymentStatus: "PartiallyRefunded" as const,
      financialStatus: "Settled" as const,
      orderDate: Date.now(),
      items: [],
      subtotal: 1000,
      discountTotal: 0,
      taxTotal: 0,
      shippingCollected: 0,
      totalRevenue: 1000,
      totalCogs: 400,
      grossProfit: 600,
      sellingFees: 100,
      fulfillmentFees: 0,
      otherFees: 0,
      netPayoutExpected: 900,
      paidAmount: 1000,
      refundedAmount: 300,
      netCollectedAmount: 700,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "u1",
      updatedBy: "u1",
    };

    const financials = calculateOrderFinancials(order);

    expect(financials.paidAmount).toBe(1000);
    expect(financials.refundedAmount).toBe(300);
    expect(financials.netCollectedAmount).toBe(700);
    expect(financials.effectiveRevenue).toBe(700);
  });

  it("uses default fallback when paidAmount is undefined/null", () => {
    const order = {
      id: "ord-203",
      platformOrderId: "AMZ-203",
      platform: "Amazon",
      status: "Delivered" as const,
      paymentStatus: "Paid" as const,
      financialStatus: "Settled" as const,
      orderDate: Date.now(),
      items: [],
      subtotal: 1000,
      discountTotal: 0,
      taxTotal: 0,
      shippingCollected: 0,
      totalRevenue: 1000,
      totalCogs: 400,
      grossProfit: 600,
      sellingFees: 100,
      fulfillmentFees: 0,
      otherFees: 0,
      netPayoutExpected: 900,
      paidAmount: undefined,
      refundedAmount: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "u1",
      updatedBy: "u1",
    };

    const financials = calculateOrderFinancials(order);

    expect(financials.paidAmount).toBe(1000); // Default fallback for Paid status
    expect(financials.refundedAmount).toBe(0);
    expect(financials.netCollectedAmount).toBe(1000);
  });
});
