const WORKFLOW_STAGES = [
    'Lock Concept',
    'Lock UX features',
    'Lock MRP',
    'Lock graphics theme',
    'Lock Production feasibility',
    'Lock Procurement',
    'Lock IM',
    'Lock CCP',
    'Final Handover'
];

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    }) + ' IST';
}

function getDesignerName(designerId, designers) {
    const designer = designers.find(d => d.id === designerId);
    return designer ? designer.name : 'Unassigned';
}

function getStatusColor(status) {
    const colors = {
        'ON_TRACK': 'bg-green-100 text-green-700',
        'DELAYED': 'bg-red-100 text-red-700',
        'COMPLETED': 'bg-blue-100 text-blue-700',
        'AT_RISK': 'bg-amber-100 text-amber-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
}

function getStatusText(status) {
    const text = {
        'ON_TRACK': 'On Track',
        'DELAYED': 'Delayed',
        'COMPLETED': 'Completed',
        'AT_RISK': 'At Risk',
    };
    return text[status] || status;
}

function generateTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMessage');
    if (!toast || !toastMsg) return;
    toastMsg.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('translate-y-0', 'opacity-100');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2200);
}
