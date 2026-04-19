import { Injectable, OnModuleInit, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import makeWASocket, { 
  DisconnectReason, 
  fetchLatestBaileysVersion, 
  makeCacheableSignalKeyStore,
  WAMessage,
  WASocket,
  jidNormalizedUser
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode';
import pino from 'pino';
import { WhatsappChannel, WhatsappChannelDocument } from './schemas/whatsapp-channel.schema';
import { WhatsappMessage, WhatsappMessageDocument } from './schemas/whatsapp-message.schema';
import { WhatsappSession, WhatsappSessionDocument } from './schemas/whatsapp-session.schema';
import { useMongoDBAuthState } from './mongodb-auth';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { UsersService } from '../users/users.service';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldValue } from 'firebase-admin/firestore';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly pinoLogger = pino({ level: 'silent' });
  private sessions = new Map<string, WASocket>();

  constructor(
    @InjectModel(WhatsappChannel.name) private channelModel: Model<WhatsappChannelDocument>,
    @InjectModel(WhatsappMessage.name) private messageModel: Model<WhatsappMessageDocument>,
    @InjectModel(WhatsappSession.name) private sessionModel: Model<WhatsappSessionDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    private readonly usersService: UsersService,
    private readonly firebaseService: FirebaseService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue('whatsapp-messages') private messageQueue: Queue,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing WhatsApp Service...');
    const channels = await this.channelModel.find({ isActive: true }).exec();
    for (const channel of channels) {
      if (channel.status === 'connected') {
        this.initSession(channel);
      }
    }
  }

  async initSession(channel: WhatsappChannelDocument) {
    const sessionId = channel.sessionId;
    const channelId = channel._id.toString();

    this.logger.log(`Initializing session for ${channel.label} (${sessionId})`);

    try {
      const { state, saveCreds } = await useMongoDBAuthState(
        this.sessionModel,
        sessionId,
        channelId
      );

      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.pinoLogger as any),
        },
        browser: ['EN TEC CRM', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: true,
        logger: this.pinoLogger as any,
      });

      this.sessions.set(sessionId, sock);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const db = this.firebaseService.getFirestore();
        const channelRef = db.collection('whatsappChannels').doc(channelId);

        if (qr) {
          const qrBase64 = await qrcode.toDataURL(qr);
          await this.channelModel.findByIdAndUpdate(channelId, { 
            qrCode: qrBase64,
            status: 'qr_pending'
          });

          await channelRef.set({
            qrCode: qrBase64,
            status: 'qr_pending',
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          this.logger.log(`Connection closed for ${sessionId}. Reconnect: ${shouldReconnect}`);
          
          await this.channelModel.findByIdAndUpdate(channelId, { status: 'disconnected', qrCode: undefined });
          
          await channelRef.set({
            status: 'disconnected',
            qrCode: '',
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });

          if (shouldReconnect) {
            setTimeout(() => this.initSession(channel), 5000);
          } else {
            this.sessions.delete(sessionId);
          }
        } else if (connection === 'open') {
          this.logger.log(`Connection opened for ${sessionId}`);
          const phoneNumber = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : 'Unknown';
          
          // Verify phone number match if it was previously set
          if (channel.phoneNumber && channel.phoneNumber !== 'Pending' && channel.phoneNumber !== phoneNumber) {
            this.logger.error(`Connection rejected: Scanned number ${phoneNumber} does not match registered number ${channel.phoneNumber}`);
            await sock.logout();
            
            await channelRef.set({
              status: 'wrong_number',
              updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return;
          }

          await this.channelModel.findByIdAndUpdate(channelId, { 
            status: 'connected', 
            qrCode: undefined,
            phoneNumber,
            lastConnectedAt: new Date()
          });

          await channelRef.set({
            status: 'connected',
            qrCode: '',
            phoneNumber,
            lastConnectedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
      });

      sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
          for (const msg of m.messages) {
            if (!msg.key.fromMe && msg.message) {
              await this.handleIncomingMessage(channelId, sessionId, msg);
            }
          }
        }
      });

      return sock;
    } catch (error) {
      this.logger.error(`Failed to init session ${sessionId}: ${error.message}`);
      await this.channelModel.findByIdAndUpdate(channelId, { status: 'disconnected' });
    }
  }

  private async handleIncomingMessage(channelId: string, sessionId: string, msg: WAMessage) {
    const fromJid = msg.key.remoteJid;
    if (!fromJid) return;

    const phoneNumber = fromJid.split('@')[0].replace(/\D/g, '');
    
    const content = msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || 
                    '[Non-text message]';

    // Try to find a matching lead by phone number
    const lead = await this.leadModel.findOne({ 
      phone: { $regex: phoneNumber } 
    }).exec();

    const timestamp = new Date((msg.messageTimestamp as number) * 1000);

    const newMessage = new this.messageModel({
      channelId: new Types.ObjectId(channelId),
      leadId: lead?._id,
      externalNumber: phoneNumber,
      direction: 'inbound',
      content,
      waMessageId: msg.key.id,
      timestamp,
      status: 'delivered'
    });

    await newMessage.save();
    
    // Save to Firestore
    const db = this.firebaseService.getFirestore();
    const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
    
    await messageRef.set({
      externalNumber: phoneNumber,
      leadId: lead?._id?.toString() || null,
      direction: 'inbound',
      content,
      status: 'delivered',
      waMessageId: msg.key.id,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Notify agents
    try {
      const channel = await this.channelModel.findById(channelId);
      if (channel) {
        let recipientIds: string[] = [];
        
        if (channel.allAgentsAccess) {
          // Get all agents if allAgentsAccess is true
          const allUsers = await this.usersService.findAll();
          recipientIds = allUsers.map(u => (u as any).id || (u as any)._id.toString());
        } else {
          recipientIds = channel.assignedAgents.map(id => id.toString());
        }
        
        // If we have specific agents, create notifications for them
        if (recipientIds.length > 0) {
          await this.notificationsService.createBulk(
            recipientIds,
            'whatsapp_message',
            'رسالة واتساب جديدة',
            `${lead?.name || phoneNumber}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
            { channelId, leadId: lead?._id?.toString(), phoneNumber }
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to notify agents for message on channel ${channelId}: ${error.message}`);
    }
  }

  async createChannel(label: string, userId: string) {
    const sessionId = `session_${Date.now()}`;
    const channel = new this.channelModel({
      label,
      sessionId,
      phoneNumber: 'Pending',
      createdBy: new Types.ObjectId(userId),
    });
    await channel.save();

    // Create channel in Firestore
    const db = this.firebaseService.getFirestore();
    await db.collection('whatsappChannels').doc(channel._id.toString()).set({
      label,
      sessionId,
      phoneNumber: 'Pending',
      status: 'disconnected',
      assignedAgents: [],
      allAgentsAccess: false,
      updatedAt: FieldValue.serverTimestamp()
    });
    
    // Start session to get QR
    await this.initSession(channel);
    return channel;
  }

  async getChannels(user: any) {
    const filter: any = { isActive: true };
    if (user.role === 'agent') {
      const currentUserId = user.userId || user.id;
      filter.$or = [
        { assignedAgents: new Types.ObjectId(currentUserId) },
        { allAgentsAccess: true }
      ];
    }
    return this.channelModel.find(filter).populate('assignedAgents', 'name email').exec();
  }

  async deleteChannel(id: string) {
    const channel = await this.channelModel.findById(id);
    if (!channel) throw new NotFoundException('Channel not found');

    const sock = this.sessions.get(channel.sessionId);
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {}
      this.sessions.delete(channel.sessionId);
    }

    await this.channelModel.findByIdAndDelete(id);
    await this.sessionModel.deleteMany({ channelId: new Types.ObjectId(id) });

    // Delete from Firestore
    const db = this.firebaseService.getFirestore();
    await db.collection('whatsappChannels').doc(id).delete();

    return { success: true };
  }

  async reconnect(id: string) {
    const channel = await this.channelModel.findById(id);
    if (!channel) throw new NotFoundException('Channel not found');

    // Remove old session if exists
    const oldSock = this.sessions.get(channel.sessionId);
    if (oldSock) {
      try { await oldSock.logout(); } catch (e) {}
      this.sessions.delete(channel.sessionId);
    }

    // Set to pending and re-init
    channel.status = 'qr_pending';
    channel.qrCode = undefined;
    await channel.save();

    // Update Firestore
    const db = this.firebaseService.getFirestore();
    await db.collection('whatsappChannels').doc(id).set({
      status: 'qr_pending',
      qrCode: '',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    this.initSession(channel as any);
    return { success: true };
  }

  async updateChannelAgents(id: string, agents: string[], allAgentsAccess: boolean) {
    const channel = await this.channelModel.findByIdAndUpdate(
      id,
      { 
        assignedAgents: agents.map(a => new Types.ObjectId(a)),
        allAgentsAccess 
      },
      { new: true }
    ).populate('assignedAgents', 'name email').exec();
    
    if (!channel) throw new NotFoundException('Channel not found');

    // Update Firestore
    const db = this.firebaseService.getFirestore();
    await db.collection('whatsappChannels').doc(id).set({
      assignedAgents: agents,
      allAgentsAccess,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return channel;
  }

  async sendMessage(channelId: string, leadId: string, content: string, agentId: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const lead = await this.leadModel.findById(leadId);
    if (!lead) throw new NotFoundException('Lead not found');

    // Add to queue instead of sending immediately
    const job = await this.messageQueue.add('send-message', {
      channelId,
      leadId,
      content,
      agentId
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });

    return { jobId: job.id, status: 'queued' };
  }

  async sendDirectMessage(channelId: string, leadId: string, content: string, agentId: string) {
    this.logger.log(`sendDirectMessage: Attempting to send message to lead ${leadId} via channel ${channelId}`);
    
    const channel = await this.channelModel.findById(channelId);
    if (!channel) {
      this.logger.error(`sendDirectMessage: Channel ${channelId} not found`);
      throw new NotFoundException('Channel not found');
    }

    const lead = await this.leadModel.findById(leadId);
    if (!lead) {
      this.logger.error(`sendDirectMessage: Lead ${leadId} not found`);
      throw new NotFoundException('Lead not found');
    }

    let sock = this.sessions.get(channel.sessionId);
    
    // Auto-reinit if status is connected but session is missing from memory (e.g. after restart)
    if (!sock && channel.status === 'connected') {
      this.logger.warn(`sendDirectMessage: Channel ${channel.label} is marked connected but session is missing. Re-initializing...`);
      sock = await this.initSession(channel);
    }

    if (!sock || channel.status !== 'connected') {
      const reason = !sock ? 'Session missing' : `Channel status is ${channel.status}`;
      this.logger.error(`sendDirectMessage: WhatsApp channel ${channel.label} is not connected. Reason: ${reason}`);
      throw new Error(`WhatsApp channel is not connected (${reason})`);
    }

    // Clean phone number: remove any non-digit except possibly a + at start
    const cleanPhone = lead.phone.replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;

    const result = await sock.sendMessage(jid, { text: content });
    if (!result) throw new Error('Failed to send message');
    
    const newMessage = new this.messageModel({
      channelId: channel._id,
      leadId: lead._id,
      externalNumber: cleanPhone,
      direction: 'outbound',
      content,
      waMessageId: result.key.id,
      timestamp: new Date(),
      status: 'sent',
      sentByAgent: new Types.ObjectId(agentId)
    });

    await newMessage.save();

    // Save to Firestore
    const db = this.firebaseService.getFirestore();
    const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
    
    await messageRef.set({
      externalNumber: cleanPhone,
      leadId: lead._id.toString(),
      direction: 'outbound',
      content,
      status: 'sent',
      sentByAgent: agentId,
      waMessageId: result.key.id,
      timestamp: FieldValue.serverTimestamp(),
    });

    return newMessage;
  }

  async getMessages(channelId: string, phoneNumber: string) {
    return this.messageModel.find({
      channelId: new Types.ObjectId(channelId),
      externalNumber: phoneNumber
    })
    .sort({ timestamp: 1 })
    .limit(100)
    .exec();
  }
}
