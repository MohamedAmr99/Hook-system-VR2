import { z } from "zod";

export const marketplaceStatusSchema = z.enum([
  "Active",
  "Inactive",
  "Pending",
  "Suspended",
]);

export const marketplaceUrlsSchema = z.object({
  amazon: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  noon: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  jumia: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
});

export const productSchema = z.object({
  productName: z
    .string()
    .min(2, "Product name must be at least 2 characters")
    .max(100, "Product name cannot exceed 100 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(
      /^[a-z0-9-_]+$/,
      "Slug must only contain lowercase letters, numbers, hyphens, and underscores",
    ),
  sku: z
    .string()
    .min(3, "SKU must be at least 3 characters")
    .max(30, "SKU is too long"),
  barcode: z.string().optional().default(""),
  brand: z.string().min(1, "Brand is required"),
  category: z.string().min(1, "Category is required"),
  subcategory: z.string().optional().default(""),
  description: z.string().optional().default(""),

  // Pricing
  sellingPrice: z.coerce.number().min(0, "Selling price must be non-negative"),
  costPrice: z.coerce.number().min(0, "Cost price must be non-negative").default(0),

  // Inventory
  quantity: z.coerce
    .number()
    .int("Quantity must be an integer")
    .min(0, "Quantity cannot be negative"),
  reservedQuantity: z.coerce
    .number()
    .int("Reserved quantity must be an integer")
    .min(0, "Reserved quantity cannot be negative")
    .default(0),
  unavailableQuantity: z.coerce
    .number()
    .int("Unavailable quantity must be an integer")
    .min(0, "Unavailable quantity cannot be negative")
    .optional(),
  minimumStockAlert: z.coerce
    .number()
    .int("Stock alert must be an integer")
    .min(0, "Stock alert cannot be negative")
    .default(5),

  // Marketplace Statuses
  amazonStatus: marketplaceStatusSchema.default("Inactive"),
  noonStatus: marketplaceStatusSchema.default("Inactive"),
  jumiaStatus: marketplaceStatusSchema.default("Inactive"),
  listingUrls: marketplaceUrlsSchema.default({}),

  // SEO
  metaTitle: z
    .string()
    .max(70, "Meta title should be under 70 characters")
    .optional()
    .default(""),
  metaDescription: z
    .string()
    .max(160, "Meta description should be under 160 characters")
    .optional()
    .default(""),
  keywords: z.string().optional().default(""),

  // AI
  aiPrompt: z.string().optional().default(""),
  aiGeneratedDescription: z.string().optional().default(""),

  // Media
  thumbnail: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  gallery: z.array(z.string().url("Must be a valid URL")).default([]),
  videos: z.array(z.string().url("Must be a valid URL")).default([]),
});

export type ProductFormValues = z.infer<typeof productSchema>;
