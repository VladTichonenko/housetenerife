import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
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

function languageLabel(item) {
  return item.languageLabel || LANG_LABELS[item.language] || item.language || '—';
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

function ChatPanel({ chatId, title, subtitle, onClose }) {
  const [messages, setMessages] = useState([]);
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
      const data = await api.getChatMessages(chatId, { excludeAssistant: true });
      setMessages(data.messages || []);
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
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="chat-panel-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog modal__dialog--wide chat-panel">
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>

        <div className="chat-panel__header">
          <div>
            <h2 id="chat-panel-title" className="modal__title">
              {title || client?.chatName || client?.phoneDisplay || chatId}
            </h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className={`btn btn--sm ${settings.aiDisabled ? 'btn--primary' : 'btn--outline'}`}
            onClick={toggleAi}
            disabled={togglingAi}
          >
            {togglingAi
              ? '…'
              : settings.aiDisabled
                ? 'Включить ответы ИИ'
                : 'Выключить ответы ИИ'}
          </button>
        </div>

        {settings.aiDisabled && (
          <p className="chat-panel__ai-hint">
            ИИ не отвечает этому клиенту — общение только от менеджера.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="chat-panel__messages">
          {loading && !messages.length ? (
            <p className="handoff-modal__loading">Загрузка переписки…</p>
          ) : messages.length === 0 ? (
            <p className="chat-panel__empty">Сообщений пока нет</p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id || `${m.at}-${m.role}`}
                className={`chat-bubble chat-bubble--${m.role === 'manager' ? 'manager' : 'user'}`}
              >
                {m.role === 'manager' && m.managerName && (
                  <span className="chat-bubble__author">{m.managerName}</span>
                )}
                <p className="chat-bubble__text">{m.text}</p>
                <span className="chat-bubble__time">{formatDate(m.at)}</span>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-panel__composer" onSubmit={handleSend}>
          <textarea
            className="chat-panel__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Написать клиенту от лица WhatsApp-аккаунта…"
            rows={2}
            disabled={sending}
          />
          <button type="submit" className="btn btn--primary" disabled={sending || !text.trim()}>
            {sending ? 'Отправка…' : 'Отправить'}
          </button>
        </form>
      </div>
    </div>
  );
}

function HandoffModal({ leadId, onClose, onStartChat }) {
  const { manager } = useAuth();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
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

  const handleAssign = async () => {
    setAssigning(true);
    try {
      const data = await api.assignHandoff(leadId);
      setLead(data.item);
    } catch (err) {
      setError(err.message || 'Не удалось обновить заявку');
    } finally {
      setAssigning(false);
    }
  };

  const isAssignedToMe = lead?.assignedManagerId === manager?.id;

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
              {lead.assignedManagerName && (
                <span className="handoff-card__badge handoff-card__badge--assigned">
                  {lead.assignedManagerName}
                </span>
              )}
            </div>

            <label className="handoff-assign">
              <input
                type="checkbox"
                checked={isAssignedToMe}
                disabled={assigning}
                onChange={handleAssign}
              />
              <span>Взять заявку в работу{manager ? ` (${manager.name})` : ''}</span>
            </label>

            <div className="handoff-modal__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onStartChat(lead)}
              >
                Начать общение
              </button>
              {lead.waLink && (
                <a
                  href={lead.waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--outline btn--sm"
                >
                  WhatsApp
                </a>
              )}
            </div>

            <div className="handoff-modal__block">
              <span className="handoff-modal__label">Контакт</span>
              <p className="handoff-modal__phone">{lead.phoneDisplay}</p>
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

            {error && <p className="form-error">{error}</p>}

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
  const { manager } = useAuth();
  const [mode, setMode] = useState('all');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [leadFilter, setLeadFilter] = useState('all');
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
        setError(err.message || 'Не удалось загрузить данные');
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

  const refresh = () => fetchPage(meta.page);

  const goPage = (p) => {
    const next = Math.max(1, Math.min(p, meta.totalPages));
    fetchPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleAssignCard = async (e, leadId) => {
    e.stopPropagation();
    try {
      await api.assignHandoff(leadId);
      fetchPage(meta.page, { silent: true });
    } catch (err) {
      setError(err.message || 'Не удалось закрепить заявку');
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
      <div className="card handoffs-intro">
        <p className="card__desc">
          <strong>Все</strong> — переписки с ботом (без ответов ИИ).{' '}
          <strong>Заявки</strong> — переданные менеджеру с выжимкой.
          {manager && (
            <>
              {' '}
              Вы вошли как <strong>{manager.name}</strong>.
            </>
          )}
        </p>
        <div className="handoff-tabs">
          <button
            type="button"
            className={`btn btn--sm ${mode === 'all' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => {
              setSelectedLeadId(null);
              setChatTarget(null);
              setMode('all');
            }}
          >
            Все
          </button>
          <button
            type="button"
            className={`btn btn--sm ${mode === 'leads' ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => {
              setSelectedLeadId(null);
              setChatTarget(null);
              setMode('leads');
            }}
          >
            Заявки
          </button>
        </div>

        <form className="handoffs-toolbar" onSubmit={handleSearch}>
          <input
            type="search"
            className="handoffs-toolbar__search"
            placeholder={mode === 'all' ? 'Поиск по имени, телефону…' : 'Поиск по заявкам…'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn--outline btn--sm">
            Найти
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? 'Загрузка…' : 'Обновить'}
          </button>
        </form>

        {mode === 'leads' && (
          <div className="handoffs-filters">
            {[
              { id: 'all', label: 'Все' },
              { id: 'new', label: 'Новые' },
              { id: 'active', label: 'Самые активные' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                className={`btn btn--sm ${leadFilter === f.id ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setLeadFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
            <select
              className="handoffs-filters__select"
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
          <button type="button" className="btn btn--primary" onClick={refresh}>
            Повторить
          </button>
        </div>
      )}

      {loading && !items.length ? (
        <div className="session-status__loader">
          {mode === 'all' ? 'Загрузка переписок…' : 'Загрузка заявок…'}
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="card__desc">
            {mode === 'all'
              ? 'Пока нет переписок. Они появятся после первого сообщения в WhatsApp.'
              : 'Пока нет заявок. Они появятся после передачи клиента менеджеру.'}
          </p>
        </div>
      ) : (
        <>
          <div className={`handoff-grid${loading ? ' handoff-grid--loading' : ''}`}>
            {items.map((item) => (
              <div key={item.id} className="handoff-card-wrap">
                {mode === 'leads' && (
                  <label
                    className="handoff-card__assign"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={item.assignedManagerId === manager?.id}
                      onChange={(e) => handleAssignCard(e, item.id)}
                    />
                    <span>В работе</span>
                  </label>
                )}
                <button
                  type="button"
                  className="handoff-card"
                  onClick={() =>
                    mode === 'all' ? openChat(item) : setSelectedLeadId(item.id)
                  }
                >
                  <span className="handoff-card__badge">
                    {mode === 'all' ? 'Переписка' : item.reasonLabel}
                  </span>
                  {mode === 'leads' && item.assignedManagerName && (
                    <span className="handoff-card__badge handoff-card__badge--assigned">
                      {item.assignedManagerName}
                    </span>
                  )}
                  <span className="handoff-card__phone">
                    {item.clientName || item.chatName
                      ? `${item.clientName || item.chatName} · `
                      : ''}
                    {item.phoneDisplay || item.phone}
                  </span>
                  <span className="handoff-card__date">
                    {languageLabel(item)} ·{' '}
                    {formatDate(
                      mode === 'all'
                        ? item.lastSeenAt
                        : item.lastActivityAt || item.createdAt
                    )}
                  </span>
                  {mode === 'all' ? (
                    <span className="handoff-card__summary">
                      {summaryPreview(item.lastMessage) ||
                        `Сообщений: ${item.messageCount || 0}`}
                    </span>
                  ) : item.summaryStatus === 'pending' ? (
                    <span className="handoff-card__summary handoff-card__summary--pending">
                      Выжимка формируется
                    </span>
                  ) : (
                    <span className="handoff-card__summary">
                      {summaryPreview(item.summary) || 'Выжимка готова'}
                    </span>
                  )}
                </button>
              </div>
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

      {selectedLeadId && (
        <HandoffModal
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onStartChat={(lead) => {
            setSelectedLeadId(null);
            openChat(lead);
          }}
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
