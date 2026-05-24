import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Logo from './Logo';
import { IconBot, IconBook, IconCatalog, IconClose, IconGuide, IconMenu, IconPhone, IconUsers } from './Icons';
import SessionSection from './SessionSection';
import AssistantSection from './AssistantSection';
import KnowledgeSection from './KnowledgeSection';
import CatalogSection from './CatalogSection';
import GuideSection from './GuideSection';
import ManagerHandoffsSection from './ManagerHandoffsSection';

const SECTIONS = {
  guide: { title: 'Инструкция', id: 'guide' },
  session: { title: 'Сессия WhatsApp', id: 'session' },
  assistant: { title: 'Умный помощник', id: 'assistant' },
  knowledge: { title: 'База знаний', id: 'knowledge' },
  catalog: { title: 'Каталог объектов', id: 'catalog' },
  handoffs: { title: 'Связь с менеджером', id: 'handoffs' }
};

const NAV_ITEMS = [
  { id: 'guide', label: 'Инструкция', Icon: IconGuide },
  { id: 'session', label: 'Сессия WhatsApp', Icon: IconPhone },
  { id: 'assistant', label: 'Умный помощник', Icon: IconBot },
  { id: 'handoffs', label: 'Связь с менеджером', Icon: IconUsers },
  { id: 'knowledge', label: 'База знаний', Icon: IconBook },
  { id: 'catalog', label: 'Каталог', Icon: IconCatalog }
];

export default function Dashboard({ showToast }) {
  const { logout } = useAuth();
  const [section, setSection] = useState('guide');
  const [session, setSession] = useState(null);
  const [sessionQr, setSessionQr] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const data = await api.session();
      setSession(data);
      if (!data.ready && data.hasQr) {
        const qrData = await api.qr();
        setSessionQr(qrData.qr);
      } else {
        setSessionQr(null);
      }
    } catch {
      setSession(null);
      setSessionQr(null);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshSession]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  const current = SECTIONS[section];

  const navigateTo = (id) => {
    setSection(id);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (id === 'session') refreshSession();
  };

  const selectSection = (id) => {
    setSection(id);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (id === 'session') refreshSession();
  };

  const globalReady = Boolean(session?.ready);

  const statusPill = (
    <button
      type="button"
      className={`status-pill status-pill--btn${globalReady ? ' status-pill--ok' : ''}${sessionLoading ? ' status-pill--loading' : ''}`}
      onClick={refreshSession}
      disabled={sessionLoading}
      title="Обновить статус бота"
    >
      <span className="status-pill__dot" />
      <span className="status-pill__text">
        {sessionLoading ? 'Проверка…' : globalReady ? 'Бот онлайн' : 'Ожидание'}
      </span>
    </button>
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
          {section === 'session' && (
            <SessionSection
              session={session}
              qr={sessionQr}
              loading={sessionLoading}
              onRefresh={refreshSession}
            />
          )}
          {section === 'assistant' && <AssistantSection showToast={showToast} />}
          {section === 'knowledge' && <KnowledgeSection showToast={showToast} />}
          {section === 'catalog' && <CatalogSection />}
          {section === 'handoffs' && <ManagerHandoffsSection />}
        </div>
      </div>
    </div>
  );
}
