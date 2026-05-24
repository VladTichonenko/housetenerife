import { IconCheck } from './Icons';

export default function SessionSection({ session, qr, loading, onRefresh }) {
  if (loading && !session) {
    return <div className="session-status__loader">Загрузка статуса…</div>;
  }

  const ready = session?.ready;
  const account = session?.account;

  return (
    <>
      <div className="card card--session">
        <div className="card__header card__header--row">
          <p className="card__desc" style={{ margin: 0 }}>
            Статус WhatsApp-сессии. Обновляйте вручную или при возврате на вкладку браузера.
          </p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Обновление…' : 'Обновить статус'}
          </button>
        </div>
        <div className="session-status">
          {ready ? (
            <div className="session-connected">
              <div className="session-connected__icon">
                <IconCheck />
              </div>
              <div>
                <h3 className="session-connected__title">Сессия активна</h3>
                <p className="session-connected__text">
                  WhatsApp подключён. Бот готов принимать сообщения.
                </p>
                {session?.clientState && (
                  <span className="session-connected__meta">Состояние: {session.clientState}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="session-qr">
              <h3 className="session-qr__title">Подключите WhatsApp</h3>
              <p className="session-qr__text">
                Откройте WhatsApp на телефоне → Связанные устройства → Привязать устройство.
                Если QR не появился — нажмите «Обновить статус».
              </p>
              {qr ? (
                <img src={qr} alt="QR-код для входа в WhatsApp" className="session-qr__image" />
              ) : (
                <div className="session-qr__waiting">
                  {!loading && (
                    <p>QR-код не загружен. Нажмите «Обновить статус».</p>
                  )}
                  {loading && (
                    <>
                      <div className="app-loading__spinner" />
                      <p>Загрузка…</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {ready && account && (
        <div className="card">
          <h3 className="card__title">Подключённый аккаунт</h3>
          <dl className="account-info">
            {account.name && (
              <>
                <dt>Имя</dt>
                <dd>{account.name}</dd>
              </>
            )}
            {account.phone && (
              <>
                <dt>Телефон</dt>
                <dd>+{account.phone}</dd>
              </>
            )}
            {account.platform && (
              <>
                <dt>Платформа</dt>
                <dd>{account.platform}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </>
  );
}
