import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const PAGE_SIZE = 24;

function formatSyncedAt(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch {
    return iso;
  }
}

export default function CatalogSection() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({
    total: 0,
    page: 1,
    totalPages: 1,
    syncedAt: null,
    countInDb: 0
  });
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  const fetchPage = useCallback(async (page, q) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getProperties({ page, limit: PAGE_SIZE, q });
      setItems(data.items || []);
      setMeta({
        total: data.total ?? 0,
        page: data.page ?? 1,
        totalPages: data.totalPages ?? 1,
        syncedAt: data.syncedAt,
        countInDb: data.countInDb ?? data.total ?? 0,
        source: data.source
      });
    } catch (err) {
      setError(err.message || 'Не удалось загрузить каталог');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1, query);
  }, [query, fetchPage]);

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

  const showingFrom = meta.total === 0 ? 0 : (meta.page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(meta.page * PAGE_SIZE, meta.total);

  return (
    <>
      <div className="card catalog-stats">
        <div className="catalog-stats__main">
          <span className="catalog-stats__count">{meta.countInDb}</span>
          <span className="catalog-stats__label">объектов в каталоге</span>
        </div>
        <div className="catalog-stats__meta">
          <span>Синхронизация: {formatSyncedAt(meta.syncedAt)}</span>
          {query && (
            <span>
              Найдено: {meta.total} по запросу «{query}»
            </span>
          )}
        </div>
      </div>

      <div className="card catalog-search">
        <input
          type="search"
          className="input catalog-search__input"
          placeholder="Поиск по названию, цене, описанию…"
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

      {loading && !items.length ? (
        <div className="session-status__loader">Загрузка каталога…</div>
      ) : !error && items.length === 0 ? (
        <div className="card">
          <p className="kb-empty">Ничего не найдено. Попробуйте другой запрос.</p>
        </div>
      ) : (
        <>
          <p className="catalog-range">
            Показано {showingFrom}–{showingTo} из {meta.total}
          </p>
          <div className={`catalog-grid${loading ? ' catalog-grid--loading' : ''}`}>
            {items.map((item) => (
              <article key={item.url} className="catalog-card">
                {item.propertyType && (
                  <span className="catalog-card__badge">{item.propertyType}</span>
                )}
                <h3 className="catalog-card__title">{item.title}</h3>
                {item.price && <p className="catalog-card__price">{item.price}</p>}
                {item.description && (
                  <p className="catalog-card__desc">{item.description}</p>
                )}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="catalog-card__link"
                >
                  Открыть на сайте →
                </a>
              </article>
            ))}
          </div>

          {meta.totalPages > 1 && (
            <div className="catalog-pagination">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                disabled={meta.page <= 1 || loading}
                onClick={() => goPage(meta.page - 1)}
              >
                ← Назад
              </button>
              <span className="catalog-pagination__info">
                Страница {meta.page} из {meta.totalPages}
              </span>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                disabled={meta.page >= meta.totalPages || loading}
                onClick={() => goPage(meta.page + 1)}
              >
                Вперёд →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
