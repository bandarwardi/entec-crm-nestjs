# WebSocket Presence — CRM Access Control System

## Overview

This document provides a complete implementation guide for securing an Angular/NestJS CRM using WebSocket Presence. Access is only possible while an external Python desktop application maintains an active WebSocket connection with the server.

### Environment

| Layer | Platform |
|---|---|
| NestJS Backend | Railway (HTTPS/WSS) |
| Angular Frontend | Namecheap shared hosting |
| Python Desktop App | User's machine (Windows/macOS/Linux) |

---

## How It Works

1. Python App sends `POST /auth/login` with username/password
2. NestJS validates credentials and returns a `wsToken` (one-time use)
3. Python opens a WebSocket connection using the `wsToken`
4. NestJS registers the connection as an active session for that user
5. Python opens the browser — NestJS sets a session cookie via HTTP login
6. On every browser request, `SessionGuard` checks: is there an active WS connection for this user?
7. If yes → request proceeds. If no → `401`
8. When Python closes, the WS disconnects instantly → `onDisconnect()` fires → session removed → all browser requests return `401`

---

## Project Structure

```
project-root/
├── backend/                               # NestJS on Railway
│   └── src/
│       ├── auth/
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts
│       │   ├── auth.module.ts
│       │   ├── session.guard.ts
│       │   └── ws-token.store.ts
│       ├── presence/
│       │   ├── presence.gateway.ts
│       │   ├── presence.service.ts
│       │   └── presence.module.ts
│       ├── crm/
│       │   └── crm.controller.ts
│       ├── app.module.ts
│       └── main.ts
│
├── frontend/                              # Angular on Namecheap
│   └── src/
│       └── app/
│           ├── interceptors/
│           │   └── auth.interceptor.ts
│           └── pages/
│               └── access-denied/
│                   └── access-denied.component.ts
│
└── desktop/                               # Python App
    ├── main.py
    └── requirements.txt
```

---

## Implementation

### 1. NestJS Backend

#### Install dependencies

```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npm install cookie-parser
npm install -D @types/cookie-parser
```

---

#### `src/auth/ws-token.store.ts`

Stores one-time-use tokens that Python uses to authenticate the WebSocket connection. Each token is valid for 30 seconds and deleted after first use.

```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

interface WsTokenEntry {
  userId: string;
  expiresAt: number;
}

@Injectable()
export class WsTokenStore {
  private tokens = new Map<string, WsTokenEntry>();
  private readonly TTL_MS = 30_000; // 30 seconds

  issue(userId: string): string {
    const token = randomUUID();
    this.tokens.set(token, {
      userId,
      expiresAt: Date.now() + this.TTL_MS,
    });
    return token;
  }

  consume(token: string): string | null {
    const entry = this.tokens.get(token);
    this.tokens.delete(token); // delete immediately — one-time use

    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;

    return entry.userId;
  }
}
```

---

#### `src/presence/presence.service.ts`

Tracks which users currently have an active WebSocket connection.

```typescript
import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class PresenceService {
  // userId → Set of active socket connections
  // A user can have multiple connections (e.g. two machines)
  private activeConnections = new Map<string, Set<Socket>>();

  register(userId: string, socket: Socket): void {
    if (!this.activeConnections.has(userId)) {
      this.activeConnections.set(userId, new Set());
    }
    this.activeConnections.get(userId)!.add(socket);
  }

  remove(userId: string, socket: Socket): void {
    const sockets = this.activeConnections.get(userId);
    if (!sockets) return;

    sockets.delete(socket);

    if (sockets.size === 0) {
      this.activeConnections.delete(userId);
    }
  }

  isActive(userId: string): boolean {
    const sockets = this.activeConnections.get(userId);
    return !!sockets && sockets.size > 0;
  }
}
```

---

#### `src/presence/presence.gateway.ts`

The WebSocket gateway that Python connects to. On connect it validates the `wsToken`, on disconnect it removes the session immediately.

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PresenceService } from './presence.service';
import { WsTokenStore } from '../auth/ws-token.store';

@WebSocketGateway({
  namespace: '/presence',
  cors: {
    origin: '*', // tighten this in production
    credentials: true,
  },
})
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly presenceService: PresenceService,
    private readonly wsTokenStore: WsTokenStore,
  ) {}

  handleConnection(socket: Socket): void {
    // Python passes wsToken as a query parameter on connect
    const wsToken = socket.handshake.query?.wsToken as string;

    if (!wsToken) {
      socket.disconnect();
      return;
    }

    const userId = this.wsTokenStore.consume(wsToken);

    if (!userId) {
      // Token invalid, expired, or already used
      socket.disconnect();
      return;
    }

    // Attach userId to socket for cleanup on disconnect
    socket.data.userId = userId;
    this.presenceService.register(userId, socket);

    socket.emit('connected', { status: 'ok' });
  }

  handleDisconnect(socket: Socket): void {
    const userId = socket.data?.userId;
    if (userId) {
      this.presenceService.remove(userId, socket);
    }
  }
}
```

---

#### `src/presence/presence.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';
import { WsTokenStore } from '../auth/ws-token.store';

@Module({
  providers: [PresenceGateway, PresenceService, WsTokenStore],
  exports: [PresenceService],
})
export class PresenceModule {}
```

---

#### `src/auth/session.guard.ts`

Protects every CRM route. Reads the `userId` from the session cookie and checks if an active WebSocket connection exists for that user.

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PresenceService } from '../presence/presence.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly presenceService: PresenceService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // userId is stored in cookie after login
    const userId = request.cookies?.['crm_user'];

    if (!userId || !this.presenceService.isActive(userId)) {
      throw new UnauthorizedException('No active desktop session');
    }

    return true;
  }
}
```

---

#### `src/auth/auth.service.ts`

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { WsTokenStore } from './ws-token.store';

// Replace with your real database / TypeORM / Prisma lookup
const VALID_USERS: Record<string, string> = {
  admin: 'secret123',
};

@Injectable()
export class AuthService {
  constructor(private readonly wsTokenStore: WsTokenStore) {}

  login(username: string, password: string): { userId: string; wsToken: string } {
    const storedPassword = VALID_USERS[username];

    if (!storedPassword || storedPassword !== password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // userId can be the username or a DB record ID
    const userId = username;
    const wsToken = this.wsTokenStore.issue(userId);

    return { userId, wsToken };
  }
}
```

---

#### `src/auth/auth.controller.ts`

```typescript
import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body('username') username: string,
    @Body('password') password: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, wsToken } = this.authService.login(username, password);

    // Set userId cookie so the browser can be identified by SessionGuard
    res.cookie('crm_user', userId, {
      httpOnly: true,
      sameSite: 'none', // required for cross-origin (Railway API + Namecheap frontend)
      secure: true,     // required with sameSite: 'none'
    });

    // Return wsToken to Python — it uses it to open the WebSocket
    return { wsToken };
  }
}
```

---

#### `src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WsTokenStore } from './ws-token.store';

@Module({
  controllers: [AuthController],
  providers: [AuthService, WsTokenStore],
})
export class AuthModule {}
```

---

#### `src/crm/crm.controller.ts`

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';

@UseGuards(SessionGuard)
@Controller('crm')
export class CrmController {
  @Get()
  getRoot() {
    return { ok: true };
  }
}
```

---

#### `src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PresenceModule } from './presence/presence.module';
import { CrmModule } from './crm/crm.module';

@Module({
  imports: [AuthModule, PresenceModule, CrmModule],
})
export class AppModule {}
```

---

#### `src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.enableCors({
    // Allow both Namecheap frontend and Python app
    origin: [
      'https://your-crm.namecheap-domain.com',
    ],
    credentials: true,
  });

  // Railway injects PORT automatically
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
```

---

### 2. Angular Frontend

#### `src/app/interceptors/auth.interceptor.ts`

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  // withCredentials required for cross-origin cookies (Railway API)
  const cloned = req.clone({ withCredentials: true });

  return next(cloned).pipe(
    catchError((err) => {
      if (err.status === 401) {
        router.navigate(['/access-denied']);
      }
      return throwError(() => err);
    }),
  );
};
```

---

#### `src/app/pages/access-denied/access-denied.component.ts`

```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'app-access-denied',
  standalone: true,
  template: `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: sans-serif;
      background: #f8f8f8;
    ">
      <h1 style="font-size: 6rem; margin: 0; color: #222;">401</h1>
      <p style="font-size: 1.1rem; color: #666; margin-top: 12px;">
        Access denied. Please open the desktop application to continue.
      </p>
    </div>
  `,
})
export class AccessDeniedComponent {}
```

---

#### `src/app/app.config.ts`

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideRouter, Routes } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor';
import { AccessDeniedComponent } from './pages/access-denied/access-denied.component';

const routes: Routes = [
  { path: 'access-denied', component: AccessDeniedComponent },
  // ... your CRM routes
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```

---

### 3. Python Desktop App

#### `desktop/requirements.txt`

```
requests==2.31.0
python-socketio==5.10.0
websocket-client==1.7.0
```

#### `desktop/main.py`

```python
import threading
import webbrowser
import tkinter as tk
from tkinter import messagebox
import requests
import socketio
import atexit

# ─── Configuration ────────────────────────────────────────────────
API_URL  = "https://your-api.railway.app"
CRM_URL  = "https://your-crm.namecheap-domain.com"
# ──────────────────────────────────────────────────────────────────

sio = socketio.Client()
connected = False


# ─── WebSocket events ─────────────────────────────────────────────

@sio.event(namespace='/presence')
def connect():
    global connected
    connected = True
    label_status.config(text="● Connected", fg="green")
    btn_login.config(state=tk.DISABLED)
    btn_logout.config(state=tk.NORMAL)


@sio.event(namespace='/presence')
def disconnect():
    global connected
    connected = False
    label_status.config(text="● Disconnected", fg="red")
    btn_login.config(state=tk.NORMAL)
    btn_logout.config(state=tk.DISABLED)


@sio.on('connected', namespace='/presence')
def on_confirmed(data):
    # Server confirmed session is active — open the browser
    webbrowser.open(CRM_URL)


# ─── Actions ──────────────────────────────────────────────────────

def do_login():
    username = entry_username.get().strip()
    password = entry_password.get().strip()

    if not username or not password:
        messagebox.showwarning("Missing fields", "Please enter username and password.")
        return

    try:
        response = requests.post(
            f"{API_URL}/auth/login",
            json={"username": username, "password": password},
            timeout=5,
        )
    except requests.RequestException:
        messagebox.showerror("Connection Error", f"Cannot reach {API_URL}")
        return

    if response.status_code != 200:
        messagebox.showerror("Login Failed", "Invalid username or password.")
        return

    ws_token = response.json().get("wsToken")

    if not ws_token:
        messagebox.showerror("Error", "Server did not return a session token.")
        return

    # Open WebSocket connection — pass wsToken as query param
    def connect_ws():
        try:
            sio.connect(
                API_URL,
                namespaces=['/presence'],
                socketio_path='/socket.io',
                transports=['websocket'],
                auth={"wsToken": ws_token},
                # socket.io passes auth in handshake query automatically
            )
            sio.wait()
        except Exception as e:
            label_status.config(text="● Connection failed", fg="red")

    threading.Thread(target=connect_ws, daemon=True).start()


def do_logout():
    if sio.connected:
        sio.disconnect()


def on_close():
    do_logout()
    root.destroy()


atexit.register(do_logout)


# ─── UI ───────────────────────────────────────────────────────────
root = tk.Tk()
root.title("CRM Access")
root.geometry("320x220")
root.resizable(False, False)
root.protocol("WM_DELETE_WINDOW", on_close)

tk.Label(root, text="CRM Secure Access", font=("Arial", 14, "bold")).pack(pady=(20, 10))

frame = tk.Frame(root)
frame.pack(pady=4)

tk.Label(frame, text="Username:", width=10, anchor="e").grid(row=0, column=0, pady=4)
entry_username = tk.Entry(frame, width=20)
entry_username.grid(row=0, column=1)

tk.Label(frame, text="Password:", width=10, anchor="e").grid(row=1, column=0, pady=4)
entry_password = tk.Entry(frame, show="*", width=20)
entry_password.grid(row=1, column=1)

btn_frame = tk.Frame(root)
btn_frame.pack(pady=10)

btn_login = tk.Button(
    btn_frame, text="Login & Open CRM",
    width=18, command=do_login
)
btn_login.grid(row=0, column=0, padx=6)

btn_logout = tk.Button(
    btn_frame, text="Logout",
    width=10, command=do_logout,
    state=tk.DISABLED
)
btn_logout.grid(row=0, column=1, padx=6)

label_status = tk.Label(root, text="● Disconnected", fg="red", font=("Arial", 10))
label_status.pack()

root.mainloop()
```

> **Note on `wsToken` in socket.io:** The `auth` object in `sio.connect()` is sent as part of the socket.io handshake. On the NestJS side, read it from `socket.handshake.auth.wsToken` instead of `socket.handshake.query.wsToken`. Update `presence.gateway.ts` accordingly:
> ```typescript
> const wsToken = socket.handshake.auth?.wsToken as string;
> ```

---

## Railway — Required Environment Variables

Set these in your Railway project dashboard under **Variables**:

| Variable | Value |
|---|---|
| `PORT` | Set automatically by Railway — do not override |
| `COOKIE_SECRET` | A long random string for signing cookies (optional but recommended) |
| `FRONTEND_URL` | `https://your-crm.namecheap-domain.com` |

---

## Railway — WebSocket Support

Railway supports WebSockets natively on all plans. No extra configuration needed. Socket.io will automatically use the `wss://` protocol since Railway enforces HTTPS.

The NestJS WebSocket gateway path will be:
```
wss://your-api.railway.app/presence
```

---

## Namecheap — CORS Cookie Requirement

Because the Angular frontend (Namecheap) and the NestJS API (Railway) are on **different origins**, cookies require these exact settings:

**NestJS side (already in the code above):**
```typescript
res.cookie('crm_user', userId, {
  sameSite: 'none',  // allows cross-origin
  secure: true,      // required with sameSite: 'none' — HTTPS only
  httpOnly: true,
});
```

**Angular side (already in the interceptor above):**
```typescript
req.clone({ withCredentials: true })
```

Without both of these, the browser will not send the cookie on cross-origin requests and every request will return 401.

---

## Configuration Reference

| Parameter | File | Value |
|---|---|---|
| WsToken TTL | `ws-token.store.ts` | `30_000` ms |
| Cookie name | `auth.controller.ts` + `session.guard.ts` | `crm_user` |
| WS namespace | `presence.gateway.ts` + `main.py` | `/presence` |
| API URL | `main.py` | `https://your-api.railway.app` |
| CRM URL | `main.py` | `https://your-crm.namecheap-domain.com` |

---

## Production Checklist

- [ ] Replace hardcoded `VALID_USERS` in `auth.service.ts` with a real database lookup
- [ ] Hash passwords with `bcrypt`
- [ ] Add rate limiting to `POST /auth/login` using `@nestjs/throttler`
- [ ] Tighten `cors origin` in `presence.gateway.ts` to your frontend URL only
- [ ] Add `COOKIE_SECRET` and sign cookies with `cookie-parser`
- [ ] Build Python app as a standalone executable with PyInstaller

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name "CRM Access" desktop/main.py
```

---

## File Checklist for the Agent

```
backend/src/auth/ws-token.store.ts          ← create
backend/src/auth/auth.service.ts            ← create
backend/src/auth/auth.controller.ts         ← create
backend/src/auth/auth.module.ts             ← create
backend/src/auth/session.guard.ts           ← create
backend/src/presence/presence.service.ts    ← create
backend/src/presence/presence.gateway.ts    ← create
backend/src/presence/presence.module.ts     ← create
backend/src/crm/crm.controller.ts           ← modify (add @UseGuards)
backend/src/app.module.ts                   ← modify (add PresenceModule)
backend/src/main.ts                         ← modify (cookieParser + cors)

frontend/src/app/interceptors/auth.interceptor.ts          ← create
frontend/src/app/pages/access-denied/*.component.ts        ← create
frontend/src/app/app.config.ts              ← modify (interceptor + route)

desktop/main.py                             ← create
desktop/requirements.txt                    ← create
```
