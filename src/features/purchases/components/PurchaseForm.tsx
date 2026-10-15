import React from "react";
import { useForm, useFieldArray, useWatch, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { v4 as uuidv4 } from "uuid";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PurchaseInput, PurchaseSchema } from "../schemas/purchase.schema";
import { useStore } from "@/shared/store/useStore";
import { useProducts, PRODUCT_QUERY_KEYS } from "@/features/products/hooks/useProducts";
import { PurchaseService } from "../services/purchase.service";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Purchase, PurchaseItem } from "../types/purchase.types";
import { Trash2, Plus } from "lucide-react";

interface PurchaseFormProps {
  initialData?: Purchase;
  onSuccess: () => void;
}

const round2 = (n: number) => Number(n.toFixed(2));

const inputCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground";

export function PurchaseForm({ initialData, onSuccess }: PurchaseFormProps) {
  const { t } = useTranslation();
  const addPurchase = useStore(state => state.addPurchase);
  const updatePurchase = useStore(state => state.updatePurchase);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const currency = t("orders.currency");
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Real products from Firebase
  const { data: products = [] } = useProducts();

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting }, setValue } =
    useForm<PurchaseInput>({
      resolver: zodResolver(PurchaseSchema) as Resolver<PurchaseInput>,
      defaultValues: initialData
        ? {
            supplierId: initialData.supplierId,
            supplierName: initialData.supplierName,
            status: initialData.status,
            paymentStatus: initialData.paymentStatus,
            purchaseDate: initialData.purchaseDate,
            items: initialData.items,
            subtotal: initialData.subtotal,
            shippingCost: initialData.shippingCost,
            tax: initialData.tax,
            otherExpenses: initialData.otherExpenses,
            totalCost: initialData.totalCost,
            amountPaid: initialData.amountPaid,
            balanceDue: initialData.balanceDue,
          }
        : {
            supplierId: "",
            supplierName: "",
            status: "Pending",
            paymentStatus: "Unpaid",
            purchaseDate: Date.now(),
            items: [{ productId: "", sku: "", name: "", orderedQuantity: 1, receivedQuantity: 0, unitCost: 0 }],
            subtotal: 0,
            shippingCost: 0,
            tax: 0,
            otherExpenses: 0,
            totalCost: 0,
            amountPaid: 0,
            balanceDue: 0,
          },
    });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const watchedItems = useWatch({ control, name: "items" }) || [];
  const shippingCost = Number(useWatch({ control, name: "shippingCost" })) || 0;
  const tax = Number(useWatch({ control, name: "tax" })) || 0;
  const otherExpenses = Number(useWatch({ control, name: "otherExpenses" })) || 0;
  const amountPaid = Number(useWatch({ control, name: "amountPaid" })) || 0;
  const watchedStatus = useWatch({ control, name: "status" });

  // Totals are derived during render so they always reflect the latest qty / unit cost.
  // `|| 0` guards NaN coming from empty number inputs (valueAsNumber).
  const itemsSubtotal = round2(
    watchedItems.reduce((acc, item) => acc + (Number(item?.orderedQuantity) || 0) * (Number(item?.unitCost) || 0), 0),
  );
  const totalCost = round2(itemsSubtotal + shippingCost + tax + otherExpenses);
  const balanceDue = round2(totalCost - amountPaid);
  const totalUnits = watchedItems.reduce((acc, item) => acc + (Number(item?.orderedQuantity) || 0), 0);

  // Keep the numbers in form state so the submit payload carries them.
  React.useEffect(() => {
    setValue("subtotal", itemsSubtotal);
    setValue("totalCost", totalCost);
    setValue("balanceDue", balanceDue);
  }, [itemsSubtotal, totalCost, balanceDue, setValue]);

  // Search/dropdown state for each row
  const [openDropdownIndex, setOpenDropdownIndex] = React.useState<number | null>(null);
  const [productSearch, setProductSearch] = React.useState<Record<number, string>>({});
  
  // Initialize product search terms on load
  React.useEffect(() => {
    if (products.length > 0 && watchedItems.length > 0) {
      const initialSearches: Record<number, string> = {};
      watchedItems.forEach((item, index) => {
        if (item.sku) {
          const p = products.find(p => p.sku === item.sku);
          if (p) initialSearches[index] = `${p.productName} (${p.sku})`;
        }
      });
      setProductSearch(prev => Object.keys(prev).length === 0 ? initialSearches : prev);
    }
  }, [products]); // Only run when products load initially

  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownIndex(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectProduct = (index: number, p: (typeof products)[0]) => {
    const opts = { shouldDirty: true, shouldValidate: true };
    setValue(`items.${index}.productId`, p.id, opts);
    setValue(`items.${index}.sku`, p.sku, opts);
    setValue(`items.${index}.name`, p.productName, opts);
    setValue(`items.${index}.unitCost`, p.costPrice || 0, opts);
    setProductSearch(prev => ({ ...prev, [index]: `${p.productName} (${p.sku})` }));
    setOpenDropdownIndex(null);
  };

  // ── SUBMIT ─────────────────────────────────────────────────────────────
  const onSubmit = async (data: PurchaseInput) => {
    if (!user) return;
    setSubmitError(null);
    const actor = { userId: user.uid, userDisplayName: user.displayName ?? "System" };
    const now = Date.now();

    const items: PurchaseItem[] = data.items.map((i) => ({
      id: i.id || uuidv4(),
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      orderedQuantity: Number(i.orderedQuantity) || 0,
      receivedQuantity: Number(i.receivedQuantity) || 0,
      unitCost: Number(i.unitCost) || 0,
    }));

    // Recompute totals from the items so a stale form value can never be persisted.
    const subtotal = round2(items.reduce((acc, i) => acc + i.orderedQuantity * i.unitCost, 0));
    const shipping = Number(data.shippingCost) || 0;
    const taxValue = Number(data.tax) || 0;
    const other = Number(data.otherExpenses) || 0;
    const paid = Number(data.amountPaid) || 0;
    const total = round2(subtotal + shipping + taxValue + other);

    const base: Purchase = {
      ...data,
      id: initialData?.id ?? uuidv4(),
      items,
      subtotal,
      shippingCost: shipping,
      tax: taxValue,
      otherExpenses: other,
      totalCost: total,
      amountPaid: paid,
      balanceDue: round2(total - paid),
      createdAt: initialData?.createdAt ?? now,
      createdBy: initialData?.createdBy ?? user.uid,
      updatedAt: now,
      updatedBy: user.uid,
    };

    try {
      const saved = initialData
        ? await PurchaseService.updatePurchaseAtomic(base, actor)
        : await PurchaseService.createPurchaseAtomic(base, actor);

      // The purchases list reads from the local store (display cache); mirror the saved doc.
      if (initialData) updatePurchase(saved.id, saved);
      else addPurchase(saved);

      queryClient.invalidateQueries({ queryKey: PRODUCT_QUERY_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ["inventoryMovements"] });
      onSuccess();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t("purchases.form.saveFailed"));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-lg font-semibold border-b pb-2">
          {initialData ? t("purchases.form.editTitle") : t("purchases.form.createTitle")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t("purchases.form.supplierName")}</label>
            <input
              {...register("supplierName")}
              className={inputCls}
              placeholder={t("purchases.form.supplierPlaceholder")}
            />
            {errors.supplierName && <span className="text-xs text-destructive">{errors.supplierName.message}</span>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("purchases.form.purchaseDate")}</label>
            <input
              type="date"
              value={new Date(watch("purchaseDate") || Date.now()).toISOString().substring(0,10)}
              onChange={(e) => setValue("purchaseDate", new Date(e.target.value).getTime())}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("purchases.form.status")}</label>
            <select {...register("status")} className={inputCls}>
              <option value="Draft">📝 Draft</option>
              <option value="Pending">⏳ {t("purchases.statuses.Pending")}</option>
              <option value="PartiallyReceived">📦 Partially Received</option>
              <option value="Received">✅ {t("purchases.statuses.Received")}</option>
              <option value="Cancelled">❌ {t("purchases.statuses.Cancelled")}</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {watchedStatus === "Received"
                ? t("purchases.form.receivedHint")
                : t("purchases.form.notReceivedHint")}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="text-lg font-semibold">{t("purchases.form.productDetails")}</h3>
          <button
            type="button"
            onClick={() => append({ productId: "", sku: "", name: "", orderedQuantity: 1, receivedQuantity: 0, unitCost: 0 })}
            className="flex items-center gap-1 text-sm bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 rounded-md transition-colors"
          >
            <Plus size={16} />
            {t("purchases.form.addItem")}
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

            return (
              <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start bg-secondary/5 p-4 rounded-lg border">
                
                <div className="md:col-span-5 relative">
                  <label className="block text-sm font-medium mb-1">{t("purchases.form.product")} {index + 1}</label>
                  <input
                    type="text"
                    value={currentSearch}
                    placeholder={t("purchases.form.searchProduct")}
                    onChange={(e) => { 
                      setProductSearch(prev => ({ ...prev, [index]: e.target.value })); 
                      setOpenDropdownIndex(index); 
                    }}
                    onFocus={() => setOpenDropdownIndex(index)}
                    className={inputCls}
                    autoComplete="off"
                  />
                  {openDropdownIndex === index && (
                    <div className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-md border bg-popover shadow-lg">
                      {filteredProducts.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No products found</div>
                      ) : (
                        filteredProducts.map(p => (
                          <button
                            key={p.sku}
                            type="button"
                            onClick={() => handleSelectProduct(index, p)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex justify-between items-center"
                          >
                            <span className="font-medium">{p.productName}</span>
                            <span className="text-xs text-muted-foreground ml-2 font-mono">
                              {p.sku} · Stock: {p.quantity}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  <input type="hidden" {...register(`items.${index}.productId`)} />
                  <input type="hidden" {...register(`items.${index}.sku`)} />
                  <input type="hidden" {...register(`items.${index}.name`)} />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-sm font-medium mb-1">{t("purchases.form.quantity")}</label>
                  <input
                    type="number"
                    min={1}
                    {...register(`items.${index}.orderedQuantity`, { valueAsNumber: true })}
                    className={inputCls}
                  />
                  {errors.items?.[index]?.orderedQuantity && <span className="text-xs text-destructive">{errors.items[index].orderedQuantity.message}</span>}
                </div>

                <div className="md:col-span-3">
                  <label className="block text-sm font-medium mb-1">{t("purchases.form.unitCost")}</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    {...register(`items.${index}.unitCost`, { valueAsNumber: true })}
                    className={inputCls}
                  />
                </div>

                <div className="md:col-span-1 flex items-end justify-center pb-2 h-full">
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold border-b pb-2">{t("purchases.form.financials")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-3 p-4 bg-secondary/10 rounded-lg border">
            <h4 className="font-medium">{t("purchases.form.additionalExpenses")}</h4>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("purchases.form.shippingFreight")}</label>
              <input type="number" step="0.01" min={0} {...register("shippingCost", { valueAsNumber: true })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Tax</label>
              <input type="number" step="0.01" min={0} {...register("tax", { valueAsNumber: true })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">{t("purchases.form.otherCustoms")}</label>
              <input type="number" step="0.01" min={0} {...register("otherExpenses", { valueAsNumber: true })} className={inputCls} />
            </div>
          </div>

          <div className="md:col-span-2 flex flex-col justify-center p-6 bg-primary/5 rounded-lg border border-primary/20 gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("purchases.form.itemsTotal", { count: totalUnits })}</span>
              <span className="font-medium">{itemsSubtotal.toFixed(2)} {currency}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("purchases.form.shipping")}</span>
              <span className="font-medium">{shippingCost.toFixed(2)} {currency}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("purchases.form.taxAndOther")}</span>
              <span className="font-medium">{(tax + otherExpenses).toFixed(2)} {currency}</span>
            </div>
            <div className="flex justify-between items-end border-t border-primary/20 pt-3">
              <span className="text-sm text-muted-foreground">{t("purchases.form.totalPurchaseCost")}</span>
              <span className="text-4xl font-bold tracking-tight text-primary">{totalCost.toFixed(2)} {currency}</span>
            </div>
          </div>
        </div>
      </section>

      {submitError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <button type="button" onClick={onSuccess}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 px-4">
          {t("purchases.form.cancel")}
        </button>
        <button type="submit" disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 disabled:opacity-50">
          {isSubmitting ? t("purchases.form.saving") : initialData ? t("purchases.form.update") : t("purchases.form.save")}
        </button>
      </div>
    </form>
  );
}
