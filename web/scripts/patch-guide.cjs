const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '../src/components/GuideSection.jsx');
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf('      <motion-not-needed className="guide-sections">');
const startAlt = s.indexOf('      <div className="guide-sections">');
const i = startAlt >= 0 ? startAlt : start;
if (i < 0) throw new Error('guide-sections block not found');

const end = s.indexOf('      <div className="card guide-footer">', i);
if (end < 0) throw new Error('guide-footer not found');

const replacement = `      <Accordion className="guide-accordion">
        {SECTIONS_GUIDE.map((item) => (
          <AccordionItem
            key={item.id}
            title={item.title}
            subtitle="Что редактировать и как влияет на бота"
          >
            <article className="guide-card guide-card--nested">
              <div className="guide-card__block">
                <h4 className="guide-card__label">Что это</h4>
                <p>{item.what}</p>
              </div>

              <div className="guide-card__block">
                <h4 className="guide-card__label">Что можно редактировать</h4>
                <ul>
                  {item.edit.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </motion-not-needed>

              <div className="guide-card__block guide-card__block--accent">
                <h4 className="guide-card__label">Влияние на бота</h4>
                <p>{item.effect}</p>
              </div>

              <p className="guide-card__tip">
                <strong>Совет:</strong> {item.tip}
              </p>

              <button
                type="button"
                className="btn btn--primary btn--full"
                onClick={() => onNavigate(item.id)}
              >
                Перейти в раздел →
              </button>
            </article>
          </AccordionItem>
        ))}
      </Accordion>

`;

const fixed = replacement.replace(
  '              </motion-not-needed>',
  '              </div>'
);

fs.writeFileSync(p, s.slice(0, i) + fixed + s.slice(end), 'utf8');
console.log('patched');
