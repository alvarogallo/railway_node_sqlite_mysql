const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuración de conexión usando las variables directamente
const mysqlConfig = {
  host: process.env.RAILWAY_PRIVATE_DOMAIN || 'localhost',
  port: parseInt(process.env.MYSQLPORT || "3306"),
  user: 'root',
  password: process.env.MYSQL_ROOT_PASSWORD,
  database: 'railway',
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 20000
};

async function testConnection() {
  let connection;
  
  // Mostrar la configuración (sin mostrar la contraseña por seguridad)
  console.log('Intentando conectar con:', {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    database: mysqlConfig.database,
    env_vars_present: {
      RAILWAY_PRIVATE_DOMAIN: !!process.env.RAILWAY_PRIVATE_DOMAIN,
      MYSQL_ROOT_PASSWORD: !!process.env.MYSQL_ROOT_PASSWORD,
      MYSQLPORT: !!process.env.MYSQLPORT
    }
  });

  try {
    // Intentar crear la conexión
    connection = await mysql.createConnection(mysqlConfig);
    console.log('¡Conexión exitosa a la base de datos!');

    // Probar una consulta simple
    const [rows] = await connection.query('SELECT 1 + 1 as result');
    console.log('Prueba de consulta exitosa:', rows[0].result);

  } catch (error) {
    console.error('Error detallado de conexión:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Conexión cerrada');
    }
  }
}

// Ejecutar la prueba de conexión
testConnection()
  .then(() => {
    console.log('Prueba de conexión completada con éxito');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error en la prueba de conexión');
    process.exit(1);
  });