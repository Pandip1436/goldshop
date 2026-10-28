import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import {
  MAKING_CHARGE_TYPES,
  PRICING_MODES,
  PURITY_KEYS,
  type ImageRef,
  type MakingChargeType,
  type PricingMode,
  type PurityKey,
} from '@goldshop/shared';
import { imageSchema, seoSchema } from './common';

export interface IVariant {
  _id: Types.ObjectId;
  sku: string;
  label: string;
  attributes: Record<string, string>;
  /** Net metal weight in milligrams (used for pricing). */
  netWeightMg: number;
  /** Gross weight including stones, in milligrams (informational). */
  grossWeightMg: number;
  /** Stone / diamond charges in paise. */
  stoneCharge: number;
  /** Price in paise for fixed-price products (GST inclusive). */
  fixedPrice: number;
  /** Optional genuine previous price for fixed-price products. */
  compareAtPrice: number;
  stock: number;
  isActive: boolean;
  /** Current computed price in paise; refreshed whenever rates or the product change. */
  priceCache: number;
}

export interface IProduct {
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  category: Types.ObjectId;
  /** Category and all of its ancestors, so a parent category lists its children's products. */
  categoryPath: Types.ObjectId[];
  collections: Types.ObjectId[];
  tags: string[];
  purity?: PurityKey;
  pricingMode: PricingMode;
  making: { type: MakingChargeType; value: number };
  makingDiscountPercent: number;
  variants: Types.DocumentArray<IVariant & Types.Subdocument>;
  optionNames: string[];
  specs: { label: string; value: string }[];
  images: ImageRef[];
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  soldCount: number;
  ratingAvg: number;
  ratingCount: number;
  minPrice: number;
  maxPrice: number;
  inStock: boolean;
  totalStock: number;
  seo?: { title?: string; description?: string };
  demo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<IVariant>({
  sku: { type: String, required: true, trim: true, maxlength: 60 },
  label: { type: String, default: 'Standard', trim: true, maxlength: 60 },
  attributes: { type: Schema.Types.Mixed, default: {} },
  netWeightMg: { type: Number, default: 0, min: 0 },
  grossWeightMg: { type: Number, default: 0, min: 0 },
  stoneCharge: { type: Number, default: 0, min: 0 },
  fixedPrice: { type: Number, default: 0, min: 0 },
  compareAtPrice: { type: Number, default: 0, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  priceCache: { type: Number, default: 0 },
});

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 160 },
    shortDescription: { type: String, default: '', maxlength: 400 },
    description: { type: String, default: '', maxlength: 8000 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryPath: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    collections: { type: [{ type: Schema.Types.ObjectId, ref: 'Collection' }], default: [] },
    tags: { type: [String], default: [] },
    purity: { type: String, enum: PURITY_KEYS },
    pricingMode: { type: String, enum: PRICING_MODES, default: 'weight' },
    making: {
      type: { type: String, enum: MAKING_CHARGE_TYPES, default: 'percent' },
      value: { type: Number, default: 0, min: 0 },
    },
    makingDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
    variants: { type: [variantSchema], default: [] },
    optionNames: { type: [String], default: [] },
    specs: { type: [{ label: String, value: String, _id: false }], default: [] },
    images: { type: [imageSchema], default: [] },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    minPrice: { type: Number, default: 0 },
    maxPrice: { type: Number, default: 0 },
    inStock: { type: Boolean, default: false },
    totalStock: { type: Number, default: 0 },
    seo: { type: seoSchema, default: {} },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ 'variants.sku': 1 }, { unique: true, sparse: true });
productSchema.index({ isActive: 1, categoryPath: 1, minPrice: 1 });
productSchema.index({ isActive: 1, collections: 1 });
productSchema.index({ isActive: 1, isFeatured: -1, sortOrder: 1 });
productSchema.index({ isActive: 1, soldCount: -1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ isActive: 1, inStock: 1, totalStock: 1 });
productSchema.index(
  { name: 'text', tags: 'text', shortDescription: 'text', description: 'text' },
  { weights: { name: 10, tags: 6, shortDescription: 3, description: 1 }, name: 'product_text' },
);

export type ProductDoc = HydratedDocument<IProduct>;
export const Product = model<IProduct>('Product', productSchema);
