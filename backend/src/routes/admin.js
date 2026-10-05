import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as bookings from '../services/bookingService.js';
import * as maintenance from '../services/maintenanceService.js';
import {
  adminBookingsQuery,
  createMaintenanceBody,
  decisionBody,
  idParam,
  listMaintenanceQuery,
} from '../validators.js';

const router = Router();

router.use(authenticate, authorize('admin'));

// ---- bookings ----
router.get('/bookings', validate({ query: adminBookingsQuery }), async (req, res) => {
  res.json(await bookings.listAllBookings(req.valid.query));
});

router.patch('/bookings/:id/approve', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await bookings.approveBooking(req.user, req.valid.params.id) });
});

router.patch('/bookings/:id/reject', validate({ params: idParam, body: decisionBody }), async (req, res) => {
  res.json({ data: await bookings.rejectBooking(req.user, req.valid.params.id, req.valid.body.reason) });
});

// ---- maintenance windows ----
router.get('/maintenance', validate({ query: listMaintenanceQuery }), async (req, res) => {
  res.json({ data: await maintenance.listMaintenance(req.valid.query) });
});

router.post('/maintenance', validate({ body: createMaintenanceBody }), async (req, res) => {
  res.status(201).json({ data: await maintenance.createMaintenance(req.user, req.valid.body) });
});

router.delete('/maintenance/:id', validate({ params: idParam }), async (req, res) => {
  await maintenance.deleteMaintenance(req.valid.params.id);
  res.status(204).end();
});

export default router;
