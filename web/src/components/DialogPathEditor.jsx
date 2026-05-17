import { IconTrash } from './Icons';
import { Accordion, AccordionItem } from './Accordion';

export default function DialogPathEditor({ path, onChange }) {
  const updateStep = (index, field, value) => {
    const next = path.map((item, i) =>
      i === index ? { ...item, [field]: value, step: item.step ?? i + 1 } : item
    );
    onChange(next);
  };

  const addStep = () => {
    onChange([
      ...path,
      { step: path.length + 1, title: '', description: '' }
    ]);
  };

  const removeStep = (index) => {
    const next = path
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, step: i + 1 }));
    onChange(next);
  };

  return (
    <>
      <div className="card__header card__header--row">
        <div>
          <h3 className="card__title">Путь диалога</h3>
          <p className="card__desc">Последовательность шагов, по которым ведёт бот</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={addStep}>
          + Шаг
        </button>
      </div>

      <Accordion className="path-accordion">
        {path.map((item, index) => {
          const stepNum = item.step ?? index + 1;
          const title = item.title?.trim() || `Шаг ${stepNum}`;
          const preview = item.description?.trim();
          const subtitle = preview
            ? preview.length > 72
              ? `${preview.slice(0, 72)}\u2026`
              : preview
            : 'Без описания';

          return (
            <AccordionItem
              key={index}
              badge={stepNum}
              title={title}
              subtitle={subtitle}
              defaultOpen={index === 0}
            >
              <div className="path-step__editor">
                <label className="field-label">
                  Название шага
                  <input
                    type="text"
                    className="input"
                    placeholder="Например: Приветствие"
                    value={item.title || ''}
                    onChange={(e) => updateStep(index, 'title', e.target.value)}
                  />
                </label>
                <label className="field-label">
                  Описание
                  <textarea
                    className="textarea textarea--sm"
                    rows={4}
                    placeholder="Что бот делает на этом шаге"
                    value={item.description || ''}
                    onChange={(e) => updateStep(index, 'description', e.target.value)}
                  />
                </label>
                {path.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm path-step__delete"
                    onClick={() => removeStep(index)}
                  >
                    <IconTrash />
                    Удалить шаг
                  </button>
                )}
              </div>
            </AccordionItem>
          );
        })}
      </Accordion>
    </>
  );
}
