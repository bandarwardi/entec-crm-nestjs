import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { FieldValue } from 'firebase-admin/firestore';
import { UsersService } from '../users/users.service';

export interface NotificationPayload {
  leadId?: string;
  channelId?: string;
  sessionId?: string;
  [key: string]: any;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private firebaseService: FirebaseService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {}

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

      // Send Push Notification if user has FCM token
      await this.sendPushNotification(recipientId, title, body, { ...payload, type });
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

      // Send Push Notifications in background
      for (const recipientId of recipientIds) {
        this.sendPushNotification(recipientId, title, body, { ...payload, type }).catch(err => 
          this.logger.error(`Push failed for ${recipientId}: ${err.message}`)
        );
      }
    } catch (error) {
      this.logger.error(`Failed to create bulk notifications: ${error.message}`, error.stack);
    }
  }

  private async sendPushNotification(userId: string, title: string, body: string, data: any = {}) {
    try {
      const user = await this.usersService.findOne(userId);
      // We need to make sure findOne returns fcmToken, the current implementation selects specific fields
      // Let's use a more direct check or update findOne
      
      // If the user has a token, send it
      const fcmToken = (user as any).fcmToken;
      if (!fcmToken) return;

      const messaging = this.firebaseService.getMessaging();
      
      // Clean data values to be strings (FCM requirement)
      const stringData: { [key: string]: string } = {};
      Object.keys(data).forEach(key => {
        if (data[key]) {
          stringData[key] = String(data[key]);
        }
      });

      await messaging.send({
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: stringData,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'whatsapp_messages',
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      });

      this.logger.log(`Push notification sent successfully to user ${userId}`);
    } catch (error) {
      this.logger.error(`Push notification failed for user ${userId}: ${error.message}`);
    }
  }
}
