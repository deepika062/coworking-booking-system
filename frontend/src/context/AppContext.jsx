import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { metaApi } from '../api/endpoints.js';

/** Business rules from /api/meta (timezone, opening hours, slot size) + toast notifications. */
const AppContext = createContext(null);

const DEFAULT_META = { timezone: 'Asia/Kolkata', openingHour: 8, closingHour: 20, slotMinutes: 30, maxAdvanceDays: 60 };

export function AppProvider({ children }) {
  const [meta, setMeta] = useState(DEFAULT_META);
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  useEffect(() => {
    metaApi.get().then(setMeta).catch(() => {});
  }, []);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (message, type = 'success') => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, type }]);
      setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ meta, toast }), [meta, toast]);
  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
