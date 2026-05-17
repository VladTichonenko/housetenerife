import { IconPlus, IconTrash } from './Icons';

export default function KnowledgeTopicsTab({ topics, onChange }) {
  const entries = Object.entries(topics || {});

  const update = (oldKey, newKey, value) => {
    const next = { ...topics };
    if (oldKey !== newKey) delete next[oldKey];
    next[newKey] = value;
    onChange(next);
  };

  const add = () => {
    onChange({ ...topics, [`topic_${Date.now()}`]: '' });
  };

  const remove = (key) => {
    const next = { ...topics };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="card">
      <div className="card__header card__header--row">
        <div>
          <h3 className="card__title">Темы</h3>
          <p className="card__desc">Ключевые темы: NIE, визы, Канары и др.</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={add}>
          <IconPlus /> Тема
        </button>
      </div>
      <div className="kb-topics">
        {entries.length === 0 && <p className="kb-empty">Тем пока нет</p>}
        {entries.map(([key, value]) => (
          <div key={key} className="kb-topic">
            <input
              className="input"
              placeholder="Ключ (например: nie)"
              value={key}
              onChange={(e) => update(key, e.target.value, value)}
            />
            <textarea
              className="textarea textarea--sm"
              rows={3}
              placeholder="Описание темы"
              value={value}
              onChange={(e) => update(key, key, e.target.value)}
            />
            <button
              type="button"
              className="path-step__remove"
              onClick={() => remove(key)}
              aria-label="Удалить тему"
            >
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
