import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as spaces from '../services/spaceService.js';
import {
  availabilityQuery,
  createSpaceBody,
  idParam,
  listSpacesQuery,
  updateSpaceBody,
} from '../validators.js';

const router = Router();

// ---- public (visitor) ----
router.get('/', validate({ query: listSpacesQuery }), async (req, res) => {
  res.json(await spaces.listSpaces(req.valid.query));
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await spaces.getSpace(req.valid.params.id) });
});

router.get('/:id/availability', validate({ params: idParam, query: availabilityQuery }), async (req, res) => {
  res.json({ data: await spaces.getAvailability(req.valid.params.id, req.valid.query.date) });
});

// ---- admin ----
const adminOnly = [authenticate, authorize('admin')];

router.post('/', ...adminOnly, validate({ body: createSpaceBody }), async (req, res) => {
  res.status(201).json({ data: await spaces.createSpace(req.valid.body) });
});

router.put('/:id', ...adminOnly, validate({ params: idParam, body: updateSpaceBody }), async (req, res) => {
  res.json({ data: await spaces.updateSpace(req.valid.params.id, req.valid.body) });
});

router.delete('/:id', ...adminOnly, validate({ params: idParam }), async (req, res) => {
  res.json({ data: await spaces.deleteSpace(req.valid.params.id) });
});

export default router;
