// db.js
const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const CUAL_DATABASE = process.env.CUAL_DATABASE || 'SQLITE'; // MYSQL o SQLITE

const mysqlConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "11702"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 10000
};

let mysqlPool = null;
let sqliteDb = null;

async function initMySQLPool() {
  try {
    mysqlPool = mysql.createPool(mysqlConfig);
    await mysqlPool.getConnection();
    console.log('✅ Conexión a MySQL exitosa');
  } catch (err) {
    console.error('❌ Error de conexión a MySQL:', err.message);
    await ensureUsersTableExistsMySQL();
    process.exit(1);
  }
}

async function initSQLite() {
  try {
    sqliteDb = await open({
      filename: 'sqlite3.railway.internal',
      driver: sqlite3.Database
    });
    await sqliteDb.get('SELECT 1');
    console.log('✅ Conexión a SQLite exitosa');
    await ensureUsersTableExistsSQLite();
  } catch (err) {
    console.error('❌ Error de conexión a SQLite:', err.message);
    process.exit(1);
  }
}

// Verificar y crear la tabla `users` en MySQL
async function ensureUsersTableExistsMySQL() {
  try {
    console.log("🔍 Verificando si existe la tabla 'users' en MySQL...");
    const [rows] = await mysqlPool.query(`
      SELECT TABLE_NAME 
      FROM information_schema.tables 
      WHERE table_schema = ? AND table_name = 'users'`,
      [mysqlConfig.database]
    );

    if (rows.length === 0) {
      console.log("⚙️ La tabla 'users' no existe. Creándola...");
      await mysqlPool.query(`
        CREATE TABLE users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
      `);
      console.log("✅ Tabla 'users' creada con éxito.");
    } else {
      console.log("✅ La tabla 'users' ya existe.");
    }
  } catch (error) {
    console.error("❌ Error al verificar o crear la tabla 'users':", error.message);
  }
}
// Verificar y crear la tabla `users` en SQLite
async function ensureUsersTableExistsSQLite() {
  try {
    console.log("🔍 Verificando si existe la tabla 'users' en SQLite...");
    const tableExists = await sqliteDb.get(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='users';
    `);

    if (!tableExists) {
      console.log("⚙️ La tabla 'users' no existe. Creándola...");
      await sqliteDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("✅ Tabla 'users' creada con éxito.");
    } else {
      console.log("✅ La tabla 'users' ya existe.");
    }
  } catch (error) {
    console.error("❌ Error al verificar o crear la tabla 'users':", error.message);
  }
}
console.log('Usando base de datos:', CUAL_DATABASE);
console.log('Configuración de la base de datos MySQL:');
console.log('HOST:', mysqlConfig.host);
console.log('PORT:', mysqlConfig.port);
console.log('USER:', mysqlConfig.user);
console.log('DATABASE:', mysqlConfig.database);
console.log('PASSWORD:', mysqlConfig.password ? '[PRESENTE]' : '[NO PRESENTE]');

async function query(sql, params) {
  if (CUAL_DATABASE === 'MYSQL') {
    if (!mysqlPool) await initMySQLPool();
    const [results] = await mysqlPool.execute(sql, params);
    return results;
  } else {
    if (!sqliteDb) await initSQLite();
    const results = await sqliteDb.all(sql, params);
    return results;
  }
}

module.exports = {
  query,
  CUAL_DATABASE
};