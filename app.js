// Import required modules
const express = require('express');
const connectToMySQL = require('./connection/mysql_init'); // Assuming the database connection function is in connection.js

// Create an instance of Express application
const app = express();

// Middleware
// You can add middleware here if needed

// Routes
// Import and use route handlers
// Route for handling GET request to '/'
app.get('/', async (req, res) => {
    try {
        // Establish connection to MySQL
        const connection = await connectToMySQL();
        const status = 'success';
        const message = 'Connected to MySQL!';
        const data = {
            connection: connection,
        };

        res.status(200).json({ status, message, data });
    } catch (error) {
        console.error('Error connecting to MySQL:', error);
        const status = 'error';
        const message = 'Error connecting to MySQL';
        const data = null;
        res.status(500).json({ status, message, data });
    }
});

// Route for handling GET request to '/users'
app.get('/users', async (req, res) => {
    try {
        // Establish connection to MySQL
        const connection = await connectToMySQL();
        // Query all users from the users table
        const [rows, fields] = await connection.execute('SELECT * FROM users');

        // Send the response with the users data
        res.status(200).json({ users: rows });
    } catch (error) {
        console.error('Error retrieving users:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
