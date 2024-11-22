const mysql = require('mysql2/promise');
require('dotenv').config();

const mysqlConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 20000
};

async function testConnection() {
  let connection;
  
  console.log('Configuración de conexión:', {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    database: mysqlConfig.database
  });

  try {
    // Intentar crear la conexión
    connection = await mysql.createConnection(mysqlConfig);
    console.log('Conexión exitosa a la base de datos');

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