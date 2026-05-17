import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import KnowledgeArticlesTab from './KnowledgeArticlesTab';
import KnowledgeMainTab from './KnowledgeMainTab';
import KnowledgeTopicsTab from './KnowledgeTopicsTab';
import KnowledgeContactsTab from './KnowledgeContactsTab';
import KnowledgeJsonTab from './KnowledgeJsonTab';

const TABS = [
  { id: 'articles', label: 'Статьи' },
  { id: 'main', label: 'Основное' },
  { id: 'topics', label: 'Темы' },
  { id: 'contacts', label: 'Контакты' },
  { id: 'json', label: 'Полный JSON' }
];

export default function KnowledgeSection({ showToast }) {
  const [tab, setTab] = useState('articles');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [knowledge, setKnowledge] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [loadError, setLoadError] = useState('');
  const loadedRef = useRef(false);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.getKnowledge();
      const kb = data.knowledge || {};
      if (!Array.isArray(kb.custom_articles)) kb.custom_articles = [];
      setKnowledge(kb);
      setUpdatedAt(data.updatedAt);
      setJsonText(JSON.stringify(kb, null, 2));
      setJsonError('');
    } catch (err) {
      const msg = err.message || 'Не удалось загрузить базу знаний';
      setLoadError(msg);
      setKnowledge(null);
      showToastRef.current(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [load]);

  const retryLoad = () => load();

  const patch = useCallback((key, value) => {
    setKnowledge((prev) => ({ ...prev, [key]: value }));
  }, []);

  const save = async (payload) => {
    setSaving(true);
    try {
      const { knowledge: saved, message, updatedAt: at } = await api.saveKnowledge(payload);
      setKnowledge(saved);
      setUpdatedAt(at);
      setJsonText(JSON.stringify(saved, null, 2));
      setJsonError('');
      showToast(message || 'База знаний сохранена');
    } catch (err) {
      showToast(err.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (tab === 'json') {
      try {
        const parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setJsonError('Корень должен быть объектом JSON');
          return;
        }
        setJsonError('');
        setKnowledge(parsed);
        save(parsed);
      } catch {
        setJsonError('Некорректный JSON');
      }
    } else {
      save(knowledge);
    }
  };

  const syncJsonFromState = () => {
    if (knowledge) {
      setJsonText(JSON.stringify(knowledge, null, 2));
      setJsonError('');
    }
  };

  if (loading) {
    return <div className="session-status__loader">Загрузка базы знаний…</div>;
  }

  if (!knowledge) {
    return (
      <div className="card">
        <h3 className="card__title">База знаний недоступна</h3>
        <p className="card__desc">{loadError || 'Не удалось загрузить данные.'}</p>
        <p className="card__desc" style={{ marginTop: 12 }}>
          Перезапустите бота (<code>npm start</code>), чтобы подтянуть API{' '}
          <code>/api/admin/knowledge</code>.
        </p>
        <button type="button" className="btn btn--primary" style={{ marginTop: 16 }} onClick={retryLoad}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="card card--info">
        <p className="card__desc">
          Бот <strong>обязан</strong> опираться на эту базу при каждом ответе. Изменения применяются
          сразу — при следующем сообщении в WhatsApp.
        </p>
      </div>

      <div className="kb-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`kb-tab${tab === t.id ? ' kb-tab--active' : ''}`}
            onClick={() => {
              setTab(t.id);
              if (t.id === 'json') syncJsonFromState();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'articles' && (
        <KnowledgeArticlesTab
          articles={knowledge.custom_articles || []}
          onChange={(v) => patch('custom_articles', v)}
        />
      )}
      {tab === 'main' && <KnowledgeMainTab knowledge={knowledge} patch={patch} />}
      {tab === 'topics' && (
        <KnowledgeTopicsTab topics={knowledge.topics} onChange={(v) => patch('topics', v)} />
      )}
      {tab === 'contacts' && (
        <KnowledgeContactsTab contacts={knowledge.contacts} onChange={(v) => patch('contacts', v)} />
      )}
      {tab === 'json' && (
        <KnowledgeJsonTab
          jsonText={jsonText}
          jsonError={jsonError}
          onChange={setJsonText}
          onSync={syncJsonFromState}
        />
      )}

      <div className="actions-bar">
        {updatedAt && (
          <span className="actions-bar__hint">
            Обновлено: {new Date(updatedAt).toLocaleString('ru-RU')}
          </span>
        )}
        <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить базу знаний'}
        </button>
      </div>
    </>
  );
}
