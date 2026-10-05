import { Link } from 'react-router-dom';
import { typeLabel } from '../utils/format.js';

const ICONS = { desk: '💻', meeting_room: '👥', private_office: '🚪' };

export default function SpaceCard({ space, date }) {
  const to = `/spaces/${space.id}${date ? `?date=${date}` : ''}`;
  return (
    <article className="card space-card">
      <div className="space-card-head">
        <span className="space-icon" aria-hidden="true">
          {ICONS[space.type]}
        </span>
        <div>
          <h3>
            <Link to={to}>{space.name}</Link>
          </h3>
          <p className="muted small">
            {typeLabel(space.type)} · {space.capacity} {space.capacity === 1 ? 'person' : 'people'}
            {space.location && ` · ${space.location}`}
          </p>
        </div>
      </div>
      {space.description && <p className="space-desc">{space.description}</p>}
      <ul className="chips">
        {space.amenities.map((a) => (
          <li key={a} className="chip">
            {a}
          </li>
        ))}
      </ul>
      <Link to={to} className="btn btn-outline btn-block">
        View availability
      </Link>
    </article>
  );
}
