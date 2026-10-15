import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { v4 as uuidv4 } from "uuid";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OrderInput, OrderSchema } from "../schemas/order.schema";
import { useStore } from "@/shared/store/useStore";
import { useProducts, PRODUCT_QUERY_KEYS } from "@/features/products/hooks/useProducts";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Order, OrderStatus } from "../types/order.types";
import { usePlatforms } from "@/features/platforms/hooks/usePlatforms";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { createOrderAtomic, updateOrderAtomic } from "../services/inventory.service";
import { useReturns } from "@/features/returns/hooks/useReturns";
import { orderHasReturn } from "@/shared/utils/orderCalculations";

interface OrderFormProps {
  initialData?: Order;
  onSuccess: () => void;
}

const ORDER_STATUSES: OrderStatus[] = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];

const inputCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground";
const smallInputCls = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function OrderForm({ initialData, onSuccess }: OrderFormProps) {
  const { t } = useTranslation();
  const addOrder = useStore(state => state.addOrder);
  const updateOrder = useStore(state => state.updateOrder);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  
  const { data: products = [], isLoading: isLoadingProducts } = useProducts();
  const { data: platforms = [] } = usePlatforms();
  const { returns } = useReturns();
  // Status of an order with a return is locked (also enforced server-side by updateOrderAtomic).
  const statusLocked = Boolean(initialData && orderHasReturn(initialData, returns));
  
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [openDropdowns, setOpenDropdowns] = useState<Record<number, boolean>>({});
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdowns({});
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { register, handleSubmit, watch, formState: { errors }, setValue, control } = useForm<OrderInput>({
    resolver: zodResolver(OrderSchema) as any,
    defaultValues: initialData ? {
      platform: initialData.platform,
      platformOrderId: initialData.platformOrderId,
      status: initialData.status,
      paymentStatus: initialData.paymentStatus,
      financialStatus: initialData.financialStatus,
      returnStatus: initialData.returnStatus,
      orderDate: initialData.orderDate,
      items: initialData.items,
      subtotal: initialData.subtotal,
      discountTotal: initialData.discountTotal,
      taxTotal: initialData.taxTotal,
      shippingCollected: initialData.shippingCollected,
      totalRevenue: initialData.totalRevenue,
      totalCogs: initialData.totalCogs,
      grossProfit: initialData.grossProfit,
      sellingFees: initialData.sellingFees,
      fulfillmentFees: initialData.fulfillmentFees,
      otherFees: initialData.otherFees,
      netPayoutExpected: initialData.netPayoutExpected,
      settlementId: initialData.settlementId || "",
      paidAmount: initialData.paidAmount !== undefined ? initialData.paidAmount : (initialData.paymentStatus === "Paid" ? initialData.totalRevenue : 0),
      refundedAmount: initialData.refundedAmount !== undefined ? initialData.refundedAmount : 0,
      netCollectedAmount: initialData.netCollectedAmount !== undefined ? initialData.netCollectedAmount : ((initialData.paidAmount || (initialData.paymentStatus === "Paid" ? initialData.totalRevenue : 0)) - (initialData.refundedAmount || 0)),
    } : {
      platformOrderId: "",
      platform: "",
      status: "Pending",
      paymentStatus: "Unpaid",
      financialStatus: "Unsettled",
      returnStatus: "None",
      orderDate: Date.now(),
      items: [{ productId: "", sku: "", name: "", quantity: 1, unitPrice: 0, unitCogs: 0, discount: 0, tax: 0 }],
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      shippingCollected: 0,
      totalRevenue: 0,
      totalCogs: 0,
      grossProfit: 0,
      sellingFees: 0,
      fulfillmentFees: 0,
      otherFees: 0,
      netPayoutExpected: 0,
      settlementId: "",
      paidAmount: 0,
      refundedAmount: 0,
      netCollectedAmount: 0,
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items"
  });

  const subtotal   = watch("subtotal")   || 0;
  const discountTotal = watch("discountTotal") || 0;
  const taxTotal     = watch("taxTotal")     || 0;
  const shippingCollected = watch("shippingCollected") || 0;
  
  const sellingFees    = watch("sellingFees")    || 0;
  const fulfillmentFees = watch("fulfillmentFees") || 0;
  const otherFees      = watch("otherFees")      || 0;
  const selectedPlatform = watch("platform");
  const items          = watch("items");

  useEffect(() => {
    let totalSales = 0;
    let totalCogs = 0;
    let totalCommission = 0;

    const platformDoc = platforms.find(p => p.name === selectedPlatform || p.id === selectedPlatform);

    items.forEach((item, index) => {
      if (item.sku) {
        const product = products.find(p => p.sku === item.sku);
        if (product) {
          if (item.name !== product.productName) {
            setValue(`items.${index}.name`, product.productName);
            setProductSearch(prev => ({ ...prev, [index]: `${product.productName} (${product.sku})` }));
          }
          if (item.unitPrice === 0) {
             setValue(`items.${index}.unitPrice`, product.sellingPrice);
          }
          if (item.unitCogs === 0 && product.costPrice) {
             setValue(`items.${index}.unitCogs`, product.costPrice);
          }
          
          const qty = item.quantity || 1;
          const price = watch(`items.${index}.unitPrice`) || product.sellingPrice;
          const cogs = watch(`items.${index}.unitCogs`) || product.costPrice || 0;
          
          totalSales += (qty * price);
          totalCogs += (qty * cogs);

          if (platformDoc && product.category) {
             const platCat = platformDoc.categories.find(c => c.categoryName === product.category);
             if (platCat) {
                totalCommission += (qty * price * platCat.commissionRate) / 100;
             }
          }
        }
      }
    });

    setValue("subtotal", Number(totalSales.toFixed(2)));
    setValue("totalCogs", Number(totalCogs.toFixed(2)));
    setValue("sellingFees", Number(totalCommission.toFixed(2)));

  }, [JSON.stringify(items.map(i => `${i.sku}-${i.quantity}-${i.unitPrice}-${i.unitCogs}`)), selectedPlatform, platforms, products, setValue]);

  useEffect(() => {
    const revenue = Number(subtotal) - Number(discountTotal) + Number(taxTotal) + Number(shippingCollected);
    const deductions = Number(sellingFees) + Number(fulfillmentFees) + Number(otherFees);
    const net = revenue - deductions;
    
    setValue("totalRevenue", Number(revenue.toFixed(2)));
    setValue("grossProfit", Number((revenue - Number(watch("totalCogs") || 0)).toFixed(2)));
    setValue("netPayoutExpected", Number(net.toFixed(2)));
  }, [subtotal, discountTotal, taxTotal, shippingCollected, sellingFees, fulfillmentFees, otherFees, setValue, watch]);

  const currency = t("orders.currency", "EGP");

  // Helper to compute available stock and validation limits per item
  const getItemStockInfo = (index: number) => {
    const currentItem = items[index];
    if (!currentItem) return { available: 0, maxAllowed: 0, isOutOfStock: false, isOverStock: false };

    const selectedProd = products.find(p => p.id === currentItem.productId || p.sku === currentItem.sku);
    if (!selectedProd) return { available: 0, maxAllowed: 0, isOutOfStock: false, isOverStock: false };

    const baseAvailable =
      Number(selectedProd.quantity || 0) -
      Number(selectedProd.reservedQuantity || 0) -
      Number(selectedProd.unavailableQuantity || 0);

    const oldItem = initialData?.items?.find(i => i.productId === selectedProd.id || i.sku === selectedProd.sku);
    const oldQty = oldItem ? Number(oldItem.quantity || 0) : 0;

    const maxAllowed = Math.max(0, baseAvailable) + oldQty;
    const requestedQty = Number(currentItem.quantity || 0);

    return {
      available: Math.max(0, baseAvailable),
      maxAllowed,
      isOutOfStock: maxAllowed <= 0,
      isOverStock: requestedQty > maxAllowed,
      productName: selectedProd.productName,
    };
  };

  // Check if entire form has any overstock violations
  const hasAnyStockError = items.some((_, idx) => {
    const info = getItemStockInfo(idx);
    return info.isOverStock || (info.isOutOfStock && Number(items[idx]?.quantity || 0) > 0);
  });

  const onSubmit = async (data: OrderInput) => {
    // 1. Client-Side Stock Validation Check
    for (let i = 0; i < data.items.length; i++) {
      const info = getItemStockInfo(i);
      const qty = Number(data.items[i].quantity || 0);
      if (qty > info.maxAllowed) {
        toast.error(
          `المخزون المتاح لا يكفي للمنتج "${info.productName || data.items[i].name}". المتاح: ${info.maxAllowed}، المطلوب: ${qty}`
        );
        return;
      }
    }

    const platName = platforms.find(p => p.id === data.platform)?.name || data.platform;
    const paid = Number(data.paidAmount ?? (data.paymentStatus === "Paid" ? data.totalRevenue : 0));
    const refunded = Number(data.refundedAmount ?? 0);
    const netCollected = paid - refunded;

    const finalData = {
      ...data,
      platform: platName,
      paidAmount: paid,
      refundedAmount: refunded,
      netCollectedAmount: netCollected,
    };

    setIsSubmittingForm(true);

    try {
      if (initialData) {
        const updatedOrderFull: Order = {
          ...initialData,
          ...finalData,
          items: finalData.items.map((i, idx) => ({
            ...i,
            id: (i as any).id || initialData.items[idx]?.id || uuidv4(),
          })),
          updatedAt: Date.now(),
          updatedBy: user?.uid || "",
        };

        if (user) {
          await updateOrderAtomic({
            oldOrder: initialData,
            updatedOrder: updatedOrderFull,
            userId: user.uid,
            userDisplayName: user.displayName ?? "System",
          });
        }

        updateOrder(initialData.id, updatedOrderFull);
        toast.success("تم تحديث الطلب والمخزون بنجاح");
      } else {
        const newOrder: Order = {
          ...finalData,
          id: uuidv4(),
          items: finalData.items.map(i => ({ ...i, id: uuidv4() })),
          stockState: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: user?.uid || "",
          updatedBy: user?.uid || "",
        };

        if (user) {
          await createOrderAtomic({
            order: newOrder,
            userId: user.uid,
            userDisplayName: user.displayName ?? "System",
          });
        }

        addOrder(newOrder);
        toast.success("تم إنشاء الطلب وحجز المخزون بنجاح");
      }

      queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
      onSuccess();
    } catch (err: any) {
      console.error("Order submission failed:", err);
      toast.error(err?.message || "فشل حفظ الطلب، يرجى التحقق من المخزون والبيانات");
    } finally {
      setIsSubmittingForm(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-8">
      {/* 1. Order Info */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold border-b pb-2">{t("orders.form.orderInfo")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Platform Order ID */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("orders.form.platformOrderId")} <span className="text-destructive">*</span>
            </label>
            <input
              {...register("platformOrderId")}
              className={inputCls}
              placeholder="e.g. 408-1234567-1234567"
            />
            {errors.platformOrderId && (
              <span className="text-xs text-destructive">{errors.platformOrderId.message}</span>
            )}
          </div>

          {/* Platform */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("orders.form.platform")} <span className="text-destructive">*</span>
            </label>
            <select {...register("platform")} className={inputCls}>
              <option value="">{t("orders.form.selectPlatform")}</option>
              {platforms.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.platform && (
              <span className="text-xs text-destructive">{errors.platform.message}</span>
            )}
          </div>

          {/* Order Status */}
          <div>
            <label className="block text-sm font-medium mb-1">{t("orders.form.status")}</label>
            {statusLocked && initialData ? (
              // Not registered on purpose: the form keeps the default status value untouched.
              <>
                <select value={initialData.status} disabled className={inputCls}>
                  <option value={initialData.status}>{t(`orders.statuses.${initialData.status}`)}</option>
                </select>
                <span className="text-xs text-muted-foreground">{t("orders.statusLockedByReturn")}</span>
              </>
            ) : (
              <select {...register("status")} className={inputCls}>
                {ORDER_STATUSES.map(s => (
                  <option key={s} value={s}>{t(`orders.statuses.${s}`)}</option>
                ))}
              </select>
            )}
          </div>

          {/* Payment Status */}
          <div>
            <label className="block text-sm font-medium mb-1">حالة الدفع</label>
            <select {...register("paymentStatus")} className={inputCls}>
              <option value="Unpaid">في انتظار الدفع (Unpaid)</option>
              <option value="Paid">تم الدفع (Paid)</option>
              <option value="PartiallyRefunded">مسترد جزئياً (Partially Refunded)</option>
              <option value="Refunded">مسترد بالكامل (Refunded)</option>
            </select>
          </div>

          {/* Order Date */}
          <div>
            <label className="block text-sm font-medium mb-1">{t("orders.form.orderDate")}</label>
            <input
              type="date"
              className={inputCls}
              defaultValue={new Date().toISOString().split('T')[0]}
              onChange={(e) => {
                setValue("orderDate", new Date(e.target.value).getTime());
              }}
            />
          </div>
        </div>
      </section>

      {/* 2. Products */}
      <section className="space-y-4">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="text-lg font-semibold">{t("orders.form.productsSection")}</h3>
          <button
            type="button"
            onClick={() => append({ productId: "", sku: "", name: "", quantity: 1, unitPrice: 0, unitCogs: 0, discount: 0, tax: 0 })}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/80 h-8 px-3 rounded-md"
          >
            <Plus size={14} />
            {t("orders.form.addProduct")}
          </button>
        </div>
        
        <div className="space-y-4" ref={dropdownRef}>
          {fields.map((field, index) => {
             const currentSearch = productSearch[index] || "";
             const filteredProducts = products.filter(p => {
               if (!currentSearch) return true;
               const q = currentSearch.toLowerCase();
               return p.productName.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
             });

             const stockInfo = getItemStockInfo(index);

             return (
               <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start bg-secondary/5 p-4 rounded-lg border">
                 {/* Product Search */}
                 <div className="md:col-span-5 relative">
                   <label className="block text-sm font-medium mb-1">المنتج <span className="text-destructive">*</span></label>
                   <input
                     type="text"
                     className={inputCls}
                     placeholder={isLoadingProducts ? "جاري التحميل..." : "ابحث عن طريق الاسم أو SKU"}
                     value={currentSearch}
                     onChange={(e) => {
                       setProductSearch(prev => ({ ...prev, [index]: e.target.value }));
                       setOpenDropdowns(prev => ({ ...prev, [index]: true }));
                       if (e.target.value === "") setValue(`items.${index}.sku`, "");
                     }}
                     onFocus={() => setOpenDropdowns(prev => ({ ...prev, [index]: true }))}
                   />
                   
                   {openDropdowns[index] && (
                     <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
                       {filteredProducts.map(p => {
                         const pAvail = Math.max(0, Number(p.quantity || 0) - Number(p.reservedQuantity || 0) - Number(p.unavailableQuantity || 0));
                         const isOutOfStock = pAvail <= 0;

                         return (
                           <div 
                             key={p.sku}
                             className={`px-3 py-2 cursor-pointer text-sm flex justify-between items-center ${
                               isOutOfStock ? "bg-muted/40 hover:bg-muted/60 opacity-80" : "hover:bg-accent"
                             }`}
                             onClick={() => {
                               setValue(`items.${index}.productId`, p.id);
                               setValue(`items.${index}.sku`, p.sku, { shouldValidate: true });
                               setValue(`items.${index}.name`, p.productName);
                               setValue(`items.${index}.unitPrice`, p.sellingPrice);
                               setValue(`items.${index}.unitCogs`, p.costPrice || 0);
                               setProductSearch(prev => ({ ...prev, [index]: `${p.productName} (${p.sku})` }));
                               setOpenDropdowns(prev => ({ ...prev, [index]: false }));
                             }}
                           >
                             <div className="flex-1 min-w-0 pr-1">
                                <div className="font-medium text-foreground truncate">{p.productName}</div>
                                <div className="text-xs text-muted-foreground truncate">SKU: {p.sku}</div>
                              </div>
                             <span className={`text-xs px-2 py-0.5 rounded ${
                               isOutOfStock 
                                 ? "bg-destructive/10 text-destructive font-semibold" 
                                 : "bg-primary/10 text-primary font-medium"
                             }`}>
                               {pAvail} متاح
                             </span>
                           </div>
                         );
                       })}
                       {filteredProducts.length === 0 && (
                         <div className="px-3 py-2 text-sm text-muted-foreground">لا يوجد منتجات</div>
                       )}
                     </div>
                   )}
                   {errors.items?.[index]?.sku && (
                     <span className="text-xs text-destructive">{errors.items[index]?.sku?.message}</span>
                   )}
                   <input type="hidden" {...register(`items.${index}.productId`)} />
                 </div>

                 {/* Name (auto) */}
                 <div className="md:col-span-3">
                   <label className="block text-sm font-medium mb-1">الاسم (يملأ تلقائياً)</label>
                   <input
                     readOnly
                     {...register(`items.${index}.name` as const)}
                     className={`${inputCls} bg-muted cursor-not-allowed`}
                   />
                 </div>

                 {/* Quantity */}
                 <div className="md:col-span-2">
                   <div className="flex justify-between items-center mb-1">
                     <label className="block text-sm font-medium">الكمية</label>
                     {items[index]?.sku && (
                       <span className={`text-[11px] font-medium ${stockInfo.isOverStock ? "text-destructive" : "text-muted-foreground"}`}>
                         (المتاح: {stockInfo.maxAllowed})
                       </span>
                     )}
                   </div>
                   <input
                     type="number"
                     min={1}
                     {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                     className={`${inputCls} ${stockInfo.isOverStock ? "border-destructive focus-visible:ring-destructive" : ""}`}
                   />
                   {stockInfo.isOverStock && (
                     <div className="flex items-center gap-1 text-[11px] text-destructive font-medium mt-1">
                       <AlertCircle size={12} />
                       <span>تتجاوز المخزون المتاح ({stockInfo.maxAllowed})</span>
                     </div>
                   )}
                 </div>

                 {/* Unit Price */}
                 <div className="md:col-span-2">
                   <label className="block text-sm font-medium mb-1">سعر الوحدة ({currency})</label>
                   <div className="flex gap-2 items-center">
                     <input
                       type="number"
                       step="0.01"
                       {...register(`items.${index}.unitPrice` as const, { valueAsNumber: true })}
                       className={inputCls}
                     />
                     {fields.length > 1 && (
                       <button
                         type="button"
                         onClick={() => remove(index)}
                         className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md"
                       >
                         <Trash2 size={18} />
                       </button>
                     )}
                   </div>
                 </div>
               </div>
             );
          })}
        </div>
      </section>

      {/* 3. Financials */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold border-b pb-2">{t("orders.form.financialBreakdown")}</h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Customer Payments */}
          <div className="space-y-3 p-4 bg-secondary/5 rounded-lg border">
            <h4 className="font-medium text-sm text-primary">مدفوعات العميل</h4>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">المجموع الفرعي ({currency})</label>
              <input
                type="number"
                step="0.01"
                {...register("subtotal", { valueAsNumber: true })}
                className={smallInputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">شحن محصل ({currency})</label>
              <input
                type="number"
                step="0.01"
                {...register("shippingCollected", { valueAsNumber: true })}
                className={smallInputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">خصومات ({currency})</label>
              <input
                type="number"
                step="0.01"
                {...register("discountTotal", { valueAsNumber: true })}
                className={smallInputCls}
              />
            </div>
          </div>

          {/* Platform Fees */}
          <div className="space-y-3 p-4 bg-secondary/5 rounded-lg border">
            <h4 className="font-medium text-sm text-destructive">رسوم المنصة والتكاليف</h4>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">عمولة البيع ({currency})</label>
              <input
                type="number"
                step="0.01"
                {...register("sellingFees", { valueAsNumber: true })}
                className={smallInputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">رسوم التخزين/الشحن FBA ({currency})</label>
              <input
                type="number"
                step="0.01"
                {...register("fulfillmentFees", { valueAsNumber: true })}
                className={smallInputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">رسوم أخرى ({currency})</label>
              <input
                type="number"
                step="0.01"
                {...register("otherFees", { valueAsNumber: true })}
                className={smallInputCls}
              />
            </div>
          </div>

          {/* Collections & Payments */}
          <div className="space-y-3 p-4 bg-secondary/5 rounded-lg border">
            <h4 className="font-medium text-sm text-blue-600 dark:text-blue-400">التحصيل والمدفوعات</h4>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                المبلغ المحصل فعلياً ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                {...register("paidAmount", { valueAsNumber: true })}
                className={smallInputCls}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                المبلغ المسترد للعميل ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                {...register("refundedAmount", { valueAsNumber: true })}
                className={smallInputCls}
                placeholder="0.00"
              />
            </div>
            <div className="pt-1">
              <span className="block text-[11px] text-muted-foreground">صافي المحصل:</span>
              <span className="text-sm font-bold text-foreground">
                {((watch("paidAmount") || 0) - (watch("refundedAmount") || 0)).toFixed(2)} {currency}
              </span>
            </div>
          </div>

          {/* Payout & Net Profit */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center justify-center p-3 bg-secondary/10 rounded-lg border">
              <h4 className="text-xs font-medium text-muted-foreground mb-0.5">صافي التحويل (Payout)</h4>
              <div className={`text-lg font-bold ${watch("netPayoutExpected") >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                {watch("netPayoutExpected").toFixed(2)} {currency}
              </div>
              <p className="text-[9px] text-center text-muted-foreground mt-0.5">
                الإيرادات - العمولة والرسوم
              </p>
            </div>
            {(() => {
              const netProf = watch("netPayoutExpected") - watch("totalCogs");
              const totalRev = watch("totalRevenue") || watch("subtotal") || 0;
              const marginPct = totalRev > 0 ? (netProf / totalRev) * 100 : 0;
              return (
                <div className="flex flex-col items-center justify-center p-3 bg-primary/10 rounded-lg border border-primary/20">
                  <h4 className="text-xs font-medium text-primary mb-0.5">صافي الربح (Net Profit)</h4>
                  <div className={`text-xl font-bold ${netProf >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                    {netProf.toFixed(2)} {currency}
                  </div>
                  <div className={`text-[11px] font-semibold mt-1 px-2.5 py-0.5 rounded-full ${marginPct >= 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "bg-destructive/15 text-destructive border border-destructive/20"}`}>
                    متوقع الربح: {marginPct.toFixed(1)}% من سعر أمر الشراء
                  </div>
                  <p className="text-[9px] text-center text-muted-foreground mt-1">
                    صافي التحويل - تكلفة المنتج (COGS)
                  </p>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <button
          type="button"
          onClick={onSuccess}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
        >
          {t("orders.form.cancel", "إلغاء")}
        </button>
        <button
          type="submit"
          disabled={isSubmittingForm || hasAnyStockError}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 disabled:opacity-50"
        >
          {isSubmittingForm ? t("orders.form.saving", "جاري الحفظ...") : t("orders.form.save", "حفظ")}
        </button>
      </div>
    </form>
  );
}
