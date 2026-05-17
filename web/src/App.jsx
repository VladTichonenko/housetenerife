import { useCallback, useState } from 'react';
import { useAuth } from './context/AuthContext';
import Landing from './components/Landing';
import LoginModal from './components/LoginModal';
import Dashboard from './components/Dashboard';
import Toast from './components/Toast';

export default function App() {
  const { isAuthenticated, booting } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  if (booting) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Landing onLogin={() => setLoginOpen(true)} />
        <LoginModal
          open={loginOpen}
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            showToast('Добро пожаловать в панель');
          }}
          onError={(msg) => showToast(msg, 'error')}
        />
        <Toast toast={toast} />
      </>
    );
  }

  return (
    <>
      <Dashboard showToast={showToast} />
      <Toast toast={toast} />
    </>
  );
}
