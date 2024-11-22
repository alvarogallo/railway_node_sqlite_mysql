const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db');
require('dotenv').config();
const session = require('express-session');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/authMiddleware');



const app = express();
app.use(cors());
app.use(express.json());

// app.get('/admin/set-password', (req, res) => {
//   res.sendFile(path.join(__dirname, '../public', 'set-password.html'));
// });

// app.post('/admin/set-password', async (req, res) => {
//   try {
//     const { email, password } = req.body;
    
//     // Verificar que se proporcionaron email y password
//     if (!email || !password) {
//       return res.status(400).json({ error: 'Email y password son requeridos' });
//     }

//     // Verificar que el usuario existe
//     const [existingUser] = await db.query(
//       'SELECT * FROM users WHERE email = ?', 
//       [email]
//     );

//     if (!existingUser) {
//       return res.status(404).json({ error: 'Usuario no encontrado' });
//     }

//     // Generar hash de la contraseña
//     const salt = await bcrypt.genSalt(10);
//     const hashedPassword = await bcrypt.hash(password, salt);

//     // Actualizar la contraseña del usuario
//     await db.query(
//       'UPDATE users SET password = ? WHERE email = ?',
//       [hashedPassword, email]
//     );

//     res.json({ mensaje: 'Contraseña actualizada exitosamente' });

//   } catch (error) {
//     console.error('Error al actualizar contraseña:', error);
//     res.status(500).json({ error: 'Error interno del servidor' });
//   }
// });

// Ruta de diagnóstico
app.get('/admin/diagnostico', async (req, res) => {
  try {
    // Verificar sesión actual
    const sessionInfo = req.session ? {
      hasSession: true,
      adminSession: req.session.admin || null
    } : {
      hasSession: false,
      adminSession: null
    };

    // Verificar configuración de la base de datos
    const dbConfig = {
      host: db.CUAL_DATABASE,
      hasPassword: !!process.env.DB_PASSWORD
    };

    res.json({
      sessionInfo,
      dbConfig,
      nodeEnv: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/check-user', async (req, res) => {
  try {
    const [user] = await db.query(
      'SELECT id, email, role, password FROM users WHERE email = ?', 
      ['alvarogallo@hotmail.com'] // Reemplaza con tu email
    );

    if (!user) {
      return res.json({ error: 'Usuario no encontrado' });
    }

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      hasPassword: !!user.password
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
let listeners = [];
let senders = [];
const activeChannels = new Map();


// app.use(session({
//   secret: process.env.SESSION_SECRET || 'secret-key',
//   resave: false,
//   saveUninitialized: false,
//   cookie: { secure: process.env.NODE_ENV === 'production' }
// }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'tu-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Rutas de administración
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'admin-login.html'));
});

// Modificar en server.js
// Modificar en server.js
app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  
  console.log('Intento de login:', { email });
  
  try {
    // Buscar usuario
    const [user] = await db.query(
      'SELECT * FROM users WHERE email = ?', 
      [email]
    );
    
    console.log('Usuario encontrado:', !!user);
    
    if (!user) {
      return res.status(401).json({ 
        error: 'Credenciales inválidas',
        debug: { step: 'user_check' }
      });
    }

    // Verificar rol
    console.log('Rol del usuario:', user.role);
    if (user.role !== 'ADMIN') {
      return res.status(401).json({ 
        error: 'No tienes permisos de administrador',
        debug: { step: 'role_check', role: user.role }
      });
    }

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Contraseña válida:', validPassword);
    
    if (!validPassword) {
      return res.status(401).json({ 
        error: 'Credenciales inválidas',
        debug: { step: 'password_check' }
      });
    }

    // Crear sesión
    req.session.admin = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    // Esperar a que la sesión se guarde
    await new Promise((resolve) => req.session.save(resolve));

    console.log('Sesión creada:', req.session.admin);

    // Enviar respuesta
    return res.status(200).json({ 
      success: true,
      redirect: '/admin/dashboard',
      debug: { 
        step: 'success',
        sessionId: req.session.id,
        hasSession: !!req.session.admin
      }
    });
    
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      debug: { 
        step: 'error',
        message: error.message
      }
    });
  }
});

// Verificar que la ruta del dashboard existe y está correcta
app.get('/admin/dashboard', authMiddleware, (req, res) => {
  console.log('Accediendo al dashboard. Sesión:', req.session.admin);
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/admin/dashboard', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'admin-dashboard.html'));
});

app.get('/api/admin/canales', authMiddleware, async (req, res) => {
  try {
    const canales = await db.query(`
      SELECT 
        c.*, 
        COUNT(DISTINCT t.id) as total_tokens,
        COUNT(DISTINCT CASE WHEN t.permisos = 'emisor' THEN t.id END) as emisores,
        COUNT(DISTINCT CASE WHEN t.permisos = 'receptor' THEN t.id END) as receptores
      FROM socket_io_canales c
      LEFT JOIN socket_io_tokens t ON c.id = t.id_canal
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(canales);
  } catch (error) {
    console.error('Error al obtener canales:', error);
    res.status(500).json({ error: 'Error al obtener canales' });
  }
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ redirect: '/admin/login' });
});

async function loadData() {
  try {
    // Cargar receptores y emisores desde la tabla tokens
    const listenersResult = await db.query(
      'SELECT t.token, c.nombre as canal FROM socket_io_tokens t JOIN socket_io_canales c ON t.id_canal = c.id WHERE t.permisos = "receptor"'
    );
    const sendersResult = await db.query(
      'SELECT t.token, c.nombre as canal, iv.ip FROM socket_io_tokens t JOIN socket_io_canales c ON t.id_canal = c.id LEFT JOIN socket_io_ips_validas iv ON t.id_canal = iv.id_canal WHERE t.permisos = "emisor"'
    );
    
    listeners = listenersResult || [];
    senders = sendersResult || [];
    
    console.log('Datos cargados desde MySQL:', {
      listeners: listeners.length,
      senders: senders.length
    });
  } catch (error) {
    console.error('Error cargando datos de MySQL:', error);
  }
}

async function validarListener(canal, token) {
  try {
    const [result] = await db.query(
      'SELECT t.id FROM socket_io_tokens t JOIN socket_io_canales c ON t.id_canal = c.id WHERE c.nombre = ? AND t.token = ? AND t.permisos = "receptor"',
      [canal, token]
    );
    return result ? [null, 'Listener válido.'] : ['listener_invalido', 'Canal o token no válidos.'];
  } catch (error) {
    console.error('Error en validación:', error);
    return ['error_db', 'Error en validación'];
  }
}

async function addLog(canal, evento, mensaje) {
  try {
    // Obtener o crear el canal
    let [canalResult] = await db.query('SELECT id FROM socket_io_canales WHERE nombre = ?', [canal]);
    let canalId;
    
    if (!canalResult) {
      await db.query('INSERT INTO socket_io_canales (nombre) VALUES (?)', [canal]);
      [canalResult] = await db.query('SELECT id FROM socket_io_canales WHERE nombre = ?', [canal]);
    }
    canalId = canalResult.id;

    // Obtener o crear el evento
    let [eventoResult] = await db.query('SELECT id FROM socket_io_eventos WHERE evento = ? AND id_canal = ?', [evento, canalId]);
    let eventoId;
    
    if (!eventoResult) {
      await db.query('INSERT INTO socket_io_eventos (id_canal, evento) VALUES (?, ?)', [canalId, evento]);
      [eventoResult] = await db.query('SELECT id FROM socket_io_eventos WHERE evento = ? AND id_canal = ?', [evento, canalId]);
    }
    eventoId = eventoResult.id;

    // Registrar en historial
    await db.query(
      'INSERT INTO socket_io_historial (id_canal, id_evento, ip, mensaje) VALUES (?, ?, ?, ?)',
      [canalId, eventoId, '0.0.0.0', JSON.stringify(mensaje)]
    );
  } catch (error) {
    console.error('Error al agregar log:', error);
  }
}

function updateActiveChannel(canal, socketId, isJoining = true) {
  if (isJoining) {
    if (!activeChannels.has(canal)) {
      activeChannels.set(canal, new Set());
    }
    activeChannels.get(canal).add(socketId);
  } else {
    if (activeChannels.has(canal)) {
      activeChannels.get(canal).delete(socketId);
      if (activeChannels.get(canal).size === 0) {
        activeChannels.delete(canal);
      }
    }
  }
}

async function getAllChannels() {
  try {
    const channels = await db.query('SELECT nombre FROM socket_io_canales');
    return channels.map(c => c.nombre);
  } catch (error) {
    console.error('Error obteniendo canales:', error);
    return [];
  }
}

// Cargar datos iniciales
loadData();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.get('/logs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'logs.html'));
});

app.get('/api/logs', async (req, res) => {
  try {
    const logs = await db.query(`
      SELECT 
        h.*, 
        c.nombre as canal_nombre,
        e.evento as evento_nombre
      FROM socket_io_historial h 
      JOIN socket_io_canales c ON h.id_canal = c.id 
      JOIN socket_io_eventos e ON h.id_evento = e.id 
      ORDER BY h.created_at DESC 
      LIMIT 200
    `);
    res.json(logs);
  } catch (error) {
    console.error('Error al obtener logs:', error);
    res.status(500).json({ error: 'Error al obtener logs' });
  }
});

app.get('/api/active-channels', async (req, res) => {
  try {
    const allChannels = await getAllChannels();
    const channelsInfo = {
      all: allChannels.reduce((acc, channel) => {
        const activeConnections = activeChannels.get(channel)?.size || 0;
        acc[channel] = {
          isActive: activeConnections > 0,
          connections: activeConnections
        };
        return acc;
      }, {})
    };
    res.json(channelsInfo);
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/enviar-mensaje', async (req, res) => {
  const { canal, token, evento, mensaje } = req.body;
  const ipCliente = req.ip;
  
  try {
    const [result] = await db.query(`
      SELECT t.id 
      FROM socket_io_tokens t 
      JOIN socket_io_canales c ON t.id_canal = c.id 
      LEFT JOIN socket_io_ips_validas iv ON t.id_canal = iv.id_canal 
      WHERE c.nombre = ? AND t.token = ? AND t.permisos = 'emisor'
      AND (iv.ip IS NULL OR iv.ip = ? OR iv.ip = '0.0.0.0')
    `, [canal, token, ipCliente]);

    if (!result) {
      return res.status(400).json({ error: 'invalid_sender', mensaje: 'Emisor no válido' });
    }

    io.to(canal).emit(evento, mensaje);
    await addLog(canal, evento, mensaje);
    res.json({ mensaje: 'Evento enviado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  const subscribedChannels = new Set();

  socket.on('unirseCanal', async (data) => {
    const { canal, token } = data;
    const [error, razon] = await validarListener(canal, token);
    
    if (error) {
      socket.emit('respuesta', { mensaje: razon });
    } else {
      socket.join(canal);
      subscribedChannels.add(canal);
      updateActiveChannel(canal, socket.id, true);
      socket.emit('respuesta', { mensaje: `Te has unido al canal: ${canal}` });
      await addLog(canal, 'unirseCanal', { socketId: socket.id });
    }
  });

  socket.on('disconnect', async () => {
    for (const canal of subscribedChannels) {
      updateActiveChannel(canal, socket.id, false);
    }
    subscribedChannels.clear();
    await addLog('system', 'disconnect', { socketId: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});