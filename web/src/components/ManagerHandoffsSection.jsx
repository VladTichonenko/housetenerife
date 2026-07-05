import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { IconClose } from './Icons';

const PAGE_SIZE = 50;

const LANG_LABELS = {
  ru: 'Русский',
  en: 'Английский',
  es: 'Испанский',
  de: 'Немецкий',
  fr: 'Французский',
  it: 'Итальянский',
  pt: 'Португальский',
};

const STATUS_LABELS = {
  new: 'Новая',
  in_progress: 'В работе',
  closed: 'Завершена',
};

const LEAD_FILTERS = [
  { id: 'open', label: 'Открытые' },
  { id: 'mine', label: 'Мои' },
  { id: 'new', label: 'Новые' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'active', label: 'Активные' },
  { id: 'closed', label: 'Завершённые' },
];

function languageLabel(item) {
  return item.languageLabel || LANG_LABELS[item.language] || item.language || '—';
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function summaryPreview(summary, max = 120) {
  const s = (summary || '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function linkifyText(text) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="chat-link">
        {part}
      </a>
    ) : (
      part
    )
  );
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

function PropertyLinks({ properties, compact = false }) {
  if (!properties?.length) return null;
  return (
    <div className={`property-links${compact ? ' property-links--compact' : ''}`}>
      <span className="property-links__title">
        {compact ? 'Объекты' : 'Интерес клиента к объектам'}
      </span>
      <ul className="property-links__list">
        {properties.map((p) => (
          <li key={p.id} className="property-links__item">
            <div className="property-links__main">
              <span className="property-links__id">{p.id}</span>
              <span className="property-links__name">{p.title}</span>
              {p.price && <span className="property-links__price">{p.price}</span>}
            </div>
            {p.siteUrl && (
              <a
                href={p.siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="property-links__url"
              >
                На сайте
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  return <span className={`lead-status lead-status--${status || 'new'}`}>{label}</span>;
}

function ChatPanel({ chatId, title, subtitle, onClose }) {
  const [messages, setMessages] = useState([]);
  const [interestedProperties, setInterestedProperties] = useState([]);
  const [settings, setSettings] = useState({ aiDisabled: false });
  const [client, setClient] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  const load = useCallback(async () => {
    if (!chatId) return;
    try {
      const data = await api.getChatMessages(chatId);
      setMessages(data.messages || []);
      setInterestedProperties(data.interestedProperties || []);
      setSettings(data.settings || { aiDisabled: false });
      setClient(data.client);
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить переписку');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    document.body.classList.add('chat-fullscreen-open');
    return () => document.body.classList.remove('chat-fullscreen-open');
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSend = async (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const data = await api.sendChatMessage(chatId, trimmed);
      setText('');
      setSettings(data.settings || settings);
      await load();
    } catch (err) {
      setError(err.message || 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  const toggleAi = async () => {
    setTogglingAi(true);
    try {
      const data = await api.setAiDisabled(chatId, !settings.aiDisabled);
      setSettings(data.settings);
    } catch (err) {
      setError(err.message || 'Не удалось изменить настройку ИИ');
    } finally {
      setTogglingAi(false);
    }
  };

  return (
    <div className="modal modal--chat" role="dialog" aria-modal="true" aria-labelledby="chat-panel-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog modal__dialog--wide chat-panel">
        <header className="chat-panel__topbar">
          <button type="button" className="chat-panel__back" onClick={onClose} aria-label="Назад">
            ←
          </button>
          <div className="chat-panel__topbar-info">
            <h2 id="chat-panel-title" className="chat-panel__topbar-title">
              {title || client?.chatName || client?.phoneDisplay || chatId}
            </h2>
            {subtitle && <p className="chat-panel__topbar-sub">{subtitle}</p>}
          </div>
          <button
            type="button"
            className={`btn btn--sm chat-panel__ai-btn ${settings.aiDisabled ? 'btn--primary' : 'btn--outline'}`}
            onClick={toggleAi}
            disabled={togglingAi}
          >
            {togglingAi ? '…' : settings.aiDisabled ? 'ИИ вкл' : 'ИИ выкл'}
          </button>
        </header>

        <button type="button" className="modal__close modal__close--chat" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>

        <div className="chat-panel__body">
          {settings.aiDisabled && (
            <p className="chat-panel__ai-hint">ИИ не отвечает — только менеджер.</p>
          )}

          <PropertyLinks properties={interestedProperties} />

          {error && <p className="form-error">{error}</p>}

          <div className="chat-panel__messages">
            {loading && !messages.length ? (
              <p className="handoff-modal__loading">Загрузка…</p>
            ) : messages.length === 0 ? (
              <p className="chat-panel__empty">Сообщений пока нет</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id || `${m.at}-${m.role}`}
                  className={`chat-bubble chat-bubble--${bubbleRole(m)}`}
                >
                  <span className="chat-bubble__author">{bubbleLabel(m)}</span>
                  <p className="chat-bubble__text">{linkifyText(m.text)}</p>
                  <span className="chat-bubble__time">{formatDate(m.at)}</span>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form className="chat-panel__composer" onSubmit={handleSend}>
          <textarea
            className="chat-panel__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Написать клиенту…"
            rows={2}
            disabled={sending}
          />
          <button type="submit" className="btn btn--primary" disabled={sending || !text.trim()}>
            {sending ? '…' : 'Отправить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function HandoffModal({ leadId, onClose, onStartChat, onUpdated }) {
  const { manager } = useAuth();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const data = await api.getHandoff(leadId);
      setLead(data.item);
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить');
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

  const handleAssign = async () => {
    setBusy(true);
    try {
      const data = await api.assignHandoff(leadId);
      setLead(data.item);
      onUpdated?.();
    } catch (err) {
      setError(err.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      const data = await api.closeHandoff(leadId);
      setLead(data.item);
      onUpdated?.();
    } catch (err) {
      setError(err.message || 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const isAssignedToMe = lead?.assignedManagerId === manager?.id;
  const isClosed = lead?.status === 'closed';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="handoff-modal-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog modal__dialog--wide handoff-modal">
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>

        {loading && !lead ? (
          <p className="handoff-modal__loading">Загрузка…</p>
        ) : error && !lead ? (
          <>
            <p className="form-error">{error}</p>
            <button type="button" className="btn btn--primary" onClick={load}>
              Повторить
            </button>
          </>
        ) : lead ? (
          <>
            <div className="handoff-modal__top">
              <div>
                <h2 id="handoff-modal-title" className="modal__title">
                  {lead.clientName || lead.phoneDisplay || lead.phone}
                </h2>
                <p className="modal__subtitle">
                  {lead.reasonLabel} · {formatDate(lead.createdAt)}
                </p>
              </div>
              <StatusBadge status={lead.status} />
            </div>

            <div className="handoff-modal__meta-row">
              <span className="handoff-card__lang">{languageLabel(lead)}</span>
              {lead.assignedManagerName && (
                <span className="handoff-card__badge handoff-card__badge--assigned">
                  {lead.assignedManagerName}
                </span>
              )}
            </div>

            <PropertyLinks properties={lead.interestedProperties} />

            <div className="handoff-modal__actions">
              {!isClosed && (
                <label className="handoff-assign">
                  <input
                    type="checkbox"
                    checked={isAssignedToMe}
                    disabled={busy}
                    onChange={handleAssign}
                  />
                  <span>Взять в работу{manager ? ` (${manager.name})` : ''}</span>
                </label>
              )}
              <button type="button" className="btn btn--primary btn--sm" onClick={() => onStartChat(lead)}>
                Чат
              </button>
              <button
                type="button"
                className={`btn btn--sm ${isClosed ? 'btn--outline' : 'btn--ghost'}`}
                onClick={handleClose}
                disabled={busy}
              >
                {isClosed ? 'Вернуть в работу' : 'Завершить'}
              </button>
              {lead.waLink && (
                <a href={lead.waLink} target="_blank" rel="noopener noreferrer" className="btn btn--outline btn--sm">
                  WhatsApp
                </a>
              )}
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Контакт</span>
              <p className="handoff-modal__phone">{lead.phoneDisplay}</p>
            </div>

            {lead.preview && (
              <div className="handoff-modal__block">
                <span className="handoff-modal__label">Триггер</span>
                <p className="handoff-modal__preview">{lead.preview}</p>
              </div>
            )}

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Выжимка</span>
              {lead.summaryStatus === 'pending' ? (
                <p className="handoff-modal__pending">Формируется…</p>
              ) : (
                <div className="handoff-modal__summary">{lead.summary}</div>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function ManagerHandoffsSection() {
  const { manager } = useAuth();
  const [mode, setMode] = useState('leads');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [leadFilter, setLeadFilter] = useState('open');
  const [managerFilter, setManagerFilter] = useState('');
  const [managers, setManagers] = useState([]);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [chatTarget, setChatTarget] = useState(null);

  useEffect(() => {
    api.managers().then((d) => setManagers(d.managers || [])).catch(() => {});
  }, []);

  const fetchPage = useCallback(
    async (page, { silent = false } = {}) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const data =
          mode === 'all'
            ? await api.getClients({ page, limit: PAGE_SIZE, q: search })
            : await api.getHandoffs({
                page,
                limit: PAGE_SIZE,
                q: search,
                filter: leadFilter,
                managerId: managerFilter,
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
    [mode, search, leadFilter, managerFilter]
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

  const handleAssignRow = async (e, leadId) => {
    e.stopPropagation();
    try {
      await api.assignHandoff(leadId);
      fetchPage(meta.page, { silent: true });
    } catch (err) {
      setError(err.message || 'Ошибка');
    }
  };

  const handleCloseRow = async (e, leadId) => {
    e.stopPropagation();
    try {
      await api.closeHandoff(leadId);
      fetchPage(meta.page, { silent: true });
    } catch (err) {
      setError(err.message || 'Ошибка');
    }
  };

  const openChat = (item) => {
    setChatTarget({
      chatId: item.chatId || item.id,
      title: item.clientName || item.chatName || item.phoneDisplay || item.phone,
      subtitle: mode === 'leads' ? item.reasonLabel : languageLabel(item),
    });
  };

  return (
    <>
      <div className="inbox-shell">
        <div className="inbox-shell__head">
          <div>
            <h3 className="inbox-shell__title">Входящие</h3>
            {manager && <p className="inbox-shell__user">{manager.name}</p>}
          </div>
          <div className="segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'all'}
              className={`segmented__btn${mode === 'all' ? ' segmented__btn--active' : ''}`}
              onClick={() => {
                setSelectedLeadId(null);
                setChatTarget(null);
                setMode('all');
              }}
            >
              Все переписки
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'leads'}
              className={`segmented__btn${mode === 'leads' ? ' segmented__btn--active' : ''}`}
              onClick={() => {
                setSelectedLeadId(null);
                setChatTarget(null);
                setMode('leads');
              }}
            >
              Заявки
              {mode === 'leads' && meta.total > 0 && (
                <span className="segmented__count">{meta.total}</span>
              )}
            </button>
          </div>
        </div>

        <form className="inbox-toolbar" onSubmit={handleSearch}>
          <input
            type="search"
            className="inbox-toolbar__search"
            placeholder={mode === 'all' ? 'Телефон, имя, сообщение…' : 'Поиск заявок…'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn--outline btn--sm">
            Найти
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={refresh} disabled={loading}>
            {loading ? '…' : 'Обновить'}
          </button>
          <span className="inbox-toolbar__meta">
            {meta.total > 0 ? `${meta.total} записей` : ''}
          </span>
        </form>

        {mode === 'leads' && (
          <div className="inbox-filters">
            {LEAD_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`inbox-filters__chip${leadFilter === f.id ? ' inbox-filters__chip--active' : ''}`}
                onClick={() => setLeadFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
            <select
              className="inbox-filters__select"
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
            >
              <option value="">Все менеджеры</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="card">
          <p className="form-error">{error}</p>
        </div>
      )}

      {loading && !items.length ? (
        <div className="session-status__loader">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="card__desc">Ничего не найдено.</p>
        </div>
      ) : mode === 'leads' ? (
        <>
          <div className={`lead-table-wrap${loading ? ' lead-table-wrap--loading' : ''}`}>
            <table className="lead-table">
              <thead>
                <tr>
                  <th>Статус</th>
                  <th>Клиент</th>
                  <th>Причина</th>
                  <th>Менеджер</th>
                  <th>Объекты</th>
                  <th>Активность</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`lead-table__row${item.status === 'closed' ? ' lead-table__row--closed' : ''}`}
                    onClick={() => setSelectedLeadId(item.id)}
                  >
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>
                      <span className="lead-table__name">
                        {item.clientName || item.phoneDisplay || item.phone}
                      </span>
                      <span className="lead-table__sub">{item.phoneDisplay}</span>
                    </td>
                    <td className="lead-table__reason">{item.reasonLabel}</td>
                    <td>{item.assignedManagerName || '—'}</td>
                    <td>
                      {item.interestedProperties?.length ? (
                        <span className="lead-table__props" title={item.interestedProperties.map((p) => p.title).join(', ')}>
                          {item.interestedProperties.length} · {item.interestedProperties[0].id}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="lead-table__date">
                      {formatDate(item.lastActivityAt || item.createdAt)}
                    </td>
                    <td className="lead-table__actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`lead-table__action${item.assignedManagerId === manager?.id ? ' lead-table__action--on' : ''}`}
                        title="Взять в работу"
                        onClick={(e) => handleAssignRow(e, item.id)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="lead-table__action"
                        title="Чат"
                        onClick={() => openChat(item)}
                      >
                        💬
                      </button>
                      <button
                        type="button"
                        className={`lead-table__action${item.status === 'closed' ? ' lead-table__action--on' : ''}`}
                        title={item.status === 'closed' ? 'Вернуть' : 'Завершить'}
                        onClick={(e) => handleCloseRow(e, item.id)}
                      >
                        {item.status === 'closed' ? '↩' : '✕'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta.totalPages > 1 && (
            <div className="catalog-pagination">
              <button type="button" className="btn btn--ghost btn--sm" disabled={meta.page <= 1} onClick={() => goPage(meta.page - 1)}>
                Назад
              </button>
              <span className="catalog-pagination__info">
                {meta.page} / {meta.totalPages}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" disabled={meta.page >= meta.totalPages} onClick={() => goPage(meta.page + 1)}>
                Вперёд
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`conv-list${loading ? ' conv-list--loading' : ''}`}>
            {items.map((item) => (
              <button key={item.id} type="button" className="conv-list__row" onClick={() => openChat(item)}>
                <div className="conv-list__main">
                  <span className="conv-list__name">
                    {item.chatName || item.clientName || item.phoneDisplay || item.phone}
                  </span>
                  <span className="conv-list__preview">{summaryPreview(item.lastMessage, 80) || '—'}</span>
                </div>
                <div className="conv-list__meta">
                  <span>{formatDate(item.lastSeenAt)}</span>
                  <span>{item.messageCount || 0} msg</span>
                </div>
              </button>
            ))}
          </div>
          {meta.totalPages > 1 && (
            <div className="catalog-pagination">
              <button type="button" className="btn btn--ghost btn--sm" disabled={meta.page <= 1} onClick={() => goPage(meta.page - 1)}>
                Назад
              </button>
              <span className="catalog-pagination__info">
                {meta.page} / {meta.totalPages}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" disabled={meta.page >= meta.totalPages} onClick={() => goPage(meta.page + 1)}>
                Вперёд
              </button>
            </div>
          )}
        </>
      )}

      {selectedLeadId && (
        <HandoffModal
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onStartChat={(lead) => {
            setSelectedLeadId(null);
            openChat(lead);
          }}
          onUpdated={refresh}
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
