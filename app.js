// ============================================
// STATE
// ============================================
let currentView = 'dashboard';
let selectedProjectId = 1;
let slackMessagesPollInterval = null;
let selectedSlackProjectId = null;
let designerModalStageIndex = null;
let pendingCompleteStageIndex = null;
let tempDesignerSelections = [];
let DESIGNERS = [];
let CURRENT_USER = null;
let USER_ROLE = null;
let tempManagerSelections = [];
let tempEditManagerSelections = [];
// _editProjectCache removed - phase type is now read-only on edit page
let _editProjectPhaseType = 'PRODUCTION';
let _editProjectDeadline = '';
let MANAGERS = [];

// ============================================
// CHARTS
// ============================================
const chartInstances = {};

function renderChart(canvasId, config) {
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        delete chartInstances[canvasId];
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    chartInstances[canvasId] = new Chart(ctx, config);
}

function destroyAllCharts() {
    Object.keys(chartInstances).forEach(id => {
        chartInstances[id].destroy();
    });
    Object.keys(chartInstances).forEach(id => {
        delete chartInstances[id];
    });
}

const chartColors = {
    brand: '#F47920',
    brandLight: 'rgba(244, 121, 32, 0.15)',
    green: '#22C55E',
    greenBg: 'rgba(34, 197, 94, 0.75)',
    red: '#EF4444',
    redBg: 'rgba(239, 68, 68, 0.75)',
    amber: '#F59E0B',
    amberBg: 'rgba(245, 158, 11, 0.75)',
    blue: '#3B82F6',
    blueBg: 'rgba(59, 130, 246, 0.75)',
    purple: '#A855F7',
    purpleBg: 'rgba(168, 85, 247, 0.75)',
    gray: '#9CA3AF',
    grayBg: 'rgba(156, 163, 175, 0.75)',
};

const defaultChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            labels: {
                font: { family: 'Inter', size: 12, weight: '500' },
                padding: 16,
                usePointStyle: true,
                pointStyleWidth: 10,
            }
        }
    }
};

const defaultScaleConfig = {
    grid: { color: 'rgba(0, 0, 0, 0.05)', drawBorder: false },
    ticks: { font: { family: 'Inter', size: 11 } }
};

// ============================================
// DELAY INSIGHT HELPERS
// ============================================

let _delayHistoryCache = null;

async function _getDelayHistoryCache() {
    if (_delayHistoryCache) return _delayHistoryCache;
    try {
        const projects = await api.getAllProjects();
        const stageDelays = {};
        for (const project of (projects || [])) {
            for (const phase of (project.phases || [])) {
                const name = phase.stage_name || phase.name || '';
                if (!name || phase.delay_days <= 0) continue;
                if (!stageDelays[name]) stageDelays[name] = [];
                stageDelays[name].push(phase.delay_days);
            }
        }
        const averages = {};
        for (const [name, delays] of Object.entries(stageDelays)) {
            averages[name] = delays.reduce((a, b) => a + b, 0) / delays.length;
        }
        _delayHistoryCache = averages;
        return averages;
    } catch (err) {
        console.warn('[APP] _getDelayHistoryCache: Failed to load delay history:', err.message);
        _delayHistoryCache = {};
        return _delayHistoryCache;
    }
}

function formatDelayInsight(item, context) {
    if (item.delay_reason) return item.delay_reason;
    if (!item.delay_days || item.delay_days <= 0) return '';
    
    const stageName = item.stage_name || '';
    const delayDays = item.delay_days;
    
    const ctx = context || {};
    
    if (ctx.type === 'weekly-overdue') {
        return `${delayDays} days behind deadline (${formatDate(item.deadline)})`;
    }
    
    if (stageName) {
        try {
            const averages = _delayHistoryCache || {};
            const histAvg = averages[stageName];
            if (histAvg && histAvg > 0) {
                const diff = (delayDays - histAvg).toFixed(1);
                const direction = parseFloat(diff) > 0 ? 'more' : 'less';
                return `${delayDays} days delayed — ${Math.abs(parseFloat(diff))} days ${direction} than this stage's average (${histAvg.toFixed(1)}d) across other projects`;
            }
        } catch (e) {
            // fall through
        }
    }
    
    return `${delayDays} days behind schedule`;
}

// ============================================
// AUTH
// ============================================

async function checkAuth() {
    const initialHash = window.location.hash.replace('#', '');
    console.log('[APP] checkAuth: Starting authentication check, initialHash=%s', initialHash);
    console.log('[APP] checkAuth: Starting authentication check');
    try {
        const user = await api.getMe();
        console.log('[APP] checkAuth: User data received', user);
        if (user) {
            CURRENT_USER = user;
            USER_ROLE = user.role;
            updateSidebarUser(user);
            applyRoleBasedNavVisibility();
            if (user.role === 'PENDING') {
                console.log('[APP] checkAuth: User role is PENDING, showing pending page');
                showPage('pendingPage');
                document.getElementById('pendingRole').textContent = user.requested_role || 'Designer';
            } else if (user.role === 'ADMIN') {
                console.log('[APP] checkAuth: User role is ADMIN, showing dashboard');
                showPage('mainApp');
                navigateTo(initialHash && ['dashboard', 'projects', 'create-project', 'project-details', 'edit-project', 'designers', 'settings', 'slack-messages', 'slack-settings', 'data-export', 'reports'].includes(initialHash) ? initialHash : 'dashboard');
            } else if (user.role === 'DESIGNER') {
                console.log('[APP] checkAuth: User role is DESIGNER, showing restricted page');
                showPage('designerRestrictedPage');
                showDesignerRestricted(user);
            } else {
                console.log('[APP] checkAuth: User authenticated, showing main app');
                showPage('mainApp');
                navigateTo(initialHash && ['dashboard', 'projects', 'create-project', 'project-details', 'edit-project', 'designers', 'settings', 'slack-messages', 'slack-settings', 'data-export', 'reports'].includes(initialHash) ? initialHash : 'dashboard');
            }
        } else {
            console.log('[APP] checkAuth: No user data, showing login page');
            showPage('loginPage');
        }
    } catch (err) {
        console.error('[APP] checkAuth: Error during auth check:', err.message);
        showPage('loginPage');
    }
}

function showPage(pageId, { updateUrl = true } = {}) {
    ['loginPage', 'pendingPage', 'designerLandingPage', 'designerRestrictedPage', 'mainApp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === pageId) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });

    if (updateUrl) {
        const path = PAGE_TO_PATH[pageId] || '/';
        if (window.location.pathname !== path) {
            // Use the initial load as a replace (no extra back-button entry),
            // subsequent page switches push a new entry so back/forward works.
            const method = history.state && history.state.__routed ? 'pushState' : 'replaceState';
            history[method]({ __routed: true, pageId }, '', path);
        }
    }
}

// ============================================
// ROUTER
// ============================================

const PAGE_TO_PATH = {
    loginPage: '/login',
    pendingPage: '/pending',
    mainApp: '/home',
};

// Re-run auth check on back/forward so the URL and visible page stay in sync
window.addEventListener('popstate', (event) => {
    // If we already have auth state, restore sub-page from history state or hash
    if (CURRENT_USER && CURRENT_USER.role !== 'PENDING') {
        const view = event.state?.view || window.location.hash.replace('#', '') || 'dashboard';
        if (view && view !== currentView) {
            navigateTo(view);
        }
        return;
    }
    checkAuth();
});

function updateSidebarUser(user) {
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) {
        const roleLabels = {
            'ADMIN': 'Administrator',
            'MANAGER': 'Manager',
            'DESIGNER': 'Designer',
        };
        roleEl.textContent = roleLabels[user.role] || user.role;
    }
}

function slackLogin() {
    window.location.href = `${API_BASE}/auth/slack-auth-url`;
}

function connectSlackWorkspace() {
    window.location.href = `${API_BASE}/slack/install`;
}

function handleSlackInstallReturn() {
    const params = new URLSearchParams(window.location.search);
    const installed = params.get('slack_install');
    const installError = params.get('slack_install_error');
    if (installed === 'success') {
        showToast('Slack workspace connected! Bot token saved.');
        window.history.replaceState({}, '', window.location.pathname);
        loadSlackSettings();
    } else if (installError) {
        showToast('Slack install failed: ' + installError);
        window.history.replaceState({}, '', window.location.pathname);
    }
}

async function handleSlackCallback() {
    console.log('[APP] handleSlackCallback: Checking URL params for Slack OAuth result');
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const slackLogin = params.get('slack_login');
    const slackPending = params.get('slack_pending');
    console.log('[APP] handleSlackCallback: error=%s, slack_login=%s, slack_pending=%s', error, slackLogin, slackPending);

    if (error) {
        console.error('[APP] handleSlackCallback: Slack login failed with error:', error);
        showToast('Slack login failed: ' + error);
        window.history.replaceState({}, document.title, window.location.pathname);
        showPage('loginPage');
        return true;
    }

    if (slackLogin === 'success') {
        console.log('[APP] handleSlackCallback: Slack login success, fetching user data');
        window.history.replaceState({}, document.title, window.location.pathname);
        try {
            const user = await api.getMe();
            console.log('[APP] handleSlackCallback: User data after Slack login', user);
            if (user) {
                CURRENT_USER = user;
                USER_ROLE = user.role;
                updateSidebarUser(user);
                if (user.role === 'PENDING') {
                    showPage('pendingPage');
                    document.getElementById('pendingRole').textContent = user.requested_role || 'Designer';
                } else if (user.role === 'ADMIN') {
                    showPage('mainApp');
                    navigateTo('dashboard');
                } else {
                    showPage('mainApp');
                    navigateTo('dashboard');
                }
                return true;
            }
        } catch (err) {
            console.error('[APP] handleSlackCallback: Failed to fetch user after Slack login:', err.message);
            showToast('Slack login failed: ' + err.message);
        }
    }

    if (slackPending) {
        console.log('[APP] handleSlackCallback: Slack account pending approval');
        window.history.replaceState({}, document.title, window.location.pathname);
        showPage('loginPage');
        showToast('Account pending approval. Please login with email.');
        return true;
    }

    console.log('[APP] handleSlackCallback: No Slack callback params found');
    return false;
}

async function emailLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) {
        showToast('Please enter email and password');
        return;
    }
    console.log('[APP] emailLogin: Attempting login for email:', email);
    try {
        const result = await api.emailLogin(email, password);
        console.log('[APP] emailLogin: Login response received', result);
        if (result && result.user) {
            CURRENT_USER = result.user;
            USER_ROLE = result.user.role;
            updateSidebarUser(result.user);
            if (result.user.role === 'PENDING') {
                showPage('pendingPage');
                document.getElementById('pendingRole').textContent = result.user.requested_role || 'Designer';
            } else if (result.user.role === 'ADMIN') {
                showPage('mainApp');
                navigateTo('dashboard');
            } else {
                showPage('mainApp');
                navigateTo('dashboard');
            }
        }
    } catch (err) {
        console.error('[APP] emailLogin: Login failed:', err.message);
        showToast(err.message);
    }
}

async function logout() {
    console.log('[APP] logout: Starting logout process');
    try {
        await api.logout();
        console.log('[APP] logout: API logout successful');
    } catch (err) {
        console.warn('[APP] logout: API logout failed (ignored):', err.message);
    }
    CURRENT_USER = null;
    USER_ROLE = null;
    showPage('loginPage');
    console.log('[APP] logout: Logged out, showing login page');
}

// ============================================
// ADMIN: Pending Users
// ============================================

async function approveUser(userId, role) {
    if (!confirm(`Approve this user as ${role}?`)) return;
    try {
        await api.approveUser(userId, role);
        showToast('User approved as ' + role);
        populateDesignersPage();
    } catch (err) {
        showToast('Failed: ' + err.message);
    }
}

async function rejectUser(userId) {
    if (!confirm('Reject this user? They will need to contact an admin again.')) return;
    try {
        await api.deleteDesigner(userId);
        showToast('User rejected');
        populateDesignersPage();
    } catch (err) {
        showToast(err.message);
    }
}

async function denyUser(userId) {
    if (!confirm('Deny this user? They will need to contact an admin again.')) return;
    console.log('[APP] denyUser: Denying user', userId);
    try {
        // Delete the user from DB
        const db = SessionLocal();
        const user = db.query(User).filter(User.id == userId).first();
        if (user) {
            db.delete(user);
            db.commit();
        }
        db.close();
        showToast('User denied');
        populateDesignersPage();
    } catch (err) {
        console.error('[APP] denyUser: Failed to deny user:', err.message);
        showToast('Failed: ' + err.message);
    }
}

// ============================================
// NAVIGATION
// ============================================
function navigateTo(view, projectId = null) {
    currentView = view;
    if (projectId) selectedProjectId = projectId;

    document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
    const pageMap = {
        'dashboard': 'page-dashboard',
        'projects': 'page-projects',
        'create-project': 'page-create-project',
        'project-details': 'page-project-details',
        'edit-project': 'page-edit-project',
        'designers': 'page-designers',
        'settings': 'page-settings',
        'slack-messages': 'page-slack-messages',
        'slack-settings': 'page-slack-settings',
        'data-export': 'page-data-export',
        'reports': 'page-reports',
    };
    const targetId = pageMap[view];
    if (targetId) {
        const target = document.getElementById(targetId);
        if (target) target.classList.remove('hidden');
    }

    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active', 'bg-brand-50', 'text-brand-600', 'font-semibold');
        link.classList.add('text-gray-600', 'font-medium');
    });
    const navMap = {
        'dashboard': 'dashboard',
        'projects': 'projects',
        'create-project': 'projects',
        'project-details': 'projects',
        'edit-project': 'projects',
        'designers': 'designers',
        'slack-messages': 'slack-messages',
        'slack-settings': 'slack-settings',
        'data-export': 'data-export',
    };
    const navKey = navMap[view];
    if (navKey) {
        const navLink = document.querySelector(`[data-nav="${navKey}"]`);
        if (navLink) {
            navLink.classList.add('active', 'bg-brand-50', 'text-brand-600', 'font-semibold');
            navLink.classList.remove('text-gray-600', 'font-medium');
        }
    }

    if (view === 'projects') populateProjectsTable();
    if (view === 'project-details') populateProjectDetails();
    if (view === 'edit-project') populateEditProject();
    if (view === 'designers') populateDesignersPage();
    if (view === 'create-project') resetCreateProjectForm();
    if (view === 'dashboard') loadDashboard();
    if (view === 'slack-messages') loadSlackMessages();
    if (view === 'slack-messages') loadSlackSettings();
    if (view === 'data-export') resetExportForm();
    if (view === 'reports') populateReportsPage();

    // Attach date change listeners for phase deadlines
    const startDateInputs = document.querySelectorAll('#page-create-project form input[type="date"]');
    startDateInputs.forEach((input, idx) => {
        input.onchange = function () {
            renderPhaseDeadlines();
        };
    });

    // Update URL hash so browser history tracks sub-page navigation
    const currentHash = window.location.hash.replace('#', '');
    if (currentHash !== view) {
        history.pushState({ view }, '', `#${view}`);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeSidebar();
}

// ============================================
// SIDEBAR TOGGLE (Mobile)
// ============================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
}

// ============================================
// DASHBOARD
// ============================================
async function loadDashboard() {
    console.log('[APP] loadDashboard: Loading dashboard data');
    try {
        const stats = await api.getDashboardStats();
        console.log('[APP] loadDashboard: Stats received', stats);
        document.getElementById('statActiveProjects').textContent = stats.active_projects;
        document.getElementById('statOnTime').textContent = stats.on_time;
        document.getElementById('statCompleted').textContent = stats.completed;
        document.getElementById('statDelayed').textContent = stats.delayed;

        // Dashboard Charts
        try {
            const statusChartEl = document.getElementById('dashboardStatusChart');
            if (statusChartEl) {
                renderChart('dashboardStatusChart', {
                    type: 'doughnut',
                    data: {
                    labels: ['On Time', 'Delayed', 'Completed'],
                    datasets: [{
                        data: [stats.on_time, stats.delayed, stats.completed],
                        backgroundColor: [chartColors.blueBg, chartColors.redBg, chartColors.greenBg],
                            borderWidth: 0,
                            hoverOffset: 8,
                        }]
                    },
                    options: {
                        ...defaultChartOptions,
                        cutout: '65%',
                        plugins: {
                            ...defaultChartOptions.plugins,
                            legend: {
                                ...defaultChartOptions.plugins.legend,
                                position: 'bottom'
                            }
                        }
                    }
                });
            }
            const overdueList = document.getElementById('overdueProjectsList');
            if (overdueList) {
                try {
                    const overdue = await api.getOverdueProjects();
                    let html = '';
                    if (overdue.length === 0) {
                        html = '<p class="text-sm text-gray-400 text-center py-4">No overdue projects. All on track!</p>';
                    } else {
                        overdue.forEach(p => {
                            html += `
                                <div class="flex items-center justify-between py-3 border-b border-gray-100 last:border-0" style="cursor:pointer" onclick="navigateTo('project-details', ${p.id})">
                                    <div>
                                        <p class="font-medium text-gray-900 text-sm">${p.name}</p>
                                        <p class="text-xs text-gray-500">${p.assigned_designer || 'Unassigned'} · Deadline: ${p.deadline}</p>
                                    </div>
                                    <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700 whitespace-nowrap">${p.days_overdue}d overdue</span>
                                </div>
                            `;
                        });
                    }
                    overdueList.innerHTML = html;
                } catch (overdueErr) {
                    console.warn('[APP] loadDashboard: Failed to load overdue projects:', overdueErr.message);
                    overdueList.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Failed to load overdue projects.</p>';
                }
            }
            const trendChartEl = document.getElementById('dashboardDelayTrendChart');
            if (trendChartEl) {
                try {
                    const trend = await api.getDelayTrend();
                    if (trend.length > 0) {
                        const sortedTrend = [...trend].sort((a, b) => a.month.localeCompare(b.month));
                        const months = sortedTrend.map(t => {
                            const [y, m] = t.month.split('-');
                            return new Date(y, m - 1).toLocaleDateString('en', { month: 'short', year: '2-digit' });
                        });
                        renderChart('dashboardDelayTrendChart', {
                            type: 'line',
                            data: {
                                labels: months,
                                datasets: [{
                                    label: 'Total Delay Days',
                                    data: sortedTrend.map(t => t.total_delay_days),
                                    borderColor: chartColors.red,
                                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                    fill: true,
                                    tension: 0.3,
                                    pointRadius: 4,
                                    pointHoverRadius: 6,
                                    borderWidth: 2,
                                }, {
                                    label: 'Delayed Projects',
                                    data: sortedTrend.map(t => t.delayed_projects),
                                    borderColor: chartColors.amber,
                                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                                    fill: true,
                                    tension: 0.3,
                                    pointRadius: 4,
                                    pointHoverRadius: 6,
                                    borderWidth: 2,
                                    yAxisID: 'y1',
                                }]
                            },
                            options: {
                                ...defaultChartOptions,
                                scales: {
                                    x: { ...defaultScaleConfig, grid: { display: false }, reverse: false },
                                    y: { ...defaultScaleConfig, beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, title: { display: true, text: 'Delay Days', font: { size: 11 } } },
                                    y1: { ...defaultScaleConfig, beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Projects', font: { size: 11 } } }
                                },
                                plugins: {
                                    ...defaultChartOptions.plugins,
                                    legend: { position: 'bottom', labels: { font: { size: 11 } } }
                                }
                            }
                        });
                    } else {
                        document.getElementById('delayTrendContainer').innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No delay data available yet.</p>';
                    }
                } catch (trendErr) {
                    console.warn('[APP] loadDashboard: Failed to load delay trend:', trendErr.message);
                    document.getElementById('delayTrendContainer').innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Failed to load delay trend.</p>';
                }
            }
        } catch (chartErr) {
            console.warn('[APP] loadDashboard: Failed to render charts:', chartErr.message);
        }
    } catch (err) {
        console.error('[APP] loadDashboard: Failed to load dashboard:', err.message);
        showToast('Failed to load dashboard: ' + err.message);
    }
}

// ============================================
// POPULATE PROJECTS TABLE
// ============================================
let currentProjectsFilter = 'all';

function setProjectsFilter(filter) {
    currentProjectsFilter = filter;
    
    const tabs = {
        all: 'projectsFilterAll',
        IDEATION: 'projectsFilterIdeation',
        PRODUCTION: 'projectsFilterProduction',
    };
    
    Object.entries(tabs).forEach(([key, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (key === filter) {
            btn.classList.add('border-brand-500', 'text-brand-600');
            btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        } else {
            btn.classList.remove('border-brand-500', 'text-brand-600');
            btn.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        }
    });
    
    populateProjectsTable();
}

async function populateProjectsTable() {
    console.log('[APP] populateProjectsTable: Loading projects table');
    try {
        DESIGNERS = await api.getDesigners();
        console.log('[APP] populateProjectsTable: Designers loaded', DESIGNERS?.length || 0);
        const projects = await api.getProjects();
        console.log('[APP] populateProjectsTable: Projects loaded', projects?.length || 0);
        const filteredProjects = currentProjectsFilter === 'all' 
            ? projects 
            : projects.filter(p => p.phase_type === currentProjectsFilter);
        const tbody = document.getElementById('projectsTableBody');
        let html = '';
        filteredProjects.forEach(p => {
            const statusClass = getStatusColor(p.status);
            const statusText = getStatusText(p.status);
            const stageLabel = getPhaseDisplayName(p, p.stage_index);
            const typeBadge = p.phase_type === 'IDEATION'
                ? '<span class="text-xs font-medium px-2 py-1 rounded-full bg-purple-100 text-purple-700">Ideation</span>'
                : '<span class="text-xs font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-700">Production</span>';
            html += `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer" onclick="navigateTo('project-details', ${p.id})">
                    <td class="px-5 py-4">
                        <p class="font-semibold text-gray-900">${p.name}</p>
                    </td>
                    <td class="px-5 py-4">${typeBadge}</td>
                    <td class="px-5 py-4 text-gray-600">${getDesignerName(p.assigned_designer_id, DESIGNERS)}</td>
                    <td class="px-5 py-4">
                        <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">Stage ${p.stage_index + 1} — ${stageLabel}</span>
                    </td>
                    <td class="px-5 py-4">
                        <div class="flex items-center gap-2">
                            <div class="w-20 h-1.5 bg-gray-200 rounded-full flex-shrink-0">
                                <div class="h-full rounded-full ${p.progress >= 80 ? (p.status === 'DELAYED' ? 'bg-red-500' : 'bg-green-500') : p.progress >= 40 ? 'bg-brand-500' : 'bg-amber-500'}" style="width:${p.progress}%"></div>
                            </div>
                            <span class="text-xs font-medium text-gray-600">${p.progress}%</span>
                        </div>
                    </td>
                    <td class="px-5 py-4 text-gray-600 text-sm">${p.phases && p.phases[p.stage_index] ? formatDate(p.phases[p.stage_index].deadline) : formatDate(p.deadline)}</td>
                    <td class="px-5 py-4">
                        <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}">${statusText}</span>
                    </td>
                    <td class="px-5 py-4 text-right" onclick="event.stopPropagation()">
                        <button onclick="navigateTo('project-details', ${p.id})" class="text-brand-600 hover:text-brand-700 font-medium text-xs mr-3 transition-colors">View</button>
                        <button onclick="navigateTo('edit-project', ${p.id})" class="text-gray-500 hover:text-gray-700 font-medium text-xs transition-colors">Edit</button>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (err) {
        console.error('[APP] populateProjectsTable: Failed to load projects:', err.message);
        showToast('Failed to load projects: ' + err.message);
    }
}

// ============================================
// POPULATE PROJECT DETAILS
// ============================================
async function populateProjectDetails() {
    console.log('[APP] populateProjectDetails: Loading project details for project', selectedProjectId);
    try {
        DESIGNERS = await api.getDesigners();
        MANAGERS = await api.getManagers();
        const project = await api.getProject(selectedProjectId);
        console.log('[APP] populateProjectDetails: Project data received', project);
        document.getElementById('detailProjectName').textContent = project.name;
        document.getElementById('detailClientName').textContent = 'Assigned to ' + getDesignerName(project.assigned_designer_id, DESIGNERS);
        document.getElementById('detailStageBadge').textContent =
            `Stage ${project.stage_index + 1}`;
        
        // Show/hide Slack button based on channel connection
        const slackBtn = document.getElementById('openSlackBtn');
        if (project.slack_channel_id && project.slack_channel_id.trim() !== '') {
            slackBtn.classList.remove('hidden');
        } else {
            slackBtn.classList.add('hidden');
        }
        
        document.getElementById('detailProgress').textContent = project.progress;
        document.getElementById('detailProgressBar').style.width = project.progress + '%';
        document.getElementById('detailProgressBar').className = `h-full rounded-full ${project.progress >= 80 ? (project.status === 'DELAYED' ? 'bg-red-500' : 'bg-green-500') : project.progress >= 40 ? 'bg-brand-500' : 'bg-amber-500'}`;
        document.getElementById('detailDeadline').textContent = formatDate(project.deadline);
        document.getElementById('detailStatus').textContent = getStatusText(project.status);

        const phases = project.phases || [];

        // Workflow tracker
        const tracker = document.getElementById('workflowTracker');
        let trackerHTML = '';
        phases.forEach((phase, idx) => {
            const isCompleted = idx < project.stage_index;
            const isCurrent = idx === project.stage_index;
            const isUpcoming = idx > project.stage_index;

            let circleClass = 'bg-gray-100 text-gray-400';
            let labelClass = 'text-gray-400';
            let icon = '○';
            let connectorClass = 'bg-gray-200';

            if (isCompleted) {
                circleClass = 'bg-green-500 text-white';
                labelClass = 'text-green-700';
                icon = '✓';
                connectorClass = 'bg-green-500';
            } else if (isCurrent) {
                circleClass = 'bg-brand-500 text-white ring-4 ring-brand-100';
                labelClass = 'text-brand-700 font-semibold';
                icon = (idx + 1).toString();
                connectorClass = 'bg-brand-500';
            }

            trackerHTML += `
                <div class="flex flex-col items-center flex-shrink-0 relative" style="min-width:60px;">
                    <div class="w-8 h-8 rounded-full ${circleClass} flex items-center justify-center text-xs font-bold z-10 relative">
                        ${icon}
                    </div>
                    <span class="text-[10px] md:text-xs mt-1.5 text-center ${labelClass} leading-tight max-w-[60px]">${getPhaseDisplayName(project, idx)}</span>
                    ${idx < phases.length - 1 ? `<div class="absolute top-4 left-[calc(50%+20px)] w-[calc(100%-40px)] h-0.5 ${connectorClass}" style="width:calc(100vw / ${phases.length}); max-width:60px; left:50%;"></div>` : ''}
                </div>
            `;
        });
        tracker.innerHTML = trackerHTML;

        // Manager remarks callout from previous stage
        const currentPhaseIdx = project.stage_index;
        const prevPhase = project.phases.find(p => p.stage_index === currentPhaseIdx - 1);
        let remarksCalloutHTML = '';
        if (prevPhase && prevPhase.manager_remarks && prevPhase.manager_remarks.trim()) {
            const prevStageName = getPhaseDisplayName(project, prevPhase.stage_index);
            remarksCalloutHTML = `
                <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                    <div class="flex items-start gap-3">
                        <svg class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <div>
                            <p class="text-sm font-semibold text-amber-800 mb-1">Manager remarks from ${prevStageName}</p>
                            <p class="text-sm text-amber-700 whitespace-pre-wrap">${prevPhase.manager_remarks}</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Stage cards
        const cardsContainer = document.getElementById('stageCardsContainer');
        let cardsHTML = '';
        project.phases.forEach((sd, idx) => {
            const isCompleted = sd.completed_at !== null;
            const isCurrent = idx === project.stage_index;
            const isLocked = idx > project.stage_index;
            const prevCompleted = idx === 0 ? true : (project.phases[idx - 1].completed_at !== null);
            const canComplete = isCurrent && !isCompleted && prevCompleted;

            const assignedNames = sd.assigned_designer_ids && sd.assigned_designer_ids.length > 0
                ? sd.assigned_designer_ids.map(dId => DESIGNERS.find(d => d.id === dId)).filter(Boolean).map(d => d.name).join(', ')
                : getDesignerName(project.assigned_designer_id, DESIGNERS);

            const delayReason = sd.delay_reason || '—';
            const delayResponsible = sd.delay_responsible || [];
            const delayDays = calculateDelayDays(sd.deadline);
            const completedAt = sd.completed_at ? formatDateTime(sd.completed_at) : '—';
            const deadline = sd.deadline ? formatDate(sd.deadline) : '—';

            // Build responsible people names
            let responsibleNames = '—';
            if (delayResponsible.length > 0) {
                const responsibleNamesList = delayResponsible
                    .map(uid => {
                        const allDesigners = DESIGNERS || [];
                        const d = allDesigners.find(d => d.id === uid);
                        if (d) return d.name;
                        const allManagers = MANAGERS || [];
                        const m = allManagers.find(m => m.id === uid);
                        return m ? m.name : null;
                    })
                    .filter(Boolean);
                if (responsibleNamesList.length > 0) {
                    responsibleNames = responsibleNamesList.join(', ');
                }
            }

            let statusClass = 'bg-gray-100 text-gray-500';
            let statusText = 'Locked';
            let leftBorder = 'border-l-gray-200';
            let cardBg = 'bg-white';

            if (isCompleted) {
                statusClass = 'bg-green-50 text-green-700';
                statusText = 'Completed';
                leftBorder = 'border-l-green-400';
                cardBg = 'bg-white';
            } else if (isCurrent) {
                statusClass = 'bg-brand-50 text-brand-700';
                statusText = 'In Progress';
                leftBorder = 'border-l-brand-500';
                cardBg = 'bg-brand-50/20';
            }

            cardsHTML += `
                <div class="rounded-lg border border-gray-200 ${leftBorder} ${cardBg} p-4">
                    <div class="flex items-center justify-between gap-3 mb-3">
                        <div class="flex items-center gap-2.5">
                            <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isCompleted ? 'bg-green-500 text-white' : isCurrent ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}">${idx + 1}</span>
                            <div>
                                <h4 class="text-sm font-semibold text-gray-900">${getPhaseDisplayName(project, idx)}</h4>
                                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded ${statusClass}">${statusText}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-1.5 flex-shrink-0">
                            ${canComplete ? `
                            <button onclick="markStageComplete(${idx})" class="px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
                                ✓ Complete
                            </button>
                            ` : ''}
                            ${isCompleted ? `
                            <button onclick="unmarkStageComplete(${idx})" class="px-2.5 py-1 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors">
                                ↩
                            </button>
                            ` : ''}
                            ${isLocked ? `
                            <span class="px-2 py-1 text-xs text-gray-400">🔒</span>
                            ` : ''}
                            ${isCurrent && !isCompleted && !prevCompleted ? `
                            <span class="px-2 py-1 text-xs text-amber-600 bg-amber-50 rounded-md">🔒</span>
                            ` : ''}
                            <button onclick="openDesignerModal(${idx})" class="px-2.5 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors ${isLocked ? 'opacity-40 cursor-not-allowed' : ''}" ${isLocked ? 'disabled' : ''}>
                                👤
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                        <div>
                            <p class="text-gray-400 mb-0.5">Deadline</p>
                            <p class="font-medium text-gray-700">${deadline}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Designer</p>
                            <p class="font-medium text-gray-700">${assignedNames}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Delay</p>
                            <p class="text-gray-500 truncate">${delayDays > 0 ? `Delayed (${delayDays}d)` : 'On track'}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Reason</p>
                            <p class="text-gray-500 truncate">${delayReason}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Responsible</p>
                            <p class="text-gray-500 truncate">${responsibleNames}</p>
                        </div>
                    </div>
                </div>
            `;
        });
        cardsContainer.innerHTML = cardsHTML;
    } catch (err) {
        console.error('[APP] populateProjectDetails: Failed to load project details:', err.message);
        showToast('Failed to load project details: ' + err.message);
    }
}

// ============================================
// SEND REMINDER (manager/admin manual trigger)
// ============================================
async function sendProjectReminder() {
    if (!selectedProjectId) return;
    const btn = document.getElementById('sendReminderBtn');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Sending…';
    }
    try {
        const result = await api.sendReminder(selectedProjectId);
        showToast(`Reminder sent to Slack — asking about "${result.stage}"`);
    } catch (err) {
        console.error('[APP] sendProjectReminder: failed:', err.message);
        showToast('Failed to send reminder: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// ============================================
// OPEN PROJECT SLACK CHANNEL
// ============================================
async function openProjectSlackChannel() {
    if (!selectedProjectId) return;
    try {
        const project = await api.getProject(selectedProjectId);
        if (!project.slack_channel_id || project.slack_channel_id.trim() === '') {
            showToast('No Slack channel connected for this project');
            return;
        }
        const teamId = project.slack_team_id || (CURRENT_USER && CURRENT_USER.slack_team_id ? CURRENT_USER.slack_team_id : '');
        if (!teamId) {
            showToast('Slack team ID not found. Please reconnect Slack.');
            return;
        }
        const slackUrl = `https://app.slack.com/client/${teamId}/${project.slack_channel_id}`;
        window.open(slackUrl, '_blank');
    } catch (err) {
        console.error('[APP] openProjectSlackChannel: failed:', err.message);
        showToast('Failed to open Slack channel: ' + err.message);
    }
}

// ============================================
// ADMIN DATA EXPORT
// ============================================
function resetExportForm() {
    const checkbox = document.getElementById('exportUseRange');
    const inputs = document.getElementById('exportRangeInputs');
    if (checkbox) checkbox.checked = false;
    if (inputs) inputs.classList.add('hidden');
    const from = document.getElementById('exportFrom');
    const to = document.getElementById('exportTo');
    if (from) from.value = '';
    if (to) to.value = '';
}

function toggleExportRangeInputs() {
    const checkbox = document.getElementById('exportUseRange');
    const inputs = document.getElementById('exportRangeInputs');
    if (!checkbox || !inputs) return;
    inputs.classList.toggle('hidden', !checkbox.checked);
}

async function runExport(entity, format) {
    const useRange = document.getElementById('exportUseRange')?.checked;
    let fromDate = '';
    let toDate = '';
    if (useRange) {
        fromDate = document.getElementById('exportFrom')?.value || '';
        toDate = document.getElementById('exportTo')?.value || '';
        if (!fromDate && !toDate) {
            showToast('Pick at least a From or To date, or uncheck the custom range.');
            return;
        }
    }
    try {
        showToast(`Preparing ${entity} export…`);
        await api.exportData(entity, format, fromDate, toDate);
        showToast(`${entity.charAt(0).toUpperCase() + entity.slice(1)} export downloaded.`);
    } catch (err) {
        console.error('[APP] runExport: failed:', err.message);
        showToast('Export failed: ' + err.message);
    }
}

// ============================================
// POPULATE EDIT PROJECT
// ============================================
async function populateEditProject() {
    console.log('[APP] populateEditProject: Loading edit form for project', selectedProjectId);
    try {
        DESIGNERS = await api.getDesigners();
        MANAGERS = await api.getManagers();
        const project = await api.getProject(selectedProjectId);
        console.log('[APP] populateEditProject: Project data received', project);
        
        // Project Name
        const nameInput = document.getElementById('editProjectName');
        if (nameInput) nameInput.value = project.name;
        
        // Designer Select
        const designerSelect = document.getElementById('editDesignerSelect');
        if (designerSelect) {
            let html = '<option value="">Select a designer</option>';
            DESIGNERS.forEach(d => {
                const sel = d.id === project.assigned_designer_id ? 'selected' : '';
                html += `<option value="${d.id}" ${sel}>${d.name}</option>`;
            });
            designerSelect.innerHTML = html;
        }
        
        // Start Date
        const startDateInput = document.getElementById('editProjectStartDate');
        if (startDateInput) startDateInput.value = project.start_date || '';
        
        // Deadline
        const dateInput = document.getElementById('editProjectDeadline');
        if (dateInput) dateInput.value = project.deadline;
        
        // Description
        const descInput = document.getElementById('editProjectDescription');
        if (descInput) descInput.value = project.description || '';
        
        // Manager Selection
        populateEditManagerSelect(project.managers ? project.managers.map(m => m.id) : []);
        
        // Phase Type (read-only display)
        _editProjectPhaseType = project.phase_type || 'PRODUCTION';
        _editProjectDeadline = project.deadline || '';
        const phaseTypeDisplay = document.getElementById('editPhaseTypeDisplay');
        if (phaseTypeDisplay) {
            const pt = project.phase_type || 'PRODUCTION';
            const icon = pt === 'IDEATION' 
                ? '<svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>'
                : '<svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 00-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.442l4.896 4.896a2 2 0 002.828 0l4.896-4.896a2 2 0 00.586-1.442V5l-1-1H4z"/></svg>';
            phaseTypeDisplay.innerHTML = `${icon}${pt}`;
        }
        
        // Phase Deadlines
        renderEditPhaseDeadlines(project);
        
        // Read-only info panels
        populateEditReadOnlyInfo(project);
    } catch (err) {
        console.error('[APP] populateEditProject: Failed to load project:', err.message);
        showToast('Failed to load project: ' + err.message);
    }
}

async function saveProjectEdit() {
    console.log('[APP] saveProjectEdit: Saving project', selectedProjectId);
    try {
        const nameInput = document.getElementById('editProjectName');
        const designerSelect = document.getElementById('editDesignerSelect');
        const startDateInput = document.getElementById('editProjectStartDate');
        const dateInput = document.getElementById('editProjectDeadline');
        const descInput = document.getElementById('editProjectDescription');
        const phaseDeadlineInputs = document.querySelectorAll('#editPhaseDeadlinesContainer .phase-deadline-input');
        const phaseNameInputs = document.querySelectorAll('#editPhaseDeadlinesContainer .phase-name-input');
        const phaseRowDivs = document.querySelectorAll('#editPhaseDeadlinesContainer .phase-row');
        const phaseDeadlines = [];
        const phaseNames = [];
        const phaseIds = [];
        phaseDeadlineInputs.forEach(input => phaseDeadlines.push(input.value));
        phaseNameInputs.forEach(input => phaseNames.push(input.value));
        phaseRowDivs.forEach(div => phaseIds.push(div.getAttribute('data-phase-id') || ''));
        const phases = phaseDeadlines.map((deadline, index) => {
            const phaseObj = {
                stage_index: index,
                deadline: deadline || dateInput?.value || '',
                stage_name: phaseNames[index] || null
            };
            const phaseId = phaseIds[index];
            if (phaseId && phaseId !== '') {
                phaseObj.phase_id = parseInt(phaseId);
            }
            return phaseObj;
        });

        const updateData = {
            name: nameInput ? nameInput.value : null,
            assigned_designer_id: designerSelect ? parseInt(designerSelect.value) : null,
            start_date: startDateInput ? startDateInput.value : null,
            deadline: dateInput ? dateInput.value : null,
            description: descInput ? descInput.value : null,
            stage_names: phaseNames.length ? phaseNames : null,
            phases: phaseDeadlines.length ? phases : null,
            manager_ids: tempEditManagerSelections && tempEditManagerSelections.length ? tempEditManagerSelections : null,
        };

        await api.updateProject(selectedProjectId, updateData);

        showToast('Project updated successfully!');
        navigateTo('project-details');
    } catch (err) {
        console.error('[APP] saveProjectEdit: Failed to update project:', err.message);
        showToast('Failed to update project: ' + err.message);
    }
}

// ============================================
// STAGE COMPLETION
// ============================================
async function markStageComplete(stageIndex) {
    console.log('[APP] markStageComplete: Opening delay reason modal for stage', stageIndex, 'on project', selectedProjectId);
    pendingCompleteStageIndex = stageIndex;
    document.getElementById('delayReasonInput').value = '';
    document.getElementById('managerRemarksInput').value = '';
    
    // Fetch project to get phase_type-aware stage name and pre-populate responsible checkboxes
    try {
        const project = await api.getProject(selectedProjectId);
        const stageLabel = getPhaseDisplayName(project, stageIndex);
        document.getElementById('delayReasonStageLabel').textContent = `Stage: ${stageLabel}`;
        
        // Get the phase data for this stage
        const phaseData = project.phases[stageIndex];
        const existingResponsible = phaseData?.delay_responsible || [];
        
        // Get all designers and managers
        const allDesigners = await api.getDesigners();
        const allManagers = await api.getManagers();
        
        // Populate designer checkboxes
        const designersContainer = document.getElementById('delayResponsibleDesigners');
        if (designersContainer) {
            let dHtml = '';
            allDesigners.forEach(d => {
                const checked = existingResponsible.includes(d.id) ? 'checked' : '';
                dHtml += `<label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" class="delay-responsible-checkbox rounded border-gray-300 text-brand-500 focus:ring-brand-500" value="${d.id}" data-role="DESIGNER" ${checked}>
                    <span class="text-sm text-gray-700">${d.name}</span>
                </label>`;
            });
            designersContainer.innerHTML = dHtml;
        }
        
        // Populate manager checkboxes
        const managersContainer = document.getElementById('delayResponsibleManagers');
        if (managersContainer) {
            let mHtml = '';
            allManagers.forEach(m => {
                const checked = existingResponsible.includes(m.id) ? 'checked' : '';
                mHtml += `<label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" class="delay-responsible-checkbox rounded border-gray-300 text-brand-500 focus:ring-brand-500" value="${m.id}" data-role="MANAGER" ${checked}>
                    <span class="text-sm text-gray-700">${m.name}</span>
                </label>`;
            });
            managersContainer.innerHTML = mHtml;
        }
        
        // Show/hide the responsible section based on whether delay reason has content
        toggleDelayResponsibleVisibility();
    } catch (err) {
        document.getElementById('delayReasonStageLabel').textContent = `Stage: ${stageIndex + 1}`;
    }
    document.getElementById('delayReasonModal').classList.remove('hidden');
    
    // Add onchange listener to delay reason textarea for toggling responsible section
    const reasonInput = document.getElementById('delayReasonInput');
    if (reasonInput) {
        reasonInput.oninput = toggleDelayResponsibleVisibility;
    }
}

function closeDelayReasonModal() {
    document.getElementById('delayReasonModal').classList.add('hidden');
    pendingCompleteStageIndex = null;
    // Reset responsible checkboxes
    document.querySelectorAll('.delay-responsible-checkbox').forEach(cb => cb.checked = false);
}

function toggleDelayResponsibleVisibility() {
    // Always show the responsible section — delay accountability is mandatory
    const section = document.getElementById('delayResponsibleSection');
    if (section) {
        section.classList.remove('hidden');
    }
}

async function confirmMarkComplete() {
    if (pendingCompleteStageIndex === null) return;
    const delayReason = document.getElementById('delayReasonInput').value.trim();
    const managerRemarks = document.getElementById('managerRemarksInput').value.trim();
    
    // Collect checked responsible user IDs
    const delayResponsible = [];
    document.querySelectorAll('.delay-responsible-checkbox:checked').forEach(cb => {
        delayResponsible.push(parseInt(cb.value));
    });
    
    console.log('[APP] confirmMarkComplete: Marking stage', pendingCompleteStageIndex, 'complete for project', selectedProjectId, 'delay_reason:', delayReason || '(none)', 'delay_responsible:', delayResponsible, 'manager_remarks:', managerRemarks || '(none)');
    try {
        await api.completeStage(selectedProjectId, pendingCompleteStageIndex, delayReason || undefined, delayResponsible.length > 0 ? delayResponsible : undefined, managerRemarks || undefined);
        populateProjectDetails();
        
        // Fetch project to get phase_type-aware stage name for toast
        try {
            const project = await api.getProject(selectedProjectId);
            const stageLabel = getPhaseDisplayName(project);
            showToast(`"${stageLabel}" marked as complete!`);
        } catch (err) {
            showToast(`Stage ${pendingCompleteStageIndex + 1} marked as complete!`);
        }
    } catch (err) {
        console.error('[APP] confirmMarkComplete: Failed to mark stage complete:', err.message);
        showToast(err.message);
    } finally {
        closeDelayReasonModal();
    }
}

async function unmarkStageComplete(stageIndex) {
    console.log('[APP] unmarkStageComplete: Unmarking stage', stageIndex, 'for project', selectedProjectId);
    try {
        await api.unmarkStage(selectedProjectId, stageIndex);
        populateProjectDetails();
        
        // Fetch project to get phase_type-aware stage name for toast
        try {
            const project = await api.getProject(selectedProjectId);
            const stageLabel = getPhaseDisplayName(project);
            showToast(`"${stageLabel}" unmarked from complete.`);
        } catch (err) {
            showToast(`Stage ${stageIndex + 1} unmarked from complete.`);
        }
    } catch (err) {
        console.error('[APP] unmarkStageComplete: Failed to unmark stage:', err.message);
        showToast(err.message);
    }
}

// ============================================
// DESIGNERS
// ============================================
function toggleAddDesignerForm() {
    const formSection = document.getElementById('addDesignerFormSection');
    if (!formSection) return;
    formSection.classList.toggle('hidden');
    if (!formSection.classList.contains('hidden')) {
        const nameInput = document.getElementById('newDesignerName');
        if (nameInput) nameInput.focus();
    }
}

async function populateDesignersPage() {
    try {
        DESIGNERS = await api.getDesigners();
        const container = document.getElementById('designersGrid');
        let html = '';
        DESIGNERS.forEach(d => {
            html += `
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div class="w-12 h-12 rounded-full ${d.color} flex items-center justify-center text-white font-bold text-lg flex-shrink-0">${d.initials}</div>
                    <div class="flex-1 min-w-0">
                        <p class="font-semibold text-gray-900">${d.name}</p>
                        <p class="text-xs text-gray-500">${d.specialty}</p>
                    </div>
                    <button onclick="removeDesigner(${d.id})" class="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0" title="Remove designer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;

        // Load pending approvals for admins
        if (USER_ROLE === 'ADMIN') {
            try {
                const pendingUsers = await api.getPendingUsers();
                const pendingSection = document.getElementById('pendingApprovalsSection');
                const pendingList = document.getElementById('pendingApprovalsList');
                const pendingBadge = document.getElementById('pendingBadge');
                if (pendingUsers && pendingUsers.length > 0) {
                    pendingSection.classList.remove('hidden');
                    pendingBadge.textContent = pendingUsers.length;
                    pendingBadge.classList.remove('hidden');
                    let pendingHtml = '';
                    pendingUsers.forEach(u => {
                        pendingHtml += `
                            <div class="flex items-center justify-between p-4 bg-amber-50 rounded-lg border border-amber-200">
                                <div>
                                    <p class="font-semibold text-gray-900">${u.name}</p>
                                    <p class="text-xs text-gray-500">${u.email}</p>
                                    <p class="text-xs text-gray-400 mt-1">Requested: ${u.requested_role || 'Designer'}</p>
                                </div>
                                <div class="flex gap-2">
                                    <button onclick="approveUser(${u.id}, 'DESIGNER')" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600 transition-colors">
                                        Approve as Designer
                                    </button>
                                    <button onclick="approveUser(${u.id}, 'MANAGER')" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600 transition-colors">
                                        Approve as Manager
                                    </button>
                                    <button onclick="rejectUser(${u.id})" class="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-medium border border-gray-300 hover:bg-gray-100 transition-colors">
                                        Deny
                                    </button>
                                </div>
                            </div>
                        `;
                    });
                    pendingList.innerHTML = pendingHtml;
                } else {
                    pendingSection.classList.add('hidden');
                }
            } catch (pendingErr) {
                console.error('[APP] Failed to load pending approvals:', pendingErr.message);
            }
        }
    } catch (err) {
        showToast('Failed to load designers: ' + err.message);
    }
}

async function removeDesigner(designerId) {
    if (!confirm('Remove this designer?')) return;
    try {
        await api.deleteDesigner(designerId);
        populateDesignersPage();
        populateCreateDesignerSelect();
        showToast('Designer removed.');
    } catch (err) {
        showToast(err.message);
    }
}

async function handleAddDesigner(event) {
    event.preventDefault();
    const nameInput = document.getElementById('newDesignerName');
    const specialtyInput = document.getElementById('newDesignerSpecialty');
    const name = nameInput.value.trim();
    const specialty = specialtyInput.value.trim() || 'Designer';
    if (!name) {
        showToast('Please enter a designer name');
        return;
    }
    try {
        await api.createDesigner({
            name, email: name.toLowerCase().replace(/\s/g, '.') + '@smartivity.com',
            password: 'designer123', specialty
        });
        nameInput.value = '';
        specialtyInput.value = '';
        populateDesignersPage();
        populateCreateDesignerSelect();
        showToast(`Designer "${name}" added successfully!`);
    } catch (err) {
        showToast(err.message);
    }
}

// ============================================
// CREATE PROJECT FORM
// ============================================
function onPhaseTypeChange() {
    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    const ideationCard = document.getElementById('ideationCard');
    const productionCard = document.getElementById('productionCard');
    
    if (ideationRadio && ideationRadio.checked) {
        ideationCard.className = 'phase-type-card border-2 border-brand-500 bg-brand-50 rounded-xl p-4 text-center transition-all';
        ideationCard.querySelector('div.w-10').className = 'w-10 h-10 rounded-lg bg-brand-500 text-white flex items-center justify-center mx-auto mb-2';
        ideationCard.querySelector('p.text-sm').className = 'text-sm font-semibold text-brand-700';
        
        productionCard.className = 'phase-type-card border-2 border-gray-200 bg-white rounded-xl p-4 text-center transition-all hover:border-gray-300';
        productionCard.querySelector('div.w-10').className = 'w-10 h-10 rounded-lg bg-gray-500 text-white flex items-center justify-center mx-auto mb-2';
        productionCard.querySelector('p.text-sm').className = 'text-sm font-semibold text-gray-700';
    } else {
        productionCard.className = 'phase-type-card border-2 border-brand-500 bg-brand-50 rounded-xl p-4 text-center transition-all';
        productionCard.querySelector('div.w-10').className = 'w-10 h-10 rounded-lg bg-brand-500 text-white flex items-center justify-center mx-auto mb-2';
        productionCard.querySelector('p.text-sm').className = 'text-sm font-semibold text-brand-700';
        
        ideationCard.className = 'phase-type-card border-2 border-gray-200 bg-white rounded-xl p-4 text-center transition-all hover:border-gray-300';
        ideationCard.querySelector('div.w-10').className = 'w-10 h-10 rounded-lg bg-gray-500 text-white flex items-center justify-center mx-auto mb-2';
        ideationCard.querySelector('p.text-sm').className = 'text-sm font-semibold text-gray-700';
    }
    
    renderPhaseDeadlines();
}

function renderPhaseDeadlines() {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const startDateInput = document.querySelector('#page-create-project form input[type="date"]');
    const completionInput = document.querySelectorAll('#page-create-project form input[type="date"]')[1];
    const completionDate = completionInput ? completionInput.value : '';
    const phaseContainer = document.getElementById('phaseDeadlinesContainer');
    const existingInputs = phaseContainer ? phaseContainer.querySelectorAll('.phase-deadline-input') : [];
    const existingValues = {};
    existingInputs.forEach(input => {
        existingValues[input.dataset.phaseIndex] = input.value;
    });
    const existingNames = {};
    const existingNameInputs = phaseContainer ? phaseContainer.querySelectorAll('.phase-name-input') : [];
    existingNameInputs.forEach(input => {
        existingNames[input.dataset.phaseIndex] = input.value;
    });
    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    const phaseType = ideationRadio && ideationRadio.checked ? 'IDEATION' : 'PRODUCTION';
    const stages = getStagesForPhaseType(phaseType);
    let html = '';
    stages.forEach((stage, index) => {
        let minDate = '';
        if (index === 0) {
            minDate = startDateInput ? `min="${startDateInput.value}"` : '';
        } else {
            const prevPhaseIndex = index - 1;
            const prevPhaseInput = phaseContainer ? phaseContainer.querySelector(`.phase-deadline-input[data-phase-index="${prevPhaseIndex}"]`) : null;
            const prevValue = prevPhaseInput ? prevPhaseInput.value : '';
            const effectivePrevDate = prevValue || completionDate;
            if (effectivePrevDate) {
                minDate = `min="${effectivePrevDate}"`;
            }
        }
        const existingValue = existingValues[index] || '';
        const existingName = existingNames[index] || stage;
        const isRequired = index === 0;
        html += `
            <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 phase-row" data-phase-index="${index}">
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" onclick="movePhaseUp(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors ${index === 0 ? 'opacity-0 pointer-events-none' : ''}" title="Move phase up">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
                    </button>
                    <button type="button" onclick="movePhaseDown(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors ${index === stages.length - 1 ? 'opacity-0 pointer-events-none' : ''}" title="Move phase down">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <span class="w-6 h-6 rounded-full ${index === 0 ? 'bg-brand-500' : 'bg-gray-400'} text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${index + 1}</span>
                </div>
                <div class="flex-1">
                    <input type="text"
                        class="phase-name-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors"
                        data-phase-index="${index}"
                        value="${existingName}"
                        placeholder="Phase name"
                    />
                </div>
                <div class="flex-1">
                    <input type="date"
                        class="phase-deadline-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors ${index === 0 ? 'border-gray-400' : 'border-gray-200'}"
                        data-phase-index="${index}"
                        ${minDate}
                        ${isRequired ? 'required' : ''}
                        value="${existingValue}"
                    />
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onclick="insertPhaseBelow(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Insert phase below">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    </button>
                    <button type="button" onclick="removePhase(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors ${stages.length <= 1 ? 'opacity-0 pointer-events-none' : ''}" title="Remove phase">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
            </div>
        `;
    });
    html += `
        <button type="button" onclick="addPhase()" class="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:text-brand-600 hover:border-brand-400 transition-colors flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add Phase
        </button>
    `;
    container.innerHTML = html;
    _reindexPhases();
}

function addPhase() {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    const phaseType = ideationRadio && ideationRadio.checked ? 'IDEATION' : 'PRODUCTION';
    const defaultStages = getStagesForPhaseType(phaseType);
    const existingInputs = container.querySelectorAll('.phase-deadline-input');
    const existingNameInputs = container.querySelectorAll('.phase-name-input');
    const count = existingInputs.length;
    
    const startDateInput = document.querySelector('#page-create-project form input[type="date"]');
    const completionInput = document.querySelectorAll('#page-create-project form input[type="date"]')[1];
    const completionDate = completionInput ? completionInput.value : '';
    
    let minDate = '';
    if (count > 0) {
        const prevPhaseInput = container.querySelector(`.phase-deadline-input[data-phase-index="${count - 1}"]`);
        const prevValue = prevPhaseInput ? prevPhaseInput.value : '';
        if (prevValue) {
            minDate = `min="${prevValue}"`;
        }
    } else {
        minDate = startDateInput ? `min="${startDateInput.value}"` : '';
    }
    
    const insertBefore = container.querySelector('button[onclick="addPhase()"]');
    const div = document.createElement('div');
    div.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 phase-row';
    div.setAttribute('data-phase-index', count);
    div.setAttribute('data-phase-id', '');
    div.innerHTML = `
        <div class="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" onclick="movePhaseUp(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors pointer-events-none opacity-0" title="Move phase up">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button type="button" onclick="movePhaseDown(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Move phase down">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span class="w-6 h-6 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${count + 1}</span>
        </div>
        <div class="flex-1">
            <input type="text" class="phase-name-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" value="" placeholder="Phase name" />
        </div>
        <div class="flex-1">
            <input type="date" class="phase-deadline-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" ${minDate} value="" />
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" onclick="insertPhaseBelow(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Insert phase below">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>
            <button type="button" onclick="removePhase(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove phase">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
    `;
    container.insertBefore(div, insertBefore);
    _reindexPhases();
}

function removePhase(index) {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const phaseDiv = container.querySelector(`[data-phase-index="${index}"]`);
    if (phaseDiv) {
        phaseDiv.remove();
        _reindexPhases();
    }
}

function movePhaseUp(index) {
    if (index === 0) return;
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const current = phaseDivs[index];
    const prev = phaseDivs[index - 1];
    if (current && prev) {
        container.insertBefore(current, prev);
        _reindexPhases();
    }
}

function movePhaseDown(index) {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const current = phaseDivs[index];
    const next = phaseDivs[index + 1];
    if (current && next) {
        container.insertBefore(next, current);
        _reindexPhases();
    }
}

function insertPhaseBelow(index) {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const row = phaseDivs[index];
    if (!row) return;

    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    const phaseType = ideationRadio && ideationRadio.checked ? 'IDEATION' : 'PRODUCTION';
    const defaultStages = getStagesForPhaseType(phaseType);
    const existingInputs = container.querySelectorAll('.phase-deadline-input');
    const count = existingInputs.length;

    const prevPhaseInput = container.querySelector(`.phase-deadline-input[data-phase-index="${index}"]`);
    const prevValue = prevPhaseInput ? prevPhaseInput.value : '';

    let minDate = '';
    if (prevValue) {
        minDate = `min="${prevValue}"`;
    }

    const addBtn = container.querySelector('button[onclick="addPhase()"]');
    const div = document.createElement('div');
    div.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 phase-row';
    div.setAttribute('data-phase-index', count);
    div.setAttribute('data-phase-id', '');
    div.innerHTML = `
        <div class="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" onclick="movePhaseUp(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Move phase up">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button type="button" onclick="movePhaseDown(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors ${count === defaultStages.length - 1 ? 'opacity-0 pointer-events-none' : ''}" title="Move phase down">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span class="w-6 h-6 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${count + 1}</span>
        </div>
        <div class="flex-1">
            <input type="text" class="phase-name-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" value="" placeholder="Phase name" />
        </div>
        <div class="flex-1">
            <input type="date" class="phase-deadline-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" ${minDate} value="" />
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" onclick="insertPhaseBelow(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Insert phase below">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>
            <button type="button" onclick="removePhase(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove phase">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
    `;
    container.insertBefore(div, row.nextSibling);
    _reindexPhases();
}

function _reindexPhases() {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const totalPhases = phaseDivs.length;
    phaseDivs.forEach((div, newIndex) => {
        div.setAttribute('data-phase-index', newIndex);
        const numSpan = div.querySelector('span.w-6.h-6.rounded-full');
        if (numSpan) numSpan.textContent = newIndex + 1;
        const nameInput = div.querySelector('.phase-name-input');
        if (nameInput) nameInput.setAttribute('data-phase-index', newIndex);
        const deadlineInput = div.querySelector('.phase-deadline-input');
        if (deadlineInput) {
            deadlineInput.setAttribute('data-phase-index', newIndex);
            if (newIndex === 0) {
                const startDateInput = document.querySelector('#page-create-project form input[type="date"]');
                deadlineInput.min = startDateInput ? startDateInput.value : '';
                deadlineInput.required = true;
            } else {
                const prevInput = container.querySelector(`.phase-deadline-input[data-phase-index="${newIndex - 1}"]`);
                deadlineInput.min = prevInput ? prevInput.value : '';
                deadlineInput.required = false;
            }
        }
        const removeBtn = div.querySelector('button[onclick^="removePhase"]');
        if (removeBtn) {
            removeBtn.setAttribute('onclick', `removePhase(${newIndex})`);
        }
        const upBtn = div.querySelector('button[onclick^="movePhaseUp"]');
        if (upBtn) {
            upBtn.setAttribute('onclick', `movePhaseUp(${newIndex})`);
            upBtn.classList.toggle('opacity-0', newIndex === 0);
            upBtn.classList.toggle('pointer-events-none', newIndex === 0);
        }
        const downBtn = div.querySelector('button[onclick^="movePhaseDown"]');
        if (downBtn) {
            downBtn.setAttribute('onclick', `movePhaseDown(${newIndex})`);
            downBtn.classList.toggle('opacity-0', newIndex === totalPhases - 1);
            downBtn.classList.toggle('pointer-events-none', newIndex === totalPhases - 1);
        }
        const insertBtn = div.querySelector('button[onclick^="insertPhaseBelow"]');
        if (insertBtn) {
            insertBtn.setAttribute('onclick', `insertPhaseBelow(${newIndex})`);
        }
    });
    _checkPhaseDeadlineConflicts(container);
}

function _checkPhaseDeadlineConflicts(container) {
    const deadlineInputs = container.querySelectorAll('.phase-deadline-input');
    deadlineInputs.forEach(input => {
        const row = input.closest('.phase-row');
        if (!row) return;
        const existingWarning = row.querySelector('.deadline-conflict-warning');
        if (existingWarning) existingWarning.remove();
        
        const min = input.getAttribute('min');
        if (!min || input.value === '') return;
        
        if (new Date(input.value) < new Date(min)) {
            const warning = document.createElement('div');
            warning.className = 'deadline-conflict-warning mt-1 px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-700';
            warning.textContent = 'This date is now before the previous phase — please update it';
            row.appendChild(warning);
            input.classList.add('border-red-400');
        } else {
            input.classList.remove('border-red-400');
        }
    });
}

// ============================================
// EDIT PROJECT PHASE MANAGEMENT
// ============================================
function addEditPhase() {
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container) return;
    const phaseType = _editProjectPhaseType || 'PRODUCTION';
    const defaultStages = getStagesForPhaseType(phaseType);
    const existingInputs = document.querySelectorAll('#editPhaseDeadlinesContainer .phase-deadline-input');
    const count = existingInputs.length;
    
    const prevPhaseInput = document.querySelector(`#editPhaseDeadlinesContainer .phase-deadline-input[data-phase-index="${count - 1}"]`);
    const prevValue = prevPhaseInput ? prevPhaseInput.value : '';
    
    let minDate = '';
    if (count > 0 && prevValue) {
        minDate = `min="${prevValue}"`;
    }
    
    const addBtn = container.querySelector('button[onclick="addEditPhase()"]');
    const div = document.createElement('div');
    div.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 phase-row';
    div.setAttribute('data-phase-index', count);
    div.setAttribute('data-phase-id', '');
    div.innerHTML = `
        <div class="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" onclick="moveEditPhaseUp(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors pointer-events-none opacity-0" title="Move phase up">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button type="button" onclick="moveEditPhaseDown(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Move phase down">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span class="w-6 h-6 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${count + 1}</span>
        </div>
        <div class="flex-1">
            <input type="text" class="phase-name-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" value="" placeholder="Phase name" />
        </div>
        <div class="flex-1">
            <input type="date" class="phase-deadline-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" ${minDate} value="" />
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" onclick="insertEditPhaseBelow(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Insert phase below">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>
            <button type="button" onclick="removeEditPhase(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove phase">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
    `;
    container.insertBefore(div, addBtn);
    _reindexEditPhases();
}

function removeEditPhase(index) {
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container) return;
    const phaseDiv = container.querySelector(`[data-phase-index="${index}"]`);
    if (phaseDiv) {
        phaseDiv.remove();
        _reindexEditPhases();
    }
}

function moveEditPhaseUp(index) {
    if (index === 0) return;
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const current = phaseDivs[index];
    const prev = phaseDivs[index - 1];
    if (current && prev) {
        container.insertBefore(current, prev);
        _reindexEditPhases();
    }
}

function moveEditPhaseDown(index) {
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const current = phaseDivs[index];
    const next = phaseDivs[index + 1];
    if (current && next) {
        container.insertBefore(next, current);
        _reindexEditPhases();
    }
}

function insertEditPhaseBelow(index) {
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const row = phaseDivs[index];
    if (!row) return;

    const phaseType = _editProjectPhaseType || 'PRODUCTION';
    const defaultStages = getStagesForPhaseType(phaseType);
    const count = container.querySelectorAll('.phase-deadline-input').length;

    const prevPhaseInput = container.querySelector(`.phase-deadline-input[data-phase-index="${index}"]`);
    const prevValue = prevPhaseInput ? prevPhaseInput.value : '';

    let minDate = '';
    if (prevValue) {
        minDate = `min="${prevValue}"`;
    }

    const addBtn = container.querySelector('button[onclick="addEditPhase()"]');
    const div = document.createElement('div');
    div.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 phase-row';
    div.setAttribute('data-phase-index', count);
    div.setAttribute('data-phase-id', '');
    div.innerHTML = `
        <div class="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" onclick="moveEditPhaseUp(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Move phase up">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button type="button" onclick="moveEditPhaseDown(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Move phase down">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <span class="w-6 h-6 rounded-full bg-gray-400 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${count + 1}</span>
        </div>
        <div class="flex-1">
            <input type="text" class="phase-name-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" value="" placeholder="Phase name" />
        </div>
        <div class="flex-1">
            <input type="date" class="phase-deadline-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors" data-phase-index="${count}" ${minDate} value="" />
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" onclick="insertEditPhaseBelow(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Insert phase below">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>
            <button type="button" onclick="removeEditPhase(${count})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove phase">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
    `;
    container.insertBefore(div, row.nextSibling);
    _reindexEditPhases();
}

function _reindexEditPhases() {
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container) return;
    const phaseDivs = container.querySelectorAll('.phase-row');
    const totalPhases = phaseDivs.length;
    phaseDivs.forEach((div, newIndex) => {
        div.setAttribute('data-phase-index', newIndex);
        const phaseId = div.getAttribute('data-phase-id');
        if (phaseId !== null) {
            div.setAttribute('data-phase-id', phaseId);
        }
        const numSpan = div.querySelector('span.w-6.h-6.rounded-full');
        if (numSpan) numSpan.textContent = newIndex + 1;
        const nameInput = div.querySelector('.phase-name-input');
        if (nameInput) nameInput.setAttribute('data-phase-index', newIndex);
        const deadlineInput = div.querySelector('.phase-deadline-input');
        if (deadlineInput) {
            deadlineInput.setAttribute('data-phase-index', newIndex);
            if (newIndex === 0) {
                deadlineInput.min = '';
            } else {
                const prevInput = container.querySelector(`.phase-deadline-input[data-phase-index="${newIndex - 1}"]`);
                deadlineInput.min = prevInput ? prevInput.value : '';
            }
        }
        const removeBtn = div.querySelector('button[onclick^="removeEditPhase"]');
        if (removeBtn) {
            removeBtn.setAttribute('onclick', `removeEditPhase(${newIndex})`);
        }
        const upBtn = div.querySelector('button[onclick^="moveEditPhaseUp"]');
        if (upBtn) {
            upBtn.setAttribute('onclick', `moveEditPhaseUp(${newIndex})`);
            upBtn.classList.toggle('opacity-0', newIndex === 0);
            upBtn.classList.toggle('pointer-events-none', newIndex === 0);
        }
        const downBtn = div.querySelector('button[onclick^="moveEditPhaseDown"]');
        if (downBtn) {
            downBtn.setAttribute('onclick', `moveEditPhaseDown(${newIndex})`);
            downBtn.classList.toggle('opacity-0', newIndex === totalPhases - 1);
            downBtn.classList.toggle('pointer-events-none', newIndex === totalPhases - 1);
        }
        const insertBtn = div.querySelector('button[onclick^="insertEditPhaseBelow"]');
        if (insertBtn) {
            insertBtn.setAttribute('onclick', `insertEditPhaseBelow(${newIndex})`);
        }
    });
    _checkPhaseDeadlineConflicts(container);
}

async function handleCreateProject(event) {
    event.preventDefault();
    const form = event.target;
    const designerId = parseInt(document.getElementById('createDesignerSelect').value);
    if (!designerId) {
        showToast('Please select a designer');
        return;
    }

    const startDate = form.querySelectorAll('input[type="date"]')[0].value;
    const deadline = form.querySelectorAll('input[type="date"]')[1].value;

    if (!startDate) {
        showToast('Please fill in all required fields');
        return;
    }

    if (deadline && new Date(deadline) < new Date(startDate)) {
        showToast('Expected Completion date cannot be before Start Date');
        return;
    }

    const phaseContainer = document.getElementById('phaseDeadlinesContainer');
    const phaseDeadlineInputs = phaseContainer ? phaseContainer.querySelectorAll('.phase-deadline-input') : [];
    const phaseNameInputs = phaseContainer ? phaseContainer.querySelectorAll('.phase-name-input') : [];
    const phaseDeadlines = [];
    const phaseNames = [];
    phaseDeadlineInputs.forEach(input => {
        phaseDeadlines.push(input.value);
    });
    phaseNameInputs.forEach(input => {
        phaseNames.push(input.value);
    });

    // Evenly space blank phase deadlines between start_date and deadline
    if (phaseDeadlines.length > 0 && startDate && deadline) {
        const startDt = new Date(startDate);
        const endDt = new Date(deadline);
        const totalMs = endDt.getTime() - startDt.getTime();
        const spacing = totalMs / (phaseDeadlines.length + 1);
        for (let i = 0; i < phaseDeadlines.length; i++) {
            if (!phaseDeadlines[i]) {
                const spaced = new Date(startDt.getTime() + spacing * (i + 1));
                phaseDeadlines[i] = spaced.toISOString().split('T')[0];
            }
        }
    }

    for (let i = 0; i < phaseDeadlines.length; i++) {
        if (i === 0 && new Date(phaseDeadlines[i]) < new Date(startDate)) {
            showToast(`Phase 1 deadline cannot be before the Start Date (${formatDateDisplay(startDate)})`);
            return;
        }
        if (i > 0 && new Date(phaseDeadlines[i]) < new Date(phaseDeadlines[i - 1])) {
            showToast(`Phase ${i + 1} deadline (${formatDateDisplay(phaseDeadlines[i])}) cannot be before Phase ${i} deadline (${formatDateDisplay(phaseDeadlines[i - 1])})`);
            return;
        }
    }

    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    const phaseType = ideationRadio && ideationRadio.checked ? 'IDEATION' : 'PRODUCTION';

    const phases = phaseDeadlines.map((phaseDeadline, index) => ({
        stage_index: index,
        deadline: phaseDeadline,
        stage_name: phaseNames[index] || null
    }));

    try {
        const project = await api.createProject({
            name: form.querySelector('input[type="text"]').value,
            description: form.querySelectorAll('textarea')[0].value,
            assigned_designer_id: designerId,
            start_date: startDate,
            deadline: deadline,
            manager_notes: '',
            phases: phases,
            manager_ids: tempManagerSelections,
            phase_type: phaseType,
            stage_names: phaseNames
        });
        const successMsg = document.getElementById('createSuccessMessage');
        form.classList.add('hidden');
        successMsg.classList.remove('hidden');
        showToast('Project created successfully!');
    } catch (err) {
        showToast(err.message);
    }
}

function resetCreateProjectForm() {
    const form = document.getElementById('createProjectForm');
    const successMsg = document.getElementById('createSuccessMessage');
    if (form) form.classList.remove('hidden');
    if (successMsg) successMsg.classList.add('hidden');
    if (form) form.reset();
    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    if (ideationRadio) ideationRadio.checked = true;
    updateCreateProjectDescription();
    tempManagerSelections = [];
    populateCreateDesignerSelect();
    populateCreateManagerSelect();
    renderPhaseDeadlines();
}

function updateCreateProjectDescription() {
    const ideationRadio = document.querySelector('input[name="phaseType"][value="IDEATION"]');
    const descEl = document.getElementById('createProjectDescription');
    if (descEl) {
        if (ideationRadio && ideationRadio.checked) {
            descEl.textContent = 'Fill in the details below. You can customize the workflow phases.';
        } else {
            descEl.textContent = 'Fill in the details below. You can customize the workflow phases.';
        }
    }
}

async function populateCreateDesignerSelect() {
    try {
        DESIGNERS = await api.getDesigners();
        MANAGERS = await api.getManagers();
        const select = document.getElementById('createDesignerSelect');
        if (!select) return;
        let html = '<option value="">Select a designer</option>';
        DESIGNERS.forEach(d => {
            html += `<option value="${d.id}">${d.name}</option>`;
        });
        select.innerHTML = html;
    } catch (err) {
        showToast('Failed to load designers: ' + err.message);
    }
}

async function populateCreateManagerSelect() {
    try {
        MANAGERS = await api.getManagers();
        const container = document.getElementById('managerSelectContainer');
        if (!container) return;
        let html = '';
        MANAGERS.forEach(m => {
            const checked = m.id === CURRENT_USER?.id ? 'checked' : '';
            html += `
                <label class="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                    <input type="checkbox" value="${m.id}" ${checked ? 'checked' : ''} onchange="toggleManagerSelection(${m.id}, this.checked)" class="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-400">
                    <div class="w-7 h-7 rounded-full ${m.color} flex items-center justify-center text-white font-bold text-xs flex-shrink-0">${m.initials}</div>
                    <span class="text-sm font-medium text-gray-700">${m.name}</span>
                    <span class="text-xs text-gray-400 ml-auto">${m.role}</span>
                </label>
            `;
        });
        html += `
            <div class="flex gap-2 mt-2 pt-2 border-t border-gray-100">
                <button onclick="selectAllManagers()" class="text-xs text-brand-600 hover:text-brand-700 font-medium">Select All</button>
                <button onclick="deselectAllManagers()" class="text-xs text-gray-500 hover:text-gray-700 font-medium">Deselect All</button>
            </div>
        `;
        container.innerHTML = html;
        if (!tempManagerSelections.includes(CURRENT_USER?.id)) {
            tempManagerSelections = [CURRENT_USER?.id];
        }
    } catch (err) {
        showToast('Failed to load managers: ' + err.message);
    }
}

function toggleManagerSelection(managerId, isChecked) {
    if (isChecked) {
        if (!tempManagerSelections.includes(managerId)) tempManagerSelections.push(managerId);
    } else {
        tempManagerSelections = tempManagerSelections.filter(id => id !== managerId);
    }
}

function selectAllManagers() {
    tempManagerSelections = MANAGERS.map(m => m.id);
    document.querySelectorAll('#managerSelectContainer input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function deselectAllManagers() {
    tempManagerSelections = [CURRENT_USER?.id];
    document.querySelectorAll('#managerSelectContainer input[type="checkbox"]').forEach(cb => {
        cb.checked = cb.value == CURRENT_USER?.id;
    });
}

// ============================================
// EDIT PROJECT FORM HELPERS
// ============================================
function renderEditPhaseDeadlines(project) {
    const container = document.getElementById('editPhaseDeadlinesContainer');
    if (!container || !project) return;
    
    const deadline = project.deadline || '';
    const existingInputs = document.querySelectorAll('#editPhaseDeadlinesContainer .phase-deadline-input');
    const existingValues = {};
    existingInputs.forEach(input => {
        existingValues[input.dataset.phaseIndex] = input.value;
    });
    const existingNames = {};
    const existingNameInputs = document.querySelectorAll('#editPhaseDeadlinesContainer .phase-name-input');
    existingNameInputs.forEach(input => {
        existingNames[input.dataset.phaseIndex] = input.value;
    });
    
    const phaseType = project.phase_type || 'PRODUCTION';
    const stages = getStagesForPhaseType(phaseType);
    const phases = project.phases || [];
    
    let html = '';
    stages.forEach((stage, index) => {
        const phaseData = phases.find(p => p.stage_index === index);
        const minDate = index === 0 ? '' : (index > 0 ? `min="${phases[index - 1]?.deadline || ''}"` : '');
        const existingValue = existingValues[index] || (phaseData ? phaseData.deadline : deadline);
        const existingName = existingNames[index] || (phaseData && phaseData.stage_name) || (project.stage_names && project.stage_names[index]) || stage;
        const phaseId = phaseData ? phaseData.id : '';
        
        html += `
            <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 phase-row" data-phase-index="${index}" data-phase-id="${phaseId}">
                <div class="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" onclick="moveEditPhaseUp(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors ${index === 0 ? 'opacity-0 pointer-events-none' : ''}" title="Move phase up">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
                    </button>
                    <button type="button" onclick="moveEditPhaseDown(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors ${index === stages.length - 1 ? 'opacity-0 pointer-events-none' : ''}" title="Move phase down">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <span class="w-6 h-6 rounded-full ${index === 0 ? 'bg-brand-500' : 'bg-gray-400'} text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${index + 1}</span>
                </div>
                <div class="flex-1">
                    <input type="text"
                        class="phase-name-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors"
                        data-phase-index="${index}"
                        value="${existingName}"
                        placeholder="Phase name"
                    />
                </div>
                <div class="flex-1">
                    <input type="date"
                        class="phase-deadline-input w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none transition-colors"
                        data-phase-index="${index}"
                        ${minDate}
                        value="${existingValue}"
                    />
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onclick="insertEditPhaseBelow(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Insert phase below">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    </button>
                    <button type="button" onclick="removeEditPhase(${index})" class="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:text-red-600 hover:bg-red-50 hover:bg-red-50 transition-colors flex-shrink-0 ${stages.length <= 1 ? 'opacity-0 pointer-events-none' : ''}" title="Remove phase">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
            </div>
        `;
    });
    html += `
        <button type="button" onclick="addEditPhase()" class="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:text-brand-600 hover:border-brand-400 transition-colors flex items-center justify-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add Phase
        </button>
    `;
    container.innerHTML = html;
    _reindexEditPhases();
}

function populateEditManagerSelect(selectedIds) {
    const container = document.getElementById('editManagerSelectContainer');
    if (!container) return;
    let html = '';
    MANAGERS.forEach(m => {
        const checked = selectedIds.includes(m.id) ? 'checked' : '';
        html += `
            <label class="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <input type="checkbox" value="${m.id}" ${checked ? 'checked' : ''} onchange="toggleEditManagerSelection(${m.id}, this.checked)" class="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-400">
                <div class="w-7 h-7 rounded-full ${m.color} flex items-center justify-center text-white font-bold text-xs flex-shrink-0">${m.initials}</div>
                <span class="text-sm font-medium text-gray-700">${m.name}</span>
                <span class="text-xs text-gray-400 ml-auto">${m.role}</span>
            </label>
        `;
    });
    html += `
        <div class="flex gap-2 mt-2 pt-2 border-t border-gray-100">
            <button onclick="selectAllEditManagers()" class="text-xs text-brand-600 hover:text-brand-700 font-medium">Select All</button>
            <button onclick="deselectAllEditManagers()" class="text-xs text-gray-500 hover:text-gray-700 font-medium">Deselect All</button>
        </div>
    `;
    container.innerHTML = html;
    if (!tempEditManagerSelections || tempEditManagerSelections.length === 0) {
        tempEditManagerSelections = selectedIds.length ? [...selectedIds] : [CURRENT_USER?.id];
    }
}

function toggleEditManagerSelection(managerId, isChecked) {
    if (isChecked) {
        if (!tempEditManagerSelections.includes(managerId)) tempEditManagerSelections.push(managerId);
    } else {
        tempEditManagerSelections = tempEditManagerSelections.filter(id => id !== managerId);
    }
}

function selectAllEditManagers() {
    tempEditManagerSelections = MANAGERS.map(m => m.id);
    document.querySelectorAll('#editManagerSelectContainer input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function deselectAllEditManagers() {
    tempEditManagerSelections = [CURRENT_USER?.id];
    document.querySelectorAll('#editManagerSelectContainer input[type="checkbox"]').forEach(cb => {
        cb.checked = cb.value == CURRENT_USER?.id;
    });
}

function populateEditReadOnlyInfo(project) {
    const designerUpdateEl = document.getElementById('editDesignerUpdate');
    const delayReasonEl = document.getElementById('editDelayReason');
    const completionTimestampEl = document.getElementById('editCompletionTimestamp');
    
    if (designerUpdateEl) {
        const currentPhase = project.phases && project.phases[project.stage_index];
        if (currentPhase && currentPhase.designer_update) {
            designerUpdateEl.textContent = currentPhase.designer_update;
        } else {
            designerUpdateEl.textContent = '—';
        }
    }
    
    if (delayReasonEl) {
        const currentPhase = project.phases && project.phases[project.stage_index];
        if (currentPhase && currentPhase.delay_reason && currentPhase.delay_reason !== 'On time') {
            delayReasonEl.textContent = currentPhase.delay_reason;
        } else {
            delayReasonEl.textContent = 'No delays reported.';
        }
    }
    
    if (completionTimestampEl) {
        const currentPhase = project.phases && project.phases[project.stage_index];
        if (currentPhase && currentPhase.completed_at) {
            completionTimestampEl.textContent = formatDateTime(currentPhase.completed_at);
        } else {
            completionTimestampEl.textContent = '—';
        }
    }
}

// ============================================
// DESIGNER ASSIGNMENT MODAL
// ============================================
async function openDesignerModal(stageIndex) {
    designerModalStageIndex = stageIndex;
    document.getElementById('designerSearchInput').value = '';
    
    try {
        const project = await api.getProject(selectedProjectId);
        const stageLabel = getPhaseDisplayName(project);
        document.getElementById('designerModalStageLabel').textContent = `Stage: ${stageLabel}`;
        
        const currentAssignments = project.phases[stageIndex]?.assigned_designer_ids || [];
        tempDesignerSelections = [...currentAssignments];
    } catch (err) {
        console.error('[APP] openDesignerModal: Failed to load project data:', err.message);
        tempDesignerSelections = [];
    }
    
    renderDesignerChecklist();
    document.getElementById('designerModal').classList.remove('hidden');
}

function closeDesignerModal() {
    document.getElementById('designerModal').classList.add('hidden');
    designerModalStageIndex = null;
    tempDesignerSelections = [];
}

function filterDesigners() {
    renderDesignerChecklist();
}

function renderDesignerChecklist() {
    const searchTerm = document.getElementById('designerSearchInput').value.toLowerCase();
    const container = document.getElementById('designerChecklist');
    let html = '';
    const filtered = DESIGNERS.filter(d => d.name.toLowerCase().includes(searchTerm));
    if (filtered.length === 0) {
        html = '<p class="text-sm text-gray-400 text-center py-4">No designers found.</p>';
    } else {
        filtered.forEach(d => {
            const checked = tempDesignerSelections.includes(d.id);
            html += `
                <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                    <input type="checkbox" value="${d.id}" ${checked ? 'checked' : ''} onchange="toggleDesignerSelection(${d.id}, this.checked)" class="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-400">
                    <div class="w-8 h-8 rounded-full ${d.color} flex items-center justify-center text-white font-bold text-xs flex-shrink-0">${d.initials}</div>
                    <span class="text-sm font-medium text-gray-700">${d.name}</span>
                    <span class="text-xs text-gray-400 ml-auto">${d.specialty}</span>
                </label>
            `;
        });
    }
    container.innerHTML = html;
}

function toggleDesignerSelection(designerId, isChecked) {
    if (isChecked) {
        if (!tempDesignerSelections.includes(designerId)) tempDesignerSelections.push(designerId);
    } else {
        tempDesignerSelections = tempDesignerSelections.filter(id => id !== designerId);
    }
}

async function saveDesignerAssignment() {
    if (designerModalStageIndex === null) return;
    try {
        await api.assignStageDesigners(selectedProjectId, designerModalStageIndex, tempDesignerSelections);
        closeDesignerModal();
        populateProjectDetails();
        const assignedCount = tempDesignerSelections.length;
        
        // Fetch project to get phase_type-aware stage name for toast
        const project = await api.getProject(selectedProjectId);
        const stageLabel = getPhaseDisplayName(project);
        showToast(`${assignedCount} designer${assignedCount !== 1 ? 's' : ''} assigned to "${stageLabel}"`);
    } catch (err) {
        showToast('Failed to assign designers: ' + err.message);
    }
}

// ============================================
// SLACK MESSAGES
// ============================================
async function loadSlackMessages() {
    await populateSlackMessagesProjectSelect();
    if (!selectedSlackProjectId) {
        const projects = await api.getProjects();
        if (projects.length > 0) {
            selectedSlackProjectId = projects[0].id;
            const select = document.getElementById('slackMessagesProjectSelect');
            if (select) select.value = selectedSlackProjectId;
        } else {
            return;
        }
    }
    if (slackMessagesPollInterval) clearInterval(slackMessagesPollInterval);
    const feed = document.getElementById('slackMessagesFeed');
    if (feed) feed.innerHTML = '<p class="text-sm text-gray-400 text-center py-8">Loading messages...</p>';
    await fetchSlackMessages();
    slackMessagesPollInterval = setInterval(fetchSlackMessages, 30000);
}

async function populateSlackMessagesProjectSelect() {
    try {
        const projects = await api.getProjects();
        const select = document.getElementById('slackMessagesProjectSelect');
        if (!select) return;
        let html = '<option value="">Select a project</option>';
        projects.forEach(p => {
            html += `<option value="${p.id}" ${p.id === selectedSlackProjectId ? 'selected' : ''}>${p.name}</option>`;
        });
        select.innerHTML = html;
    } catch (err) {
        showToast('Failed to load projects: ' + err.message);
    }
}

async function switchSlackMessagesProject() {
    const select = document.getElementById('slackMessagesProjectSelect');
    if (!select) return;
    selectedSlackProjectId = parseInt(select.value);
    await loadSlackMessages();
}

async function fetchSlackMessages() {
    if (!selectedSlackProjectId) return;
    try {
        const data = await api.getSlackChannelHistory(selectedSlackProjectId);
        const feed = document.getElementById('slackMessagesFeed');
        if (!feed) return;
        if (!data.has_channel) {
            feed.innerHTML = '<p class="text-sm text-amber-500 text-center py-8">⚠️ This project is not connected to a Slack channel yet.</p>';
            return;
        }
        if (data.error && (!data.messages || data.messages.length === 0)) {
            feed.innerHTML = `<p class="text-sm text-red-500 text-center py-8">Failed to load Slack messages: ${data.error}</p>`;
            return;
        }
        const existingIds = new Set();
        feed.querySelectorAll('.slack-msg-bubble').forEach(el => {
            existingIds.add(el.dataset.msgId);
        });
        const newMessages = data.messages.filter(m => !existingIds.has(String(m.id)));
        const allMessages = data.messages;
        feed.innerHTML = '';
        allMessages.forEach(msg => {
            const bubble = createSlackMessageBubble(msg);
            bubble.classList.add('slack-msg-bubble');
            bubble.dataset.msgId = msg.id;
            feed.appendChild(bubble);
        });
        feed.scrollTop = feed.scrollHeight;
    } catch (err) {
        // Silently fail for polling
    }
}

function createSlackMessageBubble(msg) {
    const bubble = document.createElement('div');
    bubble.className = 'flex items-start gap-3 mb-3';
    const avatarColor = msg.is_bot ? 'bg-purple-500' : (msg.slack_user_id ? 'bg-blue-500' : 'bg-gray-400');
    const displayName = msg.user_name || 'Slack User';
    const time = msg.ts ? new Date(parseInt(msg.ts) * 1000).toLocaleString() : msg.created_at || '';
    const text = msg.text || '';
    const cleanText = text.replace(/<@[^>]+>/g, (match) => {
        return '@' + match.replace(/[<>@]/g, '');
    });
    bubble.innerHTML = `
        <div class="flex-shrink-0 w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold">
            ${displayName.charAt(0).toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-gray-900">${displayName}</span>
                ${msg.is_bot ? '<span class="text-xs text-purple-500 font-medium">Bot</span>' : ''}
                <span class="text-xs text-gray-400">${time}</span>
            </div>
            <p class="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">${cleanText || ''}</p>
        </div>
    `;
    return bubble;
}

// ============================================
// SLACK SETTINGS
// ============================================
let slackConfigured = false;

async function loadSlackSettings() {
    try {
        const config = await api.getSlackConfig();
        if (config) {
            slackConfigured = true;
            document.getElementById('slackConfigStatus').classList.remove('hidden');
            document.getElementById('slackBotToken').value = config.bot_token.substring(0, 8) + '***';
            document.getElementById('slackSigningSecret').value = config.signing_secret.substring(0, 4) + '***';
            await populateSlackChannels();
        }
    } catch (err) {
        slackConfigured = false;
        document.getElementById('slackConfigStatus').classList.add('hidden');
        document.getElementById('slackBotToken').value = '';
        document.getElementById('slackSigningSecret').value = '';
        await populateSlackChannels();
    }
}

async function saveSlackConfig() {
    const botToken = document.getElementById('slackBotToken').value.trim();
    const signingSecret = document.getElementById('slackSigningSecret').value.trim();
    if (!botToken && !signingSecret) {
        showToast('Please fill in at least Bot Token or Signing Secret');
        return;
    }
    const btn = document.getElementById('saveSlackConfigBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        await api.saveSlackConfig({ bot_token: botToken, signing_secret: signingSecret });
        slackConfigured = true;
        document.getElementById('slackConfigStatus').classList.remove('hidden');
        document.getElementById('slackBotToken').value = botToken.substring(0, 8) + '***';
        document.getElementById('slackSigningSecret').value = signingSecret.substring(0, 4) + '***';
        showToast('Slack configuration saved!');
        await populateSlackChannels();
    } catch (err) {
        showToast('Failed to save: ' + err.message);
    }
    btn.disabled = false;
    btn.textContent = 'Save Configuration';
}

function clearSlackConfig() {
    document.getElementById('slackBotToken').value = '';
    document.getElementById('slackSigningSecret').value = '';
    document.getElementById('slackConfigStatus').classList.add('hidden');
    slackConfigured = false;
    showToast('Configuration cleared');
}

async function populateSlackChannels() {
    const container = document.getElementById('slackChannelsList');
    try {
        const projects = await api.getProjects();
        if (projects.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No projects found. Create a project first to get a Slack channel.</p>';
            return;
        }

        let channelStatuses = [];
        try {
            const statusResult = await api.getSlackChannelStatus(false);
            channelStatuses = (statusResult && statusResult.statuses) ? statusResult.statuses : [];
        } catch (statusErr) {
            console.warn('[SLACK] Failed to fetch channel status:', statusErr.message);
        }

        const statusMap = {};
        channelStatuses.forEach(s => {
            statusMap[s.project_id] = s;
        });

        let html = '';
        projects.forEach(p => {
            const statusInfo = statusMap[p.id];
            const hasChannel = p.slack_channel_id || false;
            
            let statusBadge = '';
            let actionButton = '';

            if (!hasChannel) {
                statusBadge = '<span class="text-gray-400">Not connected</span>';
                actionButton = `<button onclick="createSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600 transition-colors ml-3">
                    Create Channel
                   </button>`;
            } else if (statusInfo && statusInfo.status === 'connected') {
                statusBadge = `<span class="text-green-600">✅ Connected to #${p.slack_channel_name || statusInfo.slack_channel_name || 'channel'}</span>`;
                actionButton = `<button onclick="addBotToChannel(${p.id}, this)" class="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors ml-3 border border-green-200" id="addBotBtn_${p.id}">
                    🤖 Add Bot
                   </button> <button onclick="disconnectSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors ml-3 border border-red-200">
                    Disconnect
                   </button>`;
            } else if (statusInfo && (statusInfo.status === 'not_found' || statusInfo.status === 'archived')) {
                const reason = statusInfo.status === 'archived' ? 'Channel archived in Slack' : 'Channel not found in Slack';
                statusBadge = `<span class="text-amber-600">⚠️ ${reason}</span>`;
                actionButton = `<button onclick="reconnectSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors ml-3">
                    Recreate Channel
                   </button>`;
            } else if (statusInfo && statusInfo.status === 'unknown') {
                statusBadge = `<span class="text-gray-500">⏳ Status unknown (${statusInfo.error || 'Slack unreachable'})</span>`;
                actionButton = `<button onclick="reconnectSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600 transition-colors ml-3">
                    Recreate Channel
                   </button>`;
            } else {
                statusBadge = `<span class="text-green-600">✅ Connected to #${p.slack_channel_name || 'channel'}</span>`;
                actionButton = `<button onclick="addBotToChannel(${p.id}, this)" class="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-xs font-medium hover:bg-green-100 transition-colors ml-3 border border-green-200" id="addBotBtn_${p.id}">
                    🤖 Add Bot
                   </button> <button onclick="disconnectSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors ml-3 border border-red-200">
                    Disconnect
                   </button>`;
            }

            html += `
                <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold text-gray-900">${p.name}</p>
                        <p class="text-xs text-gray-500 mt-0.5">
                            ${statusBadge}
                        </p>
                    </div>
                    ${actionButton}
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<p class="text-sm text-gray-500">Failed to load projects.</p>';
    }
}

async function createSlackChannel(projectId, btn) {
    if (!slackConfigured) {
        showToast('Please configure Slack credentials first');
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Creating...';
    try {
        const result = await api.createSlackChannel(projectId);
        if (result.success) {
            showToast('Slack channel created!');
            await populateSlackChannels();
        } else {
            showToast('Failed: ' + result.message);
        }
    } catch (err) {
        showToast('Failed: ' + err.message);
    }
    btn.disabled = false;
    btn.textContent = 'Create Channel';
}

async function disconnectSlackChannel(projectId, btn) {
    if (!confirm('Disconnect this project from Slack? Notifications will stop.')) return;
    await api.updateProject(projectId, { slack_channel_id: '', slack_channel_name: '' });
    showToast('Disconnected from Slack');
    await populateSlackChannels();
}

async function reconnectSlackChannel(projectId, btn) {
    if (!slackConfigured) {
        showToast('Please configure Slack credentials first');
        return;
    }
    if (!confirm('The Slack channel for this project is missing or archived. Recreate it now?')) return;
    btn.disabled = true;
    btn.textContent = 'Recreating...';
    try {
        const result = await api.createSlackChannel(projectId);
        if (result.success) {
            showToast('Slack channel recreated!');
            await populateSlackChannels();
        } else {
            showToast('Failed: ' + result.message);
        }
    } catch (err) {
        showToast('Failed: ' + err.message);
    }
    btn.disabled = false;
    btn.textContent = 'Recreate Channel';
}

async function addBotToChannel(projectId, btn) {
    if (!slackConfigured) {
        showToast('Please configure Slack credentials first');
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
        const result = await api.addBotToChannel(projectId);
        if (result.success) {
            showToast(result.message || 'Bot added to channel!');
            await populateSlackChannels();
        } else {
            showToast('Failed: ' + result.message);
        }
    } catch (err) {
        showToast('Failed: ' + err.message);
    }
    btn.disabled = false;
    btn.textContent = '🤖 Add Bot';
}

function copyWebhookUrl() {
    const url = document.getElementById('webhookUrlDisplay').textContent;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Webhook URL copied!');
    }).catch(() => {
        showToast('Failed to copy');
    });
}

// ============================================
// DESIGNER LANDING PAGE
// ============================================
const DESIGNER_QUOTES = [
    {
        text: "Every great product starts with a designer who dared to imagine a better world.",
        author: "— Smartivity Team"
    },
    {
        text: "We don't just build products. We build the future our children will inherit.",
        author: "— Smartivity Mission"
    },
    {
        text: "The best way to predict the future is to create it — one design at a time.",
        author: "— Peter Drucker"
    },
    {
        text: "Innovation distinguishes between a leader and a follower. You are the leader.",
        author: "— Steve Jobs"
    },
    {
        text: "Every child deserves a world where creativity and technology work together. That's what we're building.",
        author: "— Smartivity Vision"
    },
    {
        text: "Design is not just what it looks like and feels like. Design is how it works — and how it changes lives.",
        author: "— Steve Jobs"
    },
    {
        text: "The world is waiting for your ideas. Go make it a better place.",
        author: "— Smartivity Team"
    },
    {
        text: "Great design solves problems before they exist. You are solving tomorrow's problems today.",
        author: "— Smartivity Philosophy"
    },
    {
        text: "Build with purpose. Design with heart. The world needs your brilliance.",
        author: "— Smartivity Team"
    },
    {
        text: "We are the generation that will give children a future worth designing for. Let's get to work.",
        author: "— Smartivity Mission"
    }
];

function showDesignerLanding(user) {
    const nameEl = document.getElementById('designerLandingName');
    const quoteTextEl = document.getElementById('designerQuoteText');
    const quoteAuthorEl = document.getElementById('designerQuoteAuthor');
    
    if (nameEl) {
        nameEl.textContent = user.name || 'Designer';
    }
    
    if (quoteTextEl && quoteAuthorEl) {
        const quote = DESIGNER_QUOTES[Math.floor(Math.random() * DESIGNER_QUOTES.length)];
        quoteTextEl.textContent = `"${quote.text}"`;
        quoteAuthorEl.textContent = quote.author;
    }
}

function showDesignerRestricted(user) {
    const nameEl = document.getElementById('restrictedDesignerName');
    if (nameEl) {
        nameEl.textContent = user.name || 'Designer';
    }
}

async function continueWithSlack() {
    const btn = document.getElementById('continueWithSlackBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Connecting to Slack...
    `;
    
    try {
        window.location.href = '/api/auth/slack-auth-url';
    } catch (err) {
        showToast('Failed to connect. Please try again.');
        btn.disabled = false;
        btn.innerHTML = `
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 1 0 0 5.056 2.528 2.528 0 0 0-2.528-2.528zM12.23 5.042a2.528 2.528 0 1 0 0 5.057 2.528 2.528 0 0 0-2.528-2.528zM16.808 10.07a2.528 2.528 0 1 0 0 5.057 2.528 2.528 0 0 0-2.528-2.528zM10.072 16.808a2.528 2.528 0 1 0 0 5.056 2.528 2.528 0 0 0-2.528-2.528z"/>
            </svg>
            Continue with Slack
        `;
    }
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Handle Slack OAuth callback first
    const handled = await handleSlackCallback();
    if (handled) return;

    // Otherwise check auth and load app
    checkAuth();
    handleSlackInstallReturn();

    // Restore sub-page from URL hash on initial load
    const hash = window.location.hash.replace('#', '');
    if (hash && CURRENT_USER && CURRENT_USER.role !== 'PENDING' && CURRENT_USER.role !== 'ADMIN') {
        setTimeout(() => navigateTo(hash), 100);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDesignerModal();
    });
    document.getElementById('designerModal').addEventListener('click', function (e) {
        if (e.target === this) closeDesignerModal();
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeSidebar();
    });
    
    // Hide/show sidebar nav items based on user role
    if (CURRENT_USER) {
        applyRoleBasedNavVisibility();
    }
});

function applyRoleBasedNavVisibility() {
    const role = USER_ROLE;
    if (!role) return;
    
    const navItems = document.querySelectorAll('.nav-item[data-roles]');
    navItems.forEach(item => {
        const allowedRoles = item.getAttribute('data-roles').split(',').map(r => r.trim());
        if (!allowedRoles.includes(role.toUpperCase())) {
            item.classList.add('hidden');
        } else {
            item.classList.remove('hidden');
        }
    });
    
    // Also handle report sub-tab buttons with data-roles
    const reportTabs = document.querySelectorAll('[data-roles]');
    reportTabs.forEach(item => {
        const allowedRoles = item.getAttribute('data-roles').split(',').map(r => r.trim());
        if (!allowedRoles.includes(role.toUpperCase())) {
            item.classList.add('hidden');
        } else {
            item.classList.remove('hidden');
        }
    });
}

function setExportSubTab(tab) {
    const exportSection = document.getElementById('exportDataSection');
    const reportsSection = document.getElementById('stageReportsSection');
    const btnExport = document.getElementById('exportSubTabExport');
    const btnReports = document.getElementById('exportSubTabReports');
    
    if (tab === 'export') {
        exportSection.classList.remove('hidden');
        reportsSection.classList.add('hidden');
        btnExport.classList.add('border-brand-500', 'text-brand-600');
        btnExport.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        btnReports.classList.remove('border-brand-500', 'text-brand-600');
        btnReports.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700');
    } else {
        exportSection.classList.add('hidden');
        reportsSection.classList.remove('hidden');
        btnReports.classList.add('border-brand-500', 'text-brand-600');
        btnReports.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        btnExport.classList.remove('border-brand-500', 'text-brand-600');
        btnExport.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        loadReports();
    }
}

// ============================================
// REPORTS
// ============================================
let reportViewMode = 'table';
let allReports = [];
let allSummaries = [];

async function loadReports() {
    console.log('[APP] loadReports: Loading reports');
    try {
        DESIGNERS = await api.getDesigners();
        const projects = await api.getProjects();
        populateReportFilters(projects, DESIGNERS);
        
        const projectFilter = document.getElementById('reportProjectFilter').value;
        const designerFilter = document.getElementById('reportDesignerFilter').value;
        const stageFilter = document.getElementById('reportStageFilter').value;
        const dateFrom = document.getElementById('reportDateFrom').value;
        const dateTo = document.getElementById('reportDateTo').value;
        
        let reports;
        if (projectFilter && designerFilter) {
            reports = await api.getProjectDesignerReports(parseInt(projectFilter), parseInt(designerFilter));
        } else if (projectFilter) {
            reports = await api.getProjectReports(parseInt(projectFilter));
        } else if (designerFilter) {
            reports = await api.getDesignerReports(parseInt(designerFilter));
        } else {
            const summary = await api.getReportSummary();
            allSummaries = summary;
            if (reportViewMode === 'summary') {
                renderReportSummary();
            }
            reports = [];
            for (const s of summary) {
                const projReports = await api.getProjectReports(s.project_id);
                reports.push(...projReports.filter(r => r.stage_index === s.stage_index));
            }
        }
        
        allReports = reports;
        
        if (dateFrom) {
            reports = reports.filter(r => r.submitted_at && r.submitted_at.split('T')[0] >= dateFrom);
        }
        if (dateTo) {
            reports = reports.filter(r => r.submitted_at && r.submitted_at.split('T')[0] <= dateTo);
        }
        if (stageFilter !== '') {
            reports = reports.filter(r => r.stage_index === parseInt(stageFilter));
        }
        
        document.getElementById('reportCountLabel').textContent = reports.length + ' reports';
        
        if (reportViewMode === 'table') {
            renderReportsTable(reports);
        } else {
            if (allSummaries.length === 0) {
                const summary = await api.getReportSummary();
                allSummaries = summary;
            }
            renderReportSummary(allSummaries);
        }
    } catch (err) {
        console.error('[APP] loadReports: Failed to load reports:', err.message);
        showToast('Failed to load reports: ' + err.message);
    }
}

function populateReportFilters(projects, designers) {
    const projectSelect = document.getElementById('reportProjectFilter');
    const currentProjectVal = projectSelect.value;
    let projectHTML = '<option value="">All Projects</option>';
    projects.forEach(p => {
        projectHTML += `<option value="${p.id}" ${p.id == currentProjectVal ? 'selected' : ''}>${p.name}</option>`;
    });
    projectSelect.innerHTML = projectHTML;
    
    const designerSelect = document.getElementById('reportDesignerFilter');
    const currentDesignerVal = designerSelect.value;
    let designerHTML = '<option value="">All Designers</option>';
    designers.forEach(d => {
        designerHTML += `<option value="${d.id}" ${d.id == currentDesignerVal ? 'selected' : ''}>${d.name}</option>`;
    });
    designerSelect.innerHTML = designerHTML;
}

function renderReportsTable(reports) {
    const tbody = document.getElementById('reportsTableBody');
    if (!reports || reports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13" class="px-4 py-12 text-center text-gray-400">No reports to display. Use filters or submit a new report.</td></tr>';
        return;
    }
    let html = '';
    reports.forEach(r => {
        const ratingCell = (val) => {
            if (val === null || val === undefined) return '<span class="text-gray-300">—</span>';
            const color = val >= 4 ? 'text-green-600' : val >= 3 ? 'text-amber-600' : 'text-red-600';
            return `<span class="font-semibold ${color}">${val}/5</span>`;
        };
        html += `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 text-sm font-medium text-gray-900">${r.project_id || '—'}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${r.stage_name || 'Stage ' + (r.stage_index + 1)}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${r.submitted_by_name || '—'}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${formatDate(r.submitted_at?.split('T')[0] || '')}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.costing)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.willingness_to_buy)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.engagement_life)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.durability)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.age_appropriateness)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.ease_of_use)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.aesthetics)}</td>
                <td class="px-4 py-3 text-center">${ratingCell(r.easy_to_store)}</td>
                <td class="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">${r.notes || '—'}</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function renderReportSummary(summaries) {
    const container = document.getElementById('reportSummaryCards');
    if (!summaries || summaries.length === 0) {
        container.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-400 col-span-full">No summary data available.</div>';
        return;
    }
    let html = '';
    summaries.forEach(s => {
        const avg = (val) => val !== null && val !== undefined ? val : '—';
        html += `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div class="flex items-center justify-between mb-3">
                    <h4 class="font-semibold text-gray-900 text-sm">${s.project_name}</h4>
                    <span class="text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-600">${s.stage_name}</span>
                </div>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <p class="text-xs text-gray-500">Costing</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_costing)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_costing)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_costing)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Willingness</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_willingness_to_buy)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_willingness_to_buy)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_willingness_to_buy)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Engagement</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_engagement_life)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_engagement_life)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_engagement_life)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Durability</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_durability)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_durability)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_durability)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Age Appr.</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_age_appropriateness)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_age_appropriateness)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_age_appropriateness)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Ease</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_ease_of_use)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_ease_of_use)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_ease_of_use)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Aesthetics</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_aesthetics)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_aesthetics)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_aesthetics)}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500">Store</p>
                        <p class="font-semibold ${parseFloat(avg(s.avg_easy_to_store)) >= 4 ? 'text-green-600' : parseFloat(avg(s.avg_easy_to_store)) < 3 ? 'text-red-600' : 'text-amber-600'}">${avg(s.avg_easy_to_store)}</p>
                    </div>
                </div>
                <div class="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span>${s.total_reports} report(s)</span>
                    <span>${s.assigned_designer}</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function setReportView(mode) {
    reportViewMode = mode;
    const tableView = document.getElementById('reportTableView');
    const summaryView = document.getElementById('reportSummaryView');
    const btnTable = document.getElementById('reportViewTable');
    const btnSummary = document.getElementById('reportViewSummary');
    
    if (mode === 'table') {
        tableView.classList.remove('hidden');
        summaryView.classList.add('hidden');
        btnTable.classList.add('bg-white', 'text-gray-900', 'shadow-sm');
        btnTable.classList.remove('text-gray-600', 'hover:text-gray-900');
        btnSummary.classList.remove('bg-white', 'text-gray-900', 'shadow-sm');
        btnSummary.classList.add('text-gray-600', 'hover:text-gray-900');
        renderReportsTable(allReports);
    } else {
        tableView.classList.add('hidden');
        summaryView.classList.remove('hidden');
        btnSummary.classList.add('bg-white', 'text-gray-900', 'shadow-sm');
        btnSummary.classList.remove('text-gray-600', 'hover:text-gray-900');
        btnTable.classList.remove('bg-white', 'text-gray-900', 'shadow-sm');
        btnTable.classList.add('text-gray-600', 'hover:text-gray-900');
        renderReportSummary(allSummaries);
    }
}

function resetReportFilters() {
    document.getElementById('reportProjectFilter').value = '';
    document.getElementById('reportDesignerFilter').value = '';
    document.getElementById('reportStageFilter').value = '';
    document.getElementById('reportDateFrom').value = '';
    document.getElementById('reportDateTo').value = '';
    loadReports();
}

function openSubmitReportModalFromTable() {
    const modal = document.getElementById('submitReportModal');
    modal.classList.remove('hidden');
    
    const projectSelect = document.getElementById('reportModalProject');
    api.getProjects().then(projects => {
        let html = '<option value="">Select project...</option>';
        projects.forEach(p => {
            html += `<option value="${p.id}">${p.name}</option>`;
        });
        projectSelect.innerHTML = html;
        
        // Auto-populate stages when project is selected
        projectSelect.onchange = function() {
            populateModalStages(parseInt(this.value));
        };
    });
    
    // Reset stage dropdown to empty
    document.getElementById('reportModalStage').innerHTML = '<option value="">Select stage...</option>';
    document.getElementById('reportNotes').value = '';
    ['reportRatingCosting', 'reportRatingWillingness', 'reportRatingEngagement', 'reportRatingDurability', 'reportRatingAge', 'reportRatingEase', 'reportRatingAesthetics', 'reportRatingStore'].forEach(id => {
        document.getElementById(id).value = '';
    });
}

function populateModalStages(projectId) {
    if (!projectId) {
        document.getElementById('reportModalStage').innerHTML = '<option value="">Select stage...</option>';
        return;
    }
    api.getProject(projectId).then(project => {
        let html = '<option value="">Select stage...</option>';
        (project.phases || []).forEach((phase, idx) => {
            html += `<option value="${phase.stage_index}">Stage ${phase.stage_index + 1} — ${getPhaseDisplayName(project, phase.stage_index)}</option>`;
        });
        document.getElementById('reportModalStage').innerHTML = html;
    });
}

function closeSubmitReportModal() {
    document.getElementById('submitReportModal').classList.add('hidden');
}

async function submitReportFromWeb() {
    const projectId = document.getElementById('reportModalProject').value;
    const stageIndex = document.getElementById('reportModalStage').value;
    const notes = document.getElementById('reportNotes').value;
    
    if (!projectId || stageIndex === '') {
        showToast('Please select a project and stage');
        return;
    }
    
    const project = await api.getProject(parseInt(projectId));
    const stageLabel = getPhaseDisplayName(project, parseInt(stageIndex));
    
    const ratingMap = {
        costing: document.getElementById('reportRatingCosting').value,
        willingness_to_buy: document.getElementById('reportRatingWillingness').value,
        engagement_life: document.getElementById('reportRatingEngagement').value,
        durability: document.getElementById('reportRatingDurability').value,
        age_appropriateness: document.getElementById('reportRatingAge').value,
        ease_of_use: document.getElementById('reportRatingEase').value,
        aesthetics: document.getElementById('reportRatingAesthetics').value,
        easy_to_store: document.getElementById('reportRatingStore').value,
    };
    
    const reportData = {
        project_id: parseInt(projectId),
        stage_index: parseInt(stageIndex),
        stage_name: stageLabel,
        submitted_by_user_id: String(CURRENT_USER?.id || ''),
        submitted_by_name: CURRENT_USER?.name || 'Unknown',
        submitted_by_role: CURRENT_USER?.role || 'USER',
        slack_user_id: CURRENT_USER?.slack_user_id || '',
        notes: notes,
    };
    
    for (const [key, val] of Object.entries(ratingMap)) {
        reportData[key] = val ? parseInt(val) : null;
    }
    
    try {
        await api.submitReport(reportData);
        showToast('Report submitted successfully!');
        closeSubmitReportModal();
        loadReports();
    } catch (err) {
        console.error('[APP] submitReportFromWeb: Failed:', err.message);
        showToast('Failed to submit report: ' + err.message);
    }
}

// ============================================
// REPORTS PAGE
// ============================================
let currentReportTab = 'project';
let currentReportData = null;
let currentReportEndpoint = '';

async function populateReportsPage() {
    try {
        const projects = await api.getProjects();
        const designers = await api.getDesigners();
        
        const projectSelect = document.getElementById('reportProjectSelect');
        if (projectSelect) {
            let html = '<option value="">Select project...</option>';
            projects.forEach(p => {
                html += `<option value="${p.id}">${p.name}</option>`;
            });
            projectSelect.innerHTML = html;
        }
        
        const weeklyProjectSelect = document.getElementById('weeklyProjectSelect');
        if (weeklyProjectSelect) {
            let html = '<option value="">Select project...</option>';
            projects.forEach(p => {
                html += `<option value="${p.id}">${p.name}</option>`;
            });
            weeklyProjectSelect.innerHTML = html;
        }
        
        const monthlyProjectSelect = document.getElementById('monthlyProjectSelect');
        if (monthlyProjectSelect) {
            let html = '<option value="">Select project...</option>';
            projects.forEach(p => {
                html += `<option value="${p.id}">${p.name}</option>`;
            });
            monthlyProjectSelect.innerHTML = html;
        }
        
        const designerSelect = document.getElementById('designerPerfSelect');
        if (designerSelect) {
            let html = '<option value="">Select designer...</option>';
            designers.forEach(d => {
                html += `<option value="${d.id}">${d.name}</option>`;
            });
            designerSelect.innerHTML = html;
        }
        
        const weeklyStart = document.getElementById('weeklyWeekStart');
        const weeklyEnd = document.getElementById('weeklyWeekEnd');
        if (weeklyStart) {
            const today = new Date();
            const day = today.getDay() || 7;
            const monday = new Date(today);
            monday.setDate(today.getDate() - day + 1);
            weeklyStart.value = monday.toISOString().split('T')[0];
            weeklyEnd.value = today.toISOString().split('T')[0];
        }
        if (weeklyEnd) {
            const today = new Date();
            const day = today.getDay() || 7;
            const monday = new Date(today);
            monday.setDate(today.getDate() - day + 1);
            weeklyEnd.value = today.toISOString().split('T')[0];
        }
        
        const monthlyMonth = document.getElementById('monthlyMonth');
        const monthlyYear = document.getElementById('monthlyYear');
        if (monthlyMonth) monthlyMonth.value = new Date().getMonth() + 1;
        if (monthlyYear) monthlyYear.value = new Date().getFullYear();
        
        const designerPerfMonth = document.getElementById('designerPerfMonth');
        const designerPerfYear = document.getElementById('designerPerfYear');
        if (designerPerfMonth) designerPerfMonth.value = new Date().getMonth() + 1;
        if (designerPerfYear) designerPerfYear.value = new Date().getFullYear();
        
        const designerPerfWeekStart = document.getElementById('designerPerfWeekStart');
        const designerPerfWeekEnd = document.getElementById('designerPerfWeekEnd');
        if (designerPerfWeekStart || designerPerfWeekEnd) {
            const today = new Date();
            const day = today.getDay() || 7;
            const monday = new Date(today);
            monday.setDate(today.getDate() - day + 1);
            if (designerPerfWeekStart) designerPerfWeekStart.value = monday.toISOString().split('T')[0];
            if (designerPerfWeekEnd) designerPerfWeekEnd.value = today.toISOString().split('T')[0];
        }
    } catch (err) {
        console.error('[APP] populateReportsPage: Failed:', err.message);
        showToast('Failed to load reports page: ' + err.message);
    }
}

function toggleDesignerPerfDateInputs() {
    const period = document.getElementById('designerPerfPeriod').value;
    const weeklyInputs = document.getElementById('designerPerfWeeklyInputs');
    const monthlyInputs = document.getElementById('designerPerfMonthlyInputs');
    if (period === 'weekly') {
        weeklyInputs.classList.remove('hidden');
        monthlyInputs.classList.add('hidden');
    } else {
        weeklyInputs.classList.add('hidden');
        monthlyInputs.classList.remove('hidden');
    }
}

function setReportTab(tab) {
    currentReportTab = tab;
    
    const sections = {
        project: 'reportSectionProject',
        // weekly: 'reportSectionWeekly',
        // monthly: 'reportSectionMonthly',
        designer: 'reportSectionDesigner',
        export: 'reportSectionExport',
    };
    
    Object.values(sections).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    const targetSection = sections[tab];
    if (targetSection) {
        const el = document.getElementById(targetSection);
        if (el) el.classList.remove('hidden');
    }
    
    const tabs = {
        project: 'reportTabProject',
        // weekly: 'reportTabWeekly',
        // monthly: 'reportTabMonthly',
        designer: 'reportTabDesigner',
        export: 'reportTabExport',
    };
    
    Object.entries(tabs).forEach(([key, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (key === tab) {
            btn.classList.add('border-brand-500', 'text-brand-600');
            btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        } else {
            btn.classList.remove('border-brand-500', 'text-brand-600');
            btn.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700');
        }
    });
    
    document.getElementById('reportDownloadActions').classList.add('hidden');
    currentReportData = null;
    currentReportEndpoint = '';
}

function showReportDownloadActions(endpoint) {
    currentReportEndpoint = endpoint;
    document.getElementById('reportDownloadActions').classList.remove('hidden');
}

async function loadProjectReport() {
    const projectId = document.getElementById('reportProjectSelect').value;
    if (!projectId) {
        showToast('Please select a project');
        return;
    }
    
    const content = document.getElementById('projectReportContent');
    content.innerHTML = '<div class="text-center text-gray-400 py-8">Loading report...</div>';
    
    try {
        const report = await api.getProjectReport(parseInt(projectId));
        currentReportData = report;
        showReportDownloadActions(`/reports/project/${report.project_id}/download`);
        
        let html = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div>
                        <p class="text-xs text-gray-500 uppercase tracking-wider">Project</p>
                        <p class="font-semibold text-gray-900">${report.project_name}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500 uppercase tracking-wider">Designer</p>
                        <p class="font-semibold text-gray-900">${report.assigned_designer}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                        <p class="font-semibold ${report.status === 'COMPLETED' ? 'text-green-600' : report.status === 'DELAYED' ? 'text-red-600' : 'text-amber-600'}">${report.status.replace('_', ' ')}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-500 uppercase tracking-wider">Progress</p>
                        <p class="font-semibold text-gray-900">${report.progress}%</p>
                    </div>
                </div>
                
                <h3 class="text-sm font-semibold text-gray-700 mb-3">Phase Summary</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="bg-gray-50 border-b border-gray-200">
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Stage</th>
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Deadline</th>
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Completed</th>
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Delay Reason</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        
        const completedPhases = report.phases.filter(p => p.completed_at);
        const latestPhase = report.phases
            .filter(p => !p.completed_at)
            .sort((a, b) => b.stage_index - a.stage_index)[0];
        
        const visiblePhases = [
            ...completedPhases,
            ...(latestPhase ? [latestPhase] : [])
        ].sort((a, b) => a.stage_index - b.stage_index);
        
        visiblePhases.forEach(p => {
            const isDelayed = p.delay_days > 0;
            const statusBadge = isDelayed
                ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">Delayed (${p.delay_days}d)</span>`
                : `<span class="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">On Time</span>`;
            const completedCell = p.completed_at
                ? '✅ ' + formatDateTime(p.completed_at)
                : p.is_current
                    ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-brand-100 text-brand-700">In Progress</span>`
                    : `<span class="text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-500">Not Started</span>`;
            html += `
                <tr class="border-b border-gray-100">
                    <td class="px-4 py-3 font-medium">${p.stage_name}</td>
                    <td class="px-4 py-3 text-gray-600">${formatDate(p.deadline)}</td>
                    <td class="px-4 py-3">${completedCell}</td>
                    <td class="px-4 py-3">${statusBadge}</td>
                    <td class="px-4 py-3 text-gray-500 max-w-xs truncate">${p.delay_reason || '—'}</td>
                </tr>
            `;
        });
        
        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        // B1: 3 Core Metrics — average delay per stage, on-time rate, top risk
        try {
            const completedWithDelay = report.phases.filter(p => p.completed_at && p.delay_days > 0);
            const completedOnTime = report.phases.filter(p => p.completed_at && p.delay_days === 0);
            const totalCompleted = completedWithDelay.length + completedOnTime.length;
            const onTimeRate = totalCompleted > 0 ? Math.round((completedOnTime.length / totalCompleted) * 100) : 0;
            const avgDelayPerStage = report.phases.length > 0
                ? (report.phases.reduce((sum, p) => sum + (p.delay_days || 0), 0) / report.phases.length).toFixed(1)
                : '0';
            const topRisk = report.phases
                .filter(p => !p.completed_at && p.delay_days > 0)
                .sort((a, b) => b.delay_days - a.delay_days)[0]
                || report.phases
                .filter(p => p.delay_days > 0)
                .sort((a, b) => b.delay_days - a.delay_days)[0];
            const trendPhases = report.phases.filter(p => p.completed_at);
            const trend = trendPhases.length >= 2
                ? (() => {
                    const mid = Math.floor(trendPhases.length / 2);
                    const firstHalf = trendPhases.slice(0, mid).filter(p => p.delay_days > 0).length;
                    const secondHalf = trendPhases.slice(mid).filter(p => p.delay_days > 0).length;
                    if (secondHalf < firstHalf) return '↓ improving';
                    if (secondHalf > firstHalf) return '↑ declining';
                    return '→ stable';
                })()
                : '—';
            html += `
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
                    <h3 class="text-sm font-semibold text-gray-700 mb-4">📊 Key Metrics</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div class="bg-amber-50 rounded-lg p-4">
                            <p class="text-xs text-amber-600 font-medium uppercase tracking-wider">Avg Delay per Stage</p>
                            <p class="text-2xl font-bold text-amber-700 mt-1">${avgDelayPerStage}d</p>
                            <p class="text-xs text-amber-600 mt-1">${report.phases.filter(p => p.delay_days > 0).length} of ${report.phases.length} stages delayed</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4">
                            <p class="text-xs text-green-600 font-medium uppercase tracking-wider">On-Time Completion Rate</p>
                            <p class="text-2xl font-bold text-green-700 mt-1">${onTimeRate}%</p>
                            <p class="text-xs text-green-600 mt-1">Trend: ${trend}</p>
                        </div>
                        <div class="${topRisk ? 'bg-red-50 border border-red-200' : 'bg-gray-50'} rounded-lg p-4">
                            <p class="text-xs ${topRisk ? 'text-red-600' : 'text-gray-500'} font-medium uppercase tracking-wider">Top Risk</p>
                            <p class="text-sm font-semibold ${topRisk ? 'text-red-700' : 'text-gray-600'} mt-1">${topRisk ? topRisk.stage_name + ' — ' + topRisk.delay_days + 'd delayed' : 'No active risks'}</p>
                            ${topRisk ? '<p class="text-xs text-red-600 mt-1">' + formatDelayInsight(topRisk) + '</p>' : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.warn('[APP] loadProjectReport: Failed to compute key metrics:', e.message);
        }
        
        if (report.stage_reports && report.stage_reports.length > 0) {
            html += `
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h3 class="text-sm font-semibold text-gray-700 mb-3">Stage Evaluation Reports</h3>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="bg-gray-50 border-b border-gray-200">
                                    <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Stage</th>
                                    <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Submitted By</th>
                                    <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Date</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Costing</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Willingness</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Engagement</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Durability</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Age</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Ease</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Aesthetic</th>
                                    <th class="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Store</th>
                                    <th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            report.stage_reports.forEach(r => {
                const ratingCell = (val) => {
                    if (val === null || val === undefined) return '<span class="text-gray-300">—</span>';
                    const color = val >= 4 ? 'text-green-600' : val >= 3 ? 'text-amber-600' : 'text-red-600';
                    return `<span class="font-semibold ${color}">${val}/5</span>`;
                };
                html += `
                    <tr class="border-b border-gray-100">
                        <td class="px-3 py-2 text-sm font-medium">${r.stage_name}</td>
                        <td class="px-3 py-2 text-sm text-gray-600">${r.submitted_by_name}</td>
                        <td class="px-3 py-2 text-sm text-gray-600">${formatDate(r.submitted_at?.split('T')[0] || '')}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.costing)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.willingness_to_buy)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.engagement_life)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.durability)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.age_appropriateness)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.ease_of_use)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.aesthetics)}</td>
                        <td class="px-3 py-2 text-center">${ratingCell(r.easy_to_store)}</td>
                        <td class="px-3 py-2 text-sm text-gray-500 max-w-xs truncate">${r.notes || '—'}</td>
                    </tr>
                `;
            });
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        content.innerHTML = html;

        // Show charts container
        const chartsContainer = document.getElementById('projectReportCharts');
        if (chartsContainer) chartsContainer.classList.remove('hidden');

        // Render Project Report Charts
        try {
            // Delay analysis by stage
            const delayLabels = report.phases.map(p => p.stage_name);
            const delayValues = report.phases.map(p => p.delay_days);
            renderChart('projectDelayChart', {
                type: 'bar',
                data: {
                    labels: delayLabels,
                    datasets: [{
                        label: 'Delay Days',
                        data: delayValues,
                        backgroundColor: delayValues.map(v => v > 0 ? chartColors.redBg : chartColors.grayBg),
                        borderRadius: 6,
                        borderSkipped: false,
                    }]
                },
                options: {
                    ...defaultChartOptions,
                    indexAxis: 'y',
                    scales: {
                        x: { ...defaultScaleConfig, beginAtZero: true },
                        y: { ...defaultScaleConfig, grid: { display: false } }
                    },
                    plugins: {
                        ...defaultChartOptions.plugins,
                        legend: { display: false }
                    }
                }
            });

            // Phase timeline — Gantt-style floating bars
            const today = new Date();
            const projectStart = new Date(report.start_date + 'T00:00:00');
            const projectEnd = new Date(report.deadline + 'T00:00:00');
            const totalDays = Math.max(1, Math.round((projectEnd - projectStart) / (1000 * 60 * 60 * 24)));

            // Guard: degenerate timeline when start == deadline
            if (report.start_date && report.deadline && projectStart.getTime() === projectEnd.getTime()) {
                const timelineContainer = document.getElementById('projectTimelineChart')?.closest('div');
                if (timelineContainer) {
                    timelineContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">Start date and deadline are the same — no timeline to display.</p>';
                }
            } else {

            const timelineLabels = [];
            const plannedStarts = [];
            const plannedDurations = [];
            const actualStarts = [];
            const actualDurations = [];
            const actualColors = [];

            report.phases.forEach((p, i) => {
                timelineLabels.push(p.stage_name);

                // Planned: from project start (or previous phase end) to deadline
                const phaseDeadline = new Date(p.deadline + 'T00:00:00');
                const prevPhase = report.phases[i - 1];
                let plannedStart;
                if (i === 0) {
                    plannedStart = projectStart;
                } else if (prevPhase.completed_at) {
                    plannedStart = new Date(prevPhase.completed_at.split('T')[0] + 'T00:00:00');
                } else {
                    plannedStart = projectStart;
                }

                const ps = Math.max(0, Math.round((plannedStart - projectStart) / (1000 * 60 * 60 * 24)));
                const pd = Math.max(1, Math.round((phaseDeadline - plannedStart) / (1000 * 60 * 60 * 24)));
                plannedStarts.push(ps);
                plannedDurations.push(pd);

                // Actual: from previous phase completion (or project start) to current completion
                let actualStart, actualEnd;
                if (p.completed_at) {
                    actualStart = new Date(prevPhase && prevPhase.completed_at ? prevPhase.completed_at.split('T')[0] + 'T00:00:00' : report.start_date + 'T00:00:00');
                    const completedParts = p.completed_at.split('T')[0];
                    actualEnd = new Date(completedParts + 'T00:00:00');
                    const as = Math.max(0, Math.round((actualStart - projectStart) / (1000 * 60 * 60 * 24)));
                    const ad = Math.max(1, Math.round((actualEnd - actualStart) / (1000 * 60 * 60 * 24)));
                    actualStarts.push(as);
                    actualDurations.push(ad);
                    actualColors.push(chartColors.greenBg);
                } else if (p.is_current) {
                    // In-progress: actual start from prev phase or project start, actual end = today
                    const as = Math.max(0, Math.round((plannedStart - projectStart) / (1000 * 60 * 60 * 24)));
                    const todayOffset = Math.max(0, Math.round((today - plannedStart) / (1000 * 60 * 60 * 24)));
                    actualStarts.push(as);
                    actualDurations.push(Math.max(1, todayOffset));
                    actualColors.push(p.delay_days > 0 ? chartColors.redBg : chartColors.brand);
                } else {
                    // Not started yet
                    actualStarts.push(0);
                    actualDurations.push(0);
                    actualColors.push(chartColors.grayBg);
                }
            });

            renderChart('projectTimelineChart', {
                type: 'bar',
                data: {
                    labels: timelineLabels,
                    datasets: [
                        {
                            label: 'Planned Duration',
                            data: plannedStarts.map((s, i) => [s, s + plannedDurations[i]]),
                            backgroundColor: 'rgba(156, 163, 175, 0.3)',
                            borderColor: 'rgba(156, 163, 175, 0.5)',
                            borderWidth: 1,
                            borderRadius: 4,
                        },
                        {
                            label: 'Actual Duration',
                            data: actualStarts.map((s, i) => [s, s + actualDurations[i]]),
                            backgroundColor: actualColors,
                            borderColor: actualColors.map(c => c.replace('0.75', '1')),
                            borderWidth: 1,
                            borderRadius: 4,
                        }
                    ]
                },
                options: {
                    ...defaultChartOptions,
                    indexAxis: 'y',
                    scales: {
                        x: {
                            ...defaultScaleConfig,
                            min: 0,
                            max: totalDays,
                            title: { display: true, text: 'Days from project start', font: { size: 11 } },
                        },
                        y: { ...defaultScaleConfig, grid: { display: false } }
                    },
                    plugins: {
                        ...defaultChartOptions.plugins,
                        legend: { position: 'bottom', labels: { font: { size: 11 } } },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.yStart}d → ${ctx.parsed.x}d`
                            }
                        }
                    }
                }
            });
            }
        } catch (chartErr) {
            console.warn('[APP] loadProjectReport: Failed to render charts:', chartErr.message);
        }
    } catch (err) {
        console.error('[APP] loadProjectReport: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
        const chartsContainer = document.getElementById('projectReportCharts');
        if (chartsContainer) chartsContainer.classList.add('hidden');
    }
}

async function loadWeeklyReport() {
    const projectId = document.getElementById('weeklyProjectSelect').value;
    if (!projectId) {
        showToast('Please select a project');
        return;
    }
    
    const weekStart = document.getElementById('weeklyWeekStart').value;
    const weekEnd = document.getElementById('weeklyWeekEnd').value;
    if (!weekStart || !weekEnd) {
        showToast('Please select week dates');
        return;
    }
    
    const content = document.getElementById('weeklyReportContent');
    content.innerHTML = '<div class="text-center text-gray-400 py-8">Loading report...</div>';
    
    try {
        const report = await api.getWeeklyReport(parseInt(projectId), weekStart, weekEnd);
        currentReportData = report;
        showReportDownloadActions(`/reports/weekly/${report.reports.length > 0 ? report.reports[0].project_id : projectId}/download?week_start=${weekStart}&week_end=${weekEnd}`);
        
        const summary = report.summary || {};
        
        // Categorize stages for operational view
        const updatedStages = [];
        const overdueStages = [];
        
        report.reports.forEach(item => {
            const hasActivity = item.activities && item.activities.length > 0;
            const completed = item.completed_this_week;
            const delayed = item.delay_days > 0;
            
            if (completed) {
                updatedStages.push(item);
            } else if (delayed) {
                overdueStages.push(item);
            } else if (hasActivity) {
                updatedStages.push(item);
            }
        });
        
        let html = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <p class="text-sm text-gray-500 mb-4">Week: ${formatDate(weekStart)} — ${formatDate(weekEnd)}</p>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div class="bg-green-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-green-700">${summary.stages_completed || 0}</p>
                        <p class="text-xs text-green-600 mt-1">Stages Completed</p>
                    </div>
                    <div class="bg-blue-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-blue-700">${summary.total_submissions || 0}</p>
                        <p class="text-xs text-blue-600 mt-1">Submissions</p>
                    </div>
                    <div class="bg-red-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-red-700">${summary.total_delays || 0}</p>
                        <p class="text-xs text-red-600 mt-1">Delays</p>
                    </div>
                    <div class="bg-amber-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-amber-700">${summary.total_delay_days || 0}</p>
                        <p class="text-xs text-amber-600 mt-1">Delay Days</p>
                    </div>
                </div>
            </div>
        `;
        
        // B1: 3 Core Metrics for weekly report
        try {
            const delayedItems = report.reports.filter(r => r.delay_days > 0);
            const totalItems = report.reports.length;
            const avgDelay = totalItems > 0 ? (delayedItems.reduce((s, r) => s + r.delay_days, 0) / totalItems).toFixed(1) : '0';
            const onTimeCount = report.reports.filter(r => r.delay_days === 0 && r.progress > 0).length;
            const onTimeRate = totalItems > 0 ? Math.round((onTimeCount / totalItems) * 100) : 0;
            const topRisk = delayedItems.sort((a, b) => b.delay_days - a.delay_days)[0] || report.reports.find(r => r.progress < 100 && r.delay_days === 0);
            html += `
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
                    <h3 class="text-sm font-semibold text-gray-700 mb-4">📊 Key Metrics</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div class="bg-amber-50 rounded-lg p-4">
                            <p class="text-xs text-amber-600 font-medium uppercase tracking-wider">Avg Delay per Stage</p>
                            <p class="text-2xl font-bold text-amber-700 mt-1">${avgDelay}d</p>
                            <p class="text-xs text-amber-600 mt-1">${delayedItems.length} of ${totalItems} stages delayed</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4">
                            <p class="text-xs text-green-600 font-medium uppercase tracking-wider">On-Time Rate</p>
                            <p class="text-2xl font-bold text-green-700 mt-1">${onTimeRate}%</p>
                            <p class="text-xs text-green-600 mt-1">${onTimeCount} on-time / ${delayedItems.length} delayed</p>
                        </div>
                        <div class="${topRisk ? 'bg-red-50 border border-red-200' : 'bg-gray-50'} rounded-lg p-4">
                            <p class="text-xs ${topRisk ? 'text-red-600' : 'text-gray-500'} font-medium uppercase tracking-wider">Top Risk</p>
                            <p class="text-sm font-semibold ${topRisk ? 'text-red-700' : 'text-gray-600'} mt-1">${topRisk ? topRisk.stage_name + ' — ' + topRisk.delay_days + 'd delayed' : 'No active risks'}</p>
                            ${topRisk ? '<p class="text-xs text-red-600 mt-1">' + formatDelayInsight(topRisk, { type: 'weekly-overdue' }) + '</p>' : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.warn('[APP] loadWeeklyReport: Failed to compute key metrics:', e.message);
        }
        
        // Section 1: Stages updated this week
        if (updatedStages.length > 0) {
            html += '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">';
            html += '<h3 class="text-sm font-semibold text-gray-700 mb-4">✅ Stages Updated This Week</h3>';
            html += '<div class="space-y-3">';
            updatedStages.forEach(item => {
                html += `
                    <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div class="flex items-center justify-between mb-2">
                            <h4 class="font-semibold text-gray-900">${item.stage_name}</h4>
                            <div class="flex gap-2">
                                ${item.completed_this_week ? '<span class="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">Completed</span>' : ''}
                                ${item.activities && item.activities.length > 0 ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-700">${item.activities.length} Activity${item.activities.length > 1 ? 'ies' : 'y'}</span>` : ''}
                            </div>
                        </div>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-2">
                            <div><p class="text-xs text-gray-500">Designer</p><p class="font-medium">${item.assigned_designer}</p></div>
                            <div><p class="text-xs text-gray-500">Progress</p><p class="font-medium">${item.progress}%</p></div>
                            <div><p class="text-xs text-gray-500">Change</p><p class="font-medium">${item.progress_change !== undefined && item.progress_change !== 0 ? (item.progress_change > 0 ? '+' + item.progress_change : item.progress_change) : '—'}</p></div>
                            <div><p class="text-xs text-gray-500">Delay</p><p class="font-medium">${item.delay_days > 0 ? item.delay_days + 'd' : '—'}</p></div>
                        </div>
                `;
                if (item.delay_days > 0) {
                    html += `<div class="p-3 bg-red-50 rounded-lg border border-red-200"><p class="text-sm font-medium text-red-700">⚠ Delay: ${formatDelayInsight(item)}</p></div>`;
                }
                if (item.activities && item.activities.length > 0) {
                    html += '<div class="space-y-2 mt-2">';
                    item.activities.forEach(activity => {
                        html += `<div class="bg-white rounded-lg p-3 border border-gray-200"><div class="flex items-center justify-between mb-1"><p class="text-xs font-medium text-gray-700">${activity.submitted_by || 'Unknown'}</p><p class="text-xs text-gray-500">${activity.submitted_at || ''}</p></div>`;
                        if (activity.notes) html += `<p class="text-xs text-gray-600 italic">${activity.notes}</p>`;
                        if (activity.ratings && Object.keys(activity.ratings).length > 0) {
                            html += '<div class="grid grid-cols-4 gap-1 mt-1">';
                            const ratingLabels = {costing:'Costing',willingness_to_buy:'Willingness',engagement_life:'Engagement',durability:'Durability',age_appropriateness:'Age',ease_of_use:'Ease',aesthetics:'Aesthetics',easy_to_store:'Store'};
                            for (const [key, value] of Object.entries(activity.ratings)) {
                                html += `<div class="text-center"><p class="text-xs text-gray-500">${ratingLabels[key] || key}</p><p class="text-sm font-semibold">${value}</p></div>`;
                            }
                            html += '</div>';
                        }
                        html += '</div>';
                    });
                    html += '</div>';
                }
                html += '</div>';
            });
            html += '</div></div>';
        }
        
        // Section 2: Stages that went overdue
        if (overdueStages.length > 0) {
            html += '<div class="bg-white rounded-xl border border-red-200 shadow-sm p-6">';
            html += '<h3 class="text-sm font-semibold text-red-700 mb-4">⚠ Stages Overdue This Week</h3>';
            html += '<div class="space-y-3">';
            overdueStages.forEach(item => {
                html += `
                    <div class="bg-red-50 rounded-lg p-4 border border-red-200">
                        <div class="flex items-center justify-between mb-2">
                            <h4 class="font-semibold text-red-900">${item.stage_name}</h4>
                            <span class="text-xs font-medium px-2 py-1 rounded-full bg-red-200 text-red-800">Delayed ${item.delay_days}d</span>
                        </div>
                        <p class="text-xs text-red-700">${formatDelayInsight(item, { type: 'weekly-overdue' })}</p>
                    </div>
                `;
            });
            html += '</div></div>';
        }
        
        if (updatedStages.length === 0 && overdueStages.length === 0) {
            html += '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-gray-400"><p>No activity detected for this week.</p></div>';
        }
        
        content.innerHTML = html;
    } catch (err) {
        console.error('[APP] loadWeeklyReport: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
    }
}

async function loadMonthlyReport() {
    const projectId = document.getElementById('monthlyProjectSelect').value;
    if (!projectId) {
        showToast('Please select a project');
        return;
    }
    
    const month = document.getElementById('monthlyMonth').value;
    const year = document.getElementById('monthlyYear').value;
    if (!month || !year) {
        showToast('Please select month and year');
        return;
    }
    
    const content = document.getElementById('monthlyReportContent');
    content.innerHTML = '<div class="text-center text-gray-400 py-8">Loading report...</div>';
    
    try {
        const report = await api.getMonthlyReport(parseInt(projectId), parseInt(month), parseInt(year));
        currentReportData = report;
        showReportDownloadActions(`/reports/monthly/${report.reports.length > 0 ? report.reports[0].project_id : projectId}/download?month=${month}&year=${year}`);
        
        const summary = report.summary || {};
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const ratingLabels = {
            costing: 'Costing',
            willingness_to_buy: 'Willingness to Buy',
            engagement_life: 'Engagement Life',
            durability: 'Durability',
            age_appropriateness: 'Age Appropriateness',
            ease_of_use: 'Ease of Use',
            aesthetics: 'Aesthetics',
            easy_to_store: 'Easy to Store'
        };
        
        let html = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <p class="text-sm text-gray-500 mb-4">Month: ${monthNames[parseInt(month) - 1]} ${year}</p>
                <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                    <div class="bg-gradient-to-br from-brand-50 to-brand-100 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-brand-700">${summary.progress_delta || 0}</p>
                        <p class="text-xs text-brand-600 mt-1">Progress Delta</p>
                    </div>
                    <div class="bg-green-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-green-700">${summary.stages_completed || 0}</p>
                        <p class="text-xs text-green-600 mt-1">Stages Completed</p>
                    </div>
                    <div class="bg-blue-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-blue-700">${summary.total_submissions || 0}</p>
                        <p class="text-xs text-blue-600 mt-1">Submissions</p>
                    </div>
                    <div class="bg-purple-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-purple-700">${summary.total_notes || 0}</p>
                        <p class="text-xs text-purple-600 mt-1">Notes</p>
                    </div>
                    <div class="bg-red-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-red-700">${summary.total_delays || 0}</p>
                        <p class="text-xs text-red-600 mt-1">Delays</p>
                    </div>
                    <div class="bg-amber-50 rounded-lg p-4 text-center">
                        <p class="text-2xl font-bold text-amber-700">${summary.total_delay_days || 0}</p>
                        <p class="text-xs text-amber-600 mt-1">Delay Days</p>
                    </div>
                </div>
        `;
        
        // B1: 3 Core Metrics for monthly report
        try {
            const delayedItems = report.reports.filter(r => r.delay_days > 0);
            const totalItems = report.reports.length;
            const avgDelay = totalItems > 0 ? (delayedItems.reduce((s, r) => s + r.delay_days, 0) / totalItems).toFixed(1) : '0';
            const onTimeCount = report.reports.filter(r => r.delay_days === 0).length;
            const onTimeRate = totalItems > 0 ? Math.round((onTimeCount / totalItems) * 100) : 0;
            const topRisk = delayedItems.sort((a, b) => b.delay_days - a.delay_days)[0] || report.reports.find(r => r.progress < 100);
            html += `
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-6">
                    <h3 class="text-sm font-semibold text-gray-700 mb-4">📊 Key Metrics</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div class="bg-amber-50 rounded-lg p-4">
                            <p class="text-xs text-amber-600 font-medium uppercase tracking-wider">Avg Delay per Stage</p>
                            <p class="text-2xl font-bold text-amber-700 mt-1">${avgDelay}d</p>
                            <p class="text-xs text-amber-600 mt-1">${delayedItems.length} of ${totalItems} stages delayed</p>
                        </div>
                        <div class="bg-green-50 rounded-lg p-4">
                            <p class="text-xs text-green-600 font-medium uppercase tracking-wider">On-Time Rate</p>
                            <p class="text-2xl font-bold text-green-700 mt-1">${onTimeRate}%</p>
                            <p class="text-xs text-green-600 mt-1">${onTimeCount} on-time / ${delayedItems.length} delayed</p>
                        </div>
                        <div class="${topRisk ? 'bg-red-50 border border-red-200' : 'bg-gray-50'} rounded-lg p-4">
                            <p class="text-xs ${topRisk ? 'text-red-600' : 'text-gray-500'} font-medium uppercase tracking-wider">Top Risk</p>
                            <p class="text-sm font-semibold ${topRisk ? 'text-red-700' : 'text-gray-600'} mt-1">${topRisk ? topRisk.stage_name + ' — ' + topRisk.delay_days + 'd delayed' : 'No active risks'}</p>
                            ${topRisk ? '<p class="text-xs text-red-600 mt-1">' + formatDelayInsight(topRisk) + '</p>' : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.warn('[APP] loadMonthlyReport: Failed to compute key metrics:', e.message);
        }
        
        if (summary.avg_ratings_overall && Object.keys(summary.avg_ratings_overall).length > 0) {
            html += `
                <div class="mb-6">
                    <h3 class="text-sm font-semibold text-gray-900 mb-3">Rating Averages & Trends</h3>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            `;
            for (const [key, value] of Object.entries(summary.avg_ratings_overall)) {
                let trendHtml = '<span class="text-xs">—</span>';
                const trend = summary.rating_trends ? summary.rating_trends[key] : null;
                if (trend === 'improved') {
                    trendHtml = '<span class="text-xs text-green-600 font-medium">↑ improved</span>';
                } else if (trend === 'declined') {
                    trendHtml = '<span class="text-xs text-red-600 font-medium">↓ declined</span>';
                } else if (trend === 'stable') {
                    trendHtml = '<span class="text-xs text-gray-500 font-medium">→ stable</span>';
                }
                html += `
                    <div class="bg-gray-50 rounded-lg p-3 text-center">
                        <p class="text-xs text-gray-500">${ratingLabels[key] || key}</p>
                        <p class="text-lg font-bold text-gray-900">${value !== null && value !== undefined ? value.toFixed(2) : '—'}</p>
                        ${trendHtml}
                    </div>
                `;
            }
            html += `</div></div>`;
        }
        
        html += '<div class="space-y-4">';
        
        if (report.reports.length === 0) {
            html += '<p class="text-sm text-gray-400 text-center py-4">No reports for this month.</p>';
        } else {
            report.reports.forEach(item => {
                html += `
                    <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-semibold text-gray-900">${item.stage_name}</h4>
                            <div class="flex gap-2">
                                ${item.completed_this_month ? '<span class="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">Completed This Month</span>' : ''}
                                ${item.submissions_count > 0 ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-700">${item.submissions_count} Submission${item.submissions_count > 1 ? 's' : ''}</span>` : ''}
                            </div>
                        </div>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                            <div>
                                <p class="text-xs text-gray-500">Designer</p>
                                <p class="font-medium">${item.assigned_designer}</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Progress</p>
                                <p class="font-medium">${item.progress}%</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Submissions</p>
                                <p class="font-medium">${item.submissions_count}</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Delay</p>
                                <p class="font-medium">${item.delay_days > 0 ? item.delay_days + 'd' : '—'}</p>
                            </div>
                        </div>
                `;
                
                if (item.delay_days > 0) {
                    html += `
                        <div class="mb-3 p-3 bg-red-50 rounded-lg border border-red-200">
                            <p class="text-sm font-medium text-red-700">⚠ Delay Detected</p>
                            <p class="text-xs text-red-600 mt-1">${formatDelayInsight(item)}</p>
                        </div>
                    `;
                }
                
                if (item.avg_ratings && Object.keys(item.avg_ratings).length > 0) {
                    html += '<div class="mb-3"><p class="text-xs text-gray-500 mb-2">Rating Breakdown</p><div class="grid grid-cols-2 md:grid-cols-4 gap-2">';
                    for (const [key, value] of Object.entries(item.avg_ratings)) {
                        const trend = item.rating_trends ? item.rating_trends[key] : null;
                        let trendArrow = '';
                        if (trend === 'improved') trendArrow = ' <span class="text-green-600">↑</span>';
                        else if (trend === 'declined') trendArrow = ' <span class="text-red-600">↓</span>';
                        else if (trend === 'stable') trendArrow = ' <span class="text-gray-500">→</span>';
                        html += `<div class="text-center bg-white rounded p-2"><p class="text-xs text-gray-500">${ratingLabels[key] || key}</p><p class="text-sm font-semibold text-gray-900">${value !== null && value !== undefined ? value.toFixed(2) : '—'}${trendArrow}</p></div>`;
                    }
                    html += '</div></div>';
                }
                
                if (item.activities && item.activities.length > 0) {
                    html += '<div class="space-y-2">';
                    item.activities.forEach(activity => {
                        html += `
                            <div class="bg-white rounded-lg p-3 border border-gray-200">
                                <div class="flex items-center justify-between mb-1">
                                    <p class="text-xs font-medium text-gray-700">${activity.submitted_by || 'Unknown'}</p>
                                    <p class="text-xs text-gray-500">${activity.date || ''}</p>
                                </div>
                        `;
                        if (activity.notes) {
                            html += `<p class="text-xs text-gray-600 italic">${activity.notes}</p>`;
                        }
                        html += '</div>';
                    });
                    html += '</div>';
                }
                
                html += '</div>';
            });
        }
        
        html += '</div></div>';
        content.innerHTML = html;

        // Show charts container
        const chartsContainer = document.getElementById('monthlyReportCharts');
        if (chartsContainer) chartsContainer.classList.remove('hidden');

        // Render Monthly Report Charts
        try {
            // 1. 6-month trend line chart (dual-axis: avg_rating + delay_days)
            try {
                const trendData = await api.getProjectMonthlyTrend(parseInt(projectId));
                if (trendData && trendData.length > 0) {
                    const trendMonths = trendData.map(t => {
                        const [y, m] = t.month.split('-');
                        return new Date(y, m - 1).toLocaleDateString('en', { month: 'short', year: '2-digit' });
                    });
                    renderChart('monthlyTrendChart', {
                        type: 'line',
                        data: {
                            labels: trendMonths,
                            datasets: [{
                                label: 'Avg Rating',
                                data: trendData.map(t => t.avg_rating),
                                borderColor: chartColors.brand,
                                backgroundColor: 'rgba(244, 121, 32, 0.1)',
                                fill: true,
                                tension: 0.3,
                                pointRadius: 4,
                                pointHoverRadius: 6,
                                borderWidth: 2,
                                yAxisID: 'y',
                            }, {
                                label: 'Delay Days',
                                data: trendData.map(t => t.total_delay_days),
                                borderColor: chartColors.red,
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                fill: true,
                                tension: 0.3,
                                pointRadius: 4,
                                pointHoverRadius: 6,
                                borderWidth: 2,
                                yAxisID: 'y1',
                            }]
                        },
                        options: {
                            ...defaultChartOptions,
                            scales: {
                                x: { ...defaultScaleConfig, grid: { display: false } },
                                y: { ...defaultScaleConfig, beginAtZero: true, max: 5, ticks: { ...defaultScaleConfig.ticks, stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' }, title: { display: true, text: 'Rating (1-5)', font: { size: 11 } } },
                                y1: { ...defaultScaleConfig, beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Delay Days', font: { size: 11 } } }
                            },
                            plugins: {
                                ...defaultChartOptions.plugins,
                                legend: { position: 'bottom', labels: { font: { size: 11 } } }
                            }
                        }
                    });
                }
            } catch (trendErr) {
                console.warn('[APP] loadMonthlyReport: Failed to load trend:', trendErr.message);
                const trendEl = document.getElementById('monthlyTrendChart');
                if (trendEl) trendEl.parentElement.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No trend data available.</p>';
            }

            // 3. Delay analysis bar chart (this month)
                renderChart('monthlyDelayChart', {
                    type: 'bar',
                    data: {
                        labels: report.reports.map(r => r.stage_name),
                        datasets: [{
                            label: 'Delay Days',
                            data: report.reports.map(r => r.delay_days),
                            backgroundColor: report.reports.map(r => r.delay_days > 0 ? chartColors.redBg : chartColors.grayBg),
                            borderRadius: 6,
                            borderSkipped: false,
                        }]
                    },
                    options: {
                        ...defaultChartOptions,
                        scales: {
                            x: { ...defaultScaleConfig, grid: { display: false } },
                            y: { ...defaultScaleConfig, beginAtZero: true }
                        },
                        plugins: {
                            ...defaultChartOptions.plugins,
                            legend: { display: false }
                        }
                    }
                });
            }
        catch (chartErr) {
            console.warn('[APP] loadMonthlyReport: Failed to render charts:', chartErr.message);
        }
    } catch (err) {
        console.error('[APP] loadMonthlyReport: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
        const chartsContainer = document.getElementById('monthlyReportCharts');
        if (chartsContainer) chartsContainer.classList.add('hidden');
    }
}

async function loadDesignerPerformance() {
    const designerId = document.getElementById('designerPerfSelect').value;
    if (!designerId) {
        showToast('Please select a designer');
        return;
    }
    
    const period = document.getElementById('designerPerfPeriod').value;
    const content = document.getElementById('designerPerfContent');
    content.innerHTML = '<div class="text-center text-gray-400 py-8">Loading report...</div>';
    
    try {
        let report;
        let endpoint;
        
        if (period === 'weekly') {
            const weekStart = document.getElementById('designerPerfWeekStart').value;
            const weekEnd = document.getElementById('designerPerfWeekEnd').value;
            if (!weekStart || !weekEnd) {
                showToast('Please select week dates');
                return;
            }
            report = await api.getDesignerWeeklyPerformance(parseInt(designerId), weekStart, weekEnd);
            endpoint = `/reports/designer/${designerId}/performance/download?period=weekly&week_start=${weekStart}&week_end=${weekEnd}`;
        } else {
            const month = document.getElementById('designerPerfMonth').value;
            const year = document.getElementById('designerPerfYear').value;
            if (!month || !year) {
                showToast('Please select month and year');
                return;
            }
            report = await api.getDesignerMonthlyPerformance(parseInt(designerId), parseInt(month), parseInt(year));
            endpoint = `/reports/designer/${designerId}/performance/download?period=monthly&month=${month}&year=${year}`;
        }
        
        currentReportData = report;
        showReportDownloadActions(endpoint);
        
        // Compute on-time rate for current period
        const totalStages = report.total_stages_completed || 1;
        const onTimeRate = totalStages > 0 ? Math.round((report.total_on_time / totalStages) * 100) : 0;
        const delayRate = 100 - onTimeRate;
        
        let html = `
            <h2 class="text-xl font-semibold text-gray-800 mb-3">Summary</h2>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div class="text-center p-4 bg-green-50 rounded-lg">
                        <p class="text-3xl font-bold text-green-600">${onTimeRate}%</p>
                        <p class="text-xs text-green-600 mt-1">On-Time Delivery</p>
                    </div>
                    <div class="text-center p-4 bg-brand-50 rounded-lg">
                        <p class="text-3xl font-bold text-brand-600">${report.total_stages_completed}/${report.total_stages_assigned}</p>
                        <p class="text-xs text-gray-500 mt-1">Stages Completed / Assigned</p>
                    </div>
                    <div class="text-center p-4 bg-green-50 rounded-lg">
                        <p class="text-2xl font-bold text-green-600">${report.total_on_time}</p>
                        <p class="text-xs text-green-600 mt-1">On Time Completed Stages</p>
                    </div>
                    <div class="text-center p-4 bg-red-50 rounded-lg">
                        <p class="text-2xl font-bold text-red-600">${report.total_delays}</p>
                        <p class="text-xs text-red-600 mt-1">Delayed Completed Stages</p>
                    </div>
                </div>
            </div>
        `;
        
        // Cross-designer ranking
        html += '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">';
        html += '<h3 class="text-sm font-semibold text-gray-700 mb-4">📊 Team Ranking — On-Time Rate</h3>';
        html += '<div id="designerRankingList" class="space-y-2"><p class="text-sm text-gray-400 py-2">Loading ranking...</p></div>';
        html += '</div>';
        
        html += '<div id="designerPerfContentExtra" class="space-y-6">'; // charts go here
        
        content.innerHTML = html;

        // Show charts container
        const chartsContainer = document.getElementById('designerPerfCharts');
        if (chartsContainer) chartsContainer.classList.remove('hidden');

        // Update chart title based on period
        const trendTitle = document.getElementById('designerPerfTrendTitle');
        if (trendTitle) {
            trendTitle.textContent = period === 'weekly' ? 'Delay Trend (Last 8 Weeks)' : 'Delay Trend (Last 6 Months)';
        }

        // Render Designer Performance Charts
        try {
            // 1. On-time rate trend line (period-aware)
            try {
                const trendData = await api.getDesignerPerformanceTrend(parseInt(designerId), period);
                if (trendData && trendData.length > 0) {
                    const sortedTrend = [...trendData].sort((a, b) => a.month.localeCompare(b.month));
                    const trendLabels = sortedTrend.map(t => {
                        if (period === 'weekly') {
                            return t.month;
                        }
                        const [y, m] = t.month.split('-');
                        return new Date(y, m - 1).toLocaleDateString('en', { month: 'short', year: '2-digit' });
                    });
                    renderChart('designerDelayTrendChart', {
                        type: 'line',
                        data: {
                            labels: trendLabels,
                            datasets: [{
                                label: 'On-Time Rate (%)',
                                data: sortedTrend.map(t => t.on_time_rate),
                                borderColor: chartColors.green,
                                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                fill: true,
                                tension: 0.3,
                                pointRadius: 4,
                                pointHoverRadius: 6,
                                borderWidth: 2,
                            }]
                        },
                        options: {
                            ...defaultChartOptions,
                            scales: {
                                x: { ...defaultScaleConfig, grid: { display: false } },
                                y: { ...defaultScaleConfig, beginAtZero: true, max: 100, ticks: { ...defaultScaleConfig.ticks, callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.05)' } }
                            },
                            plugins: {
                                ...defaultChartOptions.plugins,
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => `On-time: ${ctx.parsed.y}% (${ctx.label})`
                                    }
                                }
                            }
                        }
                    });
                } else {
                    const trendContainer = document.getElementById('designerDelayTrendChart')?.closest('div');
                    if (trendContainer) trendContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">No trend data available.</p>';
                }
            } catch (trendErr) {
                console.warn('[APP] loadDesignerPerformance: Failed to load trend:', trendErr.message);
                const trendContainer = document.getElementById('designerDelayTrendChart')?.closest('div');
                if (trendContainer) trendContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-6">No trend data available.</p>';
            }

            // 2. Cross-designer ranking — team-average comparison
            try {
                const periodParams = period === 'weekly'
                    ? { weekStart: document.getElementById('designerPerfWeekStart').value, weekEnd: document.getElementById('designerPerfWeekEnd').value }
                    : { month: document.getElementById('designerPerfMonth').value, year: document.getElementById('designerPerfYear').value };
                const comparisonData = await api.getDesignerComparison(period, periodParams.weekStart, periodParams.weekEnd, periodParams.month, periodParams.year);
                if (comparisonData && comparisonData.length > 0) {
                    const teamAvg = comparisonData.reduce((s, d) => s + (d.on_time_rate || 0), 0) / comparisonData.length;
                    const sorted = [...comparisonData].sort((a, b) => (b.on_time_rate || 0) - (a.on_time_rate || 0));
                    const rankingHtml = sorted.map((d) => {
                        const isCurrentDesigner = d.designer_id === parseInt(designerId);
                        const rate = d.on_time_rate !== null ? d.on_time_rate + '%' : 'N/A';
                        const barWidth = d.on_time_rate !== null ? d.on_time_rate : 0;
                        const barColor = d.on_time_rate >= 80 ? 'bg-green-500' : d.on_time_rate >= 60 ? 'bg-amber-500' : 'bg-red-500';
                        const diffFromAvg = d.on_time_rate !== null ? (d.on_time_rate - teamAvg).toFixed(1) : 0;
                        const diffLabel = d.on_time_rate !== null
                            ? (parseFloat(diffFromAvg) >= 0 ? '+' : '') + diffFromAvg + 'pp vs team avg'
                            : 'N/A';
                        const rowClass = isCurrentDesigner ? 'bg-brand-50 border-brand-200' : 'border-gray-100';
                        return `
                            <div class="flex items-center gap-3 p-2 rounded-lg border ${rowClass}">
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center justify-between mb-1">
                                        <p class="text-sm font-medium text-gray-900 truncate">${d.designer_name} ${isCurrentDesigner ? '<span class="text-xs text-brand-600"></span>' : ''}</p>
                                        <p class="text-sm font-semibold ${d.on_time_rate >= 80 ? 'text-green-600' : d.on_time_rate >= 60 ? 'text-amber-600' : 'text-red-600'}">${rate}</p>
                                    </div>
                                    <div class="w-full bg-gray-200 rounded-full h-2 relative">
                                        <div class="${barColor} h-2 rounded-full" style="width:${barWidth}%"></div>
                                        <div class="absolute top-0 bottom-0 w-0.5 bg-gray-400" style="left:${teamAvg}%"></div>
                                    </div>
                                    <p class="text-xs text-gray-500 mt-0.5">${diffLabel} · ${d.stages_completed} stages · ${d.on_time} on-time · ${d.delayed} delayed${d.avg_delay_days !== null ? ' · ' + d.avg_delay_days + 'd avg delay' : ''}</p>
                                </div>
                            </div>
                        `;
                    }).join('');
                    const teamAvgHtml = `<p class="text-xs text-gray-500 mt-3 text-center">Team average: <span class="font-semibold text-gray-700">${teamAvg.toFixed(1)}%</span> — gray line indicates team average</p>`;
                    document.getElementById('designerRankingList').innerHTML = rankingHtml + teamAvgHtml;
                } else {
                    document.getElementById('designerRankingList').innerHTML = '<p class="text-sm text-gray-400 py-2">No ranking data available for this period.</p>';
                }
            } catch (compErr) {
                console.warn('[APP] loadDesignerPerformance: Failed to load comparison:', compErr.message);
                document.getElementById('designerRankingList').innerHTML = '<p class="text-sm text-gray-400 py-2">No ranking data available.</p>';
            }
        } catch (chartErr) {
            console.warn('[APP] loadDesignerPerformance: Failed to render charts:', chartErr.message);
        }
    } catch (err) {
        console.error('[APP] loadDesignerPerformance: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
        const chartsContainer = document.getElementById('designerPerfCharts');
        if (chartsContainer) chartsContainer.classList.add('hidden');
    }
}

function downloadReportCSV() {
    if (!currentReportEndpoint) {
        showToast('No report loaded to download');
        return;
    }
    api.downloadReportCSV(currentReportEndpoint + (currentReportEndpoint.includes('?') ? '&' : '?') + 'format=csv')
        .then(() => showToast('CSV downloaded successfully'))
        .catch(err => showToast('Download failed: ' + err.message));
}

function downloadReportPDF() {
    if (!currentReportEndpoint) {
        showToast('No report loaded to download');
        return;
    }
    api.downloadReportPDF(currentReportEndpoint + (currentReportEndpoint.includes('?') ? '&' : '?') + 'format=pdf')
        .then(() => showToast('PDF downloaded successfully'))
        .catch(err => showToast('Download failed: ' + err.message));
}

function calculateDelayDays(deadline) {
    if (!deadline) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline + 'T00:00:00');
    const diffMs = today - deadlineDate;
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}