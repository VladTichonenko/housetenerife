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

function lastMessageNeedsBotReply(messages) {
  if (!messages?.length) return false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const role = messages[i]?.role;
    if (role === 'user') return true;
    if (role === 'assistant' || role === 'manager') return false;
  }
  return false;
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

export default function ChatPanel({
  chatId,
  title,
  subtitle,
  onClose,
  needsCatchUp = false,
  onCatchUpDone,
  showToast,
}) {
  const [messages, setMessages] = useState([]);
  const [interestedProperties, setInterestedProperties] = useState([]);
  const [settings, setSettings] = useState({ aiDisabled: false });
  const [client, setClient] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);
  const [error, setError] = useState('');
  const [catchUpDone, setCatchUpDone] = useState(false);
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

  const awaitingBot =
    !catchUpDone && (needsCatchUp || lastMessageNeedsBotReply(messages));

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

  const handleEnableAiAndReply = async () => {
    if (catchingUp || sending) return;
    setCatchingUp(true);
    setError('');
    try {
      if (settings.aiDisabled) {
        const s = await api.setAiDisabled(chatId, false);
        setSettings(s.settings || { aiDisabled: false });
      }
      const data = await api.catchUpChat(chatId);
      setCatchUpDone(true);
      showToast?.(data.message || 'ИИ ответил клиенту', 'success');
      await load();
      onCatchUpDone?.(chatId);
    } catch (err) {
      const msg = err.message || 'Не удалось включить ИИ и ответить';
      setError(msg);
      showToast?.(msg, 'error');
    } finally {
      setCatchingUp(false);
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
        </header>

        <button type="button" className="modal__close modal__close--chat" onClick={onClose} aria-label="Закрыть">
          <IconClose />
        </button>

        <div className="chat-panel__body">
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

        {awaitingBot && (
          <div className="chat-panel__catchup">
            <p className="chat-panel__catchup-text">
              {settings.aiDisabled
                ? 'ИИ выключен — клиент ждёт ответа.'
                : 'Клиент написал, пока бот не отвечал.'}
            </p>
            <button
              type="button"
              className="btn btn--primary chat-panel__catchup-btn"
              onClick={handleEnableAiAndReply}
              disabled={catchingUp}
            >
              {catchingUp ? 'Отвечаю…' : 'Включить ИИ и ответить'}
            </button>
          </div>
        )}

        <form className="chat-panel__composer" onSubmit={handleSend}>
          <textarea
            className="chat-panel__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Написать клиенту…"
            rows={2}
            disabled={sending || catchingUp}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={sending || catchingUp || !text.trim()}
          >
            {sending ? '…' : 'Отправить'}
          </button>
        </form>
      </div>
    </div>
  );
}

export { PropertyLinks, formatDate, linkifyText };
