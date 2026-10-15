// @ts-nocheck
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Order } from '@/features/orders/types/order.types';
import { Purchase } from '@/features/purchases/types/purchase.types';
import { ProductFormValues as Product } from '@/features/products/schemas/product.schema';
import { Expense } from '@/features/finance/types/expense.types';
import { Collection } from '@/features/finance/types/finance.types';

interface AppState {
  products: Product[];
  orders: Order[];
  purchases: Purchase[];
  expenses: Expense[];
  collections: Collection[];
  
  // Actions
  addProduct: (product: Product) => void;
  updateProduct: (sku: string, product: Product) => void;
  
  addOrder: (order: Order) => void;
  updateOrder: (id: string, order: Partial<Order>) => void;
  updateOrderStatus: (id: string, status: Order["status"]) => void;
  deleteOrder: (id: string) => void;
  
  addPurchase: (purchase: Purchase) => void;
  updatePurchase: (id: string, data: Partial<Purchase>) => void;
  updateOrderFinancialStatus: (id: string, financialStatus: FinancialStatus) => void;
  updatePurchaseStatus: (id: string, status: Purchase["status"]) => void;
  deletePurchase: (id: string) => void;

  addExpense: (expense: Expense) => void;
  updateExpense: (id: string, data: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;

  addCollection: (collection: Collection) => void;
  updateCollection: (id: string, data: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
}

// Initial mock products so the user has something to select
const initialProducts: Product[] = [
  {
    productName: "Wireless Headphones",
    slug: "wireless-headphones",
    sku: "WH-001",
    brand: "Sony",
    category: "Electronics",
    barcode: "WH001",
    subcategory: "Audio",
    description: "High quality wireless headphones",
    metaTitle: "Wireless Headphones",
    metaDescription: "",
    keywords: "",
    aiPrompt: "",
    aiGeneratedDescription: "",
    sellingPrice: 120,
    costPrice: 80,
    quantity: 100,
    reservedQuantity: 0,
    minimumStockAlert: 10,
    amazonStatus: "Active",
    noonStatus: "Active",
    jumiaStatus: "Inactive",
    gallery: [],
    videos: [],
    listingUrls: {}
  },
  {
    productName: "Smart Watch Series 8",
    slug: "smart-watch-series-8",
    sku: "SW-008",
    brand: "Apple",
    category: "Electronics",
    barcode: "SW008",
    subcategory: "Wearables",
    description: "Smart watch series 8",
    metaTitle: "Smart Watch",
    metaDescription: "",
    keywords: "",
    aiPrompt: "",
    aiGeneratedDescription: "",
    sellingPrice: 399,
    costPrice: 200,
    quantity: 45,
    reservedQuantity: 5,
    minimumStockAlert: 10,
    amazonStatus: "Active",
    noonStatus: "Active",
    jumiaStatus: "Inactive",
    gallery: [],
    videos: [],
    listingUrls: {}
  },
  {
    productName: "Power Bank 20000mAh",
    slug: "power-bank-20000",
    sku: "PB-20K",
    brand: "Anker",
    category: "Accessories",
    barcode: "PB20K",
    subcategory: "Power",
    description: "20000mAh Power Bank",
    metaTitle: "Power Bank",
    metaDescription: "",
    keywords: "",
    aiPrompt: "",
    aiGeneratedDescription: "",
    sellingPrice: 45,
    costPrice: 20,
    quantity: 200,
    reservedQuantity: 0,
    minimumStockAlert: 50,
    amazonStatus: "Active",
    noonStatus: "Active",
    jumiaStatus: "Active",
    gallery: [],
    videos: [],
    listingUrls: {}
  }
];

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      products: initialProducts,
      orders: [],
      purchases: [],
      expenses: [],
      collections: [],

      addProduct: (product) => 
        set((state) => ({ products: [...state.products, product] })),

      updateProduct: (sku, updatedProduct) =>
        set((state) => ({
          products: state.products.map(p => p.sku === sku ? updatedProduct : p)
        })),

      addOrder: (order) => {
        set((state) => {
          // 1. Add the order
          const newOrders = [...state.orders, order];
          
          // 2. Deduct quantity from products
          const newProducts = state.products.map(product => {
            const orderItem = order.items.find(item => item.sku === product.sku);
            if (orderItem) {
              return {
                ...product,
                quantity: Math.max(0, product.quantity - orderItem.quantity)
              };
            }
            return product;
          });

          return { orders: newOrders, products: newProducts };
        });
      },

      updateOrderStatus: (id, status) => {
        set((state) => {
          const order = state.orders.find((o) => o.id === id);
          if (!order) return state;

          const oldStatus = order.status;
          if (oldStatus === status) return state; // No change, skip


          let newProducts = state.products;

          const activeStatuses = ["Pending", "Processing", "Shipped", "Delivered"];
          const returnStatuses = ["Returned", "ReturnedToSeller", "ReturningToSeller", "RejectedByBuyer"];
          const isOldActive = activeStatuses.includes(oldStatus);
          const isNewActive = activeStatuses.includes(status);
          const isOldReturned = returnStatuses.includes(oldStatus);
          
          let newReturnStatus = order.returnStatus;
          if (returnStatuses.includes(status) && (!order.returnStatus || order.returnStatus === "None")) {
            newReturnStatus = "Returned"; // Automatically add to returns page
          } else if (status === "Cancelled") {
             // If cancelled, it shouldn't be in returns
             newReturnStatus = "None";
          }

          const newOrders = state.orders.map((o) => (o.id === id ? { ...o, status, returnStatus: newReturnStatus } : o));

          // CASE 1: Active → Cancelled: restock
          if (isOldActive && status === "Cancelled") {
            newProducts = state.products.map((product) => {
              const orderItem = order.items.find((item) => item.sku === product.sku);
              if (orderItem) return { ...product, quantity: Number(product.quantity) + Number(orderItem.quantity || 0) };
              return product;
            });
          }
          // CASE 2: Cancelled → Active: deduct again
          else if (oldStatus === "Cancelled" && isNewActive) {
            newProducts = state.products.map((product) => {
              const orderItem = order.items.find((item) => item.sku === product.sku);
              if (orderItem) return { ...product, quantity: Math.max(0, Number(product.quantity) - Number(orderItem.quantity || 0)) };
              return product;
            });
          }
          // CASE 3: Active → any Return status: DO NOT auto-restock
          // Restock only happens via updateOrder when condition is set to Intact
          // CASE 4: Returned (Intact) → Active: deduct back (undoing restock)
          else if (isOldReturned && isNewActive && ({ reason: order.returnReason, condition: order.returnCondition, status: order.returnStatus, refundedAmount: order.refundAmount })?.condition === "Intact") {
            newProducts = state.products.map((product) => {
              const orderItem = order.items.find((item) => item.sku === product.sku);
              if (orderItem) return { ...product, quantity: Math.max(0, Number(product.quantity) - Number(orderItem.quantity || 0)) };
              return product;
            });
          }

          return { orders: newOrders, products: newProducts };
        });
      },
      updateOrderFinancialStatus: (id, financialStatus) => {
        set((state) => ({
          orders: state.orders.map((o) => (o.id === id ? { ...o, financialStatus } : o)),
        }));
      },

      deleteOrder: (id) => {
        set((state) => {
          const order = state.orders.find((o) => o.id === id);
          if (!order) return state;

          const newOrders = state.orders.filter((o) => o.id !== id);
          let newProducts = state.products;

          const activeStatuses = ["Pending", "Processing", "Shipped", "Delivered"];
          const returnStatuses = ["Returned", "ReturnedToSeller", "ReturningToSeller", "RejectedByBuyer"];

          // CASE A: Active order → restock on delete
          if (activeStatuses.includes(order.status)) {
            newProducts = state.products.map((product) => {
              const orderItem = order.items.find((item) => item.sku === product.sku);
              if (orderItem) return { ...product, quantity: product.quantity + orderItem.quantity };
              return product;
            });
          }
          // CASE B: Returned+Intact order → stock was already added back; deduct on delete to avoid double-restock
          else if (returnStatuses.includes(order.status) && ({ reason: order.returnReason, condition: order.returnCondition, status: order.returnStatus, refundedAmount: order.refundAmount })?.condition === "Intact") {
            newProducts = state.products.map((product) => {
              const orderItem = order.items.find((item) => item.sku === product.sku);
              if (orderItem) return { ...product, quantity: Math.max(0, product.quantity - orderItem.quantity) };
              return product;
            });
          }
          // CASE C: Cancelled or Returned+Damaged → no stock change needed

          return { orders: newOrders, products: newProducts };
        });
      },

      updateOrder: (id, updatedOrder) => {
        set((state) => {
          const oldOrder = state.orders.find((o) => o.id === id);
          if (!oldOrder) return state;

          let newProducts = state.products;

          const activeStatuses = ["Pending", "Processing", "Shipped", "Delivered"];
          const returnStatuses = ["Returned", "ReturnedToSeller", "ReturningToSeller", "RejectedByBuyer"];

          const oldStatus = oldOrder.status;
          const newStatus = updatedOrder.status ?? oldStatus;
          const oldCondition = oldOrder.returnDetails?.condition;
          const newCondition = updatedOrder.returnDetails?.condition ?? oldCondition;

          const wasActive = activeStatuses.includes(oldStatus);
          const isNowActive = activeStatuses.includes(newStatus);
          const wasReturned = returnStatuses.includes(oldStatus);
          const isNowReturned = returnStatuses.includes(newStatus);
          const wasCancelled = oldStatus === "Cancelled";
          const isNowCancelled = newStatus === "Cancelled";
          const wasIntact = oldCondition === "Intact";
          const isNowIntact = newCondition === "Intact";

          // CASE 1: Active → Returned + Intact: restock
          if (wasActive && isNowReturned && isNowIntact) {
            newProducts = state.products.map((p) => {
              const item = oldOrder.items.find((i) => i.sku === p.sku);
              if (item) return { ...p, quantity: Number(p.quantity) + Number(item.orderedQuantity || item.receivedQuantity || item.quantity || 0) };
              return p;
            });
          }
          // CASE 2: Active → Cancelled: restock
          else if (wasActive && isNowCancelled) {
            newProducts = state.products.map((p) => {
              const item = oldOrder.items.find((i) => i.sku === p.sku);
              if (item) return { ...p, quantity: Number(p.quantity) + Number(item.orderedQuantity || item.receivedQuantity || item.quantity || 0) };
              return p;
            });
          }
          // CASE 3: Returned+Intact → Active: deduct back
          else if (wasReturned && wasIntact && isNowActive) {
            newProducts = state.products.map((p) => {
              const item = oldOrder.items.find((i) => i.sku === p.sku);
              if (item) return { ...p, quantity: Math.max(0, Number(p.quantity) - Number(item.orderedQuantity || item.receivedQuantity || item.quantity || 0)) };
              return p;
            });
          }
          // CASE 4: Cancelled → Active: deduct back
          else if (wasCancelled && isNowActive) {
            newProducts = state.products.map((p) => {
              const item = oldOrder.items.find((i) => i.sku === p.sku);
              if (item) return { ...p, quantity: Math.max(0, Number(p.quantity) - Number(item.orderedQuantity || item.receivedQuantity || item.quantity || 0)) };
              return p;
            });
          }
          // CASE 5: Same status (Returned), condition changes Damaged/Unknown → Intact: restock
          else if (wasReturned && isNowReturned && !wasIntact && isNowIntact) {
            newProducts = state.products.map((p) => {
              const item = oldOrder.items.find((i) => i.sku === p.sku);
              if (item) return { ...p, quantity: Number(p.quantity) + Number(item.orderedQuantity || item.receivedQuantity || item.quantity || 0) };
              return p;
            });
          }
          // CASE 6: Same status (Returned), condition changes Intact → Damaged/Unknown: deduct back
          else if (wasReturned && isNowReturned && wasIntact && !isNowIntact) {
            newProducts = state.products.map((p) => {
              const item = oldOrder.items.find((i) => i.sku === p.sku);
              if (item) return { ...p, quantity: Math.max(0, Number(p.quantity) - Number(item.orderedQuantity || item.receivedQuantity || item.quantity || 0)) };
              return p;
            });
          }
          // CASE 7: Active → Returned + Damaged/Unknown: NO restock (item is lost)
          // (no code needed — newProducts stays unchanged)

          const newOrders = state.orders.map((o) => (o.id === id ? { ...o, ...updatedOrder } : o));
          return { orders: newOrders, products: newProducts };
        });
      },

      // Purchases in this store are a display cache only. Stock and WAC are changed atomically in
      // Firestore by PurchaseService (features/purchases), never here.
      addPurchase: (purchase) => {
        set((state) => ({ purchases: [...state.purchases, purchase] }));
      },

      updatePurchase: (id, data) => {
        set((state) => ({
          purchases: state.purchases.map((p) => (p.id === id ? { ...p, ...data } : p)),
        }));
      },

      updatePurchaseStatus: (id, status) => {
        set((state) => ({
          purchases: state.purchases.map((p) => (p.id === id ? { ...p, status } : p)),
        }));
      },

      deletePurchase: (id) => {
        set((state) => ({ purchases: state.purchases.filter((p) => p.id !== id) }));
      },

      addExpense: (expense) => set((state) => ({ expenses: [...state.expenses, expense] })),
      updateExpense: (id, data) => set((state) => ({
        expenses: state.expenses.map(e => e.id === id ? { ...e, ...data } : e)
      })),
      deleteExpense: (id) => set((state) => ({
        expenses: state.expenses.filter(e => e.id !== id)
      })),

      addCollection: (collection) => set((state) => ({ collections: [...state.collections, collection] })),
      updateCollection: (id, data) => set((state) => ({
        collections: state.collections.map(c => c.id === id ? { ...c, ...data } : c)
      })),
      deleteCollection: (id) => set((state) => ({
        collections: state.collections.filter(c => c.id !== id)
      }))
    }),
    {
      name: 'hook-system-storage',
      // Ensure mock products are always seeded when the persisted products list is empty
      merge: (persistedState: any, currentState: AppState): AppState => {
        const merged = { ...currentState, ...persistedState };
        if (!merged.products || merged.products.length === 0) {
          merged.products = initialProducts;
        }
        return merged;
      },
    }
  )
);

