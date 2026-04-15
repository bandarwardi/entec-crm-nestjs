# EN TEC Upload API

PHP-based file upload API hosted on Namecheap at `https://entec.store/api`.

## Endpoint

```
POST https://entec.store/api/upload.php
```

### Headers

| Header | Value |
|--------|-------|
| `X-API-Key` | Your secret API key (must match `API_KEY` in `config.php`) |
| `Content-Type` | `multipart/form-data` |

### Body

| Field | Type | Description |
|-------|------|-------------|
| `file` | File | The file to upload |

### Success Response (201)

```json
{
  "url": "https://entec.store/api/uploads/abc123_1234567890.jpg",
  "filename": "abc123_1234567890.jpg",
  "size": 204800,
  "mimeType": "image/jpeg"
}
```

### Error Responses

| Status | Meaning |
|--------|---------|
| 400 | No file uploaded |
| 401 | Invalid or missing API key |
| 405 | Method not allowed |
| 413 | File too large (max 10MB) |
| 415 | File type not allowed |
| 500 | Server error |

## Allowed File Types
- `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- `application/pdf`

## Deployment on Namecheap (cPanel)

1. Upload the entire `api/` folder contents to your hosting via File Manager or FTP
2. Set `uploads/` folder permissions to `755`
3. Edit `config.php` and set `API_KEY` to a strong secret key
4. Set the same key in NestJS `.env` as `UPLOAD_API_KEY`

## Environment Variables (NestJS .env)

```env
UPLOAD_API_URL=https://entec.store/api/upload.php
UPLOAD_API_KEY=your-secret-key-here
```
