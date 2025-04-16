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
function validarEnviador(canal, token, ip) {
  try {
    console.log(`Validando enviador - Canal: ${canal}, Token: ${token}, IP: ${ip}`);
    
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
module.exports = validarEnviador;
