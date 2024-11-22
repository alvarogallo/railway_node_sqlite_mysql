const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Configuración básica de sesión
app.use(session({
  secret: process.env.SESSION_SECRET || 'socket-io-secret-123',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

const authMiddleware = (req, res, next) => {
  if (!req.session || !req.session.userId) {
      return res.redirect('/login');
  }
  next();
};

// Rutas de autenticación
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
      return res.redirect('/logs');
  }
  res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

app.post('/login', async (req, res) => {
  console.log('Intento de login - Body:', req.body);
  
  try {
      const { email, password } = req.body;

      if (!email || !password) {
          console.log('Faltan credenciales');
          return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      console.log('Buscando usuario con email:', email);
      const [user] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

      console.log('Usuario encontrado:', !!user);
      
      if (!user) {
          return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      // En desarrollo, imprimir la contraseña hasheada para verificación
      console.log('Password hash en DB:', user.password);

      const validPassword = password === user.password; // Comparación simple temporal
      console.log('Password válido:', validPassword);

      if (!validPassword) {
          return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      // Crear sesión
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      console.log('Sesión creada:', req.session);

      res.json({ success: true, redirect: '/logs' });

  } catch (error) {
      console.error('Error detallado:', error);
      res.status(500).json({ 
          error: 'Error interno del servidor',
          details: error.message
      });
  }
});

// Ruta de logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Proteger la ruta de logs
app.get('/logs', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'logs.html'));
});

const PORT = process.env.PORT || 3000;
let listeners = [];
let senders = [];
const activeChannels = new Map();

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