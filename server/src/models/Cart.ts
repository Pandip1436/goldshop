import { Schema, model, type HydratedDocument, Types } from 'mongoose';

export interface ICartItem {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  variant: Types.ObjectId;
  qty: number;
  /** Price the shopper last saw, used to tell them when it changed. */
  seenPrice: number;
  addedAt: Date;
}

export interface ICart {
  user?: Types.ObjectId | null;
  /** Random token stored in an httpOnly cookie for shoppers who are not signed in. */
  guestToken?: string | null;
  items: Types.DocumentArray<ICartItem & Types.Subdocument>;
  couponCode?: string;
  /** Only guest carts expire; signed-in carts are kept. */
  expiresAt?: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

const cartItemSchema = new Schema<ICartItem>({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variant: { type: Schema.Types.ObjectId, required: true },
  qty: { type: Number, required: true, min: 1, max: 10 },
  seenPrice: { type: Number, default: 0 },
  addedAt: { type: Date, default: Date.now },
});

const cartSchema = new Schema<ICart>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    guestToken: { type: String, default: null },
    items: { type: [cartItemSchema], default: [] },
    couponCode: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

cartSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } });
cartSchema.index({ guestToken: 1 }, { unique: true, partialFilterExpression: { guestToken: { $type: 'string' } } });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type CartDoc = HydratedDocument<ICart>;
export const Cart = model<ICart>('Cart', cartSchema);
