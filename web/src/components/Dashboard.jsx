import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Logo from './Logo';
import { IconBot, IconBook, IconCatalog, IconClose, IconGuide, IconMenu, IconPhone } from './Icons';
import SessionSection from './SessionSection';
import AssistantSection from './AssistantSection';
import KnowledgeSection from './KnowledgeSection';
import CatalogSection from './CatalogSection';
import GuideSection from './GuideSection';

const SECTIONS = {
  guide: { title: 'Инструкция', id: 'guide' },
  session: { title: 'Сессия WhatsApp', id: 'session' },
  assistant: { title: 'Умный помощник', id: 'assistant' },
  knowledge: { title: 'База знаний', id: 'knowledge' },
  catalog: { title: 'Каталог объектов', id: 'catalog' }
};

const NAV_ITEMS = [
  { id: 'guide', label: 'Инструкция', Icon: IconGuide },
  { id: 'session', label: 'Сессия WhatsApp', Icon: IconPhone },
  { id: 'assistant', label: 'Умный помощник', Icon: IconBot },
  { id: 'knowledge', label: 'База знаний', Icon: IconBook },
  { id: 'catalog', label: 'Каталог', Icon: IconCatalog }
];

export default function Dashboard({ showToast }) {
  const { logout } = useAuth();
  const [section, setSection] = useState('guide');
  const [globalReady, setGlobalReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const data = await api.session();
      setGlobalReady(data.ready);
    } catch {
      setGlobalReady(false);
    }
  }, []);

  useEffect(() => {
    pollStatus();
    const id = setInterval(pollStatus, 8000);
    return () => clearInterval(id);
  }, [pollStatus]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  const current = SECTIONS[section];

  const navigateTo = (id) => {
    setSection(id);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectSection = (id) => {
    setSection(id);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const statusPill = (
    <span className={`status-pill${globalReady ? ' status-pill--ok' : ''}`}>
      <span className="status-pill__dot" />
      <span className="status-pill__text">{globalReady ? 'Бот онлайн' : 'Ожидание'}</span>
    </span>
  );

  return (
    <div className="dashboard">
      <header className="app-header">
        <button
          type="button"
          className="burger"
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <IconClose /> : <IconMenu />}
        </button>
        <h2 className="app-header__title">{current.title}</h2>
        {statusPill}
      </header>

      <button
        type="button"
        className={`nav-backdrop${menuOpen ? ' nav-backdrop--visible' : ''}`}
        aria-label="Закрыть меню"
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar__head">
          <Logo small />
          <button
            type="button"
            className="sidebar__close"
            aria-label="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          >
            <IconClose />
          </button>
        </div>
        <nav className="sidebar__nav">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item${section === id ? ' nav-item--active' : ''}`}
              onClick={() => selectSection(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <button type="button" className="btn btn--ghost sidebar__logout" onClick={logout}>
          Выйти
        </button>
      </aside>

      <div className={`dashboard__content${section === 'catalog' ? ' dashboard__content--wide' : ''}`}>
        <header className="topbar">
          <h2 className="topbar__title">{current.title}</h2>
          {statusPill}
        </header>

        <div className="section">
          {section === 'guide' && <GuideSection onNavigate={navigateTo} />}
          {section === 'session' && <SessionSection />}
          {section === 'assistant' && <AssistantSection showToast={showToast} />}
          {section === 'knowledge' && <KnowledgeSection showToast={showToast} />}
          {section === 'catalog' && <CatalogSection />}
        </div>
      </div>
    </div>
  );
}
