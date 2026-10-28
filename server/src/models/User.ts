import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from 'mongoose';
import { ROLES } from '@goldshop/shared';
import { addressFields } from './common';

const savedAddressSchema = new Schema(
  {
    ...addressFields,
    label: { type: String, default: 'Home', maxlength: 30 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, default: '', trim: true, maxlength: 15 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'customer', index: true },
    isActive: { type: Boolean, default: true },
    /** Incremented on password change/reset to invalidate every existing session. */
    tokenVersion: { type: Number, default: 0 },
    addresses: { type: [savedAddressSchema], default: [] },
    wishlist: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    marketingConsent: {
      email: { type: Boolean, default: false },
      updatedAt: { type: Date },
    },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    lastLoginAt: { type: Date },
    orderCount: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ name: 'text', email: 'text', phone: 'text' });

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);
export type SavedAddress = InferSchemaType<typeof savedAddressSchema> & { _id: Types.ObjectId };
