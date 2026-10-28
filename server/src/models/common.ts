import { Schema } from 'mongoose';
import { INDIAN_STATES } from '@goldshop/shared';

export const imageSchema = new Schema(
  {
    key: { type: String, default: '' },
    url: { type: String },
    alt: { type: String, default: '', maxlength: 200 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
  },
  { _id: false },
);

export const addressFields = {
  fullName: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true, maxlength: 15 },
  line1: { type: String, required: true, trim: true, maxlength: 120 },
  line2: { type: String, default: '', trim: true, maxlength: 120 },
  landmark: { type: String, default: '', trim: true, maxlength: 80 },
  city: { type: String, required: true, trim: true, maxlength: 60 },
  state: { type: String, required: true, enum: INDIAN_STATES },
  pincode: { type: String, required: true, match: /^[1-9][0-9]{5}$/ },
} as const;

export const seoSchema = new Schema(
  {
    title: { type: String, maxlength: 120 },
    description: { type: String, maxlength: 320 },
  },
  { _id: false },
);
