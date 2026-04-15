<?php
require_once __DIR__ . '/config.php';

// ── CORS Headers ─────────────────────────────────────────────────────────────
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ALLOWED_ORIGINS)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: https://entec.store');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Content-Type: application/json; charset=utf-8');

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Method Check ──────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── API Key Validation (DISABLED) ──────────────────────────────────────────
/*
$apiKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($apiKey !== API_KEY) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}
*/

// ── File Presence Check ───────────────────────────────────────────────────────
if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) {
    http_response_code(400);
    echo json_encode(['error' => 'No file uploaded']);
    exit;
}

$file = $_FILES['file'];

// ── Upload Error Check ────────────────────────────────────────────────────────
if ($file['error'] !== UPLOAD_ERR_OK) {
    $errors = [
        UPLOAD_ERR_INI_SIZE   => 'File exceeds server limit',
        UPLOAD_ERR_FORM_SIZE  => 'File exceeds form limit',
        UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded',
        UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
        UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
        UPLOAD_ERR_EXTENSION  => 'A PHP extension stopped the file upload',
    ];
    http_response_code(500);
    echo json_encode(['error' => $errors[$file['error']] ?? 'Unknown upload error']);
    exit;
}

// ── File Size Check ───────────────────────────────────────────────────────────
if ($file['size'] > MAX_FILE_SIZE) {
    http_response_code(413);
    echo json_encode(['error' => 'File size exceeds limit of 10MB']);
    exit;
}

// ── MIME Type Validation (real check, not just extension) ─────────────────────
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $finfo->file($file['tmp_name']);

if (!in_array($mimeType, ALLOWED_MIME_TYPES)) {
    http_response_code(415);
    echo json_encode(['error' => 'File type not allowed: ' . $mimeType]);
    exit;
}

// ── Generate Safe Filename ────────────────────────────────────────────────────
$extension = match($mimeType) {
    'image/jpeg'      => 'jpg',
    'image/png'       => 'png',
    'image/webp'      => 'webp',
    'image/gif'       => 'gif',
    'application/pdf' => 'pdf',
    default           => 'bin',
};

$filename = bin2hex(random_bytes(16)) . '_' . time() . '.' . $extension;

// ── Ensure Upload Directory Exists ────────────────────────────────────────────
if (!is_dir(UPLOAD_DIR)) {
    if (!mkdir(UPLOAD_DIR, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create upload directory']);
        exit;
    }
}

// ── Move File ─────────────────────────────────────────────────────────────────
$destination = UPLOAD_DIR . $filename;
if (!move_uploaded_file($file['tmp_name'], $destination)) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save file']);
    exit;
}

// ── Success Response ──────────────────────────────────────────────────────────
http_response_code(201);
echo json_encode([
    'url'      => BASE_URL . $filename,
    'filename' => $filename,
    'size'     => $file['size'],
    'mimeType' => $mimeType,
]);
