const TOKEN_KEY = 'ht_admin_token';
const MANAGER_KEY = 'ht_manager';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(MANAGER_KEY);
}

export function getManager() {
  try {
    const raw = sessionStorage.getItem(MANAGER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setManager(manager) {
  if (manager) {
    sessionStorage.setItem(MANAGER_KEY, JSON.stringify(manager));
  } else {
    sessionStorage.removeItem(MANAGER_KEY);
  }
}

const API_ROOT = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_ROOT}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
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
  me: () => request('/api/admin/me'),
  managers: () => request('/api/admin/managers'),
  session: () => request('/api/admin/session'),
  qr: () => request('/api/admin/qr'),
  logoutSession: () => request('/api/admin/session/logout', { method: 'POST', body: '{}' }),
  getConfig: () => request('/api/admin/config'),
  saveConfig: (body) =>
    request('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) }),
  getKnowledge: () => request('/api/admin/knowledge'),
  saveKnowledge: (knowledge) =>
    request('/api/admin/knowledge', {
      method: 'PUT',
      body: JSON.stringify({ knowledge }),
    }),
  getProperties: ({ page = 1, limit = 24, q = '' } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (q) params.set('q', q);
    return request(`/api/admin/properties?${params}`);
  },
  getClients: ({ page = 1, limit = 50, q = '' } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (q) params.set('q', q);
    return request(`/api/admin/clients?${params}`);
  },
  getClient: (id) => request(`/api/admin/clients/${encodeURIComponent(id)}`),
  getConversations: ({ page = 1, limit = 24, q = '' } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (q) params.set('q', q);
    return request(`/api/admin/conversations?${params}`);
  },
  getChatMessages: (chatId, { excludeAssistant = false } = {}) => {
    const params = new URLSearchParams();
    if (excludeAssistant) params.set('excludeAssistant', 'true');
    const qs = params.toString();
    return request(
      `/api/admin/chats/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ''}`
    );
  },
  sendChatMessage: (chatId, text) =>
    request(`/api/admin/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  setAiDisabled: (chatId, disabled) =>
    request(`/api/admin/chats/${encodeURIComponent(chatId)}/ai-disabled`, {
      method: 'PUT',
      body: JSON.stringify({ disabled }),
    }),
  getHandoffs: ({ page = 1, limit = 24, q = '', filter = 'all', managerId = '' } = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      filter,
    });
    if (q) params.set('q', q);
    if (managerId) params.set('managerId', managerId);
    return request(`/api/admin/handoffs?${params}`);
  },
  getHandoff: (id) => request(`/api/admin/handoffs/${encodeURIComponent(id)}`),
  assignHandoff: (id) =>
    request(`/api/admin/handoffs/${encodeURIComponent(id)}/assign`, { method: 'PUT', body: '{}' }),
  closeHandoff: (id) =>
    request(`/api/admin/handoffs/${encodeURIComponent(id)}/close`, { method: 'PUT', body: '{}' }),
};
