// dropTables.js
require('dotenv').config();
const mysql = require('mysql2/promise');

const config = {
    host: "mysql.railway.internal",
    port: "3306",
    user: 'root',
    password: process.env.DB_PASSWORD,
    database: 'railway',
    connectTimeout: 10000
};

async function dropTables() {
    let connection;
    try {
        connection = await mysql.createConnection(config);
        console.log('✅ Conexión establecida');

        console.log('Eliminando tablas...');
        await connection.execute('DROP TABLE IF EXISTS bingo_bingos');
        await connection.execute('DROP TABLE IF EXISTS bingo_parametros');
        
        console.log('✅ Tablas eliminadas exitosamente');
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (connection) await connection.end();
    }
}

dropTables();