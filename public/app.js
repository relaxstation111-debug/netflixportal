// --- ESTRUCTURA PRINCIPAL ---
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path.includes('admin_login.html')) {
        setupAdminLoginForm();
    }
    if (path.includes('admin.html')) {
        setupGlobalAdminListeners();
        loadAdminData();
    }
    if (path.includes('dashboard.html')) {
        loadDashboard();
    }
    if (path.includes('login.html')) {
        setupClientLoginForm();
    }
});

let adminData = {}; // Variable global para almacenar datos de admin

// --- LÓGICA DE LOGIN Y AUTENTICACIÓN (NUEVO) ---

function setupAdminLoginForm() {
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('admin-password').value;
        const errorMessage = document.getElementById('error-message');
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            if (!res.ok) throw new Error('Contraseña incorrecta.');
            window.location.href = '/admin.html'; // Redirigir al panel
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.style.display = 'block';
        }
    });
}

async function checkAdminAuth() {
    // Esta función se asegura de que solo un admin logueado pueda ver la data.
    // Si la sesión no es válida, la API devolverá un error 401.
    // El 'catch' nos redirigirá al login.
    try {
        const res = await fetch('/api/admin/data');
        if (res.status === 401) {
            window.location.href = '/admin_login.html';
            return null; // Detiene la ejecución
        }
        if (!res.ok) throw new Error('No se pudieron cargar los datos del admin.');
        return await res.json();
    } catch (error) {
        console.error("Error de autenticación o de carga de datos:", error);
        window.location.href = '/admin_login.html';
        return null;
    }
}

async function logoutAdmin() {
    await fetch('/api/admin/logout');
    window.location.href = '/admin_login.html';
}

// --- LÓGICA DEL PANEL DE ADMINISTRADOR ---

async function loadAdminData() {
    const data = await checkAdminAuth();
    if (!data) return; // Si no hay data (porque no está autenticado), no hace nada.
    adminData = data;

    renderDashboardStats(adminData);
    renderAllTables(adminData);
    renderExpiringSoon(adminData);
    renderExpiredAndUnrenewed(adminData);
    populateAssignmentForm(adminData);
}

function setupGlobalAdminListeners() {
    // Listener para las pestañas
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.addEventListener('click', () => {
        document.querySelector('.tab-button.active').classList.remove('active');
        button.classList.add('active');
        document.querySelector('.tab-content.active').classList.remove('active');
        document.getElementById(button.dataset.target).classList.add('active');
    }));

    // Listener para el botón de logout (NUEVO)
    document.getElementById('logout-btn').addEventListener('click', logoutAdmin);

    // Listeners para los formularios de creación
    document.getElementById('add-account-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('add-client-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('assignment-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('add-profile-btn').addEventListener('click', addProfileInput);

    // Listeners para botones de acción y modales
    document.body.addEventListener('click', handleActionClick);
    
    // Listeners para los filtros de búsqueda
    ['assignments', 'accounts', 'clients', 'expired'].forEach(type => {
        const searchInput = document.getElementById(`search-${type}`);
        if(searchInput) searchInput.addEventListener('input', (e) => filterTable(e.target.value, `${type}-table`));
    });
    
    // Filtros avanzados (NUEVO)
    document.getElementById('filter-assignments').addEventListener('change', (e) => {
        filterAssignmentTableByPayment(e.target.value);
    });
    document.getElementById('filter-accounts').addEventListener('change', (e) => {
        filterAccountTableByAvailability(e.target.value);
    });
}

// --- FUNCIONES DE RENDERIZADO (CON MEJORAS) ---

function renderDashboardStats({ clients, serviceAccounts, activeAssignments }) {
    const totalProfiles = serviceAccounts.reduce((sum, acc) => sum + acc.profiles.length, 0);
    const availableProfiles = totalProfiles - activeAssignments.length;
    document.getElementById('stats-container').innerHTML = `
        <div class="stat-card"><h3>${clients.length}</h3><p>Clientes Totales</p></div>
        <div class="stat-card"><h3>${activeAssignments.length}</h3><p>Perfiles Asignados</p></div>
        <div class="stat-card"><h3>${availableProfiles}</h3><p>Perfiles Disponibles</p></div>
        <div class="stat-card"><h3>${serviceAccounts.length}</h3><p>Cuentas de Servicio</p></div>
    `;
}

function renderAllTables({ clients, serviceAccounts, activeAssignments, expiredAssignments }) {
    // Tabla de Cuentas (con indicador de perfiles libres)
    let accountsHtml = '<table><thead><tr><th>Estado</th><th>Nombre</th><th>Perfiles Libres</th><th>Acciones</th></tr></thead><tbody>';
    serviceAccounts.forEach(acc => {
        const assignedOnThisAccount = activeAssignments.filter(a => a.serviceAccount?._id === acc._id).length;
        const totalProfiles = acc.profiles.length;
        const available = totalProfiles - assignedOnThisAccount;
        accountsHtml += `<tr data-available="${available > 0 ? 'yes' : 'no'}">
            <td><span class="status-dot ${acc.status.toLowerCase()}"></span>${acc.status}</td>
            <td>${acc.name}</td>
            <td><strong>${available}</strong> de ${totalProfiles}</td>
            <td class="actions-cell">
                <button class="button-secondary edit-account" data-id="${acc._id}">Editar</button>
                <button class="button-secondary toggle-status" data-id="${acc._id}">Estado</button>
                <button class="button-danger delete-account" data-id="${acc._id}">Eliminar</button>
            </td>
        </tr>`;
    });
    document.getElementById('accounts-table').innerHTML = accountsHtml + '</tbody></table>';

    // Tabla de Clientes
    let clientsHtml = '<table><thead><tr><th>Nombre</th><th>WhatsApp</th><th>Notas</th><th>Acciones</th></tr></thead><tbody>';
    clients.forEach(c => {
        clientsHtml += `<tr>
            <td>${c.name}</td>
            <td>${c.whatsapp}</td>
            <td>${c.notes ? c.notes.substring(0, 20) + '...' : ''}</td>
            <td class="actions-cell">
                <button class="button-secondary edit-client" data-id="${c._id}">Editar</button>
                <button class="button-secondary view-history" data-id="${c._id}">Historial</button>
                <button class="button-danger delete-client" data-id="${c._id}">Eliminar</button>
            </td>
        </tr>`;
    });
    document.getElementById('clients-table').innerHTML = clientsHtml + '</tbody></table>';
    
    // Tabla de Asignaciones (con estado de pago)
    let assignmentsHtml = '<table><thead><tr><th>Cliente</th><th>Cuenta/Perfil</th><th>Vence</th><th>Pago</th><th>Acciones</th></tr></thead><tbody>';
    activeAssignments.forEach(a => {
        const paymentStatusClass = a.paymentStatus === 'Pagado' ? 'paid' : 'pending';
        assignmentsHtml += `<tr data-payment="${a.paymentStatus.toLowerCase()}">
            <td>${a.client?.name ||'N/A'}</td>
            <td>${a.serviceAccount?.name || 'N/A'} - ${a.profileName}</td>
            <td>${new Date(a.expiryDate).toLocaleDateString('es-PY')}</td>
            <td><span class="payment-status ${paymentStatusClass}">${a.paymentStatus}</span></td>
            <td class="actions-cell">
                <button class="button-success renew-assignment" data-id="${a._id}">Renovar</button>
                <button class="button-secondary toggle-payment" data-id="${a._id}">Pago</button>
                <button class="button-danger delete-assignment" data-id="${a._id}">Eliminar</button>
            </td>
        </tr>`;
    });
    document.getElementById('assignments-table').innerHTML = assignmentsHtml + '</tbody></table>';
    
    // Tabla de Expirados
    let expiredHtml = '<table><thead><tr><th>Cliente</th><th>Cuenta/Perfil</th><th>Venció el</th></tr></thead><tbody>';
    expiredAssignments.forEach(a => {
        expiredHtml += `<tr class="expired">
            <td>${a.client?.name || 'N/A'}</td>
            <td>${a.serviceAccount?.name || 'N/A'} - ${a.profileName}</td>
            <td>${new Date(a.expiryDate).toLocaleDateString('es-PY')}</td>
        </tr>`;
    });
    document.getElementById('expired-table').innerHTML = expiredHtml + '</tbody></table>';
}

function renderExpiringSoon({ expiringSoonAssignments }) {
    const list = document.getElementById('expiring-soon-list');
    if (!expiringSoonAssignments || expiringSoonAssignments.length === 0) {
        list.innerHTML = '<p class="empty-list">No hay vencimientos en los próximos 5 días.</p>'; return;
    }
    list.innerHTML = expiringSoonAssignments.map(a => {
        const daysLeft = Math.ceil((new Date(a.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
        const message = encodeURIComponent(`Hola ${a.client.name}, te recordamos que tu acceso a la cuenta ${a.serviceAccount.name} vence en ${daysLeft} día(s). ¿Deseas renovar?`);
        const whatsappLink = `https://wa.me/${a.client.whatsapp}?text=${message}`;
        return `<div class="list-item">
            <div class="item-info"><strong>${a.client.name}</strong><span>Vence en <strong>${daysLeft} día(s)</strong></span></div>
            <a href="${whatsappLink}" target="_blank" class="button button-whatsapp">Contactar</a>
        </div>`;
    }).join('');
}

function renderExpiredAndUnrenewed({ expiredAssignments }) {
    const list = document.getElementById('expired-unrenewed-list');
    if (!expiredAssignments || expiredAssignments.length === 0) {
        list.innerHTML = '<p class="empty-list">No hay asignaciones expiradas pendientes de acción.</p>'; return;
    }
    list.innerHTML = expiredAssignments.map(a => `
        <div class="list-item">
            <div class="item-info"><strong>${a.client.name}</strong><span>Expiró el ${new Date(a.expiryDate).toLocaleDateString('es-PY')} (Cuenta: ${a.serviceAccount.name})</span></div>
            <button class="button-danger change-pin" data-account-id="${a.serviceAccount._id}" data-profile-name="${a.profileName}" data-assignment-id="${a._id}">Cambiar PIN</button>
        </div>`
    ).join('');
}

function populateAssignmentForm({ serviceAccounts, activeAssignments }) {
    const accountSelect = document.getElementById('account-select');
    const activeAccounts = serviceAccounts.filter(a => a.status === 'Activa');
    accountSelect.innerHTML = '<option value="">-- Selecciona Cuenta --</option>';
    activeAccounts.forEach(a => accountSelect.innerHTML += `<option value="${a._id}">${a.name}</option>`);

    accountSelect.onchange = () => {
        const profileSelect = document.getElementById('profile-select');
        const pinInput = document.getElementById('pin-input');
        const selectedAccount = serviceAccounts.find(a => a._id === accountSelect.value);
        profileSelect.innerHTML = '<option value="">-- Selecciona Perfil --</option>';
        pinInput.value = '';
        if (selectedAccount) {
            const assignedProfiles = activeAssignments.filter(a => a.serviceAccount?._id === selectedAccount._id).map(a => a.profileName);
            selectedAccount.profiles.forEach(p => {
                const isAssigned = assignedProfiles.includes(p.name);
                profileSelect.innerHTML += `<option value="${p.name}" data-pin="${p.pin}" ${isAssigned ? 'disabled' : ''}>${p.name} ${isAssigned ? '(Ocupado)' : ''}</option>`;
            });
        }
    };

    document.getElementById('profile-select').onchange = (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        document.getElementById('pin-input').value = selectedOption.dataset.pin || '';
    };
}

// --- HANDLERS DE EVENTOS Y FORMULARIOS ---

async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    let endpoint = '', body = {}, successMessage = '';

    if (form.id === 'add-account-form') {
        endpoint = '/api/admin/accounts';
        const profiles = Array.from(form.querySelectorAll('.profile-entry')).map(node => ({
            name: node.querySelector('input[name="profileName"]').value,
            pin: node.querySelector('input[name="profilePin"]').value
        }));
        body = { name: form.elements['name'].value, email: form.elements['email'].value, password: form.elements['password'].value, profiles };
        successMessage = 'Cuenta agregada';
    } else if (form.id === 'add-client-form') {
        endpoint = '/api/admin/clients';
        body = { name: form.elements['name'].value, whatsapp: form.elements['whatsapp'].value };
        successMessage = 'Cliente agregado';
    } else if (form.id === 'assignment-form') { // <-- MODIFICADO para crear clientes
        endpoint = '/api/admin/assignments';
        body = { 
            clientName: form.elements['client-name'].value,
            clientWhatsapp: form.elements['client-whatsapp'].value,
            accountId: form.elements['account-select'].value,
            profileName: form.elements['profile-select'].value,
            pin: form.elements['pin-input'].value
        };
        successMessage = 'Asignación creada';
    }
    
    try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error((await res.json()).message);
        openModal('Éxito', `<p>${successMessage}</p>`);
        form.reset();
        if (form.id === 'add-account-form') document.getElementById('profiles-container').innerHTML = '';
        loadAdminData();
    } catch (error) { openModal('Error', `<p>${error.message}</p>`); }
}

async function handleActionClick(e) {
    const button = e.target.closest('button');
    if (!button) return;

    if (button.matches('[data-action="close-modal"]')) { closeModal(); return; }
    
    const id = button.dataset.id;
    
    if (button.matches('.delete-client')) { openModal('Confirmar', '<p>¿Seguro que quieres eliminar este cliente?</p>', `<button class="button-danger" data-action="confirm-delete" data-endpoint="/api/admin/clients/${id}">Eliminar</button>`); }
    if (button.matches('.edit-client')) { openEditClientModal(id); }
    if (button.matches('[data-action="save-client-edit"]')) { saveClientEdit(id); }
    if (button.matches('.view-history')) { viewClientHistory(id); }
    if (button.matches('.delete-account')) { openModal('Confirmar', '<p>¿Seguro que quieres eliminar esta cuenta?</p>', `<button class="button-danger" data-action="confirm-delete" data-endpoint="/api/admin/accounts/${id}">Eliminar</button>`); }
    if (button.matches('.edit-account')) { openEditAccountModal(id); }
    if (button.matches('[data-action="save-account-edit"]')) { saveAccountEdit(id); }
    if (button.matches('.toggle-status')) { performAction('PATCH', `/api/admin/accounts/${id}/status`, 'Estado cambiado.'); }
    if (button.matches('.delete-assignment')) { openModal('Confirmar', '<p>¿Seguro que quieres eliminar esta asignación?</p>', `<button class="button-danger" data-action="confirm-delete" data-endpoint="/api/admin/assignments/${id}">Eliminar</button>`); }
    if (button.matches('.renew-assignment')) { openModal('Confirmar', '<p>¿Renovar esta asignación por 30 días y marcarla como pagada?</p>', `<button class="button-success" data-action="confirm-renew" data-endpoint="/api/admin/assignments/${id}/renew">Renovar</button>`); }
    if (button.matches('.toggle-payment')) { performAction('PATCH', `/api/admin/assignments/${id}/payment`, 'Estado de pago cambiado.'); } // <-- NUEVO
    if (button.matches('.change-pin')) { openChangePinModal(button.dataset.accountId, button.dataset.profileName, button.dataset.assignmentId); }
    if (button.matches('[data-action="save-new-pin"]')) { saveNewPin(button.dataset.accountId, button.dataset.profileName, button.dataset.assignmentId); }

    // Handlers genéricos para confirmaciones
    if (button.matches('[data-action="confirm-delete"]')) { performAction('DELETE', button.dataset.endpoint, 'Elemento eliminado.'); }
    if (button.matches('[data-action="confirm-renew"]')) { performAction('PATCH', button.dataset.endpoint, 'Asignación renovada.'); }
}

async function performAction(method, endpoint, successMessage, { body = null } = {}) {
    try {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(endpoint, options);
        if (res.status === 401) return window.location.href = '/admin_login.html';
        if (!res.ok) throw new Error(await res.text());
        closeModal();
        if(successMessage) openModal('Éxito', `<p>${successMessage}</p>`);
        await loadAdminData();
    } catch (error) { openModal('Error', `<p>${error.message}</p>`); }
}

// --- LÓGICA DE MODALES (CON MEJORAS) ---
function openModal(title, body, footer = '<button class="button-secondary" data-action="close-modal">Cerrar</button>') {
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-footer').innerHTML = footer;
    document.getElementById('modal-backdrop').classList.add('visible');
}
function closeModal() { document.getElementById('modal-backdrop').classList.remove('visible'); }

function openEditClientModal(id) {
    const client = adminData.clients.find(c => c._id === id);
    if (!client) return;
    const body = `<form id="edit-client-form" class="modal-form">
        <label>Nombre</label><input type="text" id="edit-client-name" value="${client.name}" required>
        <label>WhatsApp</label><input type="text" id="edit-client-whatsapp" value="${client.whatsapp}" required>
        <label>Notas Internas</label><textarea id="edit-client-notes">${client.notes || ''}</textarea>
    </form>`;
    const footer = `<button class="button-secondary" data-action="close-modal">Cancelar</button><button class="button" data-action="save-client-edit" data-id="${id}">Guardar</button>`;
    openModal(`Editar Cliente: ${client.name}`, body, footer);
}
async function saveClientEdit(id) {
    const body = { name: document.getElementById('edit-client-name').value, whatsapp: document.getElementById('edit-client-whatsapp').value, notes: document.getElementById('edit-client-notes').value };
    await performAction('PUT', `/api/admin/clients/${id}`, 'Cliente actualizado.', { body });
}

async function openEditAccountModal(id) { // <-- MODIFICADO para cargar pass desencriptada
    const account = adminData.serviceAccounts.find(a => a._id === id);
    if (!account) return;
    
    // Pide la contraseña desencriptada al servidor
    const passRes = await fetch(`/api/admin/accounts/${id}/password`);
    const { password } = await passRes.json();

    const profiles = account.profiles.map(p => `${p.name}:${p.pin}`).join(', ');
    const body = `<form id="edit-account-form" class="modal-form">
        <label>Nombre</label><input type="text" id="edit-account-name" value="${account.name}" required>
        <label>Email</label><input type="email" id="edit-account-email" value="${account.email}" required>
        <label>Password</label><input type="text" id="edit-account-password" value="${password}" required>
        <label>Perfiles (formato: Nombre:PIN)</label><textarea id="edit-account-profiles" rows="3">${profiles}</textarea>
    </form>`;
    const footer = `<button class="button-secondary" data-action="close-modal">Cancelar</button><button class="button" data-action="save-account-edit" data-id="${id}">Guardar</button>`;
    openModal(`Editar Cuenta: ${account.name}`, body, footer);
}
async function saveAccountEdit(id) {
    const body = {
        name: document.getElementById('edit-account-name').value,
        email: document.getElementById('edit-account-email').value,
        password: document.getElementById('edit-account-password').value,
        profiles: document.getElementById('edit-account-profiles').value,
    };
    await performAction('PUT', `/api/admin/accounts/${id}`, 'Cuenta actualizada.', { body });
}

async function viewClientHistory(id) {
    try {
        const res = await fetch(`/api/admin/clients/${id}/history`);
        if (!res.ok) throw new Error('No se pudo cargar el historial.');
        const history = await res.json();
        if (history.length === 0) return openModal('Historial de Asignaciones', '<p>Este cliente no tiene historial.</p>');
        
        let body = '<ul class="history-list">';
        history.forEach(h => {
            const status = new Date(h.expiryDate) < new Date() ? 'Expirada' : 'Activa';
            body += `<li><strong>${h.serviceAccount.name} / ${h.profileName}</strong>
                <span>Venció el ${new Date(h.expiryDate).toLocaleDateString('es-PY')} (${status})</span>
                <span>Pago: ${h.paymentStatus}</span>
            </li>`;
        });
        body += '</ul>';
        openModal('Historial de Asignaciones', body);
    } catch (error) { openModal('Error', `<p>${error.message}</p>`); }
}

function openChangePinModal(accountId, profileName, assignmentId) {
    const body = `<p>Actualiza el PIN en Netflix y guárdalo aquí para habilitar el perfil.</p>
        <a href="https://netflix.com" class="button-secondary" target="_blank" style="margin-bottom: 20px; display: block;">Abrir Netflix.com</a>
        <div class="modal-form">
            <label>Nuevo PIN para ${profileName}</label>
            <div class="pin-generator">
                <input type="number" id="new-pin-input" placeholder="Introduce el nuevo PIN">
                <button class="button-secondary" id="generate-pin-btn">Generar y Copiar</button>
            </div>
        </div>`;
    const footer = `<button class="button-secondary" data-action="close-modal">Cancelar</button><button class="button" data-action="save-new-pin" data-account-id="${accountId}" data-profile-name="${profileName}" data-assignment-id="${assignmentId}">Guardar y Liberar</button>`;
    openModal('Acción Requerida: Cambiar PIN', body, footer);
    
    document.getElementById('generate-pin-btn').onclick = (e) => {
        const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
        document.getElementById('new-pin-input').value = randomPin;
        navigator.clipboard.writeText(randomPin).then(() => {
            e.target.textContent = '¡Copiado!';
            setTimeout(() => { e.target.textContent = 'Generar y Copiar'; }, 2000);
        });
    };
}
async function saveNewPin(accountId, profileName, assignmentId) {
    const newPin = document.getElementById('new-pin-input').value;
    if (!newPin || newPin.length < 4) { return openModal('Error', '<p>Introduce un PIN válido de 4 dígitos.</p>'); }
    
    await performAction('PATCH', `/api/admin/accounts/${accountId}/profiles`, null, { body: { profileName, newPin } });
    await performAction('DELETE', `/api/admin/assignments/${assignmentId}`, 'PIN actualizado y perfil liberado.');
}


// --- FUNCIONES DE UI Y FILTROS ---
function addProfileInput() {
    const container = document.getElementById('profiles-container');
    const entry = document.createElement('div');
    entry.className = 'profile-entry';
    entry.innerHTML = `
        <input type="text" name="profileName" placeholder="Nombre del Perfil" required>
        <input type="number" name="profilePin" placeholder="PIN (4 dígitos)" required>
        <button type="button" class="button-danger remove-profile-btn">&times;</button>
    `;
    container.appendChild(entry);
    entry.querySelector('.remove-profile-btn').addEventListener('click', () => entry.remove());
}

function filterTable(searchTerm, tableId) {
    document.querySelectorAll(`#${tableId} tbody tr`).forEach(row => {
        const isVisible = row.textContent.toLowerCase().includes(searchTerm.toLowerCase());
        row.style.display = isVisible ? '' : 'none';
    });
}

function filterAssignmentTableByPayment(status) { // <-- NUEVO
    document.querySelectorAll('#assignments-table tbody tr').forEach(row => {
        if (status === 'todos') {
            row.style.display = '';
        } else {
            row.style.display = row.dataset.payment === status ? '' : 'none';
        }
    });
}

function filterAccountTableByAvailability(status) { // <-- NUEVO
    document.querySelectorAll('#accounts-table tbody tr').forEach(row => {
        if (status === 'todos') {
            row.style.display = '';
        } else {
            row.style.display = row.dataset.available === status ? '' : 'none';
        }
    });
}


// --- LÓGICA DEL PANEL DEL CLIENTE (CON MEJORAS) ---

function setupClientLoginForm() { // Renombrado de setupLoginForm
    const form = document.getElementById('login-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            window.location.href = `/dashboard.html?whatsapp=${document.getElementById('whatsapp').value}`;
        });
    }
}

async function loadDashboard() {
    const whatsapp = new URLSearchParams(window.location.search).get('whatsapp');
    const dashboardContainer = document.getElementById('dashboard-data');
    const welcomeHeader = document.getElementById('welcome-header');
    
    if (!whatsapp) { 
        dashboardContainer.innerHTML = '<p class="error-text">Número no proporcionado. Vuelve a iniciar sesión.</p>'; 
        return; 
    }

    try {
        // Cargar datos de acceso
        const res = await fetch(`/api/client/access/${whatsapp}`);
        if (!res.ok) throw new Error((await res.json()).message);
        const data = await res.json();
        
        welcomeHeader.innerHTML = `<h1 class="title">¡Hola, ${data.clientName}!</h1><p class="subtitle">Bienvenido a tu portal de acceso.</p>`;

        const daysLeft = Math.ceil((new Date(data.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
        const daysText = daysLeft > 1 ? `${daysLeft} días` : (daysLeft === 1 ? '1 día' : 'Hoy');

        dashboardContainer.innerHTML = `
            <div class="info-card">
                <span class="label">📧 Correo / Usuario</span>
                <div class="value-wrapper"><span id="copy-email">${data.usuario}</span><button class="copy-btn" data-copy="copy-email">📋</button></div>
            </div>
            <div class="info-card">
                <span class="label">🔒 Contraseña</span>
                <div class="value-wrapper"><span id="copy-password">${data.password}</span><button class="copy-btn" data-copy="copy-password">📋</button></div>
            </div>
            <div class="dashboard-grid">
                <div class="info-card">
                    <span class="label">👤 Perfil</span>
                    <span class="value">${data.perfil}</span>
                </div>
                <div class="info-card">
                    <span class="label">#️⃣ PIN</span>
                    <span class="value pin">${data.pin}</span>
                </div>
            </div>
            <div class="status-card ${daysLeft <= 3 ? 'expiring' : 'active'}">
                <span class="label">Estado de tu Acceso</span>
                <span class="value">Vence en ${daysText}</span>
                <small>(el ${data.vence})</small>
            </div>
        `;
        
        // Cargar historial del cliente
        loadClientHistory(whatsapp);

        // Funcionalidad de botones de copiar
        document.querySelectorAll('.copy-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const textToCopy = document.getElementById(e.target.dataset.copy).textContent;
                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalText = e.target.textContent;
                    e.target.textContent = '✅';
                    setTimeout(() => { e.target.textContent = originalText; }, 1500);
                });
            });
        });
    } catch(error) {
        dashboardContainer.innerHTML = `<p class="error-text"><b>Error:</b> ${error.message}</p>`;
    }
}

async function loadClientHistory(whatsapp) {
    const historyContainer = document.getElementById('client-history');
    try {
        const res = await fetch(`/api/client/history/${whatsapp}`);
        if (!res.ok) throw new Error('No se pudo cargar el historial.');
        const history = await res.json();

        if (history.length > 0) {
            let html = '<h3>Tu Historial de Asignaciones</h3><ul class="history-list">';
            history.forEach(item => {
                html += `<li>
                    <strong>${new Date(item.assignedDate).toLocaleDateString('es-PY')}</strong>
                    <span>Cuenta: ${item.serviceAccount.name}</span>
                    <span>Estado: ${item.paymentStatus}</span>
                </li>`;
            });
            html += '</ul>';
            historyContainer.innerHTML = html;
        }
    } catch (error) {
        historyContainer.innerHTML = `<p class="error-text" style="font-size: 0.9rem;">No se pudo cargar tu historial.</p>`;
    }
}