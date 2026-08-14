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
    getOverdueProjects: () => apiFetch('/dashboard/overdue-projects'),
    getDelayTrend: () => apiFetch('/dashboard/delay-trend'),

    // Projects
    getProjects: () => apiFetch('/projects'),
    getAllProjects: () => apiFetch('/projects'),
    getProject: (id) => apiFetch(`/projects/${id}`),
    createProject: (data) => apiFetch('/projects', { method: 'POST', body: data }),
    updateProject: (id, data) => apiFetch(`/projects/${id}`, { method: 'PUT', body: data }),
    completeStage: (id, stageIndex, delayReason = undefined, delayResponsible = undefined) => {
        const body = {};
        if (delayReason !== undefined) body.delay_reason = delayReason;
        if (delayResponsible !== undefined) body.delay_responsible = delayResponsible;
        return apiFetch(`/projects/${id}/stages/${stageIndex}/complete`, { method: 'POST', body });
    },
    unmarkStage: (id, stageIndex) => apiFetch(`/projects/${id}/stages/${stageIndex}/unmark`, { method: 'POST' }),

    // Designers
    getDesigners: () => apiFetch('/designers'),
    createDesigner: (data) => apiFetch('/designers', { method: 'POST', body: data }),
    deleteDesigner: (id) => apiFetch(`/designers/${id}`, { method: 'DELETE' }),

    // Managers
    getManagers: () => apiFetch('/managers'),

    // Reports — Project Report
    getProjectReport: (projectId) => apiFetch(`/projects/${projectId}/report`),

    // Reports — Weekly Report
    getWeeklyReport: (projectId, weekStart, weekEnd) =>
        apiFetch(`/projects/${projectId}/weekly-report?week_start=${weekStart}&week_end=${weekEnd}`),

    // Reports — Monthly Report
    getMonthlyReport: (projectId, month, year) =>
        apiFetch(`/projects/${projectId}/monthly-report?month=${month}&year=${year}`),

    // Reports — Designer Performance (weekly)
    getDesignerWeeklyPerformance: (designerId, weekStart, weekEnd) =>
        apiFetch(`/designers/${designerId}/performance/weekly?week_start=${weekStart}&week_end=${weekEnd}`),

    // Reports — Designer Performance (monthly)
    getDesignerMonthlyPerformance: (designerId, month, year) =>
        apiFetch(`/designers/${designerId}/performance/monthly?month=${month}&year=${year}`),

    // Reports — Project Monthly Trend (6-12 months)
    getProjectMonthlyTrend: (projectId) => apiFetch(`/projects/${projectId}/monthly-trend`),

    // Reports — Designer Comparison (cross-designer ranking)
    getDesignerComparison: (period, weekStart, weekEnd, month, year) => {
        const params = new URLSearchParams({ period });
        if (weekStart) params.set('week_start', weekStart);
        if (weekEnd) params.set('week_end', weekEnd);
        if (month) params.set('month', month);
        if (year) params.set('year', year);
        return apiFetch(`/reports/designer-comparison?${params.toString()}`);
    },

    // Reports — Designer Performance Trend (6 months)
    getDesignerPerformanceTrend: (designerId) => apiFetch(`/designers/${designerId}/performance/trend`),

    // Report downloads (CSV / PDF) via fetch+blob
    downloadReportCSV: async (endpoint) => {
        const url = `${API_BASE}${endpoint}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Download failed' }));
            throw new Error(err.detail || 'Download failed');
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : 'report.csv';
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
    },

    downloadReportPDF: async (endpoint) => {
        const url = `${API_BASE}${endpoint}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Download failed' }));
            throw new Error(err.detail || 'Download failed');
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : 'report.pdf';
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
    },

    // Slack
    getSlackConfig: () => apiFetch('/slack/config'),
    saveSlackConfig: (data) => apiFetch('/slack/config', { method: 'POST', body: data }),
    createSlackChannel: (projectId) => apiFetch(`/projects/${projectId}/slack-channel`, { method: 'POST' }),
    getSlackStatus: (projectId) => apiFetch(`/slack/status`, { method: 'POST', body: { project_id: projectId } }),
    getSlackActivity: (projectId) => apiFetch(`/projects/${projectId}/slack-activity`),
    logSlackMessage: (data) => apiFetch('/slack/messages/log', { method: 'POST', body: data }),
    getSlackMessages: (projectId) => apiFetch(`/projects/${projectId}/slack-messages`),
    getSlackChannelHistory: (projectId) => apiFetch(`/projects/${projectId}/slack-channel-history`),
    getSlackChannelStatus: (autoCorrect) => apiFetch(`/projects/slack-channel-status?auto_correct=${autoCorrect || false}`),
    addBotToChannel: (projectId) => apiFetch(`/projects/${projectId}/bot/add-to-channel`, { method: 'POST' }),
    assignStageDesigners: (projectId, stageIndex, designerIds) => apiFetch(`/projects/${projectId}/phases/${stageIndex}/assign-designers`, { method: 'POST', body: { designer_ids: designerIds } }),

    // Reminders
    sendReminder: (projectId) => apiFetch(`/projects/${projectId}/remind`, { method: 'POST' }),

    // Stage Reports
    getProjectReports: (projectId) => apiFetch(`/projects/${projectId}/reports`),
    getDesignerReports: (designerId) => apiFetch(`/designers/${designerId}/reports`),
    getReportSummary: () => apiFetch('/reports/summary'),
    submitReport: (data) => apiFetch('/reports', { method: 'POST', body: data }),
    getProjectDesignerReports: (projectId, designerId) => apiFetch(`/reports/project/${projectId}/designer/${designerId}`),

    // Admin data export — triggers a browser download (needs the session cookie,
    // so it's done via fetch+blob rather than a plain link).
    exportData: async (entity, format, fromDate, toDate) => {
        const params = new URLSearchParams({ format });
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        const url = `${API_BASE}/admin/export/${entity}?${params.toString()}`;
        console.log(`[API] Export request: ${url}`);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Export failed' }));
            throw new Error(err.detail || 'Export failed');
        }
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : `${entity}-export.${format}`;
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
    },
};