import { useId, useState } from 'react';

export function Accordion({ children, className = '' }) {
  const cls = className ? `accordion ${className}` : 'accordion';
  return <div className={cls}>{children}</div>;
}

export function AccordionItem({ title, subtitle, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={'accordion__item' + (open ? ' accordion__item--open' : '')}>
      <button
        type="button"
        className="accordion__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="accordion__trigger-main">
          {badge != null ? <span className="accordion__badge">{badge}</span> : null}
          <span className="accordion__titles">
            <span className="accordion__title">{title}</span>
            {subtitle ? <span className="accordion__subtitle">{subtitle}</span> : null}
          </span>
        </span>
        <span className="accordion__chevron" aria-hidden="true" />
      </button>
      {!open ? null : (
        <div id={panelId} className="accordion__panel">
          <div className="accordion__panel-inner">{children}</div>
        </div>
      )}
    </div>
  );
}
