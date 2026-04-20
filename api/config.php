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
    // Audio / Voice Records
    'audio/mpeg',
    'audio/ogg',
    'audio/opus',
    'audio/mp4',
    'audio/aac',
    'audio/webm',
    // Video
    'video/mp4',
    'video/webm',
    'video/quicktime',
    // Documents
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
]);

define('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB

define('UPLOAD_DIR', __DIR__ . '/uploads/');

define('BASE_URL', 'https://entec.store/api/uploads/');
