import { Schema, model } from 'mongoose';
import { imageSchema, seoSchema } from './common';

const collectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 100 },
    /** Small heading above the name on the collections page, e.g. "Tradition". */
    eyebrow: { type: String, default: '', maxlength: 40 },
    tagline: { type: String, default: '', maxlength: 160 },
    description: { type: String, default: '', maxlength: 2000 },
    image: { type: imageSchema },
    /** Wide photo for the collections page and the collection's own banner; falls back to the cover image. */
    banner: { type: imageSchema },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    demo: { type: Boolean, default: false },
    seo: { type: seoSchema, default: {} },
  },
  { timestamps: true },
);

collectionSchema.index({ slug: 1 }, { unique: true });
collectionSchema.index({ isActive: 1, isFeatured: -1, sortOrder: 1 });

export const Collection = model('Collection', collectionSchema);
