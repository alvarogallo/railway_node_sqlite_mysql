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

const rutasNuevas = require('./rutas');


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
app.use(rutasNuevas);

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



// En server.js, después de otras rutas API
app.post('/api/logs/borrar-registros-minutos', authMiddleware, async (req, res) => {
  try {
    //console.log('Iniciando borrado de registros con {"minutos":3} que no sean de hoy');

    // const result = await db.query(`
    //   DELETE FROM socket_io_historial 
    //   WHERE DATE(created_at) < CURRENT_DATE() 
    //   AND mensaje = ?
    // `, ['{"minutos":3}']);

    const result = await db.query(`
      DELETE FROM socket_io_historial 
      WHERE mensaje LIKE ?
    `, ['{"minutos":%']);


 

    // Verificar cuántos registros fueron borrados
    if (result.affectedRows === 0) {
      console.log('No se encontraron registros que cumplan con los criterios');
      return res.json({ 
        success: true,
        message: 'No hay registros que cumplan con estos criterios para borrar',
        registrosBorrados: 0
      });
    }

    console.log(`Se borraron ${result.affectedRows} registros específicos`);
    
    res.json({
      success: true,
      message: `Se borraron ${result.affectedRows} registros específicos`,
      registrosBorrados: result.affectedRows
    });
  } catch (error) {
    console.error('Error al borrar registros específicos:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al borrar registros específicos',
      details: error.message 
    });
  }
});

async function getAllChannels() {
  try {
    const channels = await db.query('SELECT nombre FROM socket_io_canales');
    return channels.map(c => c.nombre);
  } catch (error) {
    console.error('Error obteniendo canales:', error);
    return [];
  }
}


// Ruta para actualizar manualmente el archivo senders.json
app.post('/api/actualizar-senders', authMiddleware, async (req, res) => {
  try {
    const resultado = await actualizarSendersJson();
    
    if (resultado) {
      res.json({
        success: true,
        message: 'Archivo senders.json actualizado correctamente'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Error al actualizar el archivo senders.json'
      });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Ruta para ver el archivo senders.json
app.get('/api/senders', authMiddleware, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Ruta al archivo JSON de enviadores
    const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');
    
    // Verificar si el archivo existe
    if (!fs.existsSync(sendersPath)) {
      return res.status(404).json({
        success: false,
        error: 'Archivo senders.json no encontrado',
      });
    }
    
    // Leer el archivo
    const data = fs.readFileSync(sendersPath, 'utf8');
    const senders = JSON.parse(data);
    
    // Devolver el contenido como JSON
    res.json({
      success: true,
      senders: senders
    });
  } catch (error) {
    console.error('Error al leer senders.json:', error);
    res.status(500).json({
      success: false,
      error: 'Error al leer el archivo senders.json',
      details: error.message
    });
  }
});

// Función para actualizar el archivo senders.json desde la base de datos
async function actualizarSendersJson() {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Ruta al archivo JSON de enviadores
    const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');
    
    console.log('Actualizando senders.json desde la base de datos...');
    
    // Obtener los emisores desde la base de datos
    const sendersResult = await db.query(`
      SELECT c.nombre as canal, t.token, iv.ip 
      FROM socket_io_tokens t 
      JOIN socket_io_canales c ON t.id_canal = c.id 
      LEFT JOIN socket_io_ips_validas iv ON iv.id_canal = c.id 
      WHERE t.permisos = 'emisor'
    `);
    
    // Procesar los datos para el formato correcto
    // Agrupar por canal y token para evitar duplicados
    const senderMap = new Map();
    for (const sender of sendersResult) {
      const key = `${sender.canal}-${sender.token}`;
      if (!senderMap.has(key)) {
        senderMap.set(key, {
          canal: sender.canal,
          token: sender.token,
          ip: sender.ip || '0.0.0.0' // Si no hay IP específica, usar 0.0.0.0
        });
      }
    }
    
    // Convertir el mapa a un array
    const sendersArray = Array.from(senderMap.values());
    
    // Escribir el archivo JSON
    fs.writeFileSync(sendersPath, JSON.stringify(sendersArray, null, 2), 'utf8');
    
    console.log(`✅ Archivo senders.json actualizado con ${sendersArray.length} enviadores`);
    return true;
  } catch (error) {
    console.error('❌ Error al actualizar senders.json:', error);
    return false;
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
    //res.json({ mensaje: 'Evento enviado correctamente' });
    res.json({ mensaje: 'Evento enviado correctamente, evento: ' + evento });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

io.on('connection', (socket) => {
  console.log('Cliente conectado 1:', socket.id);
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

// Ruta de diagnóstico para verificar enviadores
app.get('/api/verificar-enviador', authMiddleware, async (req, res) => {
  try {
    const { canal, token, ip } = req.query;
    
    if (!canal || !token) {
      return res.status(400).json({
        error: 'Se requieren canal y token para la verificación'
      });
    }
    
    const ipToCheck = ip || req.ip;
    console.log(`Verificando enviador - Canal: ${canal}, Token: ${token}, IP: ${ipToCheck}`);
    
    // Verificar en base de datos
    const dbQuery = `
      SELECT t.id, c.nombre as canal, t.token
      FROM socket_io_tokens t 
      JOIN socket_io_canales c ON t.id_canal = c.id 
      LEFT JOIN socket_io_ips_validas iv ON t.id_canal = iv.id_canal 
      WHERE c.nombre = ? AND t.token = ? AND t.permisos = 'emisor'
      AND (iv.ip IS NULL OR iv.ip = ? OR iv.ip = '0.0.0.0')
    `;
    
    console.log('Consulta SQL:', dbQuery);
    console.log('Parámetros:', [canal, token, ipToCheck]);
    
    const dbResult = await db.query(dbQuery, [canal, token, ipToCheck]);
    console.log('Resultado de base de datos:', dbResult);
    
    // Función para validar enviadores (implementada localmente para evitar problemas de importación)
    function validarEnviadorLocal(canal, token, ip) {
      try {
        console.log(`Validando enviador localmente - Canal: ${canal}, Token: ${token}, IP: ${ip}`);
        
        const fs = require('fs');
        const path = require('path');
        const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');
        
        console.log('Ruta a senders.json:', sendersPath);
        
        // Verificar si el archivo existe
        if (!fs.existsSync(sendersPath)) {
          console.error(`Archivo no encontrado: ${sendersPath}`);
          return ['archivo_no_encontrado', 'Archivo senders.json no encontrado'];
        }
        
        const data = fs.readFileSync(sendersPath, 'utf8');
        const enviadores = JSON.parse(data);
        
        console.log(`Datos de enviadores cargados. Total de enviadores: ${enviadores.length}`);
        console.log('Enviadores disponibles:', JSON.stringify(enviadores));

        // Buscar si existe un canal válido
        const canalesDisponibles = enviadores.map(e => e.canal);
        console.log(`Canales disponibles: ${canalesDisponibles.join(', ')}`);
        
        if (!canalesDisponibles.includes(canal)) {
          console.log(`Error: Canal '${canal}' no encontrado`);
          return ['canal_no_valido', `Canal '${canal}' no válido. Canales disponibles: ${canalesDisponibles.join(', ')}`];
        }
        
        // Buscar si existe un canal y token válidos
        const enviadorValido = enviadores.find(
          (enviador) => enviador.canal === canal && enviador.token === token
        );

        if (!enviadorValido) {
          console.log(`Error: Combinación de canal '${canal}' y token '${token}' no válida`);
          return ['token_no_valido', `Token '${token}' no válido para el canal '${canal}'`];
        }
        
        console.log(`Enviador encontrado: ${JSON.stringify(enviadorValido)}`);

        // Si la IP es '0.0.0.0', permitir cualquier IP
        if (enviadorValido.ip === '0.0.0.0' || enviadorValido.ip === ip) {
          console.log('IP válida para este enviador');
          return [null, 'Enviador válido']; // Sin error
        } else {
          console.log(`Error: IP '${ip}' no autorizada. IP esperada: '${enviadorValido.ip}'`);
          return ['ip_no_valida', `IP '${ip}' no autorizada para este enviador. IP autorizada: '${enviadorValido.ip}'`];
        }
      } catch (err) {
        console.error('Error al leer el archivo senders.json:', err);
        return ['error_lectura', `Error al leer el archivo de enviadores: ${err.message}`];
      }
    }
    
    // Verificar en senders.json
    const [error, mensaje] = validarEnviadorLocal(canal, token, ipToCheck);
    
    // Intentar leer senders.json directamente
    let sendersContent = null;
    let sendersError = null;
    
    try {
      const fs = require('fs');
      const path = require('path');
      const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');
      if (fs.existsSync(sendersPath)) {
        const sendersData = fs.readFileSync(sendersPath, 'utf8');
        sendersContent = JSON.parse(sendersData);
      } else {
        sendersError = `Archivo no encontrado: ${sendersPath}`;
      }
    } catch (readError) {
      sendersError = readError.message;
    }
    
    // Preparar respuesta con toda la información de diagnóstico
    res.json({
      dbValidation: {
        isValid: dbResult.length > 0,
        result: dbResult,
        query: dbQuery
      },
      jsonValidation: {
        isValid: error === null,
        error,
        mensaje
      },
      senders: {
        content: sendersContent,
        error: sendersError,
        path: path.join(__dirname, '../json_from_api_db/senders.json')
      },
      requestInfo: {
        canal,
        token,
        ipRequested: ip,
        ipActual: req.ip
      },
      serverInfo: {
        workingDirectory: process.cwd(),
        nodeEnv: process.env.NODE_ENV,
        platform: process.platform
      }
    });
  } catch (error) {
    console.error('Error de verificación:', error);
    res.status(500).json({
      error: 'Error al verificar enviador',
      details: error.message,
      stack: error.stack
    });
  }
});
// Ruta simple de diagnóstico para verificar enviadores
//Funciona pero no tiene restr
// app.get('/api/test-enviador', async (req, res) => {
//   try {
//     const { canal, token } = req.query;
    
//     // Información básica
//     const respuesta = {
//       mensaje: "Ruta de diagnóstico funcionando correctamente",
//       parametrosRecibidos: {
//         canal,
//         token,
//         ip: req.ip
//       },
//       hora: new Date().toISOString()
//     };
    
//     // Intenta leer el archivo senders.json
//     try {
//       const fs = require('fs');
//       const path = require('path');
//       const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');
      
//       respuesta.archivoInfo = {
//         ruta: sendersPath,
//         existe: fs.existsSync(sendersPath)
//       };
      
//       if (respuesta.archivoInfo.existe) {
//         const contenido = fs.readFileSync(sendersPath, 'utf8');
//         respuesta.enviadores = JSON.parse(contenido);
//       }
//     } catch (fileError) {
//       respuesta.errorArchivo = fileError.message;
//     }
    
//     res.json(respuesta);
//   } catch (error) {
//     console.error('Error en test:', error);
//     res.status(500).json({
//       error: 'Error en prueba de diagnóstico',
//       details: error.message
//     });
//   }
// });

// server.listen(PORT, () => {
//   console.log(`Servidor corriendo en el puerto ${PORT}`);
// });
server.listen(PORT, async () => {
  await loadData();
  await actualizarSendersJson();
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});