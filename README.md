# EN TEC CRM - Backend API

Robust NestJS backend powering the EN TEC CRM ecosystem, featuring high-performance data management and real-time communication.

## 🚀 Key Features

- **Modular Architecture**: Built with NestJS for scalability and maintainability.
- **Data Persistence**: MongoDB integration with Mongoose for efficient document storage.
- **Authentication**: Secure JWT-based auth with role-based permissions and trusted device management.
- **Real-time Communication**: 
  - Socket.io integration.
  - Hybrid Messaging System (WebSocket + HTTP Fallback for Serverless).
- **Automated Workflows**:
  - Email sending via Nodemailer with Handlebars templates.
  - Cron jobs for automated reminders and cleanup.
- **Performance Optimization**:
  - Intelligent Caching (Redis with In-memory fallback).
  - Parallel database aggregation for fast dashboard statistics.
- **Document Generation**: High-quality PDF generation using Puppeteer.

## 🛠 Tech Stack

- **Framework**: [NestJS](https://nestjs.com/)
- **Database**: MongoDB (Atlas)
- **Real-time**: Socket.io
- **Caching**: Redis
- **Security**: Passport.js & JWT

## 📦 Getting Started

1. Clone the repository
```bash
git clone https://github.com/bandarwardi/entec-crm-nestjs.git
```
2. Install dependencies
```bash
npm install
```
3. Set up environment variables (.env)
```env
MONGODB_URI=...
JWT_SECRET=...
SMTP_HOST=...
...
```
4. Run in development mode
```bash
npm run start:dev
```

## 🚀 Deployment

The backend is optimized for deployment on Vercel and traditional servers.

---
*Created and maintained by EN TEC Team.*
