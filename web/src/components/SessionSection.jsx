import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconCheck } from './Icons';

export default function SessionSection() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [qr, setQr] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.session();
      setSession(data);
      if (!data.ready && data.hasQr) {
        const qrData = await api.qr();
        setQr(qrData.qr);
      } else {
        setQr(null);
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return <div className="session-status__loader">Загрузка статуса…</div>;
  }

  const ready = session?.ready;
  const account = session?.account;

  return (
    <>
      <div className="card card--session">
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
                Откройте WhatsApp на телефоне → Связанные устройства → Привязать устройство
              </p>
              {qr ? (
                <img src={qr} alt="QR-код для входа в WhatsApp" className="session-qr__image" />
              ) : (
                <div className="session-qr__waiting">
                  <div className="app-loading__spinner" />
                  <p>Ожидание QR-кода…</p>
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
