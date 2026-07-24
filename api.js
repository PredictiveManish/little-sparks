const API_BASE = (function() {
    // Auto-detect: if running on localhost, use localhost:8000
    // Otherwise use the deployed backend URL (set via env or default)
    const envApiUrl = window.env?.API_URL;
    if (envApiUrl) return envApiUrl;
    if (window.location.hostname === 'localhost') return 'http://localhost:8000/api';
    // For deployed frontend, use the backend URL from env or default
    return 'https://little-sparks-backend.onrender.com/api';
})();

async function apiFetch(endpoint, options = {}) {
    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    };
    const config = { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...(options.headers || {}) } };
    if (options.body) {
        config.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    if (response.status === 401) {
        window.location.href = '/';
        return null;
    }
    if (response.status === 403) {
        showToast('Access denied. You need elevated permissions.');
        return null;
    }
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        throw new Error(error.detail || 'Request failed');
    }
    if (response.status === 204) return null;
    return response.json();
}

const api = {
    // Auth
    slackLogin: (code, redirectUri) => apiFetch('/auth/slack-login', { method: 'POST', body: { code, redirect_uri: redirectUri } }),
    emailLogin: (email, password) => apiFetch('/auth/login', { method: 'POST', body: { email, password } }),
    logout: () => apiFetch('/auth/logout', { method: 'GET' }),
    getMe: () => apiFetch('/auth/me'),
    getSlackAuthUrl: () => apiFetch('/auth/slack-auth-url'),
    getPendingUsers: () => apiFetch('/admin/pending-users'),
    approveUser: (userId, role) => apiFetch('/admin/users/approve', { method: 'POST', body: { user_id: userId, role } }),

    // Dashboard
    getDashboardStats: () => apiFetch('/dashboard/stats'),
    getRecentProjects: () => apiFetch('/dashboard/recent-projects'),
    getUpcomingDeadlines: () => apiFetch('/dashboard/upcoming-deadlines'),

    // Projects
    getProjects: () => apiFetch('/projects'),
    getProject: (id) => apiFetch(`/projects/${id}`),
    createProject: (data) => apiFetch('/projects', { method: 'POST', body: data }),
    updateProject: (id, data) => apiFetch(`/projects/${id}`, { method: 'PUT', body: data }),
    completeStage: (id, stageIndex) => apiFetch(`/projects/${id}/stages/${stageIndex}/complete`, { method: 'POST' }),
    unmarkStage: (id, stageIndex) => apiFetch(`/projects/${id}/stages/${stageIndex}/unmark`, { method: 'POST' }),

    // Designers
    getDesigners: () => apiFetch('/designers'),
    createDesigner: (data) => apiFetch('/designers', { method: 'POST', body: data }),
    deleteDesigner: (id) => apiFetch(`/designers/${id}`, { method: 'DELETE' }),

    // WhatsApp
    getWhatsAppMessages: (projectId) => apiFetch(`/projects/${projectId}/whatsapp-messages`),
    createWhatsAppMessage: (projectId, data) => apiFetch(`/projects/${projectId}/whatsapp-messages`, { method: 'POST', body: data }),
    respondToMessage: (projectId) => apiFetch(`/projects/${projectId}/whatsapp-messages/respond`, { method: 'POST' }),
    sendWelcomeMessage: (projectId) => apiFetch(`/projects/${projectId}/whatsapp-messages/welcome`, { method: 'POST' }),
    notifyProjectCreated: (projectId) => apiFetch(`/projects/${projectId}/whatsapp-messages/notify-project-created`, { method: 'POST' }),

    // Slack
    getSlackConfig: () => apiFetch('/slack/config'),
    saveSlackConfig: (data) => apiFetch('/slack/config', { method: 'POST', body: data }),
    createSlackChannel: (projectId) => apiFetch(`/projects/${projectId}/slack-channel`, { method: 'POST' }),
    getSlackStatus: (projectId) => apiFetch(`/slack/status`, { method: 'POST', body: { project_id: projectId } }),
    getSlackActivity: (projectId) => apiFetch(`/projects/${projectId}/slack-activity`),
    logSlackMessage: (data) => apiFetch('/slack/messages/log', { method: 'POST', body: data }),
    getSlackMessages: (projectId) => apiFetch(`/projects/${projectId}/slack-messages`),
};
