import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import DialogPathEditor from './DialogPathEditor';

export default function AssistantSection({ showToast }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mainPrompt, setMainPrompt] = useState('');
  const [additionalConditions, setAdditionalConditions] = useState('');
  const [dialogPath, setDialogPath] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const loadedRef = useRef(false);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const load = useCallback(async () => {
    try {
      const { config } = await api.getConfig();
      setMainPrompt(config.mainPrompt || '');
      setAdditionalConditions(config.additionalConditions || '');
      setDialogPath(config.dialogPath || []);
      setUpdatedAt(config.updatedAt);
    } catch (err) {
      showToastRef.current(err.message || 'Не удалось загрузить настройки', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { config, message } = await api.saveConfig({
        mainPrompt,
        additionalConditions,
        dialogPath: dialogPath.map((item, i) => ({
          step: item.step ?? i + 1,
          title: item.title || '',
          description: item.description || ''
        }))
      });
      setUpdatedAt(config.updatedAt);
      showToast(message || 'Настройки сохранены');
    } catch (err) {
      showToast(err.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="session-status__loader">Загрузка настроек…</div>;
  }

  return (
    <>
      <div className="card">
        <div className="card__header">
          <h3 className="card__title">Основная инструкция</h3>
          <p className="card__desc">Главный промпт — роль и цели бота</p>
        </div>
        <textarea
          className="textarea"
          rows={8}
          value={mainPrompt}
          onChange={(e) => setMainPrompt(e.target.value)}
          placeholder="Основная инструкция бота…"
        />
      </div>

      <div className="card">
        <div className="card__header">
          <h3 className="card__title">Дополнительные условия</h3>
          <p className="card__desc">Стиль общения, правила и форматирование</p>
        </div>
        <textarea
          className="textarea"
          rows={8}
          value={additionalConditions}
          onChange={(e) => setAdditionalConditions(e.target.value)}
          placeholder="Дополнительные условия…"
        />
      </div>

      <div className="card">
        <DialogPathEditor path={dialogPath} onChange={setDialogPath} />
      </div>

      <div className="actions-bar actions-bar--sticky">
        {updatedAt && (
          <span className="actions-bar__hint">
            Обновлено: {new Date(updatedAt).toLocaleString('ru-RU')}
          </span>
        )}
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
      </div>
    </>
  );
}
