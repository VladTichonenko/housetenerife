import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken } from '../api/client';
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

function formatDayLabel(iso) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(date, today)) return 'Сегодня';
    if (sameDay(date, yesterday)) return 'Вчера';
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

function dayKey(iso) {
  if (!iso) return 'unknown';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  } catch {
    return String(iso);
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

/** Текст для панели: без служебных блоков vision/ссылок, которые нужны только ИИ. */
function displayBubbleText(text) {
  return String(text || '')
    .replace(/\[описание фото\][\s\S]*?(?=\n\[|$)/gi, '')
    .replace(/\[содержимое ссылки\][\s\S]*?(?=\n\[|$)/gi, '')
    .replace(/\[фото без подписи\]\s*/gi, '')
    .replace(/^\[фото\]\s*/i, '')
    .replace(/^\[image\]\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mediaSrc(url) {
  if (!url) return '';
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function isNoiseUserMessage(m) {
  const t = String(m?.text || '').trim();
  if (!t) return true;
  return /^\[e2e_notification\]$/i.test(t);
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

function initialsFrom(name) {
  const parts = String(name || '')
    .replace(/[^\p{L}\p{N}\s+]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts[0].startsWith('+')) return '#';
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
  return letters || '?';
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

/** Сколько подряд сообщений клиента в хвосте без ответа бота/менеджера.
 * Число на кнопке «ответить (N)» = размер пачки; ИИ даёт один ответ на все N. */
function countPendingUserMessages(messages) {
  if (!messages?.length) return 0;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const role = messages[i]?.role;
    if (role === 'user') {
      if (!isNoiseUserMessage(messages[i])) count += 1;
      continue;
    }
    if (role === 'assistant' || role === 'manager') break;
  }
  return count;
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

function IconSend() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
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
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [error, setError] = useState('');
  const [catchUpDone, setCatchUpDone] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const autoSyncedRef = useRef('');

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

  const syncHistoryFromWhatsApp = useCallback(async () => {
    if (!chatId || syncingHistory) return;
    setSyncingHistory(true);
    setError('');
    try {
      const data = await api.syncChatMissed(chatId);
      showToast?.(data.message || 'История обновлена', 'success');
      await load();
    } catch (err) {
      const msg = err.message || 'Не удалось подтянуть историю из WhatsApp';
      setError(msg);
      showToast?.(msg, 'error');
    } finally {
      setSyncingHistory(false);
    }
  }, [chatId, syncingHistory, load, showToast]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  // При открытии чата один раз подтянуть полную историю из WhatsApp
  // (иначе в панели часто остаётся только последнее сообщение).
  useEffect(() => {
    if (!chatId || loading || autoSyncedRef.current === chatId) return undefined;
    autoSyncedRef.current = chatId;
    let cancelled = false;
    (async () => {
      try {
        setSyncingHistory(true);
        await api.syncChatMissed(chatId);
        if (!cancelled) await load();
      } catch {
        /* тихо: кнопку «Подтянуть историю» можно нажать вручную */
      } finally {
        if (!cancelled) setSyncingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, loading, load]);

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

  const pendingUserCount = countPendingUserMessages(messages);
  const awaitingBot =
    !catchUpDone && (needsCatchUp || lastMessageNeedsBotReply(messages));

  const resolvedPhone =
    client?.phoneDisplay && !/whatsapp id/i.test(client.phoneDisplay)
      ? client.phoneDisplay
      : '';
  const displayTitle =
    (client?.name && !/whatsapp id/i.test(client.name) ? client.name : '') ||
    (client?.chatName && !/whatsapp id/i.test(client.chatName) ? client.chatName : '') ||
    resolvedPhone ||
    (title && !/whatsapp id/i.test(title) ? title : '') ||
    title ||
    client?.phoneDisplay ||
    chatId;
  const displaySubtitle =
    resolvedPhone && resolvedPhone !== displayTitle
      ? resolvedPhone
      : subtitle && !/whatsapp id/i.test(subtitle)
        ? subtitle
        : resolvedPhone && resolvedPhone === displayTitle
          ? ''
          : subtitle || '';

  const timeline = useMemo(() => {
    const rows = [];
    let lastDay = '';
    for (const m of messages) {
      const key = dayKey(m.at);
      if (key !== lastDay) {
        const label = formatDayLabel(m.at);
        if (label) rows.push({ type: 'day', id: `day-${key}`, label });
        lastDay = key;
      }
      rows.push({ type: 'msg', id: m.id || `${m.at}-${m.role}-${rows.length}`, message: m });
    }
    return rows;
  }, [messages]);

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
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message || 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending && !catchingUp && text.trim()) {
        e.currentTarget.form?.requestSubmit();
      }
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
          <div className="chat-panel__avatar" aria-hidden>
            {initialsFrom(displayTitle)}
          </div>
          <div className="chat-panel__topbar-info">
            <h2 id="chat-panel-title" className="chat-panel__topbar-title">
              {displayTitle}
            </h2>
            {displaySubtitle && <p className="chat-panel__topbar-sub">{displaySubtitle}</p>}
          </div>
          <button type="button" className="chat-panel__icon-btn modal__close--chat" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </header>

        <div className="chat-panel__body">
          {interestedProperties?.length > 0 && (
            <div className="chat-panel__props">
              <PropertyLinks properties={interestedProperties} compact />
            </div>
          )}

          {error && <p className="chat-panel__error">{error}</p>}

          <div className="chat-panel__messages">
            {loading && !messages.length ? (
              <p className="chat-panel__empty">Загрузка…</p>
            ) : messages.length === 0 ? (
              <p className="chat-panel__empty">Сообщений пока нет</p>
            ) : (
              timeline.map((row) =>
                row.type === 'day' ? (
                  <div key={row.id} className="chat-day">
                    <span className="chat-day__label">{row.label}</span>
                  </div>
                ) : (
                  <div
                    key={row.id}
                    className={`chat-bubble chat-bubble--${bubbleRole(row.message)}`}
                  >
                    <span className="chat-bubble__author">{bubbleLabel(row.message)}</span>
                    {(row.message.mediaUrl ||
                      row.message.kind === 'image' ||
                      /^\[(image|фото)/i.test(String(row.message.text || ''))) &&
                      row.message.mediaUrl && (
                        <img
                          className="chat-bubble__media"
                          src={mediaSrc(row.message.mediaUrl)}
                          alt="Фото из чата"
                          loading="lazy"
                        />
                      )}
                    {displayBubbleText(row.message.text) ? (
                      <p className="chat-bubble__text">
                        {linkifyText(displayBubbleText(row.message.text))}
                      </p>
                    ) : !row.message.mediaUrl &&
                      /^\[(image|фото)/i.test(String(row.message.text || '')) ? (
                      <p className="chat-bubble__text">[фото]</p>
                    ) : null}
                    <span className="chat-bubble__meta">
                      <span className="chat-bubble__time">{formatBubbleTime(row.message.at)}</span>
                      {bubbleRole(row.message) !== 'user' && (
                        <span className="chat-bubble__ticks" aria-hidden>
                          ✓✓
                        </span>
                      )}
                    </span>
                  </div>
                )
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="chat-panel__catchup">
          <p className="chat-panel__catchup-text">
            {syncingHistory
              ? 'Подтягиваю все сообщения из WhatsApp…'
              : awaitingBot
                ? settings.aiDisabled
                  ? 'ИИ выключен — клиент ждёт ответа.'
                  : pendingUserCount > 1
                    ? `Клиент написал ${pendingUserCount} сообщ. без ответа. Число на кнопке — размер пачки: ИИ даст один ответ по всем.`
                    : 'Клиент написал, пока бот не отвечал.'
                : `В истории ${messages.length || 0} сообщ. Если чего-то не хватает — подтяните из WhatsApp.`}
          </p>
          <div className="chat-panel__catchup-actions">
            <button
              type="button"
              className="btn btn--outline chat-panel__catchup-btn"
              onClick={syncHistoryFromWhatsApp}
              disabled={syncingHistory || catchingUp}
            >
              {syncingHistory ? 'Собираю…' : 'Подтянуть историю'}
            </button>
            {awaitingBot && (
              <button
                type="button"
                className="btn btn--primary chat-panel__catchup-btn"
                onClick={handleEnableAiAndReply}
                disabled={catchingUp || syncingHistory}
                title={
                  pendingUserCount > 1
                    ? `Один ответ ИИ на ${pendingUserCount} сообщений клиента`
                    : 'Включить ИИ и ответить'
                }
              >
                {catchingUp
                  ? 'ИИ отвечает…'
                  : pendingUserCount > 1
                    ? `Один ответ ИИ (${pendingUserCount})`
                    : 'Включить ИИ и ответить'}
              </button>
            )}
          </div>
        </div>

        <form className="chat-panel__composer" onSubmit={handleSend}>
          <textarea
            ref={inputRef}
            className="chat-panel__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Введите сообщение"
            rows={1}
            disabled={sending || catchingUp}
          />
          <button
            type="submit"
            className="chat-panel__send"
            disabled={sending || catchingUp || !text.trim()}
            aria-label="Отправить"
          >
            {sending ? '…' : <IconSend />}
          </button>
        </form>
      </div>
    </div>
  );
}

export { PropertyLinks, formatDate, linkifyText };
