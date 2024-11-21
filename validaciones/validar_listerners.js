const fs = require('fs');
const path = require('path');

// Ruta al archivo JSON de listeners
const listenersPath = path.join(__dirname, '../json_from_api_db/listeners.json');

// Función para validar canal y token en listeners
function validarListener(canal, token) {
  try {
    const data = fs.readFileSync(listenersPath, 'utf8');
    const listeners = JSON.parse(data);

    // Buscar si existe un canal y token válidos
    const listenerValido = listeners.find(
      (listener) => listener.canal === canal && listener.token === token
    );

    if (listenerValido) {
      return [null, 'Listener válido']; // No hay error
    } else {
      return ['listener_no_valido', 'Canal o token no válido en listeners'];
    }
  } catch (err) {
    console.error('Error al leer el archivo listeners.json:', err);
    return ['error_lectura', 'Error al leer el archivo de listeners'];
  }
}

module.exports = validarListener;
