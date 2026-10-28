import type { Router } from 'express';
import type { Model } from 'mongoose';
import type { z } from 'zod';
import { notFound } from '../../lib/errors';
import { objectId, paginated, pagination, parse } from '../../lib/http';
import { uniqueSlug } from '../../lib/slug';
import { requirePermission, type Permission } from '../../middleware/auth';

interface CrudOptions {
  sort: Record<string, 1 | -1>;
  /** If set, a unique slug is generated from this field when none is supplied. */
  slugFrom?: string;
  readPermission?: Permission;
  /** Drop null image fields so Mongoose doesn't store empty sub-documents. */
  nullableImages?: string[];
}

/** Standard list / create / update / delete endpoints for simple admin-managed collections. */
export function mountCrud(
  router: Router,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
  schema: z.ZodType,
  permission: Permission,
  opts: CrudOptions,
): void {
  const clean = (data: Record<string, unknown>) => {
    for (const f of opts.nullableImages ?? []) if (data[f] === null) data[f] = undefined;
    return data;
  };

  router.get(`/${path}`, requirePermission(opts.readPermission ?? permission), async (req, res) => {
    const { page, limit, skip } = pagination(req, 200, 50);
    const [items, total] = await Promise.all([
      model.find().sort(opts.sort).skip(skip).limit(limit).lean(),
      model.countDocuments(),
    ]);
    res.json(paginated(items.map((i: { _id: unknown }) => ({ ...i, id: String(i._id) })), total, page, limit));
  });

  router.get(`/${path}/:id`, requirePermission(opts.readPermission ?? permission), async (req, res) => {
    const item = await model.findById(objectId(String(req.params.id))).lean<{ _id: unknown }>();
    if (!item) throw notFound();
    res.json({ ...item, id: String(item._id) });
  });

  router.post(`/${path}`, requirePermission(permission), async (req, res) => {
    const data = clean(parse(schema, req.body) as Record<string, unknown>);
    if (opts.slugFrom) {
      data.slug = await uniqueSlug(String(data.slug || data[opts.slugFrom] || ''), async (s) => Boolean(await model.exists({ slug: s })));
    }
    const doc = await model.create(data);
    res.status(201).json({ id: String(doc._id) });
  });

  router.put(`/${path}/:id`, requirePermission(permission), async (req, res) => {
    const id = objectId(String(req.params.id));
    const data = clean(parse(schema, req.body) as Record<string, unknown>);
    const doc = await model.findById(id);
    if (!doc) throw notFound();
    if (opts.slugFrom) {
      const wanted = String(data.slug || '');
      data.slug = wanted && wanted !== doc.get('slug')
        ? await uniqueSlug(wanted, async (s) => Boolean(await model.exists({ slug: s, _id: { $ne: id } })))
        : doc.get('slug');
    }
    doc.set(data);
    await doc.save();
    res.json({ id: String(doc._id) });
  });

  router.delete(`/${path}/:id`, requirePermission(permission), async (req, res) => {
    const r = await model.deleteOne({ _id: objectId(String(req.params.id)) });
    if (!r.deletedCount) throw notFound();
    res.json({ deleted: true });
  });
}
