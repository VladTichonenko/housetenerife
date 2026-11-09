import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconClose } from './Icons';

const PAGE_SIZE = 40;

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatBubbleTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function avatarInitials(value) {
  const parts = String(value || '')
    .replace(/[^\p{L}\p{N}\s+]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts[0].startsWith('+')) return '#';
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?';
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function languagesText(user) {
  if (user.languagesLabel) return user.languagesLabel;
  if (Array.isArray(user.languages) && user.languages.length) {
    return user.languages.join(', ');
  }
  return user.languageLabel || user.language || '—';
}

function bubbleRole(m) {
  if (m.role === 'manager') return 'manager';
  if (m.role === 'assistant') return 'bot';
  return 'user';
}

function bubbleLabel(m) {
  if (m.role === 'manager') return m.managerName || 'Менеджер';
  if (m.role === 'assistant') return 'Бот';
  return 'Клиент';
}

function UserDetail({ userId, onClose }) {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await api.getDbUser(userId);
      setUser(data.item);
      setMessages(data.messages || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title =
    (user?.name && !/whatsapp id/i.test(user.name) ? user.name : '') ||
    (user?.phoneDisplay && !/whatsapp id/i.test(user.phoneDisplay) ? user.phoneDisplay : '') ||
    user?.phoneDisplay ||
    userId;
  const phone =
    user?.phoneDisplay && !/whatsapp id/i.test(user.phoneDisplay) ? user.phoneDisplay : '';
  const subtitle = [
    phone && phone !== title ? phone : null,
    languagesText(user || {}),
    user?.waLink ? 'WhatsApp' : null,
  ]
    .filter((v) => v && v !== '—')
    .join(' · ');

  return (
    <div className="modal modal--chat" role="dialog" aria-modal="true" aria-labelledby="db-user-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog modal__dialog--wide chat-panel">
        <header className="chat-panel__topbar">
          <button type="button" className="chat-panel__back" onClick={onClose} aria-label="Назад">
            ←
          </button>
          <div className="chat-panel__avatar" aria-hidden>
            {avatarInitials(title)}
          </div>
          <div className="chat-panel__topbar-info">
            <h2 id="db-user-title" className="chat-panel__topbar-title">
              {title}
            </h2>
            {subtitle && <p className="chat-panel__topbar-sub">{subtitle}</p>}
          </div>
          {user?.waLink && (
            <a
              className="chat-panel__icon-btn"
              href={user.waLink}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Открыть WhatsApp"
              title="WhatsApp"
            >
              ✆
            </a>
          )}
          <button type="button" className="chat-panel__icon-btn modal__close--chat" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </header>

        <div className="chat-panel__body">
          <div className="chat-panel__messages">
            {loading && !messages.length ? (
              <p className="chat-panel__empty">Загрузка…</p>
            ) : error ? (
              <p className="chat-panel__empty">{error}</p>
            ) : messages.length === 0 ? (
              <p className="chat-panel__empty">Истории пока нет</p>
            ) : (
              messages.map((m) => (
                <div key={m.id || `${m.at}-${m.role}`} className={`chat-bubble chat-bubble--${bubbleRole(m)}`}>
                  <span className="chat-bubble__author">{bubbleLabel(m)}</span>
                  <p className="chat-bubble__text">{m.text}</p>
                  <span className="chat-bubble__meta">
                    <span className="chat-bubble__time">{formatBubbleTime(m.at)}</span>
                    {bubbleRole(m) !== 'user' && (
                      <span className="chat-bubble__ticks" aria-hidden>
                        ✓✓
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="chat-panel__composer chat-panel__composer--readonly" aria-hidden>
          <div className="chat-panel__input chat-panel__input--readonly">
            Просмотр истории · ответ из вкладки «Чаты»
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DatabaseSection() {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const debounceRef = useRef(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.getDbStats();
      setStats(data.stats);
    } catch {
      /* stats optional */
    }
  }, []);

  const fetchPage = useCallback(async (page, q, { quiet = false } = {}) => {
    if (!quiet) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await api.getDbUsers({ page, limit: PAGE_SIZE, q });
      setItems(data.items || []);
      setMeta({
        total: data.total ?? 0,
        page: data.page ?? 1,
        totalPages: data.totalPages ?? 1,
      });
    } catch (err) {
      if (!quiet) {
        setError(err.message || 'Не удалось загрузить пользователей');
        setItems([]);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchPage(1, query);
  }, [query, fetchPage]);

  // После фонового LID→phone обновить таблицу, если ещё видны WhatsApp ID.
  useEffect(() => {
    const needsPhone = items.some((u) => /whatsapp id/i.test(String(u.phoneDisplay || '')));
    if (!needsPhone) return undefined;
    const timer = setTimeout(() => {
      fetchPage(meta.page || 1, query, { quiet: true });
    }, 4000);
    return () => clearTimeout(timer);
  }, [items, meta.page, query, fetchPage]);

  const onSearchChange = (value) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(value.trim()), 350);
  };

  const goPage = (p) => {
    const next = Math.max(1, Math.min(p, meta.totalPages));
    fetchPage(next, query);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <div className="card catalog-stats">
        <div className="catalog-stats__main">
          <span className="catalog-stats__count">{stats?.users ?? '—'}</span>
          <span className="catalog-stats__label">пользователей в БД</span>
        </div>
        <div className="catalog-stats__meta db-stats-grid">
          <span>Сообщений: {stats?.messages ?? '—'}</span>
          <span>С телефоном: {stats?.withPhone ?? '—'}</span>
          <span>Стран: {stats?.countries ?? '—'}</span>
          <span>Активны за 7 дней: {stats?.activeLast7Days ?? '—'}</span>
          <span>Размер: {stats ? formatBytes(stats.dbSizeBytes) : '—'}</span>
          {stats?.path && <span className="db-stats-path" title={stats.path}>Файл: {stats.path}</span>}
        </div>
      </div>

      <div className="card catalog-search">
        <input
          type="search"
          className="input catalog-search__input"
          placeholder="Поиск по имени, телефону, стране, языку…"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchInput && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setSearchInput('');
              setQuery('');
            }}
          >
            Сбросить
          </button>
        )}
      </div>

      {error && (
        <div className="card">
          <p className="form-error">{error}</p>
          <button type="button" className="btn btn--primary" onClick={() => fetchPage(meta.page, query)}>
            Повторить
          </button>
        </div>
      )}

      <div className={`db-table-wrap${loading ? ' db-table-wrap--loading' : ''}`}>
        <table className="db-table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Телефон</th>
              <th>Страна</th>
              <th>Языки</th>
              <th>Сообщ.</th>
              <th>Последний визит</th>
            </tr>
          </thead>
          <tbody>
            {!loading && !items.length && (
              <tr>
                <td colSpan={6} className="db-table__empty">
                  Пользователей пока нет — появятся после диалогов в WhatsApp
                </td>
              </tr>
            )}
            {items.map((u) => (
              <tr key={u.id} className="db-table__row" onClick={() => setSelectedId(u.id)}>
                <td>
                  <strong>{u.name || '—'}</strong>
                  {u.isGroup && <span className="db-badge">группа</span>}
                </td>
                <td>{u.phoneDisplay || '—'}</td>
                <td>{u.countryName || u.country || '—'}</td>
                <td>{languagesText(u)}</td>
                <td>{u.messageCount || 0}</td>
                <td>{formatDate(u.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta.totalPages > 1 && (
        <div className="pager">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={meta.page <= 1}
            onClick={() => goPage(meta.page - 1)}
          >
            Назад
          </button>
          <span className="pager__info">
            {meta.page} / {meta.totalPages}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={meta.page >= meta.totalPages}
            onClick={() => goPage(meta.page + 1)}
          >
            Вперёд
          </button>
        </div>
      )}

      {selectedId && <UserDetail userId={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  );
}
