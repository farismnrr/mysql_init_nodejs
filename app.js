const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Hapi = require('@hapi/hapi');
const connectToMySQL = require('./connection/mysql_init');
const multer = require('@hapi/hapi');
const Boom = require('@hapi/boom');

const init = async () => {
    const server = Hapi.server({
        port: process.env.PORT || 9000,
        host: '0.0.0.0', // Menggunakan host '0.0.0.0' agar dapat diakses dari luar
        routes: {
            cors: true,
            validate: {
                failAction: async (request, h, err) => {
                    throw err;
                },
            },
        },
    });

    // Routes
    server.route({
        method: 'GET',
        path: '/',
        handler: async (request, h) => {
            try {
                const connection = await connectToMySQL();
                const status = 'success';
                const message = 'Connected to MySQL!';
                const data = {
                    connection: connection,
                };
                return { status, message, data };
            } catch (error) {
                console.error('Error connecting to MySQL:', error);
                return Boom.internal('Error connecting to MySQL');
            }
        },
    });

    server.route({
        method: 'GET',
        path: '/users',
        handler: async (request, h) => {
            try {
                const connection = await connectToMySQL();
                const [rows, fields] = await connection.execute(
                    'SELECT * FROM Sales',
                );
                return { users: rows };
            } catch (error) {
                console.error('Error retrieving users:', error);
                return Boom.internal('Internal Server Error');
            }
        },
    });

    server.route({
        method: 'GET',
        path: '/data',
        handler: async (request, h) => {
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
                return {
                    status: 200,
                    message: 'success',
                    data: rows,
                };
            } catch (error) {
                console.error('Error executing query:', error);
                return Boom.internal('Internal Server Error');
            }
        },
    });

    const storage = multer.diskStorage({
        destination: 'uploads/data',
        filename: (req, file, cb) => {
            cb(null, Date.now() + '-' + file.originalname);
        },
    });

    const upload = multer({ storage });

    server.route({
        method: 'POST',
        path: '/register',
        handler: async (request, h) => {
            try {
                const { username, email } = request.payload;
                const photo = request.file;

                if (!username || !email || !photo) {
                    return Boom.badRequest(
                        'Username, email, or photo is missing',
                    );
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
                    return Boom.badRequest('Username or email already exists');
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
                        const fileNumber = parseInt(
                            fileNameComponents[2].substring(5),
                        );
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
                await connection.execute(insertQuery, [
                    username,
                    email,
                    filePath,
                ]);

                return { message: 'User registered successfully' };
            } catch (error) {
                // Jika terjadi kesalahan, hapus file yang diunggah sebelumnya
                if (request.file) {
                    fs.unlinkSync(request.file.path);
                }
                console.error('Error registering user:', error);
                return Boom.internal('Internal Server Error');
            }
        },
        options: {
            payload: {
                output: 'stream',
                allow: 'multipart/form-data',
            },
        },
    });

    server.route({
        method: 'GET',
        path: '/image/{username}',
        handler: async (request, h) => {
            try {
                const username = request.params.username;
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
                    return Boom.notFound('Image not found for the user');
                }

                // Ambil file gambar pertama yang sesuai
                const imagePath = path.join(uploadsDir, userFiles[0]);

                // Dapatkan path absolut ke file gambar
                const absolutePath = path.resolve(imagePath);

                // Kirim file gambar sebagai respons
                return h.file(absolutePath);
            } catch (error) {
                console.error('Error retrieving image:', error);
                return Boom.internal('Internal Server Error');
            }
        },
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();
