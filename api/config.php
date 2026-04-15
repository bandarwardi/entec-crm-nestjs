<?php
// API Configuration — DO NOT expose this file publicly
// .htaccess blocks direct access to this file

define('API_KEY', getenv('UPLOAD_API_KEY') ?: 'MohamedAli@01553576740m');

define('ALLOWED_ORIGINS', [
    'https://entec.store',
    'http://localhost:4200',
    'http://localhost:3000',
]);

define('ALLOWED_MIME_TYPES', [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
]);

define('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB

define('UPLOAD_DIR', __DIR__ . '/uploads/');

define('BASE_URL', 'https://entec.store/api/uploads/');
