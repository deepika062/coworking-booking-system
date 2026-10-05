import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

// The access token lives only in memory (not localStorage) so injected scripts can't read it
// from storage. On page load the session is restored from the httpOnly refresh cookie.
let accessToken = null;
let onSessionChange = () => {};

export function setAccessToken(token) {
  accessToken = token;
}

/** AuthContext registers a callback so the UI updates when a refresh succeeds or fails. */
export function subscribeSession(callback) {
  onSessionChange = callback;
}

export const api = axios.create({ baseURL, withCredentials: true });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

// Single in-flight refresh: if several requests hit an expired token at once (or React
// StrictMode runs an effect twice) they all wait on the same /auth/refresh call. The
// refresh token rotates on every use, so two parallel refreshes would fight each other.
let refreshPromise = null;

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${baseURL}/auth/refresh`, null, { withCredentials: true })
      .then((res) => {
        const session = res.data.data;
        setAccessToken(session.accessToken);
        onSessionChange(session.user);
        return session;
      })
      .catch((err) => {
        setAccessToken(null);
        onSessionChange(null);
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const code = error.response?.data?.error?.code;
    if (error.response?.status === 401 && code === 'TOKEN_EXPIRED' && original && !original._retried) {
      original._retried = true;
      await refreshSession(); // throws (-> logged out) if the refresh token is also invalid
      return api(original);
    }
    throw error;
  },
);

/** Pulls the API's `{ error: { message, details } }` into one human-readable string. */
export function errorMessage(err, fallback = 'Something went wrong') {
  const apiError = err?.response?.data?.error;
  if (!apiError) return err?.message === 'Network Error' ? 'Cannot reach the server' : fallback;
  if (apiError.code === 'VALIDATION_ERROR' && apiError.details?.length) {
    return apiError.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(' · ');
  }
  return apiError.message || fallback;
}
