const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db');
require('dotenv').config();
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
const MySQLStore = require('express-mysql-session')(session);


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const options = {
  host: "mysql.railway.internal",
  port: "3306",
  user: 'root',
  password: process.env.DB_PASSWORD,
  database: 'railway',
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000, // 24 horas
  createDatabaseTable: true,
  schema: {
      tableName: 'sessions',
      columnNames: {
          session_id: 'session_id',
          expires: 'expires',
          data: 'data'
      }
  }
};

const sessionStore = new MySQLStore(options);

app.use(session({
  key: 'socket_io_sid',
  secret: process.env.SESSION_SECRET || 'socket-io-secret-123',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { 
      secure: false, // Cambiar a true si usas HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
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

      // Buscar usuario
      console.log('Buscando usuario:', email);
      const [user] = await db.query(
          'SELECT * FROM users WHERE email = ?', 
          [email]
      );
      
      console.log('Usuario encontrado:', !!user);
      console.log('Hash almacenado:', user?.password);

      if (!user) {
          return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      // Verificar contraseña con bcrypt
      const validPassword = await bcrypt.compare(password, user.password);
      console.log('Contraseña válida:', validPassword);

      if (!validPassword) {
          return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      // Crear sesión
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      req.session.userRole = user.role;

      // Guardar sesión explícitamente
      req.session.save((err) => {
          if (err) {
              console.error('Error al guardar sesión:', err);
              return res.status(500).json({ error: 'Error al crear sesión' });
          }

          console.log('Sesión creada:', {
              userId: req.session.userId,
              userEmail: req.session.userEmail,
              sessionID: req.session.id
          });

          res.json({ 
              success: true, 
              redirect: '/logs',
              user: {
                  email: user.email,
                  role: user.role
              }
          });
      });

  } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ 
          error: 'Error interno del servidor',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
  }
});

// Ruta de logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});
app.get('/check-auth', async (req, res) => {
  try {
      // Verificar si hay sesión
      if (!req.session || !req.session.userId) {
          return res.status(401).json({ 
              authorized: false, 
              message: 'No hay sesión activa' 
          });
      }

      // Verificar que el usuario existe y es admin
      const [user] = await db.query(
          'SELECT role FROM users WHERE id = ?', 
          [req.session.userId]
      );

      if (!user || user.role !== 'ADMIN') {
          return res.status(403).json({ 
              authorized: false, 
              message: 'Usuario no autorizado' 
          });
      }

      res.json({ 
          authorized: true, 
          role: user.role 
      });

  } catch (error) {
      console.error('Error en verificación de auth:', error);
      res.status(500).json({ 
          authorized: false, 
          message: 'Error interno del servidor' 
      });
  }
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

// app.get('/api/logs', async (req, res) => {
//   try {
//     const logs = await db.query(`
//       SELECT 
//         h.*, 
//         c.nombre as canal_nombre,
//         e.evento as evento_nombre
//       FROM socket_io_historial h 
//       JOIN socket_io_canales c ON h.id_canal = c.id 
//       JOIN socket_io_eventos e ON h.id_evento = e.id 
//       ORDER BY h.created_at DESC 
//       LIMIT 200
//     `);
//     res.json(logs);
//   } catch (error) {
//     console.error('Error al obtener logs:', error);
//     res.status(500).json({ error: 'Error al obtener logs' });
//   }
// });
app.get('/api/logs', async (req, res) => {
  try {
    // Obtener el conteo total - Corregido para obtener el valor directo
    const [countRow] = await db.query(
      'SELECT COUNT(*) as total FROM socket_io_historial'
    );
    const total = countRow.total;
    
    // Obtener los últimos 100 logs
    const logs = await db.query(`
      SELECT 
        h.*, 
        c.nombre as canal_nombre,
        e.evento as evento_nombre,
        h.created_at
      FROM socket_io_historial h 
      JOIN socket_io_canales c ON h.id_canal = c.id 
      JOIN socket_io_eventos e ON h.id_evento = e.id 
      ORDER BY h.created_at DESC 
      LIMIT 100
    `);

    res.json({
      total: total,
      logs: logs
    });
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


//========================================================dic 20 del 2024
const isAdminMiddleware = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
      return res.redirect('/login');
  }

  try {
      const [user] = await db.query(
          'SELECT role FROM users WHERE id = ?',
          [req.session.userId]
      );

      if (!user || user.role !== 'ADMIN') {
          return res.status(403).send('Acceso denegado');
      }

      next();
  } catch (error) {
      console.error('Error en verificación de admin:', error);
      res.status(500).send('Error interno del servidor');
  }
};
app.get('/admin', isAdminMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

// Ruta para ver historial de bingos
app.get('/historial_bingos', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'historial_bingos.html'));
});

// API para obtener historial
app.get('/api/historial_bingos', authMiddleware, async (req, res) => {
  try {
      const bingos = await db.query(
          `SELECT id, evento, numeros, created_at 
           FROM bingo_bingos 
           ORDER BY created_at DESC`
      );
      res.json(bingos);
  } catch (error) {
      console.error('Error al obtener historial:', error);
      res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// API para borrar bingos antiguos
app.post('/api/borrar_bingos_antiguos', authMiddleware, async (req, res) => {
  try {
      // Obtener registros antiguos (más de 1 mes) limitado a 10
      const [registrosABorrar] = await db.query(
          `SELECT id FROM bingo_bingos 
           WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 MONTH) 
           ORDER BY created_at ASC 
           LIMIT 10`
      );

      if (!registrosABorrar || registrosABorrar.length === 0) {
          return res.json({ 
              message: 'No hay registros antiguos para borrar',
              registrosBorrados: 0
          });
      }

      // Borrar los registros seleccionados
      const ids = registrosABorrar.map(r => r.id);
      await db.query(
          'DELETE FROM bingo_bingos WHERE id IN (?)',
          [ids]
      );

      res.json({
          message: `Se borraron ${registrosABorrar.length} registros antiguos`,
          registrosBorrados: registrosABorrar.length
      });
  } catch (error) {
      console.error('Error al borrar registros:', error);
      res.status(500).json({ error: 'Error al borrar registros antiguos' });
  }
});
// Ruta para borrar logs antiguos simplificada
app.post('/api/logs/borrar-antiguos', authMiddleware, async (req, res) => {
  try {
    // Borrar directamente los 20 registros más antiguos
    const result = await db.query(`
      DELETE FROM socket_io_historial 
      ORDER BY created_at ASC 
      LIMIT 500
    `);

    // Verificar cuántos registros fueron borrados
    if (result.affectedRows === 0) {
      return res.json({ 
        message: 'No hay registros para borrar',
        registrosBorrados: 0
      });
    }

    res.json({
      message: `Se borraron ${result.affectedRows} registros antiguos`,
      registrosBorrados: result.affectedRows
    });
  } catch (error) {
    console.error('Error al borrar logs:', error);
    res.status(500).json({ 
      error: 'Error al borrar logs antiguos',
      details: error.message 
    });
  }
});
// Ruta para borrar logs antiguos excepto los de hoy (sin autenticación)
app.get('/borrar-logs-antiguos', async (req, res) => {
  try {
      console.log('Iniciando borrado de logs antiguos (excepto hoy)');

      const result = await db.query(`
          DELETE FROM socket_io_historial 
          WHERE id IN (
              SELECT id FROM (
                  SELECT id 
                  FROM socket_io_historial 
                  WHERE DATE(created_at) < DATE(CURRENT_TIMESTAMP)
                  ORDER BY created_at ASC 
                  LIMIT 500
              ) as t
          )
      `);

      const registrosBorrados = result.affectedRows || 0;
      console.log(`Se borraron ${registrosBorrados} registros antiguos`);
      
      return res.json({
          message: `Se borraron ${registrosBorrados} registros antiguos (exceptuando los de hoy)`,
          registrosBorrados: registrosBorrados
      });

  } catch (error) {
      console.error('Error al borrar logs:', error);
      return res.status(500).json({
          error: 'Error al borrar logs antiguos',
          details: error.message
      });
  }
});
//=====================aca termina adiciones del 2024

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