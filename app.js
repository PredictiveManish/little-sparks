// ============================================
// STATE
// ============================================
let currentView = 'dashboard';
let selectedProjectId = 1;
let designerModalStageIndex = null;
let tempDesignerSelections = [];
let DESIGNERS = [];
let CURRENT_USER = null;
let USER_ROLE = null;

// ============================================
// AUTH
// ============================================

async function checkAuth() {
    try {
        const user = await api.getMe();
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
        } else {
            showPage('loginPage');
        }
    } catch (err) {
        showPage('loginPage');
    }
}

function showPage(pageId) {
    ['loginPage', 'pendingPage', 'adminPage', 'mainApp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === pageId) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });
}

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
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const slackToken = params.get('slack_token');
    const slackPending = params.get('slack_pending');

    if (error) {
        showToast('Slack login failed: ' + error);
        window.history.replaceState({}, document.title, window.location.pathname);
        showPage('loginPage');
        return true;
    }

    if (slackToken) {
        window.history.replaceState({}, document.title, window.location.pathname);
        localStorage.setItem('slack_jwt_token', slackToken);
        try {
            const user = await api.getMe();
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
            showToast('Slack login failed: ' + err.message);
        }
    }

    if (slackPending) {
        window.history.replaceState({}, document.title, window.location.pathname);
        showPage('loginPage');
        showToast('Account pending approval. Please login with email.');
        return true;
    }

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
    try {
        const result = await api.emailLogin(email, password);
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
        showToast(err.message);
    }
}

async function logout() {
    try {
        await api.logout();
    } catch (err) {
        // Ignore logout errors
    }
    CURRENT_USER = null;
    USER_ROLE = null;
    showPage('loginPage');
}

// ============================================
// ADMIN: Pending Users
// ============================================

async function loadPendingUsers() {
    const container = document.getElementById('pendingUsersList');
    try {
        const users = await api.getPendingUsers();
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
        container.innerHTML = '<p class="text-sm text-red-400 text-center py-4">Failed to load pending users.</p>';
    }
}

async function approveUser(userId, role) {
    if (!confirm(`Approve this user as ${role}?`)) return;
    try {
        await api.approveUser(userId, role);
        showToast('User approved as ' + role);
        loadPendingUsers();
    } catch (err) {
        showToast('Failed: ' + err.message);
    }
}

async function denyUser(userId) {
    if (!confirm('Deny this user? They will need to contact an admin again.')) return;
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
        'whatsapp-chat': 'page-whatsapp-chat',
        'slack-settings': 'page-slack-settings',
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
    'whatsapp-chat': 'whatsapp-chat',
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
    if (view === 'whatsapp-chat') loadWhatsAppChat();

    // Attach date change listeners for phase deadlines
    const startDateInputs = document.querySelectorAll('#page-create-project form input[type="date"]');
    startDateInputs.forEach((input, idx) => {
        input.onchange = function () {
            renderPhaseDeadlines();
        };
    });

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
    try {
        const stats = await api.getDashboardStats();
        document.getElementById('statActiveProjects').textContent = stats.active_projects;
        document.getElementById('statOnTime').textContent = stats.on_time;
        document.getElementById('statCompleted').textContent = stats.completed;
        document.getElementById('statDelayed').textContent = stats.delayed;

        const recentProjects = await api.getRecentProjects();
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
    } catch (err) {
        showToast('Failed to load dashboard: ' + err.message);
    }
}

// ============================================
// POPULATE PROJECTS TABLE
// ============================================
async function populateProjectsTable() {
    try {
        DESIGNERS = await api.getDesigners();
        const projects = await api.getProjects();
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
        showToast('Failed to load projects: ' + err.message);
    }
}

// ============================================
// POPULATE PROJECT DETAILS
// ============================================
async function populateProjectDetails() {
    try {
        const project = await api.getProject(selectedProjectId);
        document.getElementById('detailProjectName').textContent = project.name;
        document.getElementById('detailClientName').textContent = 'Assigned to ' + getDesignerName(project.assigned_designer_id, DESIGNERS);
        document.getElementById('detailStageBadge').textContent =
            `Stage ${project.stage_index + 1} — ${WORKFLOW_STAGES[project.stage_index]}`;
        document.getElementById('detailProgress').textContent = project.progress + '%';
        document.getElementById('detailProgressBar').style.width = project.progress + '%';
        document.getElementById('detailStartDate').textContent = formatDate(project.start_date);
        document.getElementById('detailDeadline').textContent = formatDate(project.deadline);
        document.getElementById('detailStatus').textContent = getStatusText(project.status);

        // Workflow tracker
        const tracker = document.getElementById('workflowTracker');
        let trackerHTML = '';
        WORKFLOW_STAGES.forEach((stage, idx) => {
            let nodeClass = 'upcoming';
            let dotBg = 'bg-gray-200';
            let dotBorder = 'border-gray-300';
            let textColor = 'text-gray-400';
            let dotContent =
                '<svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"/></svg>';

            if (idx < project.stage_index) {
                nodeClass = 'completed';
                dotBg = 'bg-green-500';
                dotBorder = 'border-green-500';
                textColor = 'text-green-700';
                dotContent =
                    '<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
            } else if (idx === project.stage_index) {
                nodeClass = 'current';
                dotBg = 'bg-brand-500';
                dotBorder = 'border-brand-500';
                textColor = 'text-brand-700 font-semibold';
                dotContent = '<span class="text-white text-xs font-bold">' + (idx + 1) + '</span>';
            }

            trackerHTML += `
                <div class="flex flex-col items-center relative workflow-node ${nodeClass} flex-shrink-0" style="width:${100 / 9}%; min-width:70px;">
                    <div class="w-9 h-9 rounded-full ${dotBg} ${dotBorder} border-2 flex items-center justify-center z-10 relative ${idx === project.stage_index ? 'current-stage-pulse' : ''} shadow-sm">
                        ${dotContent}
                    </div>
                    <span class="text-[10px] md:text-xs mt-2 text-center font-medium ${textColor} leading-tight">${stage}</span>
                </div>
            `;
        });
        tracker.innerHTML = trackerHTML;

        // Stage cards
        const cardsContainer = document.getElementById('stageCardsContainer');
        let cardsHTML = '';
        project.phases.forEach((sd, idx) => {
            let cardBorder = 'border-l-gray-300';
            let statusBadge = 'bg-gray-100 text-gray-500';
            let statusText = 'Locked';
            let bgTint = '';

            if (idx < project.stage_index) {
                cardBorder = 'border-l-green-400';
                statusBadge = 'bg-green-100 text-green-700';
                statusText = 'Completed';
                bgTint = 'bg-green-50/30';
            } else if (idx === project.stage_index) {
                cardBorder = 'border-l-brand-500';
                statusBadge = 'bg-brand-100 text-brand-700';
                statusText = 'In Progress';
                bgTint = 'bg-brand-50/30';
            }

            const assignedNames = sd.assignedDesigners
                ? sd.assignedDesigners.map(dId => DESIGNERS.find(d => d.id === dId)).filter(Boolean).map(d => d.name).join(', ')
                : 'None assigned';

            const designerUpdate = sd.designer_update || '—';
            const delayReason = sd.delay_reason || 'No delays reported.';
            const completedAt = sd.completed_at ? formatDateTime(sd.completed_at) : '—';
            const deadline = sd.deadline ? formatDate(sd.deadline) : '—';
            const isCompleted = sd.completed_at !== null;
            const isCurrent = idx === project.stage_index;
            const isLocked = idx > project.stage_index;
            const prevCompleted = idx === 0 ? true : (project.phases[idx - 1].completed_at !== null);
            const canComplete = isCurrent && !isCompleted && prevCompleted;

            cardsHTML += `
                <div class="bg-white rounded-xl border border-gray-200 shadow-sm stage-card ${bgTint} border-l-4 ${cardBorder} p-5">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div class="flex items-center gap-3">
                            <span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isCompleted ? 'bg-green-500 text-white' : isCurrent ? 'bg-brand-500 text-white' : 'bg-gray-200 text-gray-500'}">${idx + 1}</span>
                            <div>
                                <h4 class="font-semibold text-gray-900">${WORKFLOW_STAGES[idx]}</h4>
                                <span class="text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge}">${statusText}</span>
                            </div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            <button onclick="openDesignerModal(${idx})" class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 transition-colors ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}" ${isLocked ? 'disabled' : ''}>
                                👤 Assign Designer
                            </button>
                            ${isCompleted ? `
                            <button onclick="unmarkStageComplete(${idx})" class="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                                ↩ Unmark
                            </button>
                            ` : ''}
                            ${canComplete ? `
                            <button onclick="markStageComplete(${idx})" class="px-3 py-1.5 text-xs font-medium rounded-lg border border-green-300 bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
                                ✓ Mark Complete
                            </button>
                            ` : ''}
                            ${isCurrent && !isCompleted && !prevCompleted ? `
                            <span class="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 bg-amber-50 text-amber-600">
                                🔒 Complete previous stage first
                            </span>
                            ` : ''}
                            ${isLocked ? `
                            <span class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-gray-50 text-gray-400">
                                🔒 Locked
                            </span>
                            ` : ''}
                        </div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                        <div>
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Assigned Designers</p>
                            <p class="font-medium text-gray-800">${assignedNames}</p>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Stage Deadline</p>
                            <p class="font-medium text-gray-800">${deadline}</p>
                        </div>
                        <div>
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Expected Completion</p>
                            <p class="font-medium text-gray-800">${deadline}</p>
                        </div>
                        <div class="sm:col-span-2 lg:col-span-3">
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Manager Notes</p>
                            <p class="text-gray-700">${project.manager_notes || 'No notes added.'}</p>
                        </div>
                        <div class="readonly-field rounded-lg p-3 pt-5 text-sm">
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Latest Designer Update</p>
                            <p class="text-gray-500 italic">${designerUpdate}</p>
                        </div>
                        <div class="readonly-field rounded-lg p-3 pt-5 text-sm">
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Delay Reason</p>
                            <p class="text-gray-500 italic">${delayReason}</p>
                        </div>
                        <div class="readonly-field rounded-lg p-3 pt-5 text-sm">
                            <p class="text-xs text-gray-400 uppercase tracking-wider mb-1">Completion Timestamp</p>
                            <p class="text-gray-500 italic">${completedAt}</p>
                        </div>
                    </div>
                </div>
            `;
        });
        cardsContainer.innerHTML = cardsHTML;
    } catch (err) {
        showToast('Failed to load project details: ' + err.message);
    }
}

// ============================================
// POPULATE EDIT PROJECT
// ============================================
async function populateEditProject() {
    try {
        const project = await api.getProject(selectedProjectId);
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
        showToast('Failed to load project: ' + err.message);
    }
}

async function saveProjectEdit() {
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
        showToast('Failed to update project: ' + err.message);
    }
}

// ============================================
// STAGE COMPLETION
// ============================================
async function markStageComplete(stageIndex) {
    try {
        await api.completeStage(selectedProjectId, stageIndex);
        populateProjectDetails();
        showToast(`"${WORKFLOW_STAGES[stageIndex]}" marked as complete!`);
    } catch (err) {
        showToast(err.message);
    }
}

async function unmarkStageComplete(stageIndex) {
    try {
        await api.unmarkStage(selectedProjectId, stageIndex);
        populateProjectDetails();
        showToast(`"${WORKFLOW_STAGES[stageIndex]}" unmarked from complete.`);
    } catch (err) {
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
            priority: form.querySelector('select').value,
            manager_notes: '',
            phases: phases
        });
        try {
            await api.notifyProjectCreated(project.id);
        } catch (notifyErr) {
            // Non-critical: WhatsApp notification failure shouldn't block project creation
        }
        try {
            await populateWhatsAppProjectSelect();
        } catch (e) { }
        const successMsg = document.getElementById('createSuccessMessage');
        form.classList.add('hidden');
        successMsg.classList.remove('hidden');
        showToast('Project created successfully! WhatsApp notification sent.');
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
    populateCreateDesignerSelect();
    renderPhaseDeadlines();
}

async function populateCreateDesignerSelect() {
    try {
        DESIGNERS = await api.getDesigners();
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

function saveDesignerAssignment() {
    if (designerModalStageIndex === null) return;
    closeDesignerModal();
    populateProjectDetails();
    const assignedCount = tempDesignerSelections.length;
    showToast(`${assignedCount} designer${assignedCount !== 1 ? 's' : ''} assigned to "${WORKFLOW_STAGES[designerModalStageIndex]}"`);
}

// ============================================
// WHATSAPP CHAT
// ============================================
let whatsappPollInterval = null;
let isTyping = false;

async function populateWhatsAppProjectSelect() {
    try {
        const projects = await api.getProjects();
        const select = document.getElementById('whatsappProjectSelect');
        if (!select) return;
        let html = '<option value="">Select a project</option>';
        projects.forEach(p => {
            html += `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`;
        });
        select.innerHTML = html;
    } catch (err) {
        showToast('Failed to load projects: ' + err.message);
    }
}

async function switchWhatsAppProject() {
    const select = document.getElementById('whatsappProjectSelect');
    if (!select) return;
    selectedProjectId = parseInt(select.value);
    await loadWhatsAppChat();
}

async function loadWhatsAppChat() {
    await populateWhatsAppProjectSelect();
    if (!selectedProjectId) {
        const projects = await api.getProjects();
        if (projects.length > 0) {
            selectedProjectId = projects[0].id;
            const select = document.getElementById('whatsappProjectSelect');
            if (select) select.value = selectedProjectId;
        } else {
            return;
        }
    }
    if (whatsappPollInterval) clearInterval(whatsappPollInterval);
    const chatContainer = document.getElementById('chatMessages');
    if (chatContainer) chatContainer.innerHTML = '';
    await fetchWhatsAppMessages();
    whatsappPollInterval = setInterval(fetchWhatsAppMessages, 10000);
}

async function fetchWhatsAppMessages() {
    try {
        const messages = await api.getWhatsAppMessages(selectedProjectId);
        const chatContainer = document.getElementById('chatMessages');
        if (!chatContainer) return;
        const existingIds = new Set();
        chatContainer.querySelectorAll('.msg-bubble').forEach(el => {
            existingIds.add(el.dataset.msgId);
        });
        const newMessages = messages.filter(m => !existingIds.has(String(m.id)));
        if (newMessages.length > 0) {
            newMessages.forEach(msg => {
                const bubble = createMessageBubble(msg.content, msg.is_sent, msg.timestamp, msg.quick_replies || []);
                bubble.classList.add('msg-bubble');
                bubble.dataset.msgId = msg.id;
                chatContainer.appendChild(bubble);
            });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    } catch (err) {
        // Silently fail for polling
    }
}

function createMessageBubble(content, isSent, timestamp, quickReplies = []) {
    const bubble = document.createElement('div');
    bubble.className = `flex ${isSent ? 'justify-end' : 'justify-start'} mb-2`;
    const quickRepliesHTML = quickReplies.length > 0
        ? `<div class="flex flex-wrap gap-1.5 mt-2">${quickReplies.map(qr =>
            `<button class="px-2.5 py-1.5 rounded-full border border-whatsapp-500 text-whatsapp-700 text-xs font-medium hover:bg-whatsapp-50 transition-colors whitespace-nowrap quick-reply-btn" onclick="handleQuickReply('${qr.replace(/'/g, "\\'")}')">${qr}</button>`
        ).join('')}</div>`
        : '';
    bubble.innerHTML = `
        <div class="max-w-[80%] md:max-w-[65%] ${isSent ? 'bg-chat_sent rounded-lg rounded-tr-sm' : 'bg-chat_received rounded-lg rounded-tl-sm'} px-3 py-2 shadow-sm">
            <p class="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">${formatWhatsAppText(content)}</p>
            ${quickRepliesHTML}
            <div class="flex items-center justify-end gap-1 mt-1">
                <span class="text-[10px] text-gray-500">${timestamp}</span>
                ${isSent ? `
                <svg class="w-3.5 h-3.5 text-whatsapp-500" fill="currentColor" viewBox="0 0 16 15">
                    <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.503.08l-1.65 2.232a.365.365 0 0 1-.503.08l-.476-.372a.364.364 0 0 0-.503.08l-.478.372a.364.364 0 0 0 .08.503l1.65 2.232a.365.365 0 0 1 .08.503l-.372.478a.364.364 0 0 0 .08.503l.478.372a.364.364 0 0 0 .503-.08l1.65 2.232a.365.365 0 0 1 .503-.08l.478.372a.364.364 0 0 0 .503-.08l.372-.478a.364.364 0 0 0-.08-.503l-1.65 2.232a.365.365 0 0 1-.08-.503l.372-.478a.364.364 0 0 0-.08-.503z"/>
                </svg>` : ''}
            </div>
        </div>
    `;
    return bubble;
}

function showTypingIndicator() {
    const typingEl = document.getElementById('typingIndicator');
    const chatContainer = document.getElementById('chatMessages');
    if (!typingEl || isTyping) return;
    isTyping = true;
    typingEl.classList.remove('hidden');
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
    const statusEl = document.getElementById('botStatus');
    if (statusEl) statusEl.textContent = 'typing...';
}

function hideTypingIndicator() {
    const typingEl = document.getElementById('typingIndicator');
    if (!typingEl || !isTyping) return;
    isTyping = false;
    typingEl.classList.add('hidden');
    const statusEl = document.getElementById('botStatus');
    if (statusEl) statusEl.textContent = 'online';
}

async function sendUserMessage() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    if (!input || !input.value.trim()) return;
    if (!selectedProjectId) {
        showToast('Please select a project first');
        return;
    }
    const userText = input.value.trim();
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-50');

    const chatContainer = document.getElementById('chatMessages');
    if (chatContainer) {
        const bubble = createMessageBubble(userText, true, generateTime(), []);
        bubble.classList.add('msg-bubble');
        bubble.dataset.msgId = 'temp_' + Date.now();
        chatContainer.appendChild(bubble);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    try {
        await api.createWhatsAppMessage(selectedProjectId, { content: userText, is_sent: true, timestamp: generateTime(), quick_replies: [] });
        showTypingIndicator();
        setTimeout(async () => {
            try {
                await api.respondToMessage(selectedProjectId);
                await fetchWhatsAppMessages();
            } catch (err) {
                showToast('Bot response failed: ' + err.message);
            }
            hideTypingIndicator();
            sendBtn.disabled = false;
            sendBtn.classList.remove('opacity-50');
        }, 1000 + Math.random() * 1500);
    } catch (err) {
        showToast('Failed to send message: ' + err.message);
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-50');
    }
}

function sendQuickCommand(text) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = text;
        sendUserMessage();
    }
}

function handleQuickReply(text) {
    sendQuickCommand(text);
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
    if (!botToken || !signingSecret) {
        showToast('Please fill in both Bot Token and Signing Secret');
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
    btn.textContent = '💾 Save Configuration';
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
        let html = '';
        projects.forEach(p => {
            const hasChannel = p.slack_channel_id || false;
            html += `
                <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold text-gray-900">${p.name}</p>
                        <p class="text-xs text-gray-500 mt-0.5">
                            ${hasChannel
                                ? `<span class="text-green-600">✅ Connected to #${p.slack_channel_name || 'channel'}</span>`
                                : '<span class="text-gray-400">Not connected</span>'}
                        </p>
                    </div>
                    ${!hasChannel
                        ? `<button onclick="createSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-medium hover:bg-blue-600 transition-colors ml-3">
                            Create Channel
                           </button>`
                        : `<button onclick="disconnectSlackChannel(${p.id}, this)" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors ml-3 border border-red-200">
                            Disconnect
                           </button>`
                    }
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
    const project = await api.getProject(projectId);
    project.slack_channel_id = '';
    project.slack_channel_name = '';
    await api.updateProject(projectId, {});
    showToast('Disconnected from Slack');
    await populateSlackChannels();
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
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    // Handle Slack OAuth callback first
    const handled = await handleSlackCallback();
    if (handled) return;

    // Otherwise check auth and load app
    checkAuth();
    handleSlackInstallReturn();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDesignerModal();
    });
    document.getElementById('designerModal').addEventListener('click', function (e) {
        if (e.target === this) closeDesignerModal();
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeSidebar();
    });
});
