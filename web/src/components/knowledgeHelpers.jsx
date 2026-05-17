import { IconPlus, IconTrash } from './Icons';

export function ListEditor({ label, items = [], onChange, placeholder }) {
  const update = (index, value) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };
  const add = () => onChange([...items, '']);
  const remove = (index) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="kb-list-editor">
      <div className="kb-list-editor__head">
        <span className="kb-label">{label}</span>
        <button type="button" className="btn btn--outline btn--sm" onClick={add}>
          <IconPlus /> Добавить
        </button>
      </div>
      {items.map((item, index) => (
        <div key={index} className="kb-list-editor__row">
          <textarea
            className="textarea textarea--sm"
            rows={2}
            value={item}
            placeholder={placeholder}
            onChange={(e) => update(index, e.target.value)}
          />
          <button
            type="button"
            className="path-step__remove"
            onClick={() => remove(index)}
            aria-label="Удалить"
          >
            <IconTrash />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Field({ label, value, onChange, multiline }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <label className="kb-field">
      <span className="kb-label">{label}</span>
      <Tag
        className={multiline ? 'textarea' : 'input'}
        rows={multiline ? 3 : undefined}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
