import { api } from './client.js';

const data = (res) => res.data.data;
const page = (res) => res.data; // { data, pagination }

// Drop empty values so the URL stays clean (?type=&q= adds nothing).
const clean = (params) =>
  Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const authApi = {
  login: (body) => api.post('/auth/login', body).then(data),
  register: (body) => api.post('/auth/register', body).then(data),
  logout: () => api.post('/auth/logout'),
};

export const metaApi = {
  get: () => api.get('/meta').then(data),
};

export const spacesApi = {
  list: (params) => api.get('/spaces', { params: clean(params) }).then(page),
  get: (id) => api.get(`/spaces/${id}`).then(data),
  availability: (id, date) => api.get(`/spaces/${id}/availability`, { params: { date } }).then(data),
  create: (body) => api.post('/spaces', body).then(data),
  update: (id, body) => api.put(`/spaces/${id}`, body).then(data),
  remove: (id) => api.delete(`/spaces/${id}`).then(data),
};

export const bookingsApi = {
  create: (body) => api.post('/bookings', body).then(data),
  mine: (params) => api.get('/bookings/me', { params: clean(params) }).then(page),
  cancel: (id) => api.patch(`/bookings/${id}/cancel`).then(data),
};

export const adminApi = {
  bookings: (params) => api.get('/admin/bookings', { params: clean(params) }).then(page),
  approve: (id) => api.patch(`/admin/bookings/${id}/approve`).then(data),
  reject: (id, reason) => api.patch(`/admin/bookings/${id}/reject`, { reason }).then(data),
  maintenance: (params) => api.get('/admin/maintenance', { params: clean(params) }).then(data),
  createMaintenance: (body) => api.post('/admin/maintenance', body).then(data),
  deleteMaintenance: (id) => api.delete(`/admin/maintenance/${id}`),
};
