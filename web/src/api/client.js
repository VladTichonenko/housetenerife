const TOKEN_KEY = 'ht_admin_token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

const API_ROOT = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_ROOT}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && token) {
    clearToken();
    window.dispatchEvent(new Event('ht:unauthorized'));
  }

  if (!res.ok) {
    throw new Error(data.message || `Ошибка ${res.status}`);
  }
  return data;
}

export const api = {
  login: (code) => request('/api/admin/login', { method: 'POST', body: JSON.stringify({ code }) }),
  session: () => request('/api/admin/session'),
  qr: () => request('/api/admin/qr'),
  getConfig: () => request('/api/admin/config'),
  saveConfig: (body) =>
    request('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) }),
  getKnowledge: () => request('/api/admin/knowledge'),
  saveKnowledge: (knowledge) =>
    request('/api/admin/knowledge', {
      method: 'PUT',
      body: JSON.stringify({ knowledge })
    }),
  getProperties: ({ page = 1, limit = 24, q = '' } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit)
    });
    if (q) params.set('q', q);
    return request(`/api/admin/properties?${params}`);
  }
};
