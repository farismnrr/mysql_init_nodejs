const mysql = require('mysql2/promise');
const config = require('../model/mysql_config'); // Menggunakan konfigurasi dari file mysql_config.js

async function connectToMySQL() {
    console.log('Attempting to connect to MySQL...');
    try {
        const connection = await mysql.createConnection(config);
        console.log('Connected to MySQL!');
        return connection;
    } catch (error) {
        console.error('Error connecting to MySQL:', error);
        throw error;
    }
}

module.exports = connectToMySQL;
