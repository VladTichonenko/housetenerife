import { ListEditor, Field } from './knowledgeHelpers';

const BRAND_FIELDS = [
  ['name', 'Название'],
  ['legal_name', 'Юридическое название'],
  ['site', 'Сайт'],
  ['site_ru', 'Сайт (RU)'],
  ['focus', 'Фокус'],
  ['experience', 'Опыт'],
  ['positioning', 'Позиционирование'],
  ['representative', 'Представитель'],
  ['office_address', 'Адрес офиса']
];

export default function KnowledgeMainTab({ knowledge, patch }) {
  const brand = knowledge.brand || {};
  const prosCons = knowledge.spain_property_pros_cons || { pros: [], cons: [] };
  const sources = knowledge.official_sources || [];

  const setBrand = (key, value) => patch('brand', { ...brand, [key]: value });
  const setSources = (next) => patch('official_sources', next);

  const updateSource = (index, field, value) => {
    const next = sources.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    setSources(next);
  };

  return (
    <>
      <div className="card">
        <h3 className="card__title">Бренд</h3>
        <div className="kb-fields-grid">
          {BRAND_FIELDS.map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={brand[key]}
              onChange={(v) => setBrand(key, v)}
            />
          ))}
        </div>
      </div>

      <div className="card">
        <Field
          label="Дисклеймер"
          multiline
          value={knowledge.disclaimer}
          onChange={(v) => patch('disclaimer', v)}
        />
      </div>

      <div className="card">
        <ListEditor
          label="Плюсы покупки в Испании"
          items={prosCons.pros || []}
          placeholder="Плюс…"
          onChange={(pros) => patch('spain_property_pros_cons', { ...prosCons, pros })}
        />
        <div style={{ height: 16 }} />
        <ListEditor
          label="Минусы / риски"
          items={prosCons.cons || []}
          placeholder="Минус…"
          onChange={(cons) => patch('spain_property_pros_cons', { ...prosCons, cons })}
        />
      </div>

      <div className="card">
        <div className="kb-list-editor__head">
          <span className="kb-label">Официальные источники</span>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setSources([...sources, { name: '', url: '' }])}
          >
            + Источник
          </button>
        </div>
        {sources.map((src, index) => (
          <div key={index} className="kb-source-row">
            <input
              className="input"
              placeholder="Название"
              value={src.name || ''}
              onChange={(e) => updateSource(index, 'name', e.target.value)}
            />
            <input
              className="input"
              placeholder="URL"
              value={src.url || ''}
              onChange={(e) => updateSource(index, 'url', e.target.value)}
            />
            <button
              type="button"
              className="path-step__remove"
              onClick={() => setSources(sources.filter((_, i) => i !== index))}
              aria-label="Удалить"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
