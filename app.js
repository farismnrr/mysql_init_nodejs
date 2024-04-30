const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const express = require('express');
const rateLimit = require('express-rate-limit');
const connectToMySQL = require('./connection/mysql_init');
const multer = require('multer');

const app = express();

const limiter = rateLimit({
    windowMs: 10 * 1000, // 1 detik
    max: 5,
    message: 'Too many requests from this IP, please try again later',
    skipFailedRequests: true,
    skipSuccessfulRequests: false,
});

app.use(limiter);

// Middleware untuk menunda akses setelah mencapai limit
const delayMiddleware = (req, res, next) => {
    if (res.headersSent) {
        return next();
    }

    // Cek apakah batas limit telah tercapai
    if (req.rateLimit.remaining === 0) {
        setTimeout(next, 60000); // 1 menit
    } else {
        next(); // Lanjutkan tanpa penundaan jika batas limit belum tercapai
    }
};

// Routes
app.get('/', delayMiddleware, async (req, res) => {
    try {
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

app.get('/users', delayMiddleware, async (req, res) => {
    try {
        const connection = await connectToMySQL();
        const [rows, fields] = await connection.execute('SELECT * FROM Sales');
        res.status(200).json({ users: rows });
    } catch (error) {
        console.error('Error retrieving users:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/data', delayMiddleware, async (req, res) => {
    try {
        const connection = await connectToMySQL();
        const [rows, fields] = await connection.execute(`
            SELECT 
                Sales.sale_id,
                Employees.name AS employee_name,
                Products.product_name,
                Customers.name AS customer_name,
                Sales.sale_date,
                Sales.sale_amount
            FROM 
                Sales
            JOIN 
                Employees ON Sales.employee_id = Employees.employee_id
            JOIN 
                Products ON Sales.product_id = Products.product_id
            JOIN 
                Customers ON Sales.customer_id = Customers.customer_id
            UNION
            SELECT 
                Purchases.purchase_id,
                Employees.name AS employee_name,
                Products.product_name,
                Suppliers.supplier_name AS customer_name,
                Purchases.purchase_date AS sale_date,
                Purchases.purchase_amount AS sale_amount
            FROM 
                Purchases
            JOIN 
                Employees ON Purchases.employee_id = Employees.employee_id
            JOIN 
                Products ON Purchases.product_id = Products.product_id
            JOIN 
                Suppliers ON Purchases.supplier_id = Suppliers.supplier_id
            ORDER BY 
                sale_date DESC;
        `);

        // Mengirim response
        res.status(200).json({
            status: 200,
            message: 'success',
            data: rows,
        });
    } catch (error) {
        console.error('Error executing query: ' + error.stack);
        res.status(500).json({
            status: 500,
            message: 'Internal Server Error',
        });
    }
});

const upload = multer({ dest: 'uploads/data' }); // Tentukan direktori tempat file akan diunggah

app.post('/register', upload.single('photo'), async (req, res) => {
    try {
        const { username, email } = req.body;
        const photo = req.file;

        if (!username || !email || !photo) {
            return res
                .status(400)
                .json({ error: 'Username, email, or photo is missing' });
        }

        // Periksa apakah username atau email sudah ada dalam database
        const connection = await connectToMySQL();
        const checkQuery =
            'SELECT * FROM Users WHERE username = ? OR email = ?';
        const [existingUsers] = await connection.execute(checkQuery, [
            username,
            email,
        ]);

        // Jika sudah ada username atau email yang sama, kembalikan error
        if (existingUsers.length > 0) {
            // Hapus file yang diunggah
            fs.unlinkSync(photo.path);
            return res
                .status(400)
                .json({ error: 'Username or email already exists' });
        }

        // Hitung jumlah foto yang telah diunggah oleh semua pengguna
        const uploadsDir = 'uploads';
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir);
        }
        const allPhotoFiles = fs.readdirSync(uploadsDir);
        let photoCount = 1;

        // Iterasi semua file dan cari pola nama file yang sesuai
        allPhotoFiles.forEach((file) => {
            const fileName = path.parse(file).name;
            const fileExt = path.parse(file).ext;
            const fileNameComponents = fileName.split('-');
            if (
                fileNameComponents.length === 3 &&
                fileNameComponents[1] === username &&
                fileExt !== '' && // Tambahkan penanganan ekstensi file
                fileExt === path.extname(photo.originalname)
            ) {
                const fileNumber = parseInt(fileNameComponents[2].substring(5));
                if (!isNaN(fileNumber) && fileNumber >= photoCount) {
                    photoCount = fileNumber + 1;
                }
            }
        });

        // Simpan foto ke dalam folder uploads dengan nama yang sesuai format
        const fileName = `${Date.now()}-${username}-photo${photoCount}${path.extname(
            photo.originalname,
        )}`;
        const filePath = path.join(uploadsDir, fileName);
        await sharp(photo.path)
            .resize({ width: 300, height: 300, fit: 'cover' })
            .toFile(filePath);

        // Simpan data pengguna ke dalam database
        const insertQuery =
            'INSERT INTO Users (username, email, photo_path) VALUES (?, ?, ?)';
        await connection.execute(insertQuery, [username, email, filePath]);

        res.status(200).json({ message: 'User registered successfully' });
    } catch (error) {
        // Jika terjadi kesalahan, hapus file yang diunggah sebelumnya
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/image/:username', delayMiddleware, (req, res) => {
    try {
        const username = req.params.username;
        const uploadsDir = 'uploads';

        // Cari file gambar berdasarkan username
        const userFiles = fs.readdirSync(uploadsDir).filter((file) => {
            const fileNameComponents = file.split('-');
            return (
                fileNameComponents.length === 3 &&
                fileNameComponents[1] === username
            );
        });

        // Jika tidak ada file gambar yang sesuai, kirim respons error
        if (userFiles.length === 0) {
            return res
                .status(404)
                .json({ error: 'Image not found for the user' });
        }

        // Ambil file gambar pertama yang sesuai
        const imagePath = path.join(uploadsDir, userFiles[0]);

        // Dapatkan path absolut ke file gambar
        const absolutePath = path.resolve(imagePath);

        // Kirim file gambar sebagai respons
        res.sendFile(absolutePath);
    } catch (error) {
        console.error('Error retrieving image:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
