// conexiones/railwayDbChecker.js

// const dns = require('dns');
// const { promisify } = require('util');

// const resolveDns = promisify(dns.resolve4);

// async function checkRailwayDatabase() {
//   const dbHost = process.env.RAILWAY_DB_HOST || process.env.DATABASE_URL;

//   if (!dbHost) {
//     return { success: false, message: 'No se ha configurado la variable de entorno RAILWAY_DB_HOST o DATABASE_URL' };
//   }

//   try {
//     const hostname = new URL(dbHost).hostname;
//     await resolveDns(hostname);
//     return { success: true, message: `Base de datos en Railway detectada: ${hostname}` };
//   } catch (error) {
//     return { success: false, message: `No se pudo detectar la base de datos en Railway: ${error.message}` };
//   }
// }

// module.exports = checkRailwayDatabase;

const dns = require('dns');
const { promisify } = require('util');
const mysql = require('mysql2/promise');

const resolveDns = promisify(dns.resolve4);

async function checkRailwayDatabase() {
  if (!process.env.DB_HOST) {
    return { success: false, message: 'No se ha configurado la variable de entorno DB_HOST' };
  }

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await connection.ping();
    await connection.end();
    return { success: true, message: `Base de datos en Railway detectada: ${process.env.DB_HOST}` };
  } catch (error) {
    return { success: false, message: `No se pudo conectar a la base de datos en Railway: ${error.message}` };
  }
}

module.exports = checkRailwayDatabase;