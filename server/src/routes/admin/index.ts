import { Router } from 'express';
import { invalidatePublicCache } from '../../lib/cache';
import { requireStaff } from '../../middleware/auth';
import { adminCatalogRouter } from './catalog';
import { adminContentRouter } from './content';
import { adminOrdersRouter } from './orders';
import { adminPeopleRouter } from './people';
import { adminReportsRouter } from './reports';
import { adminSettingsRouter } from './settings';

export const adminRouter = Router();

// Every admin route requires a staff or admin session; individual routes add finer permissions.
adminRouter.use(requireStaff);

// Any successful admin write may change what shoppers see, so drop the public read cache.
adminRouter.use((req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) invalidatePublicCache();
    });
  }
  res.set('Cache-Control', 'no-store');
  next();
});

adminRouter.use(adminReportsRouter);
adminRouter.use(adminCatalogRouter);
adminRouter.use(adminOrdersRouter);
adminRouter.use(adminPeopleRouter);
adminRouter.use(adminContentRouter);
adminRouter.use(adminSettingsRouter);
