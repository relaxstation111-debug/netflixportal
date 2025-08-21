require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const CryptoJS = require('crypto-js'); // <-- NUEVO para encriptar contraseñas

// --- FUNCIONES DE ENCRIPTACIÓN (NUEVO) ---
const encrypt = (text) => {
    return CryptoJS.AES.encrypt(text, process.env.CRYPTO_SECRET_KEY).toString();
};

const decrypt = (ciphertext) => {
    const bytes = CryptoJS.AES.decrypt(ciphertext, process.env.CRYPTO_SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
};


// --- MODELOS DE DATOS (Schemas) ---
const ClientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    whatsapp: { type: String, required: true, unique: true },
    notes: { type: String, default: '' }
});
const Client = mongoose.model('Client', ClientSchema);

const ServiceAccountSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // <-- Se guardará encriptada
    profiles: [{ _id: false, name: String, pin: String }],
    status: { type: String, enum: ['Activa', 'Inactiva'], default: 'Activa' }
});
const ServiceAccount = mongoose.model('ServiceAccount', ServiceAccountSchema);

const AssignmentSchema = new mongoose.Schema({
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    serviceAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceAccount', required: true },
    profileName: { type: String, required: true },
    pin: { type: String, required: true },
    assignedDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: true },
    paymentStatus: { type: String, enum: ['Pagado', 'Pendiente'], default: 'Pendiente' } // <-- NUEVO para pagos
});
const Assignment = mongoose.model('Assignment', AssignmentSchema);


// --- CONFIGURACIÓN DE EXPRESS ---
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'un_secreto_muy_largo_y_dificil_de_adivinar',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- MIDDLEWARE DE AUTENTICACIÓN ---
const checkAuth = (req, res, next) => {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ message: 'Acceso no autorizado' });
    }
};

// --- CONEXIÓN A MONGODB ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ Conectado a MongoDB')).catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// --- FUNCIÓN UTILITARIA CLAVE ---
function normalizeWhatsApp(phone) {
    if (!phone) return '';
    let normalized = phone.toString().replace(/[^0-9]/g, '');
    if (normalized.startsWith('09')) {
        normalized = '595' + normalized.substring(1);
    } else if (normalized.startsWith('5950')) {
        normalized = '595' + normalized.substring(4);
    }
    return normalized;
}

// --- RUTAS DE AUTENTIFICACIÓN ---
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.status(200).json({ message: 'Login exitoso' });
    } else {
        res.status(401).json({ message: 'Contraseña incorrecta' });
    }
});
app.get('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.status(200).json({ message: 'Sesión cerrada' });
});


// --- RUTAS DE LA API (ADMIN) ---

// [ADMIN] Obtener todos los datos para el dashboard
app.get('/api/admin/data', checkAuth, async (req, res) => {
    try {
        const now = new Date();
        const fiveDaysFromNow = new Date();
        fiveDaysFromNow.setDate(now.getDate() + 5);

        const [clients, serviceAccounts, activeAssignments, expiredAssignments, expiringSoonAssignments] = await Promise.all([
            Client.find().sort({ name: 1 }),
            ServiceAccount.find().sort({ name: 1 }),
            Assignment.find({ expiryDate: { $gte: now } }).populate('client', 'name whatsapp').populate('serviceAccount', 'name'),
            Assignment.find({ expiryDate: { $lt: now } }).sort({expiryDate: -1}).limit(50).populate('client', 'name').populate('serviceAccount', 'name email'),
            Assignment.find({ expiryDate: { $gte: now, $lte: fiveDaysFromNow } }).populate('client', 'name whatsapp').populate('serviceAccount', 'name email').sort({ expiryDate: 1 })
        ]);
        res.json({ clients, serviceAccounts, activeAssignments, expiredAssignments, expiringSoonAssignments });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// [ADMIN] Rutas para CUENTAS DE SERVICIO (con encriptación)
app.post('/api/admin/accounts', checkAuth, async (req, res) => {
    try {
        const { name, email, password, profiles } = req.body;
        const newAccount = new ServiceAccount({ name, email, password: encrypt(password), profiles }); // <-- Encripta la contraseña
        await newAccount.save();
        res.status(201).json(newAccount);
    } catch (error) { res.status(400).json({ message: 'Error: Datos duplicados o inválidos.' }); }
});

app.put('/api/admin/accounts/:id', checkAuth, async (req, res) => {
    try {
        const { name, email, password, profiles } = req.body;
        const profilesArray = profiles.split(',').map(p => {
            const [profileName, pin] = p.split(':');
            return { name: profileName.trim(), pin: pin ? pin.trim() : '0000' };
        });
        
        // Comprueba si la contraseña enviada ya está encriptada o no
        let finalPassword = password;
        const oldAccount = await ServiceAccount.findById(req.params.id);
        if (oldAccount && decrypt(oldAccount.password) !== password) {
             finalPassword = encrypt(password); // Si la contraseña cambió, encriptarla
        } else {
            finalPassword = oldAccount.password; // Si no cambió, mantener la encriptada
        }

        const updatedAccount = await ServiceAccount.findByIdAndUpdate(req.params.id, { name, email, password: finalPassword, profiles: profilesArray }, { new: true });
        res.status(200).json(updatedAccount);
    } catch (error) { res.status(400).json({ message: error.message }); }
});

// [ADMIN] Para desencriptar una contraseña y mostrarla en el modal de edición
app.get('/api/admin/accounts/:id/password', checkAuth, async (req, res) => { // <-- NUEVA RUTA
    try {
        const account = await ServiceAccount.findById(req.params.id);
        if (!account) return res.status(404).json({ message: 'Cuenta no encontrada' });
        res.json({ password: decrypt(account.password) });
    } catch (error) { res.status(500).json({ message: 'Error al desencriptar' }); }
});


app.patch('/api/admin/accounts/:accountId/profiles', checkAuth, async (req, res) => {
    try {
        const { profileName, newPin } = req.body;
        const account = await ServiceAccount.findById(req.params.accountId);
        if (!account) return res.status(404).json({ message: 'Cuenta no encontrada.' });
        const profileToUpdate = account.profiles.find(p => p.name === profileName);
        if (!profileToUpdate) return res.status(404).json({ message: 'Perfil no encontrado.' });
        profileToUpdate.pin = newPin;
        await account.save();
        res.status(200).json({ message: 'PIN actualizado con éxito.' });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.delete('/api/admin/accounts/:id', checkAuth, async (req, res) => {
    try {
        await ServiceAccount.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Cuenta eliminada' });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/accounts/:id/status', checkAuth, async (req, res) => {
    try {
        const account = await ServiceAccount.findById(req.params.id);
        account.status = account.status === 'Activa' ? 'Inactiva' : 'Activa';
        await account.save();
        res.status(200).json(account);
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// [ADMIN] Rutas para CLIENTES (sin cambios mayores)
app.post('/api/admin/clients', checkAuth, async (req, res) => {
    try {
        const newClient = new Client({ name: req.body.name, whatsapp: normalizeWhatsApp(req.body.whatsapp) });
        await newClient.save();
        res.status(201).json(newClient);
    } catch (error) { res.status(400).json({ message: 'Error: Cliente ya existe o datos inválidos.' }); }
});

app.delete('/api/admin/clients/:id', checkAuth, async (req, res) => {
    try {
        await Client.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Cliente eliminado' });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.put('/api/admin/clients/:id', checkAuth, async (req, res) => {
    try {
        const { name, whatsapp, notes } = req.body;
        const updatedClient = await Client.findByIdAndUpdate(req.params.id, { name, whatsapp: normalizeWhatsApp(whatsapp), notes }, { new: true });
        res.status(200).json(updatedClient);
    } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/admin/clients/:id/history', checkAuth, async (req, res) => {
    try {
        const history = await Assignment.find({ client: req.params.id })
            .populate('serviceAccount', 'name')
            .sort({ expiryDate: -1 });
        res.json(history);
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// [ADMIN] Rutas para ASIGNACIONES (con mejoras)
app.post('/api/admin/assignments', checkAuth, async (req, res) => { // <-- RUTA MEJORADA
    try {
        const { clientName, clientWhatsapp, accountId, profileName, pin } = req.body;
        let clientId;

        // Buscar si el cliente ya existe por WhatsApp
        const normalizedNumber = normalizeWhatsApp(clientWhatsapp);
        let client = await Client.findOne({ whatsapp: normalizedNumber });

        // Si no existe, crearlo al vuelo
        if (!client) {
            if (!clientName) { // Validar que tengamos un nombre para el nuevo cliente
                return res.status(400).json({ message: 'El nombre es obligatorio para un cliente nuevo.' });
            }
            client = new Client({ name: clientName, whatsapp: normalizedNumber });
            await client.save();
        }
        clientId = client._id;

        // Comprobar asignación activa
        const existingAssignment = await Assignment.findOne({ client: clientId, expiryDate: { $gte: new Date() } });
        if (existingAssignment) {
            return res.status(400).json({ message: 'Este cliente ya tiene una asignación activa.' });
        }

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const newAssignment = new Assignment({
            client: clientId,
            serviceAccount: accountId,
            profileName,
            pin,
            expiryDate,
            paymentStatus: 'Pagado' // <-- Por defecto se marca como pagado
        });
        await newAssignment.save();
        res.status(201).json(newAssignment);
    } catch (error) { res.status(500).json({ message: error.message }); }
});


app.delete('/api/admin/assignments/:id', checkAuth, async (req, res) => {
    try {
        await Assignment.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'Asignación eliminada' });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/assignments/:id/renew', checkAuth, async (req, res) => {
    try {
        const assignment = await Assignment.findById(req.params.id);
        const newExpiryDate = new Date();
        newExpiryDate.setDate(newExpiryDate.getDate() + 30);
        assignment.expiryDate = newExpiryDate;
        assignment.paymentStatus = 'Pagado'; // <-- Marcar como pagado al renovar
        await assignment.save();
        res.status(200).json(assignment);
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// [ADMIN] Nueva ruta para cambiar estado de pago
app.patch('/api/admin/assignments/:id/payment', checkAuth, async (req, res) => { // <-- NUEVA RUTA
    try {
        const assignment = await Assignment.findById(req.params.id);
        assignment.paymentStatus = assignment.paymentStatus === 'Pagado' ? 'Pendiente' : 'Pagado';
        await assignment.save();
        res.status(200).json(assignment);
    } catch (error) { res.status(500).json({ message: error.message }); }
});


// --- RUTAS PÚBLICAS (CLIENTE) ---

app.get('/api/client/access/:whatsapp', async (req, res) => {
    try {
        const normalizedNumber = normalizeWhatsApp(req.params.whatsapp);
        const client = await Client.findOne({ whatsapp: normalizedNumber });
        if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });
        
        const assignment = await Assignment.findOne({ client: client._id, expiryDate: { $gte: new Date() } }).populate('serviceAccount', 'email password');
        if (!assignment) return res.status(404).json({ message: 'No tienes una asignación activa.' });
        
        res.json({
            clientName: client.name,
            usuario: assignment.serviceAccount.email,
            password: decrypt(assignment.serviceAccount.password), // <-- Desencripta la contraseña
            perfil: assignment.profileName,
            pin: assignment.pin,
            vence: new Date(assignment.expiryDate).toLocaleDateString('es-PY'),
            expiryDate: assignment.expiryDate
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// Nueva ruta para el historial del cliente
app.get('/api/client/history/:whatsapp', async (req, res) => { // <-- NUEVA RUTA
    try {
        const normalizedNumber = normalizeWhatsApp(req.params.whatsapp);
        const client = await Client.findOne({ whatsapp: normalizedNumber });
        if (!client) return res.status(404).json({ message: 'Cliente no encontrado.' });

        const history = await Assignment.find({ client: client._id })
            .populate('serviceAccount', 'name')
            .sort({ assignedDate: -1 })
            .limit(10);
        
        res.json(history);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el historial.' });
    }
});


// --- RUTAS PARA SERVIR ARCHIVOS HTML ---
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_login.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});