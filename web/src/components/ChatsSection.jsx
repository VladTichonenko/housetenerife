import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import ChatPanel, { formatDate } from './ChatPanel';

const PAGE_SIZE = 50;

const FILTERS = [
  { id: 'pending', label: 'Ждут ответа' },
  { id: 'all', label: 'Все чаты' },
];

function contactLabel(item) {
  if (item.name) return item.name;
  if (item.chatName) return item.chatName;
  if (item.phoneDisplay) return item.phoneDisplay;
  return item.chatId || '—';
}

function previewText(text, max = 100) {
  const s = String(text || '').trim();
  if (!s) return '—';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export default function ChatsSection({ showToast }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [syncMeta, setSyncMeta] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [selectedChatId, setSelectedChatId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCatchUpInbox({
        page,
        limit: PAGE_SIZE,
        q,
        filter,
      });
      setItems(data.items || []);
      setMeta({
        total: data.total || 0,
        page: data.page || 1,
        totalPages: data.totalPages || 1,
      });
      setSyncMeta(data.meta || null);
      setError('');
    } catch (err) {
      setError(err.message || 'Не удалось загрузить чаты');
    } finally {
      setLoading(false);
    }
  }, [page, q, filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setQ(searchInput.trim());
  };

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const data = await api.syncMissedChats();
      showToast?.(data.message || 'Синхронизация завершена', 'success');
      setSyncMeta(data.meta || syncMeta);
      setFilter('pending');
      setPage(1);
      await load();
    } catch (err) {
      const msg = err.message || 'Не удалось собрать пропущенные';
      setError(msg);
      showToast?.(msg, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const selected = items.find((i) => i.chatId === selectedChatId);

  return (
    <div className="chats-section">
      <div className="card chats-section__intro">
        <p className="card__desc">
          Если сервер был выключен и клиенты писали в WhatsApp — соберите пропущенные сообщения,
          откройте нужный чат и нажмите «Включить ИИ и ответить».
        </p>
        <div className="chats-section__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Собираю…' : 'Собрать пропущенные'}
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={load} disabled={loading}>
            {loading ? '…' : 'Обновить список'}
          </button>
        </div>
        {syncMeta?.lastSyncAt && (
          <p className="chats-section__sync-meta">
            Последний сбор: {formatDate(syncMeta.lastSyncAt)}
            {syncMeta.lastSyncStats
              ? ` · импорт ${syncMeta.lastSyncStats.imported || 0} из ${syncMeta.lastSyncStats.scanned || 0}`
              : ''}
            {typeof syncMeta.pendingCount === 'number'
              ? ` · ждут ответа: ${syncMeta.pendingCount}`
              : ''}
          </p>
        )}
      </div>

      <div className="inbox-sticky">
        <form className="inbox-toolbar" onSubmit={handleSearch}>
          <input
            type="search"
            className="inbox-toolbar__search"
            placeholder="Телефон, имя, сообщение…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="btn btn--outline btn--sm">
            Найти
          </button>
          <span className="inbox-toolbar__meta">
            {meta.total > 0 ? `${meta.total} чатов` : ''}
          </span>
        </form>

        <div className="inbox-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`inbox-filters__chip${filter === f.id ? ' inbox-filters__chip--active' : ''}`}
              onClick={() => {
                setFilter(f.id);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
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
          <p className="card__desc">
            {filter === 'pending'
              ? 'Нет чатов, ожидающих ответа. Нажмите «Собрать пропущенные» или переключитесь на «Все чаты».'
              : 'Чатов пока нет.'}
          </p>
        </div>
      ) : (
        <>
          <div className={`lead-table-wrap${loading ? ' lead-table-wrap--loading' : ''}`}>
            <table className="lead-table">
              <thead>
                <tr>
                  <th>Статус</th>
                  <th>Клиент</th>
                  <th>Последнее сообщение</th>
                  <th>Когда</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.chatId}
                    className="lead-table__row"
                    onClick={() => setSelectedChatId(item.chatId)}
                  >
                    <td>
                      {item.needsCatchUp ? (
                        <span className="lead-status lead-status--new">Ждёт ответа</span>
                      ) : (
                        <span className="lead-status lead-status--closed">Ок</span>
                      )}
                      {item.aiDisabled ? (
                        <span className="chats-section__ai-off">ИИ выкл</span>
                      ) : null}
                    </td>
                    <td>
                      <span className="lead-table__name">{contactLabel(item)}</span>
                      <span className="lead-table__sub">
                        {item.phoneDisplay || item.chatId}
                        {item.languageLabel ? ` · ${item.languageLabel}` : ''}
                      </span>
                    </td>
                    <td className="lead-table__reason">{previewText(item.lastMessage)}</td>
                    <td className="lead-table__date">{formatDate(item.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta.totalPages > 1 && (
            <div className="pager">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Назад
              </button>
              <span className="pager__meta">
                {meta.page} / {meta.totalPages}
              </span>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </button>
            </div>
          )}
        </>
      )}

      {selectedChatId && (
        <ChatPanel
          chatId={selectedChatId}
          title={contactLabel(selected || { chatId: selectedChatId })}
          subtitle={selected?.phoneDisplay || selectedChatId}
          needsCatchUp={Boolean(selected?.needsCatchUp || selected?.aiDisabled)}
          showToast={showToast}
          onCatchUpDone={() => load()}
          onClose={() => {
            setSelectedChatId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
