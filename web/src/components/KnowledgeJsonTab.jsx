export default function KnowledgeJsonTab({ jsonText, jsonError, onChange, onSync }) {
  return (
    <div className="card">
      <div className="card__header card__header--row">
        <div>
          <h3 className="card__title">Полная база знаний (JSON)</h3>
          <p className="card__desc">
            Playbook, объекты featured_properties, услуги и др. — редактирование для опытных
            пользователей
          </p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={onSync}>
          Синхронизировать из форм
        </button>
      </div>
      <textarea
        className="textarea textarea--json"
        rows={22}
        value={jsonText}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {jsonError && <p className="form-error">{jsonError}</p>}
    </div>
  );
}
