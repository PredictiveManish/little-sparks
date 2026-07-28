const API_BASE = (function() {
    // Auto-detect: if running on localhost, use localhost:8000
    // Otherwise use a relative path so requests stay same-origin and go
    // through the Vercel rewrite proxy to the Render backend (avoids
    // cross-site cookie issues entirely).
    const envApiUrl = window.env?.API_URL;
    if (envApiUrl) return envApiUrl;
    if (window.location.hostname === 'localhost') return 'http://localhost:8000/api';
    return '/api';
})();

async function apiFetch(endpoint, options = {}) {
    const method = options.method || 'GET';
    const logEndpoint = `${method} ${endpoint}`;
    console.log(`[API] Request: ${logEndpoint}`);
    if (options.body) {
        console.log(`[API] Payload:`, JSON.stringify(options.body, null, 2));
    }
    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    };
    const config = { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...(options.headers || {}) } };
    if (options.body) {
        config.body = JSON.stringify(options.body);
    }
    let response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, config);
    } catch (fetchError) {
        console.error(`[API] Network error: ${logEndpoint} | Error: ${fetchError.message}`);
        throw new Error(`Network error: ${fetchError.message}`);
    }
    console.log(`[API] Response: ${logEndpoint} | Status: ${response.status}`);
    if (response.status === 401) {
        console.warn(`[API] Unauthorized: ${logEndpoint} | Redirecting to login`);
        window.location.href = '/login';
        return null;
    }
    if (response.status === 403) {
        const errorData = await response.json().catch(() => ({ detail: 'Access denied' }));
        console.warn(`[API] Forbidden: ${logEndpoint} | Detail: ${errorData.detail}`);
        showToast('Access denied. You need elevated permissions.');
        return null;
    }
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        console.error(`[API] Error: ${logEndpoint} | Status: ${response.status} | Detail: ${error.detail}`);
        throw new Error(error.detail || 'Request failed');
    }
    if (response.status === 204) {
        console.log(`[API] No content: ${logEndpoint}`);
        return null;
    }
    const data = await response.json();
    console.log(`[API] Data received: ${logEndpoint} | Keys: ${Object.keys(data || {}).join(', ')}`);
    return data;
}

const api = {
    // Auth
    slackLogin: (code, redirectUri) => apiFetch('/auth/slack-login', { method: 'POST', body: { code, redirect_uri: redirectUri } }),
    emailLogin: (email, password) => apiFetch('/auth/login', { method: 'POST', body: { email, password } }),
    logout: () => apiFetch('/auth/logout', { method: 'GET' }),
    getMe: () => apiFetch('/auth/me'),
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

    // Slack
    getSlackConfig: () => apiFetch('/slack/config'),
    saveSlackConfig: (data) => apiFetch('/slack/config', { method: 'POST', body: data }),
    createSlackChannel: (projectId) => apiFetch(`/projects/${projectId}/slack-channel`, { method: 'POST' }),
    getSlackStatus: (projectId) => apiFetch(`/slack/status`, { method: 'POST', body: { project_id: projectId } }),
    getSlackActivity: (projectId) => apiFetch(`/projects/${projectId}/slack-activity`),
    logSlackMessage: (data) => apiFetch('/slack/messages/log', { method: 'POST', body: data }),
    getSlackMessages: (projectId) => apiFetch(`/projects/${projectId}/slack-messages`),
    assignStageDesigners: (projectId, stageIndex, designerIds) => apiFetch(`/projects/${projectId}/phases/${stageIndex}/assign-designers`, { method: 'POST', body: { designer_ids: designerIds } }),
};