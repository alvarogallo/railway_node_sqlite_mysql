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
  // Primero eliminamos la tabla de administradores
  `DROP TABLE IF EXISTS socket_io_administradores`,

  // Creamos la nueva tabla users
  `CREATE TABLE IF NOT EXISTS users (
    id int(11) NOT NULL AUTO_INCREMENT,
    email varchar(64) NOT NULL,
    password varchar(255) NOT NULL,
    role varchar(20) NOT NULL DEFAULT 'USER',
    status varchar(20) NOT NULL DEFAULT 'ACTIVE',
    created_at datetime NOT NULL DEFAULT current_timestamp(),
    updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    last_login datetime DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`
];

async function updateDatabase() {
  let connection;
  try {
    console.log('Intentando conectar a la base de datos...');
    connection = await mysql.createConnection(mysqlConfig);
    console.log('Conexión establecida con éxito');

    console.log('Actualizando tablas...');
    for (const query of queries) {
      console.log('Ejecutando query:', query.substring(0, 50) + '...');
      await connection.query(query);
    }
    console.log('Actualización completada exitosamente');

    // Verificamos las tablas existentes
    const [tables] = await connection.query('SHOW TABLES');
    console.log('Tablas actuales en la base de datos:', tables.map(t => Object.values(t)[0]));

    // Mostramos la estructura de la nueva tabla users
    const [structure] = await connection.query('DESCRIBE socket_io_users');
    console.log('\nEstructura de la tabla socket_io_users:');
    console.log(structure);

  } catch (error) {
    console.error('Error durante la actualización:', {
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

// Ejecutar la actualización
console.log('Iniciando proceso de actualización...');
updateDatabase()
  .then(() => {
    console.log('Proceso de actualización completado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error en el proceso de actualización');
    process.exit(1);
  });