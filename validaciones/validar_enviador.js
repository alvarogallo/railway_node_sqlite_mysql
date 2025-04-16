const fs = require('fs');
const path = require('path');

// Ruta al archivo JSON de enviadores
const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');

// function validarEnviador(canal, token, ip) {
//   try {
//     const data = fs.readFileSync(sendersPath, 'utf8');
//     const enviadores = JSON.parse(data);

//     // Buscar si existe un canal y token válidos
//     const enviadorValido = enviadores.find(
//       (enviador) => enviador.canal === canal && enviador.token === token
//     );

//     if (enviadorValido) {
//       // Si la IP es '0.0.0.0', permitir cualquier IP
//       if (enviadorValido.ip === '0.0.0.0' || enviadorValido.ip === ip) {
//         return [null, 'Enviador válido']; // Sin error
//       } else {
//         return ['ip_no_valida', 'IP no autorizada para este enviador'];
//       }
//     } else {
//       return ['canal_o_token_no_valido', 'Canal o token no válido'];
//     }
//   } catch (err) {
//     console.error('Error al leer el archivo senders.json:', err);
//     return ['error_lectura', 'Error al leer el archivo de enviadores'];
//   }
// }

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

module.exports = validarEnviador;
