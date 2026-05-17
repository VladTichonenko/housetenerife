import Logo from './Logo';

export default function Landing({ onLogin }) {
  return (
    <div className="landing">
      <div className="landing__bg" aria-hidden="true" />
      <header className="landing__header">
        <Logo />
      </header>
      <main className="landing__main">
        <h1 className="landing__title">
          Панель управления
          <br />
          WhatsApp-ботом
        </h1>
        <p className="landing__subtitle">
          Настройте сессию, промпты и путь диалога консультанта по недвижимости на Тенерифе
        </p>
        <button type="button" className="btn btn--primary btn--lg" onClick={onLogin}>
          Войти
        </button>
      </main>
      <footer className="landing__footer">© House Tenerife</footer>
    </div>
  );
}
