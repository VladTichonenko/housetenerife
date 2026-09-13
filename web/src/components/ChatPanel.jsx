import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconClose } from './Icons';

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

export default function ChatPanel({ chatId, title, subtitle, onClose }) {
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

export { PropertyLinks, formatDate, linkifyText };
