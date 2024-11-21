const fs = require('fs');
const path = require('path');

// Ruta al archivo JSON de enviadores
const sendersPath = path.join(__dirname, '../json_from_api_db/senders.json');

function validarEnviador(canal, token, ip) {
  try {
    const data = fs.readFileSync(sendersPath, 'utf8');
    const enviadores = JSON.parse(data);

    // Buscar si existe un canal y token válidos
    const enviadorValido = enviadores.find(
      (enviador) => enviador.canal === canal && enviador.token === token
    );

    if (enviadorValido) {
      // Si la IP es '0.0.0.0', permitir cualquier IP
      if (enviadorValido.ip === '0.0.0.0' || enviadorValido.ip === ip) {
        return [null, 'Enviador válido']; // Sin error
      } else {
        return ['ip_no_valida', 'IP no autorizada para este enviador'];
      }
    } else {
      return ['canal_o_token_no_valido', 'Canal o token no válido'];
    }
  } catch (err) {
    console.error('Error al leer el archivo senders.json:', err);
    return ['error_lectura', 'Error al leer el archivo de enviadores'];
  }
}

module.exports = validarEnviador;
