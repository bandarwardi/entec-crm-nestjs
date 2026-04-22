import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const serviceAccountBase64 = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');

    if (!serviceAccountBase64) {
      this.logger.error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not defined in environment variables');
      return;
    }

    try {
      const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
      const serviceAccount = JSON.parse(serviceAccountJson);

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });

      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase Admin SDK: ${error.message}`, error.stack);
    }
  }

  isInitialized() {
    return !!this.firebaseApp;
  }

  getFirestore() {
    if (!this.firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized. Check FIREBASE_SERVICE_ACCOUNT_BASE64.');
    }
    return admin.firestore(this.firebaseApp);
  }

  getAuth() {
    return admin.auth(this.firebaseApp);
  }

  getMessaging() {
    if (!this.firebaseApp) {
      throw new Error('Firebase Admin SDK is not initialized.');
    }
    return admin.messaging(this.firebaseApp);
  }
}
