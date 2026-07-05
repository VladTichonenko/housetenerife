import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginModal({ open, onClose, onSuccess, onError }) {
  const { login } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setError('');
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Введите пароль');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(code.trim());
      onSuccess();
    } catch (err) {
      setError(err.message || 'Неверный пароль');
      onError?.('Неверный пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div className="modal__dialog">
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h2 id="modal-title" className="modal__title">
          Вход менеджера
        </h2>
        <p className="modal__subtitle">Введите ваш пароль для входа в панель</p>
        <form className="pin-form" onSubmit={handleSubmit}>
          <input
            type="password"
            className="manager-login__input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={loading}
            placeholder="Пароль"
            autoComplete="current-password"
            autoFocus
          />
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--full" disabled={loading}>
            {loading ? 'Проверка…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
