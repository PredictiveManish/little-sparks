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
let MANAGERS = [];

// ============================================
// AUTH
// ============================================

async function checkAuth() {
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
                navigateTo('dashboard');
            } else if (user.role === 'DESIGNER') {
                console.log('[APP] checkAuth: User role is DESIGNER, showing restricted page');
                showPage('designerRestrictedPage');
                showDesignerRestricted(user);
            } else {
                console.log('[APP] checkAuth: User authenticated, showing main app');
                showPage('mainApp');
                navigateTo('dashboard');
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
    ['loginPage', 'pendingPage', 'designerLandingPage', 'designerRestrictedPage', 'adminPage', 'mainApp'].forEach(id => {
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
    adminPage: '/admin',
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
                    showPage('adminPage');
                    loadPendingUsers();
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
                showPage('adminPage');
                loadPendingUsers();
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

async function loadPendingUsers() {
    const container = document.getElementById('pendingUsersList');
    console.log('[APP] loadPendingUsers: Loading pending users');
    try {
        const users = await api.getPendingUsers();
        console.log('[APP] loadPendingUsers: Received', users?.length || 0, 'pending users');
        if (!users || users.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No pending users.</p>';
            return;
        }
        let html = '';
        users.forEach(u => {
            html += `
                <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
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
                        <button onclick="denyUser(${u.id})" class="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-medium border border-gray-300 hover:bg-gray-100 transition-colors">
                            Deny
                        </button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (err) {
        console.error('[APP] loadPendingUsers: Failed to load pending users:', err.message);
        container.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Failed to load pending users.</p>';
    }
}

async function approveUser(userId, role) {
    if (!confirm(`Approve this user as ${role}?`)) return;
    try {
        await api.approveUser(userId, role);
        showToast('User approved as ' + role);
        // Refresh the designers page to show the newly approved user
        if (currentView === 'designers') {
            populateDesignersPage();
        } else {
            loadPendingUsers();
        }
    } catch (err) {
        showToast('Failed: ' + err.message);
    }
}

async function rejectUser(userId, btn) {
    if (!confirm('Reject this user? They will need to contact an admin again.')) return;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Rejecting...';
    }
    try {
        await api.deleteDesigner(userId);
        showToast('User rejected');
        if (currentView === 'designers') {
            populateDesignersPage();
        } else {
            loadPendingUsers();
        }
    } catch (err) {
        showToast('Failed: ' + err.message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Reject';
        }
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
        loadPendingUsers();
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

        const recentProjects = await api.getRecentProjects();
        console.log('[APP] loadDashboard: Recent projects received', recentProjects?.length || 0);
        const recentContainer = document.getElementById('recentProjectsList');
        let html = '';
        if (recentProjects.length === 0) {
            html = '<p class="text-sm text-gray-400 text-center py-4">No projects yet. Create your first project!</p>';
        } else {
            recentProjects.forEach(p => {
                html += `
                    <div class="flex items-center justify-between py-3 border-b border-gray-100 last:border-0" onclick="navigateTo('project-details', ${p.id})" style="cursor:pointer">
                        <div>
                            <p class="font-medium text-gray-900 text-sm">${p.name}</p>
                            <p class="text-xs text-gray-500">${p.assigned_designer || 'Unassigned'}</p>
                        </div>
                        <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-brand-100 text-brand-700">Stage ${p.stage_index + 1}</span>
                    </div>
                `;
            });
        }
        recentContainer.innerHTML = html;

        const deadlines = await api.getUpcomingDeadlines();
        console.log('[APP] loadDashboard: Upcoming deadlines received', deadlines?.length || 0);
        const deadlineContainer = document.getElementById('upcomingDeadlinesList');
        let dHtml = '';
        if (deadlines.length === 0) {
            dHtml = '<p class="text-sm text-gray-400 text-center py-4">No upcoming deadlines.</p>';
        } else {
            deadlines.forEach(d => {
                const colorClass = d.days_left <= 7 ? 'text-red-500' : d.days_left <= 14 ? 'text-amber-500' : 'text-blue-500';
                const bgClass = d.days_left <= 7 ? 'bg-red-50' : d.days_left <= 14 ? 'bg-amber-50' : 'bg-blue-50';
                const parts = d.deadline.split('-');
                dHtml += `
                    <div class="flex items-center gap-4 py-3 border-b border-gray-100 last:border-0" style="cursor:pointer" onclick="navigateTo('project-details', ${d.project_id})">
                        <div class="w-12 h-12 rounded-lg ${bgClass} flex flex-col items-center justify-center flex-shrink-0">
                            <span class="text-lg font-bold ${colorClass}">${parts[2]}</span>
                            <span class="text-[10px] ${colorClass} font-medium">${new Date(d.deadline).toLocaleDateString('en', { month: 'short' })}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-gray-900 text-sm truncate">${d.project_name}</p>
                            <p class="text-xs text-gray-500">${d.assigned_designer || 'Unassigned'}</p>
                        </div>
                        <span class="text-xs font-semibold ${colorClass} whitespace-nowrap">${d.days_left} days left</span>
                    </div>
                `;
            });
        }
        deadlineContainer.innerHTML = dHtml;

        // Show pending requests card for admin only
        if (USER_ROLE === 'ADMIN') {
            try {
                const pendingUsers = await api.getPendingUsers();
                const pendingCard = document.getElementById('pendingRequestsCard');
                const pendingList = document.getElementById('pendingRequestsList');
                const pendingBadge = document.getElementById('pendingBadge');

                if (pendingUsers && pendingUsers.length > 0) {
                    pendingCard.classList.remove('hidden');
                    pendingBadge.textContent = pendingUsers.length;
                    pendingBadge.classList.remove('hidden');

                    let pendingHtml = '';
                    pendingUsers.forEach(u => {
                        pendingHtml += `
                            <div class="flex items-center justify-between p-4 bg-amber-50 rounded-lg border border-amber-200">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 bg-amber-200 rounded-full flex items-center justify-center text-amber-700 font-bold">${u.name.charAt(0)}</div>
                                    <div>
                                        <p class="text-sm font-semibold text-gray-900">${u.name}</p>
                                        <p class="text-xs text-gray-500">${u.email}</p>
                                        <p class="text-xs text-amber-600 mt-0.5">Requested role: ${u.requested_role || 'Designer'}</p>
                                    </div>
                                </div>
                                <div class="flex gap-2">
                                    <button onclick="approveUser(${u.id}, 'DESIGNER')" class="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600 transition-colors">
                                        Approve as Designer
                                    </button>
                                    <button onclick="approveUser(${u.id}, 'MANAGER')" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600 transition-colors">
                                        Approve as Manager
                                    </button>
                                    <button onclick="rejectUser(${u.id})" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors border border-red-200">
                                        Reject
                                    </button>
                                </div>
                            </div>
                        `;
                    });
                    pendingList.innerHTML = pendingHtml;
                } else {
                    pendingCard.classList.add('hidden');
                }
            } catch (pendingErr) {
                console.warn('[APP] loadDashboard: Failed to load pending users:', pendingErr.message);
            }
        } else {
            document.getElementById('pendingRequestsCard').classList.add('hidden');
        }
    } catch (err) {
        console.error('[APP] loadDashboard: Failed to load dashboard:', err.message);
        showToast('Failed to load dashboard: ' + err.message);
    }
}

// ============================================
// POPULATE PROJECTS TABLE
// ============================================
async function populateProjectsTable() {
    console.log('[APP] populateProjectsTable: Loading projects table');
    try {
        DESIGNERS = await api.getDesigners();
        console.log('[APP] populateProjectsTable: Designers loaded', DESIGNERS?.length || 0);
        const projects = await api.getProjects();
        console.log('[APP] populateProjectsTable: Projects loaded', projects?.length || 0);
        const tbody = document.getElementById('projectsTableBody');
        let html = '';
        projects.forEach(p => {
            const statusClass = getStatusColor(p.status);
            const statusText = getStatusText(p.status);
            const stageLabel = WORKFLOW_STAGES[p.stage_index] || 'N/A';
            html += `
                <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer" onclick="navigateTo('project-details', ${p.id})">
                    <td class="px-5 py-4">
                        <p class="font-semibold text-gray-900">${p.name}</p>
                    </td>
                    <td class="px-5 py-4 text-gray-600">${getDesignerName(p.assigned_designer_id, DESIGNERS)}</td>
                    <td class="px-5 py-4">
                        <span class="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">Stage ${p.stage_index + 1} — ${stageLabel}</span>
                    </td>
                    <td class="px-5 py-4">
                        <div class="flex items-center gap-2">
                            <div class="w-20 h-1.5 bg-gray-200 rounded-full flex-shrink-0">
                                <div class="h-full rounded-full ${p.progress >= 80 ? 'bg-green-500' : p.progress >= 40 ? 'bg-brand-500' : 'bg-amber-500'}" style="width:${p.progress}%"></div>
                            </div>
                            <span class="text-xs font-medium text-gray-600">${p.progress}%</span>
                        </div>
                    </td>
                    <td class="px-5 py-4 text-gray-600 text-sm">${formatDate(p.deadline)}</td>
                    <td class="px-5 py-4">
                        <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${statusClass}">${statusText}</span>
                    </td>
                    <td class="px-5 py-4 text-right" onclick="event.stopPropagation()">
                        <button onclick="navigateTo('project-details', ${p.id})" class="text-brand-600 hover:text-brand-700 font-medium text-xs mr-3 transition-colors">View</button>
                        <button onclick="navigateTo('edit-project')" class="text-gray-500 hover:text-gray-700 font-medium text-xs transition-colors">Edit</button>
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
        const project = await api.getProject(selectedProjectId);
        console.log('[APP] populateProjectDetails: Project data received', project);
        document.getElementById('detailProjectName').textContent = project.name;
        document.getElementById('detailClientName').textContent = 'Assigned to ' + getDesignerName(project.assigned_designer_id, DESIGNERS);
        document.getElementById('detailStageBadge').textContent =
            `Stage ${project.stage_index + 1}`;
        document.getElementById('detailProgress').textContent = project.progress;
        document.getElementById('detailProgressBar').style.width = project.progress + '%';
        document.getElementById('detailDeadline').textContent = formatDate(project.deadline);
        document.getElementById('detailStatus').textContent = getStatusText(project.status);

        // Workflow tracker
        const tracker = document.getElementById('workflowTracker');
        let trackerHTML = '';
        WORKFLOW_STAGES.forEach((stage, idx) => {
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
                    <span class="text-[10px] md:text-xs mt-1.5 text-center ${labelClass} leading-tight max-w-[60px]">${stage}</span>
                    ${idx < WORKFLOW_STAGES.length - 1 ? `<div class="absolute top-4 left-[calc(50%+20px)] w-[calc(100%-40px)] h-0.5 ${connectorClass}" style="width:calc(100vw / 9); max-width:60px; left:50%;"></div>` : ''}
                </div>
            `;
        });
        tracker.innerHTML = trackerHTML;

        // Stage cards
        const cardsContainer = document.getElementById('stageCardsContainer');
        let cardsHTML = '';
        project.phases.forEach((sd, idx) => {
            const isCompleted = sd.completed_at !== null;
            const isCurrent = idx === project.stage_index;
            const isLocked = idx > project.stage_index;
            const prevCompleted = idx === 0 ? true : (project.phases[idx - 1].completed_at !== null);
            const canComplete = isCurrent && !isCompleted && prevCompleted;

            const assignedNames = sd.assignedDesigners && sd.assignedDesigners.length > 0
                ? sd.assignedDesigners.map(dId => DESIGNERS.find(d => d.id === dId)).filter(Boolean).map(d => d.name).join(', ')
                : getDesignerName(project.assigned_designer_id, DESIGNERS);

            const designerUpdate = sd.designer_update || '—';
            const delayReason = sd.delay_reason || '—';
            const completedAt = sd.completed_at ? formatDateTime(sd.completed_at) : '—';
            const deadline = sd.deadline ? formatDate(sd.deadline) : '—';

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
                                <h4 class="text-sm font-semibold text-gray-900">${WORKFLOW_STAGES[idx]}</h4>
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
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                            <p class="text-gray-400 mb-0.5">Deadline</p>
                            <p class="font-medium text-gray-700">${deadline}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Designer</p>
                            <p class="font-medium text-gray-700">${assignedNames}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Update</p>
                            <p class="text-gray-500 truncate">${designerUpdate}</p>
                        </div>
                        <div>
                            <p class="text-gray-400 mb-0.5">Delay</p>
                            <p class="text-gray-500 truncate">${delayReason}</p>
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
        const project = await api.getProject(selectedProjectId);
        console.log('[APP] populateEditProject: Project data received', project);
        const nameInput = document.getElementById('editProjectName');
        if (nameInput) nameInput.value = project.name;
        const priorityInput = document.getElementById('editProjectPriority');
        if (priorityInput) priorityInput.value = project.priority.toLowerCase();
        const dateInput = document.getElementById('editProjectDeadline');
        if (dateInput) dateInput.value = project.deadline;
        const descInput = document.getElementById('editProjectDescription');
        if (descInput) descInput.value = project.description;
        const notesInput = document.getElementById('editProjectManagerNotes');
        if (notesInput) notesInput.value = project.manager_notes;
    } catch (err) {
        console.error('[APP] populateEditProject: Failed to load project:', err.message);
        showToast('Failed to load project: ' + err.message);
    }
}

async function saveProjectEdit() {
    console.log('[APP] saveProjectEdit: Saving project', selectedProjectId);
    try {
        const nameInput = document.getElementById('editProjectName');
        const priorityInput = document.getElementById('editProjectPriority');
        const dateInput = document.getElementById('editProjectDeadline');
        const descInput = document.getElementById('editProjectDescription');
        const notesInput = document.getElementById('editProjectManagerNotes');

        await api.updateProject(selectedProjectId, {
            name: nameInput ? nameInput.value : null,
            priority: priorityInput ? priorityInput.value.toUpperCase() : null,
            deadline: dateInput ? dateInput.value : null,
            description: descInput ? descInput.value : null,
            manager_notes: notesInput ? notesInput.value : null,
        });

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
    document.getElementById('delayReasonStageLabel').textContent = `Stage: ${WORKFLOW_STAGES[stageIndex]}`;
    document.getElementById('delayReasonInput').value = '';
    document.getElementById('delayReasonModal').classList.remove('hidden');
}

function closeDelayReasonModal() {
    document.getElementById('delayReasonModal').classList.add('hidden');
    pendingCompleteStageIndex = null;
}

async function confirmMarkComplete() {
    if (pendingCompleteStageIndex === null) return;
    const delayReason = document.getElementById('delayReasonInput').value.trim();
    console.log('[APP] confirmMarkComplete: Marking stage', pendingCompleteStageIndex, 'complete for project', selectedProjectId, 'delay_reason:', delayReason || '(none)');
    try {
        await api.completeStage(selectedProjectId, pendingCompleteStageIndex, delayReason || undefined);
        populateProjectDetails();
        showToast(`"${WORKFLOW_STAGES[pendingCompleteStageIndex]}" marked as complete!`);
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
        showToast(`"${WORKFLOW_STAGES[stageIndex]}" unmarked from complete.`);
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
function renderPhaseDeadlines() {
    const container = document.getElementById('phaseDeadlinesContainer');
    if (!container) return;
    const startDateInput = document.querySelector('#page-create-project form input[type="date"]');
    const completionInput = document.querySelectorAll('#page-create-project form input[type="date"]')[1];
    const completionDate = completionInput ? completionInput.value : '';
    const existingInputs = document.querySelectorAll('.phase-deadline-input');
    const existingValues = {};
    existingInputs.forEach(input => {
        existingValues[input.dataset.phaseIndex] = input.value;
    });
    let html = '';
    WORKFLOW_STAGES.forEach((stage, index) => {
        let minDate = '';
        if (index === 0) {
            minDate = startDateInput ? `min="${startDateInput.value}"` : '';
        } else {
            const prevPhaseIndex = index - 1;
            const prevPhaseInput = document.querySelector(`.phase-deadline-input[data-phase-index="${prevPhaseIndex}"]`);
            const prevValue = prevPhaseInput ? prevPhaseInput.value : '';
            const effectivePrevDate = prevValue || completionDate;
            if (effectivePrevDate) {
                minDate = `min="${effectivePrevDate}"`;
            }
        }
        const existingValue = existingValues[index] || '';
        const isRequired = index === 0;
        html += `
            <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="w-6 h-6 rounded-full ${index === 0 ? 'bg-brand-500' : 'bg-gray-400'} text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${index + 1}</span>
                    <span class="text-sm font-medium ${index === 0 ? 'text-gray-900' : 'text-gray-500'}">${stage}</span>
                    ${index > 0 ? '<span class="text-xs text-gray-400">(optional — defaults to Completion Date)</span>' : ''}
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
            </div>
        `;
    });
    container.innerHTML = html;
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

    if (!startDate || !deadline) {
        showToast('Please fill in all required fields');
        return;
    }

    if (new Date(deadline) < new Date(startDate)) {
        showToast('Expected Completion date cannot be before Start Date');
        return;
    }

    const phaseDeadlineInputs = document.querySelectorAll('.phase-deadline-input');
    const phaseDeadlines = [];
    phaseDeadlineInputs.forEach(input => {
        phaseDeadlines.push(input.value);
    });

    // Fill empty phase deadlines with the Expected Completion Date
    for (let i = 0; i < phaseDeadlines.length; i++) {
        if (!phaseDeadlines[i]) {
            phaseDeadlines[i] = deadline;
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

    const phases = phaseDeadlines.map((phaseDeadline, index) => ({
        stage_index: index,
        deadline: phaseDeadline
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
            manager_ids: tempManagerSelections
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
    tempManagerSelections = [];
    populateCreateDesignerSelect();
    populateCreateManagerSelect();
    renderPhaseDeadlines();
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
// DESIGNER ASSIGNMENT MODAL
// ============================================
function openDesignerModal(stageIndex) {
    designerModalStageIndex = stageIndex;
    document.getElementById('designerModalStageLabel').textContent =
        `Stage: ${WORKFLOW_STAGES[stageIndex]}`;
    document.getElementById('designerSearchInput').value = '';
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
        showToast(`${assignedCount} designer${assignedCount !== 1 ? 's' : ''} assigned to "${WORKFLOW_STAGES[designerModalStageIndex]}"`);
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
    });
    
    document.getElementById('reportModalStage').value = '';
    document.getElementById('reportNotes').value = '';
    ['reportRatingCosting', 'reportRatingWillingness', 'reportRatingEngagement', 'reportRatingDurability', 'reportRatingAge', 'reportRatingEase', 'reportRatingAesthetics', 'reportRatingStore'].forEach(id => {
        document.getElementById(id).value = '';
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
        stage_name: WORKFLOW_STAGES[parseInt(stageIndex)] || 'Stage ' + (parseInt(stageIndex) + 1),
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
    } catch (err) {
        console.error('[APP] populateReportsPage: Failed:', err.message);
        showToast('Failed to load reports page: ' + err.message);
    }
}

function setReportTab(tab) {
    currentReportTab = tab;
    
    const sections = {
        project: 'reportSectionProject',
        weekly: 'reportSectionWeekly',
        monthly: 'reportSectionMonthly',
        designer: 'reportSectionDesigner',
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
        weekly: 'reportTabWeekly',
        monthly: 'reportTabMonthly',
        designer: 'reportTabDesigner',
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
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Designer Update</th>
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
            const delayDays = p.completed_at ? (p.delay_days || 0) : calculateDelayDays(p.deadline);
            const statusBadge = p.completed_at
                ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">Completed</span>`
                : delayDays > 0
                    ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">Delayed (${delayDays}d)</span>`
                    : `<span class="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700">On Track</span>`;
            html += `
                <tr class="border-b border-gray-100">
                    <td class="px-4 py-3 font-medium">${p.stage_name}</td>
                    <td class="px-4 py-3 text-gray-600">${formatDate(p.deadline)}</td>
                    <td class="px-4 py-3">${p.completed_at ? '✅ ' + formatDateTime(p.completed_at) : '—'}</td>
                    <td class="px-4 py-3">${statusBadge}</td>
                    <td class="px-4 py-3 text-gray-500 max-w-xs truncate">${p.designer_update || '—'}</td>
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
    } catch (err) {
        console.error('[APP] loadProjectReport: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
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
        
        let html = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <p class="text-sm text-gray-500 mb-4">Week: ${formatDate(weekStart)} — ${formatDate(weekEnd)}</p>
                <div class="space-y-3">
        `;
        
        if (report.reports.length === 0) {
            html += '<p class="text-sm text-gray-400 text-center py-4">No reports for this week.</p>';
        } else {
            report.reports.forEach(item => {
                const delayDays = item.completed_at ? (item.delay_days || 0) : calculateDelayDays(item.deadline || '');
                const statusBadge = item.completed_at
                    ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">Completed</span>`
                    : delayDays > 0
                        ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">Delayed (${delayDays}d)</span>`
                        : `<span class="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700">On Track</span>`;
                html += `
                    <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div class="flex items-center justify-between mb-2">
                            <h4 class="font-semibold text-gray-900">${item.stage_name}</h4>
                            ${statusBadge}
                        </div>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                                <p class="text-xs text-gray-500">Designer</p>
                                <p class="font-medium">${item.assigned_designer}</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Progress</p>
                                <p class="font-medium">${item.progress}%</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Update</p>
                                <p class="text-gray-600 truncate">${item.designer_update || '—'}</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Delay</p>
                                <p class="text-gray-600 truncate">${item.delay_reason || '—'}</p>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        html += '</div></div>';
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
        
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        let html = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <p class="text-sm text-gray-500 mb-4">Month: ${monthNames[parseInt(month) - 1]} ${year}</p>
                <div class="space-y-3">
        `;
        
        if (report.reports.length === 0) {
            html += '<p class="text-sm text-gray-400 text-center py-4">No reports for this month.</p>';
        } else {
            report.reports.forEach(item => {
                const delayDays = item.completed_at ? (item.delay_days || 0) : calculateDelayDays(item.deadline);
                const statusBadge = item.completed_at
                    ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">Completed</span>`
                    : delayDays > 0
                        ? `<span class="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">Delayed (${delayDays}d)</span>`
                        : `<span class="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700">On Track</span>`;
                const updates = item.designer_updates && item.designer_updates.length > 0 ? item.designer_updates.join('<br>') : '<span class="text-gray-400">—</span>';
                const delays = item.delays && item.delays.length > 0 ? item.delays.join('<br>') : '<span class="text-gray-400">—</span>';
                html += `
                    <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div class="flex items-center justify-between mb-2">
                            <h4 class="font-semibold text-gray-900">${item.stage_name}</h4>
                            ${statusBadge}
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                            <div>
                                <p class="text-xs text-gray-500">Designer</p>
                                <p class="font-medium">${item.assigned_designer}</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Progress</p>
                                <p class="font-medium">${item.progress}%</p>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">Updates</p>
                                <p class="text-gray-600">${updates}</p>
                            </div>
                        </div>
                        <div class="mt-2 text-sm">
                            <p class="text-xs text-gray-500">Delays</p>
                            <p class="text-gray-600">${delays}</p>
                        </div>
                    </div>
                `;
            });
        }
        
        html += '</div></div>';
        content.innerHTML = html;
    } catch (err) {
        console.error('[APP] loadMonthlyReport: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
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
            const weekStart = document.getElementById('weeklyWeekStart').value || new Date().toISOString().split('T')[0];
            const weekEnd = document.getElementById('weeklyWeekEnd').value || new Date().toISOString().split('T')[0];
            report = await api.getDesignerWeeklyPerformance(parseInt(designerId), weekStart, weekEnd);
            endpoint = `/reports/designer/${designerId}/performance/download?period=weekly&week_start=${weekStart}&week_end=${weekEnd}`;
        } else {
            const month = document.getElementById('monthlyMonth').value;
            const year = document.getElementById('monthlyYear').value;
            report = await api.getDesignerMonthlyPerformance(parseInt(designerId), parseInt(month), parseInt(year));
            endpoint = `/reports/designer/${designerId}/performance/download?period=monthly&month=${month}&year=${year}`;
        }
        
        currentReportData = report;
        showReportDownloadActions(endpoint);
        
        let html = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="text-center p-4 bg-brand-50 rounded-lg">
                        <p class="text-2xl font-bold text-brand-600">${report.total_updates}</p>
                        <p class="text-xs text-gray-500 mt-1">Total Updates</p>
                    </div>
                    <div class="text-center p-4 bg-red-50 rounded-lg">
                        <p class="text-2xl font-bold text-red-600">${report.total_delays}</p>
                        <p class="text-xs text-gray-500 mt-1">Total Delays</p>
                    </div>
                    <div class="text-center p-4 bg-green-50 rounded-lg">
                        <p class="text-2xl font-bold text-green-600">${report.total_stages_completed}</p>
                        <p class="text-xs text-gray-500 mt-1">Stages Completed</p>
                    </div>
                </div>
                
                <h3 class="text-sm font-semibold text-gray-700 mb-3">Project Activity</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="bg-gray-50 border-b border-gray-200">
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Project</th>
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Stage</th>
                                <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Progress</th>
                                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Updates</th>
                                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Delays</th>
                                <th class="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Reports</th>
                            </tr>
                        </thead>
                        <tbody>
        `;
        
        if (report.projects.length === 0) {
            html += '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No activity for this period.</td></tr>';
        } else {
            report.projects.forEach(item => {
                html += `
                    <tr class="border-b border-gray-100">
                        <td class="px-4 py-3 font-medium">${item.project_name}</td>
                        <td class="px-4 py-3 text-gray-600">${item.stage_name}</td>
                        <td class="px-4 py-3">
                            <span class="text-xs font-medium px-2 py-1 rounded-full ${item.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : item.status === 'DELAYED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${item.status.replace('_', ' ')}</span>
                        </td>
                        <td class="px-4 py-3 text-center font-medium">${item.progress}%</td>
                        <td class="px-4 py-3 text-center">${item.updates_count}</td>
                        <td class="px-4 py-3 text-center ${item.delays_count > 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}">${item.delays_count}</td>
                        <td class="px-4 py-3 text-center">${item.reports_submitted}</td>
                    </tr>
                `;
            });
        }
        
        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        
        content.innerHTML = html;
    } catch (err) {
        console.error('[APP] loadDesignerPerformance: Failed:', err.message);
        content.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 text-center text-red-500">Failed to load report: ' + err.message + '</div>';
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

function downloadReportExcel() {
    if (!currentReportEndpoint) {
        showToast('No report loaded to download');
        return;
    }
    api.downloadReportExcel(currentReportEndpoint + (currentReportEndpoint.includes('?') ? '&' : '?') + 'format=xlsx')
        .then(() => showToast('Excel downloaded successfully'))
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