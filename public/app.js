// --- ESTRUCTURA PRINCIPAL ---
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path.includes('admin.html')) {
        document.body.classList.add('admin-body');
        setupGlobalAdminListeners();
        loadAdminData();
    } else if (path.includes('admin_login.html')) {
        setupAdminLoginForm();
    } else if (path.includes('dashboard.html')) {
        loadDashboard();
    } else if (path.includes('login.html')) {
        setupClientLoginForm();
    }
});

// Variable global para almacenar los datos del admin
let adminData = {};

// --- LÓGICA DE LOGIN Y AUTENTICACIÓN ---

function setupAdminLoginForm() {
    const form = document.getElementById('admin-login-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('admin-password').value;
        const errorMessage = document.getElementById('error-message');
        
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || 'Contraseña incorrecta.');
            }
            window.location.href = '/admin.html';
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.style.display = 'block';
        }
    });
}

async function checkAdminAuth() {
    try {
        const res = await fetch('/api/admin/data');
        if (res.status === 401) {
            window.location.href = '/admin_login.html';
            return null;
        }
        if (!res.ok) throw new Error('No se pudieron cargar los datos del administrador.');
        return await res.json();
    } catch (error) {
        console.error("Error de autenticación:", error);
        window.location.href = '/admin_login.html';
        return null;
    }
}

async function logoutAdmin() {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin_login.html';
}

// --- LÓGICA DEL PANEL DE ADMINISTRADOR ---

async function loadAdminData() {
    const data = await checkAdminAuth();
    if (!data) return;
    
    adminData = data;

    renderDashboardStats(adminData);
    renderAllTables(adminData);
    renderExpiringSoon(adminData);
    renderExpiredAndUnrenewed(adminData);
    populateAssignmentForm(adminData);
}

function setupGlobalAdminListeners() {
    // Navegación
    document.querySelectorAll('.nav-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.nav-button.active')?.classList.remove('active');
            button.classList.add('active');
            document.querySelector('.tab-content.active')?.classList.remove('active');
            const targetTab = document.getElementById(button.dataset.target);
            if(targetTab) targetTab.classList.add('active');
            document.getElementById('page-title').textContent = button.dataset.title;
        });
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', logoutAdmin);

    // Formularios
    document.getElementById('add-account-form')?.addEventListener('submit', handleFormSubmit);
    document.getElementById('add-client-form')?.addEventListener('submit', handleFormSubmit);
    document.getElementById('assignment-form')?.addEventListener('submit', handleFormSubmit);
    document.getElementById('add-profile-btn')?.addEventListener('click', addProfileInput);

    // Clicks en todo el body para acciones (delegación de eventos)
    document.body.addEventListener('click', handleActionClick);
    
    // Filtros
    ['assignments', 'accounts', 'clients'].forEach(type => {
        const searchInput = document.getElementById(`search-${type}`);
        if(searchInput) searchInput.addEventListener('input', (e) => filterTable(e.target.value, `${type}-table`));
    });
    document.getElementById('filter-assignments')?.addEventListener('change', (e) => filterAssignmentTableByPayment(e.target.value));
    document.getElementById('filter-accounts')?.addEventListener('change', (e) => filterAccountTableByAvailability(e.target.value));

    // Buscador de clientes en formulario de asignación
    setupClientSearch();
}

// --- RENDERIZADO DE COMPONENTES ---
function renderDashboardStats({ clients = [], serviceAccounts = [], activeAssignments = [] }) {
    const totalProfiles = serviceAccounts.reduce((sum, acc) => sum + (acc.profiles?.length || 0), 0);
    const availableProfiles = totalProfiles - activeAssignments.length;
    const container = document.getElementById('stats-container');
    if(container) {
        container.innerHTML = `
            <div class="stat-card"><h3>${clients.length}</h3><p>Clientes</p></div>
            <div class="stat-card"><h3>${activeAssignments.length}</h3><p>Asignados</p></div>
            <div class="stat-card"><h3>${availableProfiles}</h3><p>Libres</p></div>
            <div class="stat-card"><h3>${serviceAccounts.length}</h3><p>Cuentas</p></div>
        `;
    }
}

function renderAllTables({ clients = [], serviceAccounts = [], activeAssignments = [] }) {
    // Tabla de Cuentas
    const accountsTable = document.getElementById('accounts-table');
    if (accountsTable) {
        accountsTable.innerHTML = serviceAccounts.map(acc => {
            const assignedCount = activeAssignments.filter(a => a.serviceAccount?._id === acc._id).length;
            const totalProfiles = acc.profiles?.length || 0;
            const available = totalProfiles - assignedCount;
            return `
            <div class="card" data-available="${available > 0 ? 'yes' : 'no'}">
                <div class="card-header">
                    <div class="card-title"><span class="status-dot ${acc.status.toLowerCase()}"></span> ${acc.name}</div>
                    <div class="card-pills"><span>${available} de ${totalProfiles} Libres</span></div>
                </div>
                <div class="card-body"><p><strong>Email:</strong> ${acc.email}</p></div>
                <div class="card-actions">
                    <button class="button button-secondary edit-account" data-id="${acc._id}">Editar</button>
                    <button class="button button-secondary toggle-status" data-id="${acc._id}">Estado</button>
                    <button class="button button-danger delete-account" data-id="${acc._id}">Eliminar</button>
                </div>
            </div>`;
        }).join('');
    }

    // Tabla de Clientes
    const clientsTable = document.getElementById('clients-table');
    if (clientsTable) {
        clientsTable.innerHTML = clients.map(c => `
            <div class="card">
                <div class="card-header"><div class="card-title">${c.name}</div></div>
                <div class="card-body">
                    <p><strong>WhatsApp:</strong> ${c.whatsapp}</p>
                    <p><strong>Notas:</strong> ${c.notes ? c.notes.substring(0, 40) + '...' : 'Sin notas'}</p>
                </div>
                <div class="card-actions">
                    <button class="button button-secondary edit-client" data-id="${c._id}">Editar</button>
                    <button class="button button-secondary view-history" data-id="${c._id}">Historial</button>
                    <button class="button button-danger delete-client" data-id="${c._id}">Eliminar</button>
                </div>
            </div>`).join('');
    }
    
    // Tabla de Asignaciones
    const assignmentsTable = document.getElementById('assignments-table');
    if (assignmentsTable) {
        assignmentsTable.innerHTML = activeAssignments.map(a => {
            const paymentStatusClass = a.paymentStatus === 'Pagado' ? 'paid' : 'pending';
            return `
            <div class="card" data-payment="${a.paymentStatus.toLowerCase()}">
                <div class="card-header">
                    <div class="card-title">${a.client?.name ||'Cliente no encontrado'}</div>
                    <div class="card-pills"><span class="payment-status ${paymentStatusClass}">${a.paymentStatus}</span></div>
                </div>
                <div class="card-body">
                    <p><strong>Cuenta:</strong> ${a.serviceAccount?.name || 'Cuenta no encontrada'} - ${a.profileName}</p>
                    <p><strong>Vence:</strong> ${new Date(a.expiryDate).toLocaleDateString('es-PY')}</p>
                </div>
                <div class="card-actions">
                    <button class="button button-success renew-assignment" data-id="${a._id}">Renovar</button>
                    <button class="button button-secondary toggle-payment" data-id="${a._id}">Pago</button>
                    <button class="button button-danger delete-assignment" data-id="${a._id}">Eliminar</button>
                </div>
            </div>`;
        }).join('');
    }
}

function renderExpiringSoon({ expiringSoonAssignments = [] }) {
    const list = document.getElementById('expiring-soon-list');
    if (!list) return;
    if (expiringSoonAssignments.length === 0) {
        list.innerHTML = '<p class="empty-list">No hay vencimientos próximos.</p>';
        return;
    }
    list.innerHTML = expiringSoonAssignments.map(a => {
        const daysLeft = Math.ceil((new Date(a.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
        const message = encodeURIComponent(`Hola ${a.client.name}, te recordamos que tu acceso a la cuenta ${a.serviceAccount.name} vence en ${daysLeft} día(s). ¿Deseas renovar?`);
        const whatsappLink = `https://wa.me/${a.client.whatsapp}?text=${message}`;
        return `
        <div class="list-item">
            <div class="item-info"><strong>${a.client.name}</strong><span>Vence en <strong>${daysLeft} día(s)</strong></span></div>
            <a href="${whatsappLink}" target="_blank" class="button button-whatsapp">Contactar</a>
        </div>`;
    }).join('');
}

function renderExpiredAndUnrenewed({ expiredAssignments = [] }) {
    const list = document.getElementById('expired-unrenewed-list');
    if (!list) return;
    if (expiredAssignments.length === 0) {
        list.innerHTML = '<p class="empty-list">No hay perfiles expirados pendientes de liberar.</p>';
        return;
    }
    list.innerHTML = expiredAssignments.map(a => `
        <div class="list-item">
            <div class="item-info"><strong>${a.client.name}</strong><span>Expiró el ${new Date(a.expiryDate).toLocaleDateString('es-PY')}</span></div>
            <button class="button button-danger change-pin" data-account-id="${a.serviceAccount._id}" data-profile-name="${a.profileName}" data-assignment-id="${a._id}">Liberar</button>
        </div>`).join('');
}

function populateAssignmentForm({ serviceAccounts = [], activeAssignments = [] }) {
    const accountSelect = document.getElementById('account-select');
    if (!accountSelect) return;

    const activeAccounts = serviceAccounts.filter(a => a.status === 'Activa');
    accountSelect.innerHTML = '<option value="">-- Selecciona Cuenta --</option>' + activeAccounts.map(a => `<option value="${a._id}">${a.name}</option>`).join('');
    
    accountSelect.onchange = () => {
        const profileSelect = document.getElementById('profile-select');
        const pinInput = document.getElementById('pin-input');
        const selectedAccount = serviceAccounts.find(a => a._id === accountSelect.value);
        
        profileSelect.innerHTML = '<option value="">-- Selecciona Perfil --</option>';
        pinInput.value = '';
        if (selectedAccount) {
            const assignedProfiles = activeAssignments
                .filter(a => a.serviceAccount?._id === selectedAccount._id)
                .map(a => a.profileName);
                
            selectedAccount.profiles.forEach(p => {
                const isAssigned = assignedProfiles.includes(p.name);
                profileSelect.innerHTML += `<option value="${p.name}" data-pin="${p.pin}" ${isAssigned ? 'disabled' : ''}>${p.name} ${isAssigned ? '(Ocupado)' : ''}</option>`;
            });
        }
    };
    
    const profileSelect = document.getElementById('profile-select');
    if(profileSelect) {
        profileSelect.onchange = (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            document.getElementById('pin-input').value = selectedOption.dataset.pin || '';
        };
    }
}

// --- MANEJO DE EVENTOS Y FORMULARIOS ---

async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formId = form.id;
    let endpoint = '', body = {}, successMessage = '', method = 'POST';

    try {
        if (formId === 'add-account-form') {
            endpoint = '/api/admin/accounts';
            const profiles = Array.from(form.querySelectorAll('.profile-entry')).map(node => ({ 
                name: node.querySelector('input[name="profileName"]').value, 
                pin: node.querySelector('input[name="profilePin"]').value 
            }));
            body = { 
                name: form.elements['name'].value, 
                email: form.elements['email'].value, 
                password: form.elements['password'].value, 
                profiles 
            };
            successMessage = 'Cuenta agregada correctamente.';
        } else if (formId === 'add-client-form') {
            endpoint = '/api/admin/clients';
            body = { name: form.elements['name'].value, whatsapp: form.elements['whatsapp'].value };
            successMessage = 'Cliente agregado correctamente.';
        } else if (formId === 'assignment-form') {
            endpoint = '/api/admin/assignments';
            body = { 
                clientName: form.elements['client-name'].value || form.elements['client-search-input'].value,
                clientWhatsapp: form.elements['client-whatsapp'].value || form.elements['client-search-input'].value,
                accountId: form.elements['account-select'].value,
                profileName: form.elements['profile-select'].value,
                pin: form.elements['pin-input'].value
            };
            successMessage = 'Asignación creada correctamente.';
        }

        const res = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Ocurrió un error.');
        }

        openModal('Éxito', `<p>${successMessage}</p>`);
        form.reset();
        if (formId === 'add-account-form') document.getElementById('profiles-container').innerHTML = '';
        if (formId === 'assignment-form') {
            document.getElementById('client-name').value = '';
            document.getElementById('client-whatsapp').value = '';
        }
        loadAdminData(); // Recargar todos los datos
    } catch (error) {
        openModal('Error', `<p>${error.message}</p>`);
    }
}

// 👇 LA LÓGICA CORREGIDA ESTÁ AQUÍ 👇
function handleActionClick(e) {
    const button = e.target.closest('button');
    if (!button) return;

    const id = button.dataset.id;

    // Identificar la acción por su clase única
    if (button.matches('.edit-client')) {
        openEditClientModal(id);
    } else if (button.matches('.delete-client')) {
        openModal('Confirmar Eliminación', `<p>¿Seguro que quieres eliminar este cliente? Se borrará también todo su historial de asignaciones de forma permanente.</p>`,
            `<button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="confirm-delete" data-endpoint="/api/admin/clients/${id}">Eliminar</button>`);
    } else if (button.matches('.view-history')) {
        viewClientHistory(id);
    } else if (button.matches('.edit-account')) {
        openEditAccountModal(id);
    } else if (button.matches('.delete-account')) {
        openModal('Confirmar Eliminación', `<p>¿Seguro que quieres eliminar esta cuenta? Todas sus asignaciones asociadas serán eliminadas permanentemente.</p>`,
            `<button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="confirm-delete" data-endpoint="/api/admin/accounts/${id}">Eliminar</button>`);
    } else if (button.matches('.toggle-status')) {
        performAction('PATCH', `/api/admin/accounts/${id}/status`, 'Estado de la cuenta cambiado.');
    } else if (button.matches('.delete-assignment')) {
        openModal('Confirmar Eliminación', `<p>¿Seguro que quieres eliminar esta asignación?</p>`,
            `<button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="confirm-delete" data-endpoint="/api/admin/assignments/${id}">Eliminar</button>`);
    } else if (button.matches('.renew-assignment')) {
        performAction('PATCH', `/api/admin/assignments/${id}/renew`, 'Asignación renovada por 30 días.');
    } else if (button.matches('.toggle-payment')) {
        performAction('PATCH', `/api/admin/assignments/${id}/payment`, 'Estado de pago cambiado.');
    } else if (button.matches('.change-pin')) {
        openChangePinModal(button.dataset.accountId, button.dataset.profileName, button.dataset.assignmentId);
    }
    
    // Acciones dentro del modal
    else if (button.dataset.action === 'close-modal') {
        closeModal();
    } else if (button.dataset.action === 'save-client-edit') {
        saveClientEdit(id);
    } else if (button.dataset.action === 'save-account-edit') {
        saveAccountEdit(id);
    } else if (button.dataset.action === 'save-new-pin') {
        saveNewPin(button.dataset.accountId, button.dataset.profileName, button.dataset.assignmentId);
    } else if (button.dataset.action === 'confirm-delete') {
        performAction('DELETE', button.dataset.endpoint, 'Elemento eliminado correctamente.');
    }
}

async function performAction(method, endpoint, successMessage, { body = null } = {}) {
    try {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);

        const res = await fetch(endpoint, options);
        
        if (res.status === 401) return window.location.href = '/admin_login.html';
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'La operación falló.');
        }
        
        closeModal();
        if(successMessage) openModal('Éxito', `<p>${successMessage}</p>`);
        await loadAdminData();
    } catch (error) { 
        openModal('Error', `<p>${error.message}</p>`); 
    }
}

// --- LÓGICA DE MODALES ---
function openModal(title, body, footer = '<button class="button button-secondary" data-action="close-modal">Cerrar</button>') {
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-footer').innerHTML = footer;
    document.getElementById('modal-backdrop').classList.add('visible');
}

function closeModal() { 
    document.getElementById('modal-backdrop').classList.remove('visible'); 
}

function openEditClientModal(id) {
    const client = adminData.clients.find(c => c._id === id);
    if (!client) return;
    const body = `
    <form id="edit-client-form" class="modal-form">
        <label>Nombre</label><input type="text" id="edit-client-name" value="${client.name}" required>
        <label>WhatsApp</label><input type="text" id="edit-client-whatsapp" value="${client.whatsapp}" required>
        <label>Notas Internas</label><textarea id="edit-client-notes">${client.notes || ''}</textarea>
    </form>`;
    const footer = `
    <button class="button button-secondary" data-action="close-modal">Cancelar</button>
    <button class="button" data-action="save-client-edit" data-id="${id}">Guardar Cambios</button>`;
    openModal(`Editar Cliente: ${client.name}`, body, footer);
}

async function saveClientEdit(id) { 
    const body = { 
        name: document.getElementById('edit-client-name').value, 
        whatsapp: document.getElementById('edit-client-whatsapp').value, 
        notes: document.getElementById('edit-client-notes').value 
    }; 
    await performAction('PUT', `/api/admin/clients/${id}`, 'Cliente actualizado.', { body }); 
}

async function openEditAccountModal(id) {
    const account = adminData.serviceAccounts.find(a => a._id === id);
    if (!account) return;

    const passRes = await fetch(`/api/admin/accounts/${id}/password`); 
    const { password } = await passRes.json();
    
    const profilesText = account.profiles.map(p => `${p.name}:${p.pin}`).join('\n');
    
    const body = `
    <form id="edit-account-form" class="modal-form">
        <label>Nombre</label><input type="text" id="edit-account-name" value="${account.name}" required>
        <label>Email</label><input type="email" id="edit-account-email" value="${account.email}" required>
        <label>Contraseña</label><input type="text" id="edit-account-password" value="${password}" required>
        <label>Perfiles (formato: Nombre:PIN, uno por línea)</label>
        <textarea id="edit-account-profiles" rows="4">${profilesText}</textarea>
    </form>`;
    const footer = `
    <button class="button button-secondary" data-action="close-modal">Cancelar</button>
    <button class="button" data-action="save-account-edit" data-id="${id}">Guardar Cambios</button>`;
    openModal(`Editar Cuenta: ${account.name}`, body, footer);
}

async function saveAccountEdit(id) { 
    const profilesArray = document.getElementById('edit-account-profiles').value.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            const [name, pin] = line.split(':');
            return { name: name.trim(), pin: pin ? pin.trim() : '0000' };
        });

    const body = { 
        name: document.getElementById('edit-account-name').value, 
        email: document.getElementById('edit-account-email').value, 
        password: document.getElementById('edit-account-password').value, 
        profiles: profilesArray 
    }; 
    await performAction('PUT', `/api/admin/accounts/${id}`, 'Cuenta actualizada.', { body }); 
}

async function viewClientHistory(id) {
    try {
        const res = await fetch(`/api/admin/clients/${id}/history`);
        if (!res.ok) throw new Error('No se pudo cargar el historial.');
        const history = await res.json();
        
        if (history.length === 0) {
            return openModal('Historial de Asignaciones', '<p>Este cliente no tiene asignaciones previas.</p>');
        }

        let body = '<ul class="history-list" style="list-style: none; padding: 0;">';
        history.forEach(h => {
            const status = new Date(h.expiryDate) < new Date() ? 'Expirada' : 'Activa';
            body += `<li style="background: #1F1F1F; padding: 10px; border-radius: 8px; margin-bottom: 5px;"><strong>${h.serviceAccount.name} / ${h.profileName}</strong><br><span>Venció el ${new Date(h.expiryDate).toLocaleDateString('es-PY')} (${status})</span> | <span>Pago: ${h.paymentStatus}</span></li>`;
        });
        body += '</ul>';
        openModal('Historial de Asignaciones', body);
    } catch (error) { 
        openModal('Error', `<p>${error.message}</p>`); 
    }
}

function openChangePinModal(accountId, profileName, assignmentId) {
    const body = `
    <p>Actualiza el PIN en Netflix y guárdalo aquí para liberar el perfil para un nuevo cliente.</p>
    <a href="https://netflix.com" class="button button-secondary" target="_blank" style="margin-bottom: 20px; display: block;">Abrir Netflix.com</a>
    <div class="modal-form">
        <label>Nuevo PIN para el perfil <strong>${profileName}</strong></label>
        <div class="pin-generator" style="display: flex; gap: 10px;">
            <input type="number" id="new-pin-input" placeholder="Introduce el nuevo PIN" style="flex-grow: 1;">
            <button class="button button-secondary" id="generate-pin-btn">Generar</button>
        </div>
    </div>`;
    const footer = `
    <button class="button button-secondary" data-action="close-modal">Cancelar</button>
    <button class="button" data-action="save-new-pin" data-account-id="${accountId}" data-profile-name="${profileName}" data-assignment-id="${assignmentId}">Guardar y Liberar</button>`;
    openModal('Acción Requerida: Cambiar PIN', body, footer);
    
    document.getElementById('generate-pin-btn').onclick = (e) => {
        const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
        document.getElementById('new-pin-input').value = randomPin;
    };
}

async function saveNewPin(accountId, profileName, assignmentId) {
    const newPin = document.getElementById('new-pin-input').value;
    if (!newPin || newPin.length !== 4) { 
        return openModal('Error', '<p>Introduce un PIN válido de 4 dígitos.</p>'); 
    }
    await performAction('PATCH', `/api/admin/accounts/${accountId}/profiles`, null, { body: { profileName, newPin } });
    await performAction('DELETE', `/api/admin/assignments/${assignmentId}`, 'PIN actualizado y perfil liberado.');
}

// --- FUNCIONES AUXILIARES ---
function addProfileInput() {
    const container = document.getElementById('profiles-container');
    const entry = document.createElement('div');
    entry.className = 'profile-entry';
    entry.style.display = 'flex';
    entry.style.gap = '10px';
    entry.innerHTML = `
        <input type="text" name="profileName" placeholder="Nombre del Perfil" required style="flex-grow: 1;">
        <input type="number" name="profilePin" placeholder="PIN (4 dígitos)" required style="width: 120px;">
        <button type="button" class="button button-danger remove-profile-btn">&times;</button>`;
    container.appendChild(entry);
    entry.querySelector('.remove-profile-btn').addEventListener('click', () => entry.remove());
}

function filterTable(searchTerm, tableId) {
    document.querySelectorAll(`#${tableId} .card`).forEach(card => {
        const isVisible = card.textContent.toLowerCase().includes(searchTerm.toLowerCase());
        card.style.display = isVisible ? '' : 'none';
    });
}

function filterAssignmentTableByPayment(status) {
    document.querySelectorAll('#assignments-table .card').forEach(card => {
        card.style.display = (status === 'todos' || card.dataset.payment === status) ? '' : 'none';
    });
}

function filterAccountTableByAvailability(status) {
    document.querySelectorAll('#accounts-table .card').forEach(card => {
        card.style.display = (status === 'todos' || card.dataset.available === status) ? '' : 'none';
    });
}

function setupClientSearch() {
    const clientSearchInput = document.getElementById('client-search-input');
    const clientSearchResults = document.getElementById('client-search-results');
    if (!clientSearchInput) return;

    clientSearchInput.addEventListener('input', async () => {
        const searchTerm = clientSearchInput.value;
        document.getElementById('client-name').value = '';
        document.getElementById('client-whatsapp').value = '';

        if (searchTerm.length < 2) {
            clientSearchResults.style.display = 'none';
            return;
        }

        const res = await fetch(`/api/admin/clients/search?term=${searchTerm}`);
        const clients = await res.json();
        
        clientSearchResults.innerHTML = '';
        if (clients.length > 0) {
            clients.forEach(client => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                item.textContent = `${client.name} (${client.whatsapp})`;
                item.onclick = () => {
                    clientSearchInput.value = `${client.name} (${client.whatsapp})`;
                    document.getElementById('client-name').value = client.name;
                    document.getElementById('client-whatsapp').value = client.whatsapp;
                    clientSearchResults.style.display = 'none';
                };
                clientSearchResults.appendChild(item);
            });
            clientSearchResults.style.display = 'block';
        } else {
            clientSearchResults.style.display = 'none';
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-select-container')) {
            clientSearchResults.style.display = 'none';
        }
    });
}


// --- LÓGICA DEL PANEL DEL CLIENTE ---
function setupClientLoginForm() {
    const form = document.getElementById('login-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const whatsapp = document.getElementById('whatsapp').value;
            window.location.href = `/dashboard.html?whatsapp=${encodeURIComponent(whatsapp)}`;
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
        const res = await fetch(`/api/client/access/${encodeURIComponent(whatsapp)}`);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message);
        }
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
                <div class="info-card"><span class="label">👤 Perfil</span><span class="value">${data.perfil}</span></div>
                <div class="info-card"><span class="label">#️⃣ PIN</span><span class="value pin">${data.pin}</span></div>
            </div>
            <div class="status-card ${daysLeft <= 3 ? 'expiring' : 'active'}">
                <span class="label">Estado de tu Acceso</span>
                <span class="value">Vence en ${daysText}</span>
                <small>(el ${data.vence})</small>
            </div>`;
        
        loadClientHistory(whatsapp);
        
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
        dashboardContainer.innerHTML = `<p class="error-text" style="font-size: 1.2rem;"><b>Error:</b> ${error.message}</p>`; 
    }
}

async function loadClientHistory(whatsapp) {
    const historyContainer = document.getElementById('client-history');
    try {
        const res = await fetch(`/api/client/history/${encodeURIComponent(whatsapp)}`);
        if (!res.ok) throw new Error();
        const history = await res.json();

        if (history.length > 1) {
            let html = '<h3 style="margin-top: 2rem; margin-bottom: 1rem;">Tu Historial de Asignaciones</h3><ul class="history-list" style="list-style: none; padding: 0;">';
            history.forEach(item => {
                html += `<li style="background: #1F1F1F; padding: 10px; border-radius: 8px; margin-bottom: 5px;"><strong>${new Date(item.assignedDate).toLocaleDateString('es-PY')}</strong><span> - Cuenta: ${item.serviceAccount.name}</span><span> - Estado: ${item.paymentStatus}</span></li>`;
            });
            html += '</ul>';
            historyContainer.innerHTML = html;
        }
    } catch (error) { 
        console.error("No se pudo cargar el historial del cliente.");
    }
}