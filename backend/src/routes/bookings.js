import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as bookings from '../services/bookingService.js';
import { createBookingBody, idParam, myBookingsQuery } from '../validators.js';

const router = Router();

router.use(authenticate, authorize('member', 'admin'));

router.post('/', validate({ body: createBookingBody }), async (req, res) => {
  res.status(201).json({ data: await bookings.createBooking(req.user, req.valid.body) });
});

router.get('/me', validate({ query: myBookingsQuery }), async (req, res) => {
  res.json(await bookings.listMyBookings(req.user.id, req.valid.query));
});

router.patch('/:id/cancel', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await bookings.cancelBooking(req.user, req.valid.params.id) });
});

export default router;
