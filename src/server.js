const mysql = require('mysql2/promise');
require('dotenv').config();

const mysqlConfig = {
  host: "mysql.railway.internal",
  port: "3306",
  user: 'root',
  password: process.env.DB_PASSWORD,
  database: 'railway',
  connectTimeout: 10000
};

const queries = [
  "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO'",
  "SET time_zone = '+00:00'",
  
  `CREATE TABLE IF NOT EXISTS socket_io_administradores (
    id int(11) NOT NULL AUTO_INCREMENT,
    email varchar(64) NOT NULL,
    role varchar(8) NOT NULL DEFAULT 'ADMIN',
    created_at datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE IF NOT EXISTS socket_io_canales (
    id int(11) NOT NULL AUTO_INCREMENT,
    vida int(8) NOT NULL DEFAULT 1,
    nombre varchar(50) NOT NULL,
    descripcion text DEFAULT NULL,
    created_at timestamp NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    UNIQUE KEY nombre (nombre)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE IF NOT EXISTS socket_io_historial (
    id int(11) NOT NULL AUTO_INCREMENT,
    ip_sender varchar(64) NOT NULL,
    canal varchar(50) DEFAULT NULL,
    evento varchar(255) DEFAULT NULL,
    mensaje varchar(255) NOT NULL,
    timestamp datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`
];

async function initializeDatabase() {
  let connection;
  try {
    console.log('Intentando conectar a la base de datos...');
    connection = await mysql.createConnection(mysqlConfig);
    console.log('Conexión establecida con éxito');

    console.log('Creando tablas...');
    // Ejecutamos cada query por separado
    for (const query of queries) {
      console.log('Ejecutando query:', query.substring(0, 50) + '...');
      await connection.query(query);
    }
    console.log('Tablas creadas exitosamente');

    // Verificamos las tablas creadas
    const [tables] = await connection.query('SHOW TABLES');
    console.log('Tablas en la base de datos:', tables.map(t => Object.values(t)[0]));

  } catch (error) {
    console.error('Error durante la inicialización:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Conexión cerrada');
    }
  }
}

// Ejecutar la inicialización
console.log('Iniciando proceso de creación de tablas...');
initializeDatabase()
  .then(() => {
    console.log('Proceso de inicialización completado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error en el proceso de inicialización');
    process.exit(1);
  });