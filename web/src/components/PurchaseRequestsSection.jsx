import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconClose } from './Icons';
import ChatPanel, { formatDate } from './ChatPanel';

const PAGE_SIZE = 50;

const STATUS_LABELS = {
  draft: 'Черновик',
  ready: 'Готова к созвону',
  call_requested: 'Созвон запрошен',
  handed_off: 'У менеджера',
  closed: 'Завершена',
};

const FINANCE_STAGE_LABELS = {
  NEED_FUNDS_NOW: 'Уточнение средств на руках',
  NEED_MORTGAGE: 'Нужна ли ипотека',
  FINANCE_DOCUMENTS: 'Документы / ипотека',
  FINANCE_DOCUMENTS_CASH: 'Документы / оплата наличными',
  PROPERTY_SELECTED: 'Объект выбран',
  OFFER_MANAGER_CALL: 'Предложен созвон',
  PROPERTY_CLOSING: 'Закрытие сделки',
};

const FILTERS = [
  { id: 'open', label: 'Открытые' },
  { id: 'draft', label: 'Черновики' },
  { id: 'ready', label: 'К созвону' },
  { id: 'handed_off', label: 'У менеджера' },
  { id: 'closed', label: 'Завершённые' },
];

function displayText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(displayText).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    if (value.label) return displayText(value.label);
    if (value.text) return displayText(value.text);
    if (value.min != null || value.max != null) {
      const min = value.min != null ? String(value.min) : '';
      const max = value.max != null ? String(value.max) : '';
      if (min && max) return `${min}–${max}`;
      return min || max;
    }
    if (value.amount != null) return String(value.amount);
  }
  return '';
}

function criteriaLine(item) {
  return [item.propertyType, item.businessSector, item.region, item.budget]
    .map(displayText)
    .filter(Boolean)
    .join(' · ');
}

function PropertyLinks({ properties }) {
  if (!properties?.length) return <span className="muted">Объект не указан</span>;
  return (
    <ul className="property-links__list">
      {properties.map((p) => (
        <li key={p.id} className="property-links__item">
          <span className="property-links__id">{p.id}</span>
          <span className="property-links__name">{p.title}</span>
          {p.price && <span className="property-links__price">{p.price}</span>}
          {p.siteUrl && (
            <a href={p.siteUrl} target="_blank" rel="noopener noreferrer" className="property-links__url">
              На сайте
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function contactLabel(item) {
  if (item.clientName) return item.clientName;
  if (item.isLid) return item.phoneDisplay || 'WhatsApp ID';
  return item.phoneDisplay || item.phone || '—';
}

function DetailModal({ id, onClose, onUpdated, onOpenChat }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPurchaseRequest(id)
      .then((d) => {
        if (!cancelled) setItem(d.item);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Ошибка загрузки');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleClose = async () => {
    try {
      const d = await api.closePurchaseRequest(id);
      setItem(d.item);
      onUpdated?.();
    } catch (e) {
      setError(e.message || 'Ошибка');
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog modal__dialog--wide handoff-modal purchase-modal">
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>

        {loading ? (
          <p className="handoff-modal__loading">Загрузка…</p>
        ) : error && !item ? (
          <p className="form-error">{error}</p>
        ) : item ? (
          <>
            <div className="handoff-modal__top">
              <div>
                <h2 id="purchase-modal-title" className="modal__title">
                  Запрос на покупку
                </h2>
                <p className="modal__subtitle">
                  {[item.languageLabel, formatDate(item.updatedAt)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className={`lead-status lead-status--${item.status}`}>
                {item.statusLabel || STATUS_LABELS[item.status] || item.status}
              </span>
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Контакт</span>
              <p className="handoff-modal__phone">{contactLabel(item)}</p>
              {item.isLid && (
                <p className="muted purchase-modal__lid-hint">
                  WhatsApp скрыл номер (Linked Device ID). Пишите клиенту через чат в панели.
                </p>
              )}
              {item.waLink && (
                <a href={item.waLink} target="_blank" rel="noopener noreferrer" className="btn btn--outline btn--sm">
                  WhatsApp
                </a>
              )}
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Объект(ы)</span>
              <PropertyLinks properties={item.properties} />
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Критерии</span>
              <p>{criteriaLine(item) || '—'}</p>
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Финансы</span>
              <p>
                {displayText(item.fundsNowLabel) || '—'}
                {item.needsMortgage === true && ' · нужна ипотека'}
                {item.needsMortgage === false && ' · без ипотеки'}
              </p>
              {item.financeStage && (
                <p className="muted">
                  Этап: {FINANCE_STAGE_LABELS[item.financeStage] || item.financeStage}
                </p>
              )}
            </div>

            {item.preview && (
              <div className="handoff-modal__block">
                <span className="handoff-modal__label">Последняя реплика</span>
                <p className="handoff-modal__preview">{item.preview}</p>
              </div>
            )}

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Отчёт по диалогу</span>
              {item.summaryStatus === 'pending' && !item.summary ? (
                <p className="handoff-modal__pending">Формируется…</p>
              ) : item.summary ? (
                <div className="handoff-modal__summary">{item.summary}</div>
              ) : (
                <p className="muted">Отчёт ещё не сформирован</p>
              )}
              {item.summaryReadyAt && (
                <p className="muted" style={{ marginTop: '0.5rem' }}>
                  Обновлён: {formatDate(item.summaryReadyAt)}
                  {item.reportTrigger ? ` · ${item.reportTrigger}` : ''}
                </p>
              )}
            </div>

            <div className="handoff-modal__actions">
              {item.chatId && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => onOpenChat?.(item)}
                >
                  История чата / ответить
                </button>
              )}
              <button type="button" className="btn btn--outline btn--sm" onClick={toggleClose}>
                {item.status === 'closed' ? 'Вернуть в работу' : 'Завершить'}
              </button>
            </div>

            {error && <p className="form-error">{error}</p>}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function PurchaseRequestsSection() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState('open');
  const [selectedId, setSelectedId] = useState(null);
  const [chatTarget, setChatTarget] = useState(null);

  const fetchPage = useCallback(
    async (page, { silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const data = await api.getPurchaseRequests({
          page,
          limit: PAGE_SIZE,
          q: search,
          filter,
        });
        setItems(data.items || []);
        setMeta({
          total: data.total ?? 0,
          page: data.page ?? 1,
          totalPages: data.totalPages ?? 1,
        });
      } catch (err) {
        setError(err.message || 'Не удалось загрузить');
        if (!silent) setItems([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [search, filter]
  );

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  const refresh = () => fetchPage(meta.page, { silent: true });

  const goPage = (p) => {
    fetchPage(Math.max(1, Math.min(p, meta.totalPages)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const openChat = (item) => {
    if (!item?.chatId) return;
    setSelectedId(null);
    setChatTarget({
      chatId: item.chatId,
      title: contactLabel(item),
      subtitle: item.properties?.[0]?.title || item.phoneDisplay || '',
    });
  };

  return (
    <>
      <div className="inbox-shell">
        <div className="inbox-shell__head">
          <div>
            <h3 className="inbox-shell__title">Запросы на покупку</h3>
            <p className="inbox-shell__user muted">
              Появляются, когда клиент выбирает объект. Откройте заявку, чтобы увидеть чат и ответить.
            </p>
          </div>
        </div>

        <form className="inbox-toolbar" onSubmit={handleSearch}>
          <input
            type="search"
            className="inbox-toolbar__search"
            placeholder="Телефон, объект, регион…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn--outline btn--sm">
            Найти
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={refresh} disabled={loading}>
            {loading ? '…' : 'Обновить'}
          </button>
          <span className="inbox-toolbar__meta">{meta.total > 0 ? `${meta.total} записей` : ''}</span>
        </form>

        <div className="inbox-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`inbox-filters__chip${filter === f.id ? ' inbox-filters__chip--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}

        {loading && !items.length ? (
          <p className="muted">Загрузка…</p>
        ) : !items.length ? (
          <p className="muted">Заявок пока нет</p>
        ) : (
          <div className="inbox-list">
            {items.map((item) => (
              <div key={item.id} className="inbox-row">
                <button
                  type="button"
                  className="inbox-row__main-btn"
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="inbox-row__main">
                    <span className={`lead-status lead-status--${item.status}`}>
                      {item.statusLabel || STATUS_LABELS[item.status]}
                    </span>
                    <strong className="inbox-row__contact">{contactLabel(item)}</strong>
                    <span className="inbox-row__preview">
                      {item.summary
                        ? item.summary.slice(0, 100) + (item.summary.length > 100 ? '…' : '')
                        : item.properties?.[0]?.title || item.preview || '—'}
                    </span>
                  </div>
                  <div className="inbox-row__meta">
                    <span>{formatDate(item.updatedAt)}</span>
                    {item.properties?.[0]?.id && (
                      <span className="property-links__id">{item.properties[0].id}</span>
                    )}
                  </div>
                </button>
                <div className="inbox-row__actions">
                  {item.chatId && (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => openChat(item)}
                    >
                      Чат
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => setSelectedId(item.id)}
                  >
                    Детали
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="pagination">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={meta.page <= 1}
              onClick={() => goPage(meta.page - 1)}
            >
              ←
            </button>
            <span>
              {meta.page} / {meta.totalPages}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => goPage(meta.page + 1)}
            >
              →
            </button>
          </div>
        )}
      </div>

      {selectedId && (
        <DetailModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => fetchPage(meta.page, { silent: true })}
          onOpenChat={openChat}
        />
      )}

      {chatTarget && (
        <ChatPanel
          chatId={chatTarget.chatId}
          title={chatTarget.title}
          subtitle={chatTarget.subtitle}
          onClose={() => setChatTarget(null)}
        />
      )}
    </>
  );
}
