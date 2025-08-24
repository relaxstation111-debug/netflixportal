require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const CryptoJS = require('crypto-js');

// --- FUNCIONES DE ENCRIPTACIÓN ---
const encrypt = (text) => {
    if (!text) return '';
    return CryptoJS.AES.encrypt(text, process.env.CRYPTO_SECRET_KEY).toString();
};

const decrypt = (ciphertext) => {
    if (!ciphertext) return '';
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, process.env.CRYPTO_SECRET_KEY);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        return originalText;
    } catch (error) {
        console.error("Error al desencriptar:", error);
        return ''; // Retorna vacío si hay un error
    }
};

// --- MODELOS DE DATOS (Schemas) ---
const ClientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    whatsapp: { type: String, required: true, unique: true },
    notes: { type: String, default: '' }
}, { timestamps: true });
const Client = mongoose.model('Client', ClientSchema);

const ServiceAccountSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profiles: [{ _id: false, name: String, pin: String }],
    status: { type: String, enum: ['Activa', 'Inactiva'], default: 'Activa' }
}, { timestamps: true });
const ServiceAccount = mongoose.model('ServiceAccount', ServiceAccountSchema);

const AssignmentSchema = new mongoose.Schema({
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    serviceAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceAccount', required: true },
    profileName: { type: String, required: true },
    pin: { type: String, required: true },
    assignedDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: true },
    paymentStatus: { type: String, enum: ['Pagado', 'Pendiente'], default: 'Pendiente' }
}, { timestamps: true });
const Assignment = mongoose.model('Assignment', AssignmentSchema);


// --- CONFIGURACIÓN DE EXPRESS Y SESIONES ---
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'un_secreto_muy_largo_y_dificil_de_adivinar',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // true en producción (HTTPS)
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 días de sesión
    }
}));

// --- MIDDLEWARE DE AUTENTICACIÓN ---
const checkAuth = (req, res, next) => {
    if (req.session.isAdmin) {
        return next();
    }
    res.status(401).json({ message: 'Acceso no autorizado. Por favor, inicie sesión.' });
};

// --- CONEXIÓN A MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB'))
    .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

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

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ message: 'No se pudo cerrar la sesión.' });
        }
        res.clearCookie('connect.sid'); // Limpia la cookie de sesión
        res.status(200).json({ message: 'Sesión cerrada' });
    });
});

// Chequea si la sesión sigue activa
app.get('/api/admin/auth-check', (req, res) => {
    if (req.session.isAdmin) {
        res.status(200).json({ isAuthenticated: true });
    } else {
        res.status(401).json({ isAuthenticated: false });
    }
});


// --- RUTAS DE LA API (PROTEGIDAS) ---

// OBTENER TODOS LOS DATOS
app.get('/api/admin/data', checkAuth, async (req, res) => {
    try {
        const now = new Date();
        const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

        const [clients, serviceAccounts, activeAssignments, expiredAssignments, expiringSoonAssignments] = await Promise.all([
            Client.find().sort({ name: 1 }),
            ServiceAccount.find().sort({ name: 1 }),
            Assignment.find({ expiryDate: { $gte: now } }).populate('client', 'name whatsapp').populate('serviceAccount', 'name'),
            Assignment.find({ expiryDate: { $lt: now } }).sort({expiryDate: -1}).limit(50).populate('client', 'name').populate('serviceAccount', 'name email'),
            Assignment.find({ expiryDate: { $gte: now, $lte: fiveDaysFromNow } }).populate('client', 'name whatsapp').populate('serviceAccount', 'name email').sort({ expiryDate: 1 })
        ]);
        res.json({ clients, serviceAccounts, activeAssignments, expiredAssignments, expiringSoonAssignments });
    } catch (error) { res.status(500).json({ message: 'Error en el servidor: ' + error.message }); }
});

// CUENTAS DE SERVICIO
app.post('/api/admin/accounts', checkAuth, async (req, res) => {
    try {
        const { name, email, password, profiles } = req.body;
        const newAccount = new ServiceAccount({ name, email, password: encrypt(password), profiles });
        await newAccount.save();
        res.status(201).json(newAccount);
    } catch (error) { res.status(400).json({ message: 'Error: Datos duplicados o inválidos.' }); }
});

app.put('/api/admin/accounts/:id', checkAuth, async (req, res) => {
    try {
        const { name, email, password, profiles } = req.body;
        
        // El formato de perfiles ahora es un array de objetos, no es necesario convertir
        const accountData = { name, email, profiles };

        // Solo encriptar la contraseña si ha cambiado
        const oldAccount = await ServiceAccount.findById(req.params.id);
        if (password !== decrypt(oldAccount.password)) {
             accountData.password = encrypt(password);
        }

        const updatedAccount = await ServiceAccount.findByIdAndUpdate(req.params.id, accountData, { new: true });
        res.status(200).json(updatedAccount);
    } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/api/admin/accounts/:id/password', checkAuth, async (req, res) => {
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

// CORREGIDO: Borrado en cascada de asignaciones
app.delete('/api/admin/accounts/:id', checkAuth, async (req, res) => {
    try {
        const accountId = req.params.id;
        // Primero, eliminar todas las asignaciones asociadas a esta cuenta
        await Assignment.deleteMany({ serviceAccount: accountId });
        // Luego, eliminar la cuenta
        await ServiceAccount.findByIdAndDelete(accountId);
        res.status(200).json({ message: 'Cuenta y sus asignaciones eliminadas' });
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

// CLIENTES
app.post('/api/admin/clients', checkAuth, async (req, res) => {
    try {
        const newClient = new Client({ name: req.body.name, whatsapp: normalizeWhatsApp(req.body.whatsapp) });
        await newClient.save();
        res.status(201).json(newClient);
    } catch (error) { res.status(400).json({ message: 'Error: Cliente ya existe o datos inválidos.' }); }
});

app.get('/api/admin/clients/search', checkAuth, async (req, res) => {
    try {
        const searchTerm = req.query.term;
        if (!searchTerm || searchTerm.length < 2) {
            return res.json([]);
        }
        const clients = await Client.find({
            $or: [
                { name: { $regex: searchTerm, $options: 'i' } },
                { whatsapp: { $regex: searchTerm, $options: 'i' } }
            ]
        }).limit(5);
        res.json(clients);
    } catch (error) { res.status(500).json({ message: 'Error al buscar clientes.' }); }
});

// CORREGIDO: Borrado en cascada de asignaciones
app.delete('/api/admin/clients/:id', checkAuth, async (req, res) => {
    try {
        const clientId = req.params.id;
        // Primero, eliminar todas las asignaciones de este cliente
        await Assignment.deleteMany({ client: clientId });
        // Luego, eliminar al cliente
        await Client.findByIdAndDelete(clientId);
        res.status(200).json({ message: 'Cliente y su historial de asignaciones eliminados' });
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

// ASIGNACIONES
app.post('/api/admin/assignments', checkAuth, async (req, res) => {
    try {
        const { clientName, clientWhatsapp, accountId, profileName, pin } = req.body;
        const normalizedNumber = normalizeWhatsApp(clientWhatsapp);

        // Buscar o crear cliente
        let client = await Client.findOneAndUpdate(
            { whatsapp: normalizedNumber },
            { $setOnInsert: { name: clientName, whatsapp: normalizedNumber } },
            { upsert: true, new: true, runValidators: true }
        );

        // Verificar si el cliente ya tiene una asignación activa
        const existingAssignment = await Assignment.findOne({ client: client._id, expiryDate: { $gte: new Date() } });
        if (existingAssignment) {
            return res.status(400).json({ message: 'Este cliente ya tiene una asignación activa.' });
        }

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        const newAssignment = new Assignment({
            client: client._id, serviceAccount: accountId, profileName, pin, expiryDate,
            paymentStatus: 'Pagado' // Por defecto al crear una nueva es 'Pagado'
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
        assignment.paymentStatus = 'Pagado';
        await assignment.save();
        res.status(200).json(assignment);
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/assignments/:id/payment', checkAuth, async (req, res) => {
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
        if (!assignment) return res.status(404).json({ message: 'No tienes una asignación activa en este momento.' });
        
        res.json({
            clientName: client.name,
            usuario: assignment.serviceAccount.email,
            password: decrypt(assignment.serviceAccount.password),
            perfil: assignment.profileName,
            pin: assignment.pin,
            vence: new Date(assignment.expiryDate).toLocaleDateString('es-PY'),
            expiryDate: assignment.expiryDate
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/client/history/:whatsapp', async (req, res) => {
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
// Redirige al panel si ya hay sesión, si no, al login.
app.get('/admin', (req, res) => {
    if (req.session.isAdmin) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'admin_login.html'));
    }
});

// Sirve el index.html en la raíz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});