const mysql = require('mysql2/promise');
//clave otra vez
const dbConfig = {
  host: process.env.DB_HOST || "autorack.proxy.rlwy.net",
  port: parseInt(process.env.DB_PORT || "11702"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 20000
};

console.log('Configuración de la base de datos:');
console.log('HOST:', dbConfig.host);
console.log('PORT:', dbConfig.port);
console.log('USER:', dbConfig.user);
console.log('DATABASE:', dbConfig.database);
console.log('PASSWORD:', dbConfig.password ? '[PRESENTE]' : '[NO PRESENTE]');

let pool = null;

async function initPool() {
  try {
    pool = mysql.createPool(dbConfig);
    await pool.getConnection();
    console.log('✅ Conexión a MySQL exitosa');
  } catch (err) {
    console.error('❌ Error de conexión a MySQL:', err.message);
    process.exit(1);
  }
}

module.exports = {
  query: async (sql, params) => {
    if (!pool) await initPool();
    const [results] = await pool.execute(sql, params);
    return results;
  }
};