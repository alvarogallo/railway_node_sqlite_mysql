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
  // Primero eliminamos todas las tablas existentes en orden correcto por las foreign keys
  `DROP TABLE IF EXISTS socket_io_tokens`,
  `DROP TABLE IF EXISTS socket_io_ips_validas`,
  `DROP TABLE IF EXISTS socket_io_historial`,
  `DROP TABLE IF EXISTS socket_io_eventos`,
  `DROP TABLE IF EXISTS socket_io_conexiones_rechazadas`,
  `DROP TABLE IF EXISTS socket_io_canales`,
  `DROP TABLE IF EXISTS users`,
  
  // Eliminamos también las tablas sin prefijo por si existen
  `DROP TABLE IF EXISTS tokens`,
  `DROP TABLE IF EXISTS ips_validas`,
  `DROP TABLE IF EXISTS historial`,
  `DROP TABLE IF EXISTS eventos`,
  `DROP TABLE IF EXISTS conexiones_rechazadas`,
  `DROP TABLE IF EXISTS canales`,

  // Configuración inicial
  "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO'",
  "SET time_zone = '+00:00'",

  // Creamos las nuevas tablas
  `CREATE TABLE users (
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE socket_io_canales (
    id int(11) NOT NULL AUTO_INCREMENT,
    nombre varchar(255) NOT NULL,
    created_at timestamp NOT NULL DEFAULT current_timestamp(),
    updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    dias int(11) DEFAULT 90,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE socket_io_conexiones_rechazadas (
    id int(11) NOT NULL AUTO_INCREMENT,
    canal_id int(11) DEFAULT NULL,
    ip varchar(45) NOT NULL,
    veces int(11) DEFAULT 1,
    created_at timestamp NOT NULL DEFAULT current_timestamp(),
    updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (id),
    KEY idx_ip_canal (ip,canal_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE socket_io_eventos (
    id int(11) NOT NULL AUTO_INCREMENT,
    id_canal int(11) DEFAULT NULL,
    evento varchar(255) NOT NULL,
    created_at timestamp NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    KEY id_canal (id_canal)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE socket_io_historial (
    id int(11) NOT NULL AUTO_INCREMENT,
    id_canal int(11) DEFAULT NULL,
    id_evento int(11) DEFAULT NULL,
    ip varchar(45) NOT NULL,
    mensaje text DEFAULT NULL,
    created_at timestamp NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (id),
    KEY id_canal (id_canal),
    KEY id_evento (id_evento)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE socket_io_ips_validas (
    id int(11) NOT NULL AUTO_INCREMENT,
    id_canal int(11) DEFAULT NULL,
    ip varchar(45) NOT NULL,
    PRIMARY KEY (id),
    KEY id_canal (id_canal)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  `CREATE TABLE socket_io_tokens (
    id int(11) NOT NULL AUTO_INCREMENT,
    id_canal int(11) DEFAULT NULL,
    token varchar(255) NOT NULL,
    permisos enum('receptor','emisor') NOT NULL,
    PRIMARY KEY (id),
    KEY id_canal (id_canal)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,

  // Agregamos las foreign keys
  `ALTER TABLE socket_io_eventos 
   ADD CONSTRAINT socket_io_eventos_ibfk_1 FOREIGN KEY (id_canal) REFERENCES socket_io_canales (id)`,

  `ALTER TABLE socket_io_historial
   ADD CONSTRAINT socket_io_historial_ibfk_1 FOREIGN KEY (id_canal) REFERENCES socket_io_canales (id),
   ADD CONSTRAINT socket_io_historial_ibfk_2 FOREIGN KEY (id_evento) REFERENCES socket_io_eventos (id)`,

  `ALTER TABLE socket_io_ips_validas
   ADD CONSTRAINT socket_io_ips_validas_ibfk_1 FOREIGN KEY (id_canal) REFERENCES socket_io_canales (id)`,

  `ALTER TABLE socket_io_tokens
   ADD CONSTRAINT socket_io_tokens_ibfk_1 FOREIGN KEY (id_canal) REFERENCES socket_io_canales (id)`
];

async function recreateDatabase() {
  let connection;
  try {
    console.log('Conectando a la base de datos...');
    connection = await mysql.createConnection(mysqlConfig);
    console.log('Conexión establecida con éxito');

    console.log('Recreando tablas...');
    for (const query of queries) {
      console.log('Ejecutando query:', query.substring(0, 50) + '...');
      await connection.query(query);
    }
    console.log('Tablas recreadas exitosamente');

    // Verificamos las tablas creadas
    const [tables] = await connection.query('SHOW TABLES');
    console.log('\nTablas en la base de datos:', tables.map(t => Object.values(t)[0]));

  } catch (error) {
    console.error('Error durante la recreación:', {
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

// Ejecutar la recreación
console.log('Iniciando proceso de recreación de la base de datos...');
recreateDatabase()
  .then(() => {
    console.log('Proceso de recreación completado exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error en el proceso de recreación');
    process.exit(1);
  });