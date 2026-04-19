import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { FieldValue } from 'firebase-admin/firestore';

export interface NotificationPayload {
  leadId?: string;
  channelId?: string;
  sessionId?: string;
  [key: string]: any;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private firebaseService: FirebaseService) {}

  async create(
    recipientId: string,
    type: 'lead_reminder' | 'whatsapp_message' | 'whatsapp_qr' | 'whatsapp_status',
    title: string,
    body: string,
    payload: NotificationPayload = {},
  ) {
    try {
      const db = this.firebaseService.getFirestore();
      const notificationRef = db.collection('notifications').doc();
      
      const data = {
        recipientId,
        type,
        title,
        body,
        payload,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      };

      await notificationRef.set(data);
      this.logger.log(`Notification created successfully in Firestore for user ${recipientId}: ${type}`);
    } catch (error) {
      this.logger.error(`Failed to create notification for user ${recipientId}: ${error.message}`, error.stack);
    }
  }

  async createBulk(
    recipientIds: string[],
    type: 'lead_reminder' | 'whatsapp_message' | 'whatsapp_qr' | 'whatsapp_status',
    title: string,
    body: string,
    payload: NotificationPayload = {},
  ) {
    if (!recipientIds || recipientIds.length === 0) {
      this.logger.warn(`createBulk called with empty recipientIds for type: ${type}`);
      return;
    }

    try {
      const db = this.firebaseService.getFirestore();
      const batch = db.batch();

      recipientIds.forEach((recipientId) => {
        const notificationRef = db.collection('notifications').doc();
        batch.set(notificationRef, {
          recipientId,
          type,
          title,
          body,
          payload,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      await batch.commit();
      this.logger.log(`Bulk notifications (${recipientIds.length}) created successfully in Firestore for type: ${type}`);
    } catch (error) {
      this.logger.error(`Failed to create bulk notifications: ${error.message}`, error.stack);
    }
  }
}
