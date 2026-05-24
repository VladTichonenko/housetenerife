import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconClose } from './Icons';

const PAGE_SIZE = 24;

const LANG_LABELS = {
  ru: 'Русский',
  en: 'Английский',
  es: 'Испанский',
  de: 'Немецкий',
  fr: 'Французский',
  it: 'Итальянский',
  pt: 'Португальский',
};

function languageLabel(lead) {
  return lead.languageLabel || LANG_LABELS[lead.language] || lead.language || '—';
}

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

function summaryPreview(summary, max = 140) {
  const s = (summary || '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function HandoffModal({ leadId, onClose }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const data = await api.getHandoff(leadId);
      setLead(data.item);
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить карточку');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="handoff-modal-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog modal__dialog--wide handoff-modal">
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>

        {loading && !lead ? (
          <p className="handoff-modal__loading">Загрузка…</p>
        ) : error ? (
          <>
            <p className="form-error">{error}</p>
            <button type="button" className="btn btn--primary" onClick={load}>
              Повторить
            </button>
          </>
        ) : lead ? (
          <>
            <h2 id="handoff-modal-title" className="modal__title">
              {lead.clientName || lead.phoneDisplay || lead.phone}
            </h2>
            <p className="modal__subtitle">
              {lead.reasonLabel} · {formatDate(lead.createdAt)}
            </p>

            <div className="handoff-modal__block handoff-modal__meta-row">
              {lead.clientName && (
                <span className="handoff-card__badge">{lead.clientName}</span>
              )}
              <span className="handoff-card__lang">{languageLabel(lead)}</span>
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Контакт</span>
              <p className="handoff-modal__phone">{lead.phoneDisplay}</p>
              {lead.waLink && (
                <a
                  href={lead.waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--primary btn--sm handoff-modal__wa"
                >
                  Написать в WhatsApp
                </a>
              )}
              <p className="handoff-modal__meta">ID чата: {lead.chatId}</p>
            </div>

            {lead.preview && (
              <div className="handoff-modal__block">
                <span className="handoff-modal__label">Триггер передачи</span>
                <p className="handoff-modal__preview">{lead.preview}</p>
              </div>
            )}

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Выжимка для менеджера</span>
              {lead.summaryStatus === 'pending' ? (
                <>
                  <p className="handoff-modal__pending">ИИ формирует краткую выжимку…</p>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={load}>
                    Обновить
                  </button>
                </>
              ) : (
                <div className="handoff-modal__summary">{lead.summary}</div>
              )}
            </div>

            <button type="button" className="btn btn--ghost btn--sm" onClick={load}>
              Обновить карточку
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function ManagerHandoffsSection() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const fetchPage = useCallback(async (page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await api.getHandoffs({ page, limit: PAGE_SIZE });
      setItems(data.items || []);
      setMeta({
        total: data.total ?? 0,
        page: data.page ?? 1,
        totalPages: data.totalPages ?? 1,
      });
    } catch (err) {
      setError(err.message || 'Не удалось загрузить лиды');
      if (!silent) setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  const refresh = () => fetchPage(meta.page);

  const goPage = (p) => {
    const next = Math.max(1, Math.min(p, meta.totalPages));
    fetchPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <div className="card handoffs-intro">
        <p className="card__desc">
          Клиенты, которых бот передал менеджеру: по ссылке, фото с описанием или по запросу «менеджер».
          Нажмите на карточку — контакт и краткая выжимка диалога (без полной переписки).
        </p>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Загрузка…' : 'Обновить'}
        </button>
      </div>

      {error && (
        <div className="card">
          <p className="form-error">{error}</p>
          <button type="button" className="btn btn--primary" onClick={refresh}>
            Повторить
          </button>
        </div>
      )}

      {loading && !items.length ? (
        <div className="session-status__loader">Загрузка лидов…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="card__desc">
            Пока нет переданных клиентов. Лиды появятся после первой передачи менеджеру в WhatsApp.
            Нажмите «Обновить», чтобы проверить снова.
          </p>
        </div>
      ) : (
        <>
          <div className={`handoff-grid${loading ? ' handoff-grid--loading' : ''}`}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="handoff-card"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="handoff-card__badge">{item.reasonLabel}</span>
                <span className="handoff-card__phone">
                  {item.clientName ? `${item.clientName} · ` : ''}
                  {item.phoneDisplay || item.phone}
                </span>
                <span className="handoff-card__date">
                  {languageLabel(item)} · {formatDate(item.createdAt)}
                </span>
                {item.summaryStatus === 'pending' ? (
                  <span className="handoff-card__summary handoff-card__summary--pending">
                    Выжимка формируется — нажмите «Обновить»
                  </span>
                ) : (
                  <span className="handoff-card__summary">
                    {summaryPreview(item.summary) || 'Выжимка готова'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {meta.totalPages > 1 && (
            <div className="catalog-pagination">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={meta.page <= 1 || loading}
                onClick={() => goPage(meta.page - 1)}
              >
                Назад
              </button>
              <span className="catalog-pagination__info">
                {meta.page} / {meta.totalPages} · всего {meta.total}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={meta.page >= meta.totalPages || loading}
                onClick={() => goPage(meta.page + 1)}
              >
                Вперёд
              </button>
            </div>
          )}
        </>
      )}

      {selectedId && <HandoffModal leadId={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  );
}
