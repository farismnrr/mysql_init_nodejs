const fs = require('fs');

require('dotenv').config();

const config = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
        ca: fs.readFileSync('ca.pem'), // Assuming ca.pem is in the same directory
        rejectUnauthorized: true,
    },
};

module.exports = config;
