import { Field } from './knowledgeHelpers';

const CONTACT_FIELDS = [
  ['office_phone', 'Телефон офиса'],
  ['mobile_whatsapp', 'WhatsApp / мобильный'],
  ['mobile_note', 'Примечание к мобильному'],
  ['email', 'Email'],
  ['website', 'Сайт'],
  ['office_address', 'Адрес'],
  ['office_address_short', 'Адрес (кратко)']
];

export default function KnowledgeContactsTab({ contacts, onChange }) {
  const c = contacts || {};
  const set = (key, value) => onChange({ ...c, [key]: value });

  return (
    <div className="card">
      <h3 className="card__title">Контакты</h3>
      <p className="card__desc" style={{ marginBottom: 16 }}>
        Бот использует эти данные из базы знаний — не выдумывает контакты
      </p>
      <div className="kb-fields-grid">
        {CONTACT_FIELDS.map(([key, label]) => (
          <Field key={key} label={label} value={c[key]} onChange={(v) => set(key, v)} />
        ))}
      </div>
    </div>
  );
}
