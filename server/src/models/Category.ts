import { Schema, model, type InferSchemaType } from 'mongoose';
import { imageSchema, seoSchema } from './common';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 100 },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, default: '', maxlength: 1000 },
    image: { type: imageSchema },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    demo: { type: Boolean, default: false },
    seo: { type: seoSchema, default: {} },
  },
  { timestamps: true },
);

categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ parent: 1, sortOrder: 1 });

export type CategoryShape = InferSchemaType<typeof categorySchema>;
export const Category = model('Category', categorySchema);
