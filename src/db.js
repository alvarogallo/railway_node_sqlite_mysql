// db.js
const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const CUAL_DATABASE = process.env.CUAL_DATABASE || 'MYSQL'; // MYSQL o SQLITE

const mysqlConfig = {
  host: "mysql.railway.internal",
  port: "3306",
  user: 'root',
  password: process.env.DB_PASSWORD,
  database: 'railway',
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
  } catch (err) {
    console.error('❌ Error de conexión a SQLite:', err.message);
    process.exit(1);
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

async function setupTables() {
  const dropBingosSql = 'DROP TABLE IF EXISTS bingo_bingos;';
  const dropParamsSql = 'DROP TABLE IF EXISTS bingo_parametros;';
  
  const createBingosSql = `
      CREATE TABLE bingo_bingos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          evento VARCHAR(32) NOT NULL,
          numeros VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  
  const createParamsSql = `
      CREATE TABLE bingo_parametros (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nombre VARCHAR(32) NOT NULL,
          valor VARCHAR(32) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  try {
      console.log('Eliminando tablas existentes...');
      await query(dropBingosSql);
      await query(dropParamsSql);

      console.log('Creando nuevas tablas...');
      await query(createBingosSql);
      await query(createParamsSql);

      console.log('✅ Tablas creadas exitosamente');
  } catch (error) {
      console.error('❌ Error al configurar tablas:', error);
      throw error;
  }
}

module.exports = {
  query,
  CUAL_DATABASE,
  setupTables
};