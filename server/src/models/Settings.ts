import { Schema, model, type HydratedDocument } from 'mongoose';
import { DEFAULT_JOURNAL_SCRIPT, INDIAN_STATES, PURITY_KEYS, type ImageRef, type PurityKey } from '@goldshop/shared';
import { imageSchema } from './common';

export interface ShippingZone {
  _id?: unknown;
  name: string;
  /** Matches when the delivery state is in this list. */
  states: string[];
  /** Matches when the PIN code starts with any of these prefixes (more specific than states). */
  pinPrefixes: string[];
  /** Flat shipping charge in paise. */
  rate: number;
  /** Order subtotal (paise) at or above which shipping is free. 0 disables free shipping. */
  freeAbove: number;
  codAvailable: boolean;
  etaMinDays: number;
  etaMaxDays: number;
  isActive: boolean;
}

export interface ISettings {
  key: 'store';
  store: {
    name: string;
    legalName: string;
    tagline: string;
    description: string;
    email: string;
    phone: string;
    whatsapp: string;
    address: { line1: string; line2: string; city: string; state: string; pincode: string };
    mapUrl: string;
    hours: string;
    gstin: string;
    social: { instagram: string; facebook: string; youtube: string; pinterest: string };
  };
  goldRates: Record<PurityKey, number> & { updatedAt?: Date; updatedBy?: string };
  displayRates: PurityKey[];
  tax: { gstRateBps: number; hsnCode: string };
  checkout: {
    guestCheckout: boolean;
    orderPrefix: string;
    codEnabled: boolean;
    codMaxOrderValue: number;
    codFee: number;
    returnWindowDays: number;
  };
  shipping: {
    zones: ShippingZone[];
    /** Applies to any serviceable PIN not matched by a zone. Disable to restrict delivery to listed zones. */
    fallbackEnabled: boolean;
    fallbackRate: number;
    fallbackFreeAbove: number;
    fallbackCod: boolean;
    fallbackEtaMin: number;
    fallbackEtaMax: number;
    note: string;
  };
  announcement: { enabled: boolean; text: string; href: string };
  benefits: { title: string; text: string; icon: string }[];
  stats: { value: string; label: string; icon?: string }[];
  /** The Our story page's chapter cards. */
  storyChapters: {
    title: string;
    eyebrow: string;
    body: string;
    image?: ImageRef | null;
    features: { icon: string; value: string; label: string }[];
  }[];
  /** The homepage / About page brand story section. */
  about: {
    enabled: boolean;
    eyebrow: string;
    title: string;
    highlight: string;
    tagline: string;
    body: string;
    badge: string;
    features: { label: string; icon: string }[];
    image?: ImageRef | null;
    insetImage?: ImageRef | null;
  };
  /** Content of the public gold-rate page (the rates themselves live in `goldRates`). */
  goldRatePage: {
    image?: ImageRef | null;
    /** Script words over the photo, one line each. */
    script: string;
    highlights: { title: string; text: string; icon: string }[];
    /** A photo for each purity's rate card. */
    purityImages?: Partial<Record<PurityKey, ImageRef | null>>;
  };
  /** The band above the footer, and the photo in the footer's corner. */
  footer: { highlights: { title: string; text: string; icon: string }[]; image?: ImageRef | null };
  /** The shop listing banner. */
  shopPage: { image?: ImageRef | null; tagline: string; features: { title: string; text: string; icon: string }[] };
  /** The collections page banner. */
  collectionsPage: { image?: ImageRef | null; subtitle: string };
  /** The contact page banner. */
  contactPage: { image?: ImageRef | null; subtitle: string; replyNote: string; highlights: { title: string; text: string; icon: string }[] };
  /** The wishlist page banner. */
  wishlistPage: { image?: ImageRef | null };
  /** The account pages banner. */
  accountPage: { image?: ImageRef | null };
  /** Banner photo for the help pages (track order, FAQs). */
  helpPage: { image?: ImageRef | null };
  /** Photo in the "Visit us" section of the Our story page. */
  visitSection: { image?: ImageRef | null };
  /** Photographs of the shop for the Our story page gallery; each photo's alt text is its caption. */
  storePhotos: { title: string; subtitle: string; images: ImageRef[] };
  /** The store's logo: the full lockup, and the mark alone for small or dark places. */
  brand: { logo?: ImageRef | null; mark?: ImageRef | null };
  /** Photos for homepage sections. */
  homePage: {
    pricingImage?: ImageRef | null;
    savingsImage?: ImageRef | null;
    trust: { title: string; text: string; icon: string }[];
    promos: { title: string; text: string; ctaLabel: string; href: string; image?: ImageRef | null }[];
    /** The homepage circles: a category or collection (by slug), or any link with its own label. */
    circles: { kind: 'category' | 'collection' | 'link'; ref: string; label: string; href: string; image?: ImageRef | null }[];
  };
  /** The journal page banner. */
  journalPage: { image?: ImageRef | null; script: string };
  savingsPlan: {
    enabled: boolean;
    summary: string;
    image?: ImageRef | null;
    /** Shown beside "How it works". */
    stepsImage?: ImageRef | null;
    tagline: string;
    /** Script words over the photo, one line each. */
    script: string;
    features: { title: string; text: string; icon: string }[];
    schemes: { title: string; eyebrow: string; points: string[]; image?: ImageRef | null; details: string }[];
    highlights: { title: string; text: string; icon: string }[];
  };
  seo: { titleSuffix: string; defaultDescription: string };
}

const zoneSchema = new Schema<ShippingZone>({
  name: { type: String, required: true, maxlength: 60 },
  states: { type: [{ type: String, enum: INDIAN_STATES }], default: [] },
  pinPrefixes: { type: [{ type: String, match: /^[1-9][0-9]{0,5}$/ }], default: [] },
  rate: { type: Number, default: 0, min: 0 },
  freeAbove: { type: Number, default: 0, min: 0 },
  codAvailable: { type: Boolean, default: false },
  etaMinDays: { type: Number, default: 3, min: 0 },
  etaMaxDays: { type: Number, default: 7, min: 0 },
  isActive: { type: Boolean, default: true },
});

const goldRatesShape = Object.fromEntries(PURITY_KEYS.map((k) => [k, { type: Number, default: 0, min: 0 }]));

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, default: 'store', unique: true },
    store: {
      name: { type: String, default: 'Iniya Jewellers' },
      legalName: { type: String, default: '' },
      tagline: { type: String, default: 'Fine gold jewellery, priced in the open' },
      description: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
      address: {
        line1: { type: String, default: '' },
        line2: { type: String, default: '' },
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        pincode: { type: String, default: '' },
      },
      mapUrl: { type: String, default: '' },
      hours: { type: String, default: '' },
      gstin: { type: String, default: '' },
      social: {
        instagram: { type: String, default: '' },
        facebook: { type: String, default: '' },
        youtube: { type: String, default: '' },
        pinterest: { type: String, default: '' },
      },
    },
    goldRates: { ...goldRatesShape, updatedAt: { type: Date }, updatedBy: { type: String } },
    displayRates: { type: [{ type: String, enum: PURITY_KEYS }], default: ['gold24', 'gold22', 'gold18'] },
    tax: {
      gstRateBps: { type: Number, default: 300, min: 0, max: 2800 },
      hsnCode: { type: String, default: '7113' },
    },
    checkout: {
      guestCheckout: { type: Boolean, default: true },
      orderPrefix: { type: String, default: 'IJ', maxlength: 4 },
      codEnabled: { type: Boolean, default: false },
      codMaxOrderValue: { type: Number, default: 0 },
      codFee: { type: Number, default: 0 },
      returnWindowDays: { type: Number, default: 0 },
    },
    shipping: {
      zones: { type: [zoneSchema], default: [] },
      fallbackEnabled: { type: Boolean, default: true },
      fallbackRate: { type: Number, default: 0 },
      fallbackFreeAbove: { type: Number, default: 0 },
      fallbackCod: { type: Boolean, default: false },
      fallbackEtaMin: { type: Number, default: 4 },
      fallbackEtaMax: { type: Number, default: 8 },
      note: { type: String, default: '' },
    },
    announcement: {
      enabled: { type: Boolean, default: false },
      text: { type: String, default: '' },
      href: { type: String, default: '' },
    },
    benefits: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
    stats: { type: [{ value: String, label: String, icon: String, _id: false }], default: [] },
    storyChapters: {
      type: [
        {
          title: { type: String, default: '' },
          eyebrow: { type: String, default: '' },
          body: { type: String, default: '' },
          image: { type: imageSchema, default: null },
          features: { type: [{ icon: String, value: String, label: String, _id: false }], default: [] },
          _id: false,
        },
      ],
      default: [],
    },
    about: {
      enabled: { type: Boolean, default: false },
      eyebrow: { type: String, default: 'About us' },
      title: { type: String, default: '' },
      highlight: { type: String, default: '' },
      tagline: { type: String, default: '' },
      body: { type: String, default: '' },
      badge: { type: String, default: '' },
      features: { type: [{ label: String, icon: String, _id: false }], default: [] },
      image: { type: imageSchema, default: null },
      insetImage: { type: imageSchema, default: null },
    },
    goldRatePage: {
      image: { type: imageSchema, default: null },
      script: { type: String, default: '' },
      highlights: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
      purityImages: Object.fromEntries(PURITY_KEYS.map((k) => [k, { type: imageSchema, default: null }])),
    },
    footer: {
      highlights: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
      image: { type: imageSchema, default: null },
    },
    shopPage: {
      image: { type: imageSchema, default: null },
      tagline: { type: String, default: '' },
      features: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
    },
    collectionsPage: {
      image: { type: imageSchema, default: null },
      subtitle: { type: String, default: '' },
    },
    contactPage: {
      image: { type: imageSchema, default: null },
      subtitle: { type: String, default: '' },
      replyNote: { type: String, default: '' },
      highlights: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
    },
    wishlistPage: { image: { type: imageSchema, default: null } },
    accountPage: { image: { type: imageSchema, default: null } },
    helpPage: { image: { type: imageSchema, default: null } },
    visitSection: { image: { type: imageSchema, default: null } },
    storePhotos: {
      title: { type: String, default: '' },
      subtitle: { type: String, default: '' },
      images: { type: [imageSchema], default: [] },
    },
    brand: { logo: { type: imageSchema, default: null }, mark: { type: imageSchema, default: null } },
    homePage: {
      pricingImage: { type: imageSchema, default: null },
      savingsImage: { type: imageSchema, default: null },
      trust: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
      promos: {
        type: [
          {
            title: { type: String, default: '' },
            text: { type: String, default: '' },
            ctaLabel: { type: String, default: '' },
            href: { type: String, default: '' },
            image: { type: imageSchema, default: null },
            _id: false,
          },
        ],
        default: [],
      },
      circles: {
        type: [
          {
            kind: { type: String, enum: ['category', 'collection', 'link'], default: 'category' },
            ref: { type: String, default: '' },
            label: { type: String, default: '' },
            href: { type: String, default: '' },
            image: { type: imageSchema, default: null },
            _id: false,
          },
        ],
        default: [],
      },
    },
    journalPage: {
      image: { type: imageSchema, default: null },
      script: { type: String, default: DEFAULT_JOURNAL_SCRIPT },
    },
    savingsPlan: {
      enabled: { type: Boolean, default: true },
      summary: { type: String, default: '' },
      image: { type: imageSchema, default: null },
      stepsImage: { type: imageSchema, default: null },
      tagline: { type: String, default: '' },
      script: { type: String, default: '' },
      features: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
      schemes: {
        type: [
          {
            title: { type: String, default: '' },
            eyebrow: { type: String, default: '' },
            points: { type: [String], default: [] },
            image: { type: imageSchema, default: null },
            details: { type: String, default: '' },
            _id: false,
          },
        ],
        default: [],
      },
      highlights: { type: [{ title: String, text: String, icon: String, _id: false }], default: [] },
    },
    seo: {
      titleSuffix: { type: String, default: '' },
      defaultDescription: { type: String, default: '' },
    },
  },
  { timestamps: true, minimize: false },
);

export type SettingsDoc = HydratedDocument<ISettings>;
export const Settings = model<ISettings>('Settings', settingsSchema);
