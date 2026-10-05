const LEGEND = [
  ['free', 'Available'],
  ['pending', 'Pending request'],
  ['booked', 'Booked'],
  ['maintenance', 'Maintenance'],
  ['past', 'Past'],
];

/**
 * Day view: one cell per slot, coloured by status. If `onSlotClick` is given, free slots
 * are clickable and slots inside [selStart, selEnd) are highlighted.
 */
export default function AvailabilityCalendar({ slots, selStart, selEnd, onSlotClick }) {
  const isSelected = (s) => selStart && selEnd && s.start >= selStart && s.end <= selEnd;
  const freeCount = slots.filter((s) => s.status === 'free').length;

  return (
    <div>
      <div className="slot-grid" role="grid" aria-label="Time slots">
        {slots.map((s) => {
          const clickable = onSlotClick && s.status === 'free';
          return (
            <button
              key={s.start}
              type="button"
              role="gridcell"
              className={`slot slot-${s.status} ${isSelected(s) ? 'slot-selected' : ''}`}
              disabled={!clickable}
              onClick={() => clickable && onSlotClick(s)}
              title={`${s.start}–${s.end}: ${s.status}`}
              aria-label={`${s.start} to ${s.end}, ${s.status}${isSelected(s) ? ', selected' : ''}`}
            >
              <span className="slot-time">{s.start}</span>
              <span className="slot-status">{s.status === 'free' ? '' : s.status}</span>
            </button>
          );
        })}
      </div>
      <div className="legend">
        {LEGEND.map(([key, label]) => (
          <span key={key} className="legend-item">
            <span className={`legend-swatch slot-${key}`} /> {label}
          </span>
        ))}
        <span className="legend-item muted">
          {freeCount} of {slots.length} slots free
        </span>
      </div>
    </div>
  );
}
