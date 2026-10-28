/**
 * Default content inserted by `npm run seed`. Nothing here overwrites existing records.
 *
 * Policy pages are TEMPLATES: text in [square brackets] must be replaced with your business's
 * real terms, and the whole document should be reviewed by your legal/tax advisor before launch.
 */

const reviewNote =
  '> **Template:** replace the text in [square brackets] with your own terms and have this page reviewed before going live.\n\n';

export const DEFAULT_PAGES = [
  {
    slug: 'about',
    title: 'Our story',
    body: `[Write two or three short paragraphs about how your store began, who makes your jewellery, and what you care about. Customers buying gold want to know the people behind it.]

## What we promise

- **Pricing in the open.** Every piece shows its gold weight, today's rate, making charge and GST before you buy.
- **Purity you can check.** [Describe your hallmarking and certification here, e.g. "Every gold piece carries a BIS hallmark with a 6-digit HUID."]
- **People you can talk to.** Call, WhatsApp or visit us — we're happy to help you choose.`,
  },
  {
    slug: 'shipping-policy',
    title: 'Shipping policy',
    body: `${reviewNote}## Where we deliver

We deliver to the PIN codes shown as serviceable at checkout. Enter your PIN code on any product page to see whether we deliver to you and the estimated delivery time.

## Dispatch and delivery times

- Ready-to-ship pieces are dispatched within **[1–2] business days** of your order being confirmed.
- Estimated delivery times for your PIN code are shown on the product page and at checkout. These are estimates; courier delays can occasionally happen.

## Shipping charges

Shipping charges, if any, are shown at checkout before you pay. [State any free-shipping threshold here.]

## Packaging and insurance

[Describe how orders are packed, whether shipments are insured, and whether a signature or OTP is needed on delivery.]

## Tracking

Once your order ships, we'll email you the courier name and tracking number. You can also check progress at any time on the **Track order** page.

## Damaged or tampered parcels

If the parcel looks damaged or tampered with, please **do not accept it** and contact us immediately at [phone / email].`,
  },
  {
    slug: 'returns-and-refunds',
    title: 'Returns & refunds',
    body: `${reviewNote}## Returns

[State whether you accept returns, within how many days of delivery, and on which items. Customised, resized or engraved pieces are commonly excluded.]

To be eligible, a piece must be unused, in its original condition and packaging, with its certificate and invoice.

## Exchanges and buy-back

[Describe any exchange or buy-back terms, including how the value is calculated — for example, the gold value at the prevailing rate less any deductions.]

## Refunds

- Approved refunds for online payments are made to the original payment method. Banks usually take **5–7 business days** to show the amount.
- [Explain how refunds are handled for cash-on-delivery orders, e.g. bank transfer.]
- [State whether making charges, shipping or GST are refundable.]

## How to start a return

Contact us at [phone / email] with your order number. We'll guide you through the next steps.`,
  },
  {
    slug: 'cancellation-policy',
    title: 'Cancellation policy',
    body: `${reviewNote}## Before your order is prepared

- **Unpaid orders** are cancelled automatically if payment isn't completed, and any reserved pieces are released.
- **Cash-on-delivery orders** can be cancelled from your order page until we start preparing them.
- **Paid orders:** contact us at [phone / email] as soon as possible. If the order hasn't shipped, we'll cancel it and refund the full amount to your original payment method.

## After dispatch

Once an order has shipped it can't be cancelled; please see our Returns & refunds policy.

## Cancellations by us

Rarely, we may need to cancel an order — for example if a piece becomes unavailable or a pricing error occurs. If that happens we'll tell you straight away and refund any payment in full.`,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy policy',
    body: `${reviewNote}This policy explains how [legal business name] ("we") collects and uses your personal data, in line with India's Digital Personal Data Protection Act, 2023.

## What we collect

- **Details you give us:** name, email, mobile number, delivery address, and anything you write in messages or enquiries.
- **Order details:** what you bought, amounts paid and order history.
- **Technical data:** cookies that keep you signed in and remember your bag.

We **do not** see or store card, UPI or bank details. Online payments are processed by our payment gateway, [Razorpay], under its own privacy policy.

## How we use it

To process and deliver orders, provide customer support, send order updates, prevent fraud, and meet legal and tax obligations. We send marketing emails **only if you opt in**, and you can opt out at any time.

## Sharing

We share only what is needed with service providers who help us run the store: payment gateway, courier partners, and email providers. We do not sell your data.

## Retention

We keep order and invoice records for as long as tax law requires, and other data only as long as needed.

## Your rights

You can ask to access, correct or erase your personal data, or withdraw consent, by writing to [email]. Our grievance officer is [name, contact].

## Contact

[Legal business name], [registered address], [email].`,
  },
  {
    slug: 'terms',
    title: 'Terms & conditions',
    body: `${reviewNote}By using this website and placing an order you agree to these terms.

## Pricing

Prices of weight-based jewellery are calculated from the gold rate we publish, the piece's net weight, making charges, stone charges (if any) and GST. Because gold rates change, **prices can change from day to day**. The price shown when you place your order is the price you pay.

## Product details

Weights, dimensions and colours are shown as accurately as possible. Handcrafted pieces can vary slightly, and the final weight on your invoice may differ by a small margin [state your tolerance, if any].

## Orders

An order is confirmed when payment is received (or, for cash on delivery, when we confirm it). We may cancel an order in case of a pricing or stock error, with a full refund of any payment.

## Payments

Online payments are processed by [Razorpay]. Cash on delivery is offered only where shown at checkout, up to the limit shown.

## Governing law

These terms are governed by the laws of India. Courts at [city] have exclusive jurisdiction.

## Contact

[Legal business name], [address], [email], [phone]. GSTIN: [GSTIN].`,
  },
];

export const DEFAULT_FAQS = [
  {
    group: 'Pricing & purity',
    question: 'How is the price of a piece calculated?',
    answer:
      "For gold jewellery: net gold weight × today's rate for its purity, plus making charges, plus the value of any stones, plus 3% GST. Each product page shows this breakdown, so you can see exactly what you're paying for.",
  },
  {
    group: 'Pricing & purity',
    question: 'Why do prices change from day to day?',
    answer:
      "Because the price of gold changes. We update our rates regularly and every price on the site follows them. The price shown when you place your order is the price you pay — it won't change afterwards.",
  },
  {
    group: 'Pricing & purity',
    question: 'What do 24K, 22K and 18K mean?',
    answer:
      '"Karat" describes how much of the metal is pure gold. 24K is 99.9% pure (marked 999) and is too soft for most jewellery, so it is used for coins and bars. 22K is 91.6% gold (marked 916) and is the traditional choice for Indian jewellery. 18K is 75% gold (marked 750); its extra strength makes it ideal for diamond and stone-set pieces.',
  },
  {
    group: 'Pricing & purity',
    question: 'What is a BIS hallmark and HUID?',
    answer:
      'Hallmarking by the Bureau of Indian Standards (BIS) is mandatory for most gold jewellery sold in India. A hallmark has three parts: the BIS logo, the purity grade (for example 22K916) and a 6-character alphanumeric HUID (Hallmark Unique Identification) unique to that piece. You can verify a HUID yourself using the "Verify HUID" feature of the official BIS CARE app.',
  },
  {
    group: 'Orders & payment',
    question: 'Which payment methods can I use?',
    answer:
      "The payment options available for your order are shown at checkout. Online payments are processed securely by our payment gateway — we never see or store your card, UPI or bank details. Where cash on delivery is offered, you'll see it as an option at checkout.",
  },
  {
    group: 'Orders & payment',
    question: 'Can I cancel my order?',
    answer:
      "Unpaid orders and cash-on-delivery orders can be cancelled from your order page until we start preparing them. For a paid order, contact us as soon as possible — if it hasn't shipped, we'll cancel it and refund you in full.",
  },
  {
    group: 'Delivery',
    question: 'How long will delivery take?',
    answer:
      'Enter your PIN code on any product page or at checkout to see whether we deliver to you and the estimated delivery time. Once your order ships we email you the tracking details.',
  },
  {
    group: 'Delivery',
    question: 'How do I track my order?',
    answer:
      'Use the Track order page with your order number and the email or mobile number you used at checkout. If you have an account, your orders are also listed under My account.',
  },
  {
    group: 'Returns',
    question: 'Do you accept returns or exchanges?',
    answer: 'Please see our Returns & refunds policy for what can be returned or exchanged, and how refunds are made.',
  },
  {
    group: 'Care',
    question: 'How should I care for my gold jewellery?',
    answer:
      'Put jewellery on after perfume, lotion and hairspray, and take it off before swimming, bathing or exercising. Store pieces separately in a soft pouch so they don\'t scratch each other, and clean them gently with mild soap, lukewarm water and a soft brush. Pieces set with pearls or enamel should only be wiped with a soft dry cloth.',
  },
];

export const DEFAULT_POSTS = [
  {
    slug: 'choosing-gold-purity-24k-22k-18k',
    title: '24K, 22K or 18K? Choosing the right gold purity',
    excerpt: 'What karat really measures, why most Indian jewellery is 22K, and when 18K is the better choice.',
    tags: ['purity', 'guides'],
    cover: 'met-dt6630',
    body: `"Karat" (K) tells you how much of the metal in a piece is pure gold, out of 24 parts.

| Purity | Gold content | Hallmark grade | Best for |
| --- | --- | --- | --- |
| 24K | 99.9% | 999 | Coins and bars |
| 22K | 91.6% | 916 | Traditional jewellery |
| 18K | 75% | 750 | Diamond and stone-set pieces |
| 14K | 58.5% | 585 | Everyday, lightweight pieces |

## Why not wear 24K?

Pure gold is very soft. It bends and scratches easily, so it is rarely used for jewellery that's worn. It's the standard for coins and bars, which are bought for their gold value.

## Why 22K is the classic choice

22K has the warm, rich colour people associate with Indian gold while being strong enough for necklaces, bangles and jhumkas. Most traditional and temple jewellery is made in 22K.

## When 18K makes more sense

The extra 25% of other metals makes 18K harder, so it holds stones — especially diamonds — more securely and keeps sharp, fine details. It is also a little lighter on the pocket for the same weight.

## How purity affects the price

The gold value of a piece is its **net weight × the rate for its purity**. An 18K rate is lower than a 22K rate, so the same weight costs less. On our product pages you can see the purity, weight and rate used for every price.`,
  },
  {
    slug: 'how-to-read-a-bis-hallmark-and-huid',
    title: 'How to read a BIS hallmark and verify a HUID',
    excerpt: 'Three small marks tell you who certified a piece, how pure it is, and give it a unique identity you can check yourself.',
    tags: ['hallmark', 'guides'],
    cover: 'jhumka-aic',
    body: `Hallmarking by the **Bureau of Indian Standards (BIS)** is mandatory for most gold jewellery sold in India. A hallmark is stamped into the metal and has three parts.

## 1. The BIS logo

A triangle-shaped mark that shows the piece was tested at a BIS-recognised assaying and hallmarking centre.

## 2. The purity grade

Written as karat and fineness together — for example **22K916** for 22 karat (91.6% gold) or **18K750** for 18 karat (75% gold).

## 3. The HUID

A **6-character alphanumeric code** (Hallmark Unique Identification) that is unique to that piece of jewellery.

## How to verify a HUID

1. Install the official **BIS CARE** app.
2. Choose **Verify HUID** and enter the 6-character code from the piece.
3. The app shows details recorded when the piece was hallmarked, such as the purity and the type of article.

If you'd like the HUID of a piece before you buy, just ask us.`,
  },
  {
    slug: 'how-our-prices-are-calculated',
    title: 'How our prices are calculated',
    excerpt: 'Gold value, making charges, stones and GST — the four parts of every price, and why they move with the gold rate.',
    tags: ['pricing'],
    cover: 'gold-bar',
    body: `We think you should be able to see exactly what you're paying for. Every gold piece on our site is priced from four parts, and the breakdown is on every product page.

## 1. Gold value

**Net gold weight × today's rate** for the piece's purity (24K, 22K or 18K). Net weight excludes stones. Because gold rates move, this is the part of the price that changes from day to day.

## 2. Making charges

The cost of design and craftsmanship. Depending on the piece it's charged as a percentage of the gold value, a fixed amount per gram, or a flat amount. Intricate handwork costs more to make than a plain band.

## 3. Stones

For pieces set with diamonds, gemstones, pearls or enamel, the value of those materials is shown separately.

## 4. GST

Gold jewellery attracts **3% GST**, calculated on the total of the parts above.

## The price you pay is locked when you order

If the gold rate changes while a piece is in your bag, we'll show you the new price before you check out. Once you place your order, the price is fixed.`,
  },
  {
    slug: 'caring-for-gold-jewellery',
    title: 'Caring for your gold jewellery at home',
    excerpt: 'Simple habits that keep gold bright for decades — and what to avoid with pearls, enamel and stones.',
    tags: ['care', 'guides'],
    cover: 'gold-jewelry-pu',
    body: `Gold doesn't rust or tarnish the way silver does, but daily life can dull its shine and loosen stones. A few habits go a long way.

## Last on, first off

Put jewellery on **after** perfume, lotion and hairspray, and take it off before bathing, swimming, exercising or cooking. Chlorine and harsh chemicals can damage settings and finishes.

## Store pieces apart

Gold is soft and pieces can scratch each other. Keep each one in its own soft pouch or a lined box, and fasten chains so they don't tangle.

## Gentle cleaning

1. Soak plain gold for a few minutes in lukewarm water with a drop of mild soap.
2. Brush gently with a very soft toothbrush, paying attention to crevices.
3. Rinse and pat dry with a lint-free cloth.

## Pearls, enamel and kundan

Don't soak these. Wipe them with a soft, dry cloth after wearing. Meenakari (enamel) and kundan work can be damaged by water and ultrasonic cleaners.

## Check settings

Every few months, look for loose stones or worn clasps. A small repair early prevents losing a stone later.`,
  },
  {
    slug: 'temple-jewellery-styling-guide',
    title: 'Temple jewellery, worn your way',
    excerpt: 'Where temple jewellery comes from, the motifs to look for, and easy ways to wear it beyond weddings.',
    tags: ['trends', 'style'],
    cover: 'bride-pu',
    body: `Temple jewellery began in South India as ornaments made for temple deities, and later for classical dancers. Today it is one of the most loved styles for weddings and festivals — and it works well for smaller occasions too.

## Motifs to look for

- **Lakshmi and other deities**, often at the centre of a necklace or pendant
- **Peacocks, lotuses and mango (manga) shapes**, drawn from temple architecture
- **Kemp stones** in red and green, with gold beads or drops along the edge

## The antique finish

Many temple pieces have a matte, slightly darkened "antique" finish that brings out the carved detail. It is a surface finish only — the purity of the gold is shown by its hallmark, not its colour.

## Ways to wear it

1. **One statement piece.** A Lakshmi pendant on a plain chain, or bold jhumkas with a simple saree or kurta.
2. **Layer lengths.** Pair a short necklace (attigai) with a long haaram, keeping the motifs related so the set looks planned.
3. **Mix with plain gold.** Antique-finish jhumkas look fresh next to polished bangles.
4. **Try it with modern outfits.** Temple jhumkas suit solid-coloured fusion wear as well as silk.

## Caring for the finish

Wipe each piece with a soft, dry cloth after wearing. Avoid polishing cloths and dips meant for bright gold — they can strip the antique finish.`,
  },
  {
    slug: 'choosing-gold-jewellery-for-a-wedding',
    title: 'Choosing gold jewellery for a wedding',
    excerpt: 'Plan by ceremony, budget by weight, and pick pieces you will keep wearing long after the wedding day.',
    tags: ['occasions', 'wedding'],
    cover: 'indian-necklaces',
    body: `Wedding jewellery is often the biggest gold purchase a family makes. A little planning keeps it enjoyable — and makes sure every piece is worn again.

## Plan by ceremony

List the events — engagement, muhurtham, reception — and the look you want for each. A traditional South Indian bridal set often includes:

- a short necklace and a long haaram
- jhumkas, with maattal (ear chains) to carry their weight
- a nethi chutti (forehead ornament) and bangles
- an oddiyanam (waist belt) and vanki (armlet)

Not every ceremony needs every piece. Repeating the core set and changing one piece is common.

## Budget by weight, not only by price

Gold rates move, so it helps to set a budget in grams for each piece. Ask for the net weight, purity and making charge of every piece so you can compare like with like.

## Choose the purity for the piece

- **22K (916)** for plain and temple pieces
- **18K (750)** for stone-heavy and diamond pieces, which need a stronger setting

## Think beyond the day

Choose a few pieces you will wear afterwards — a lighter chain, everyday bangles, studs. Heavier sets come out again for festivals and family functions.

## Comfort matters

You may wear the jewellery for many hours. Try the pieces on together, check that heavy earrings are supported and that every clasp is secure.

## Keep the paperwork

Keep the GST invoice for each piece, with its weight, purity and HUID. You will need it for insurance, exchange or resale later.`,
  },
  {
    slug: 'gold-jewellery-buying-checklist',
    title: 'A checklist before you buy gold jewellery',
    excerpt: 'Seven things to check — hallmark, weight, rate, making charges, stones, invoice and returns — before you pay for any piece.',
    tags: ['buying', 'buying-guide'],
    cover: 'neck-ear-met',
    body: `Whether you buy online or in a shop, these checks help you know exactly what you are paying for.

## 1. The BIS hallmark and HUID

Hallmarked gold jewellery carries the BIS logo, the purity grade (such as **22K916**) and a 6-character HUID that you can check in the official BIS CARE app. Our guide explains [how to read a hallmark](/journal/how-to-read-a-bis-hallmark-and-huid).

## 2. Gross and net weight

Gross weight includes stones, enamel and other materials. The gold value should be charged on the **net** gold weight only.

## 3. The rate used

Ask which purity's rate was applied and compare it with the rate published that day.

## 4. Making charges

These can be a percentage, an amount per gram or a flat fee. Ask for the figure in rupees so you can compare pieces fairly.

## 5. Stone charges

Stones should be listed separately, with their weight or count. For diamonds, ask whether they come with a certificate.

## 6. GST and the invoice

GST on gold jewellery is 3%. Ask for a proper GST invoice showing the weight, purity, HUID, rate, making charges and tax for each piece.

## 7. Size, returns and exchange

Check ring and bangle sizes before you buy, and read the return, exchange and buyback terms — they differ from shop to shop.`,
  },
];

export const DEFAULT_BENEFITS = [
  { title: 'Every price explained', text: 'Gold weight, today’s rate, making charge and GST — shown on every piece.', icon: 'scale' },
  { title: 'Rate-linked pricing', text: 'Prices follow the gold rate we publish, and are locked when you order.', icon: 'trending' },
  { title: 'Secure checkout', text: 'Card and UPI details are handled by the payment gateway, never stored by us.', icon: 'shield' },
  { title: 'Real people to talk to', text: 'Questions before you buy? Call, WhatsApp or visit us.', icon: 'message' },
];
