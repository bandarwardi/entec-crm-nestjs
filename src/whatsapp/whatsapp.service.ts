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
  jidNormalizedUser,
  Contact,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode';
import pino from 'pino';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { ConfigService } from '@nestjs/config';
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
  private lidMaps = new Map<string, Map<string, string>>();

  constructor(
    @InjectModel(WhatsappChannel.name) private channelModel: Model<WhatsappChannelDocument>,
    @InjectModel(WhatsappMessage.name) private messageModel: Model<WhatsappMessageDocument>,
    @InjectModel(WhatsappSession.name) private sessionModel: Model<WhatsappSessionDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    private readonly usersService: UsersService,
    private readonly firebaseService: FirebaseService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    @InjectQueue('whatsapp-messages') private messageQueue: Queue,
  ) {}

  private async uploadMedia(buffer: Buffer, filename: string): Promise<string | null> {
    try {
      const uploadUrl = this.configService.get<string>('UPLOAD_API_URL');
      if (!uploadUrl) {
        this.logger.error('UPLOAD_API_URL not found in environment variables');
        return null;
      }

      const form = new (FormData as any)();
      let contentType = 'image/jpeg';
      if (filename.endsWith('.webp')) contentType = 'image/webp';
      else if (filename.endsWith('.mp4')) contentType = 'video/mp4';
      else if (filename.endsWith('.mp3')) contentType = 'audio/mpeg';

      form.append('file', buffer, { 
        filename,
        contentType
      });

      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: form as any,
      });

      const result: any = await response.json();
      if (result && (result.url || result.file_url)) {
        return result.url || result.file_url;
      }

      this.logger.error(`Upload failed: ${JSON.stringify(result)}`);
      return null;
    } catch (error) {
      this.logger.error(`Error uploading media: ${error.message}`);
      return null;
    }
  }

  private getLidMap(sessionId: string): Map<string, string> {
    if (!this.lidMaps.has(sessionId)) {
      this.lidMaps.set(sessionId, new Map<string, string>());
    }
    return this.lidMaps.get(sessionId)!;
  }

  private async resolveToPn(sock: WASocket, sessionId: string, jid: string, msg: WAMessage): Promise<{ pn: string, source: string, unresolved: boolean }> {
    // Layer 1: Check JID directly
    if (jid.endsWith('@s.whatsapp.net')) {
      return { pn: jid.split('@')[0], source: 'direct', unresolved: false };
    }

    // Layer 2: Check remoteJidAlt / participantAlt (Fastest)
    const key = msg.key as any;
    if (key.remoteJidAlt && key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
      const pn = key.remoteJidAlt.split('@')[0];
      this.getLidMap(sessionId).set(jid, pn); // Cache it
      return { pn, source: 'alt_jid', unresolved: false };
    }

    if (key.participantAlt && key.participantAlt.endsWith('@s.whatsapp.net')) {
      const pn = key.participantAlt.split('@')[0];
      this.getLidMap(sessionId).set(jid, pn); // Cache it
      return { pn, source: 'alt_participant', unresolved: false };
    }

    // Layer 3: Official Baileys Store (signalRepository.lidMapping)
    try {
      const officialPn = await (sock as any).signalRepository.lidMapping.getPNForLID(jid);
      if (officialPn) {
        const pn = officialPn.split('@')[0];
        this.getLidMap(sessionId).set(jid, pn); // Cache it
        return { pn, source: 'official_store', unresolved: false };
      }
    } catch (e) {
      this.logger.debug(`[LID] Failed to query official store for ${jid}: ${e.message}`);
    }

    // Layer 4: In-memory Map (built from events)
    const cachedPn = this.getLidMap(sessionId).get(jid);
    if (cachedPn) {
      return { pn: cachedPn, source: 'memory_map', unresolved: false };
    }

    // Layer 5: Fallback to Raw JID
    const rawPn = jid.split('@')[0].replace(/\D/g, '');
    return { pn: rawPn, source: 'raw_fallback', unresolved: jid.endsWith('@lid') };
  }

  async onModuleInit() {
    this.logger.log('Initializing WhatsApp Service...');
    const channels = await this.channelModel.find({ isActive: true }).exec();
    for (const channel of channels) {
      if (channel.status === 'connected') {
        this.initSession(channel);
      }
    }

    // Start background job for LID resolution retries
    setInterval(() => this.retryUnresolvedLids(), 5 * 60 * 1000); // Every 5 minutes
  }

  private async retryUnresolvedLids() {
    try {
      const unresolvedMessages = await this.messageModel.find({ unresolvedLid: true }).limit(100).exec();
      if (unresolvedMessages.length === 0) return;

      this.logger.log(`[LID Retry] Attempting to resolve ${unresolvedMessages.length} messages...`);

      for (const msg of unresolvedMessages) {
        const sock = Array.from(this.sessions.values())[0]; // Just take first active session for now, or match by channelId
        if (!sock) continue;

        const sessionId = Array.from(this.sessions.keys())[0]; // This is a bit naive if multi-session, but good enough for now
        
        // Better: Find the correct session for this message's channel
        const channel = await this.channelModel.findById(msg.channelId);
        if (!channel) continue;
        const correctSock = this.sessions.get(channel.sessionId);
        if (!correctSock) continue;

        const { pn, source, unresolved } = await this.resolveToPn(correctSock, channel.sessionId, msg.lidJid, { key: { remoteJid: msg.lidJid } } as any);
        
        if (!unresolved) {
          this.logger.log(`[LID Retry] Resolved ${msg.lidJid} -> ${pn} via ${source}`);
          
          // Match Lead
          const last8 = pn.slice(-8);
          const lead = await this.leadModel.findOne({ phone: { $regex: last8 + '$' } }).exec();

          // Update MongoDB
          msg.externalNumber = pn;
          msg.unresolvedLid = false;
          if (lead) {
            msg.leadId = lead._id as any;
          }
          await msg.save();

          // Update Firestore
          const db = this.firebaseService.getFirestore();
          const messagesSnapshot = await db.collection('whatsappChannels')
            .doc(msg.channelId.toString())
            .collection('messages')
            .where('waMessageId', '==', msg.waMessageId)
            .get();

          for (const doc of messagesSnapshot.docs) {
            await doc.ref.update({
              externalNumber: pn,
              leadId: lead?._id?.toString() || null,
              unresolvedLid: false
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(`[LID Retry] Error: ${error.message}`);
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

      // LID Mapping Listeners
      sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
        const pnOnly = pn.split('@')[0];
        this.getLidMap(sessionId).set(lid, pnOnly);
        this.logger.debug(`[LID] Update: ${lid} -> ${pnOnly}`);
      });

      sock.ev.on('contacts.upsert', (contacts: Contact[]) => {
        for (const c of contacts) {
          if (c.lid && c.phoneNumber) {
            const pn = c.phoneNumber.split('@')[0];
            this.getLidMap(sessionId).set(c.lid, pn);
            this.logger.debug(`[LID] Upsert: ${c.lid} -> ${pn}`);
          }
        }
      });

      sock.ev.on('contacts.update', (contacts: Partial<Contact>[]) => {
        for (const c of contacts) {
          if (c.lid && c.phoneNumber) {
            const pn = c.phoneNumber.split('@')[0];
            this.getLidMap(sessionId).set(c.lid, pn);
            this.logger.debug(`[LID] Contact Update: ${c.lid} -> ${pn}`);
          }
        }
      });

      sock.ev.on('messaging-history.set', ({ contacts }: { contacts: Contact[] }) => {
        if (contacts) {
          for (const c of contacts) {
            if (c.lid && c.phoneNumber) {
              const pn = c.phoneNumber.split('@')[0];
              this.getLidMap(sessionId).set(c.lid, pn);
              this.logger.debug(`[LID] History Sync: ${c.lid} -> ${pn}`);
            }
          }
        }
      });

      sock.ev.on('presence.update', async (update) => {
        const { id, presences } = update;
        // In Baileys v7, presences is a map of participant JID to PresenceData
        // For individual chats, we check the main JID's presence
        const presence = Object.values(presences || {})[0]?.lastKnownPresence;
        
        // presence can be 'unavailable', 'available', 'composing', 'recording', 'paused'
        const isOnline = presence === 'available' || presence === 'composing' || presence === 'recording';
        const phoneNumber = id.split('@')[0];
        const last8 = phoneNumber.slice(-8);

        this.logger.debug(`[Presence] ${id} is now ${presence}`);

        // Update Lead status
        await this.leadModel.findOneAndUpdate(
          { phone: { $regex: last8 + '$' } },
          { isOnline }
        );
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
          const { key, update: msgUpdate } = update;
          if (msgUpdate.status) {
            // Status codes: 2=Sent, 3=Delivered, 4=Read
            let statusStr = 'sent';
            if (msgUpdate.status === 3) statusStr = 'delivered';
            if (msgUpdate.status === 4) statusStr = 'read';

            this.logger.debug(`[Message Update] ID: ${key.id}, Status: ${statusStr}`);

            // Update MongoDB
            await this.messageModel.findOneAndUpdate(
              { waMessageId: key.id },
              { status: statusStr }
            );

            // Update Firestore
            try {
              const db = this.firebaseService.getFirestore();
              const messagesSnapshot = await db.collection('whatsappChannels')
                .doc(channelId)
                .collection('messages')
                .where('waMessageId', '==', key.id)
                .get();

              for (const doc of messagesSnapshot.docs) {
                await doc.ref.update({ status: statusStr });
              }
            } catch (fsError) {
              this.logger.error(`[Message Update] Firestore update failed: ${fsError.message}`);
            }
          }
        }
      });

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
    try {
      const sock = this.sessions.get(sessionId);
      if (!sock) {
        this.logger.error(`[Incoming] Sock not found for session ${sessionId}`);
        return;
      }

      const fromJid = msg.key.remoteJid;
      if (!fromJid || fromJid === 'status@broadcast') return;

      // Check if message already exists (to prevent duplicates from system's own sends)
      const existingMsg = await this.messageModel.findOne({ waMessageId: msg.key.id }).exec();
      if (existingMsg) {
        this.logger.debug(`[Incoming] Message ${msg.key.id} already exists, skipping.`);
        return;
      }

      // Step 1: Resolve the real phone number
      const { pn: phoneNumber, source, unresolved } = await this.resolveToPn(sock, sessionId, fromJid, msg);
      
      const direction = msg.key.fromMe ? 'outbound' : 'inbound';
      this.logger.log(`[Incoming Sync] direction=${direction}, source=${source}, lid=${fromJid}, pn=${phoneNumber}`);

      const content = msg.message?.conversation || 
                      msg.message?.extendedTextMessage?.text || 
                      msg.message?.imageMessage?.caption ||
                      msg.message?.videoMessage?.caption ||
                      (msg.message?.stickerMessage ? '[Sticker]' : null) ||
                      (msg.message?.audioMessage ? '[Voice Note]' : null) ||
                      '[Non-text message]';

      const messageType = msg.message?.stickerMessage ? 'sticker' : 
                         (msg.message?.imageMessage ? 'image' : 
                         (msg.message?.videoMessage ? 'video' : 
                         (msg.message?.audioMessage ? 'audio' : 'text')));

      let mediaUrl: string | null = null;
      if (messageType !== 'text') {
        this.logger.log(`[Media] Detected ${messageType}, attempting download...`);
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, { 
            logger: this.pinoLogger as any,
            re_use_local_cache: true 
          } as any) as Buffer;
          
          if (buffer) {
            this.logger.log(`[Media] Downloaded ${messageType} (${buffer.length} bytes)`);
            let ext = 'bin';
            if (messageType === 'sticker') ext = 'webp';
            else if (messageType === 'image') ext = 'jpg';
            else if (messageType === 'video') ext = 'mp4';
            else if (messageType === 'audio') ext = 'mp3';

            const filename = `wa_${msg.key.id}.${ext}`;
            mediaUrl = await this.uploadMedia(buffer, filename);
            if (mediaUrl) {
              this.logger.log(`[Media] Uploaded ${messageType} successfully: ${mediaUrl}`);
            } else {
              this.logger.error(`[Media] Upload failed for ${messageType}`);
            }
          } else {
            this.logger.warn(`[Media] Download returned empty buffer for ${messageType}`);
          }
        } catch (downloadError) {
          this.logger.error(`[Media] Download failed for ${messageType}: ${downloadError.message}`);
        }
      }

      // Advanced Lead Matching: Match by the last 8 digits
      let lead: any = null;
      if (!unresolved && phoneNumber.length >= 8) {
        const last8 = phoneNumber.slice(-8);
        lead = await this.leadModel.findOne({ 
          phone: { $regex: last8 + '$' } 
        }).exec();
      }

      if (lead) {
        this.logger.log(`[Incoming] Found matching lead: ${lead.name} (${lead._id})`);
        
        // Background update for Profile Picture and Last Message
        const updateData: any = { lastMessageAt: new Date() };
        
        // Only fetch profile pic if not already set or every once in a while
        if (!lead.profilePicUrl) {
          try {
            const ppUrl = await sock.profilePictureUrl(fromJid, 'image').catch(() => null);
            if (ppUrl) updateData.profilePicUrl = ppUrl;
          } catch (e) {}
        }

        await this.leadModel.findByIdAndUpdate(lead._id, updateData);
      } else if (unresolved) {
        this.logger.warn(`[Incoming] Message from unresolved LID ${fromJid}. Will retry later.`);
      } else {
        this.logger.warn(`[Incoming] No lead found for phone ${phoneNumber}.`);
      }

      const timestamp = new Date((msg.messageTimestamp as number) * 1000);

      const newMessage = new this.messageModel({
        channelId: new Types.ObjectId(channelId),
        leadId: lead?._id,
        externalNumber: phoneNumber,
        direction,
        content,
        messageType,
        waMessageId: msg.key.id,
        timestamp,
        status: 'delivered',
        unresolvedLid: unresolved,
        lidJid: fromJid.endsWith('@lid') ? fromJid : undefined
      });

      await newMessage.save();
      
      // Save to Firestore
      const db = this.firebaseService.getFirestore();
      const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
      
      await messageRef.set({
        externalNumber: phoneNumber,
        leadId: lead?._id?.toString() || null,
        direction,
        content: content || '',
        messageType: messageType || 'text',
        mediaUrl: mediaUrl || null,
        status: 'delivered',
        waMessageId: msg.key.id,
        timestamp: FieldValue.serverTimestamp(),
        unresolvedLid: !!unresolved,
        lidJid: (fromJid.endsWith('@lid') ? fromJid : null) || null
      });

      this.logger.log(`[Incoming] Message saved to Firestore: whatsappChannels/${channelId}/messages/${messageRef.id}`);

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
        this.logger.error(`[Incoming] Failed to notify agents: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(`[Incoming] CRITICAL ERROR handling incoming message: ${error.message}`);
      console.error(error);
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

  async sendMessage(channelId: string, leadId: string, content: string, agentId: string, agentName: string = 'System', messageType: string = 'text', mediaUrl?: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const lead = await this.leadModel.findById(leadId);
    if (!lead) throw new NotFoundException('Lead not found');

    // Add to queue with deduplication based on content and leadId
    const jobId = `send_${leadId}_${Buffer.from(content.substring(0, 20)).toString('hex')}_${Date.now()}`;
    
    const job = await this.messageQueue.add('send-message', {
      channelId,
      leadId,
      content,
      agentId,
      agentName,
      messageType,
      mediaUrl
    }, {
      jobId, // Use specific jobId to help prevent duplicates
      attempts: 1, // Only try once to avoid banning
      removeOnComplete: true,
      removeOnFail: true
    });

    return { jobId: job.id, status: 'queued' };
  }

  async sendDirectMessage(channelId: string, leadId: string, content: string, agentId: string, agentName: string = 'System', messageType: string = 'text', mediaUrl?: string) {
    this.logger.log(`sendDirectMessage: Attempting to send ${messageType} to lead ${leadId} via channel ${channelId}`);
    
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

    const result = await (async () => {
      if (messageType === 'sticker' && mediaUrl) {
        return await sock.sendMessage(jid, { sticker: { url: mediaUrl } });
      } else if (messageType === 'audio' && mediaUrl) {
        return await sock.sendMessage(jid, { audio: { url: mediaUrl }, ptt: true });
      } else if (messageType === 'image' && mediaUrl) {
        return await sock.sendMessage(jid, { image: { url: mediaUrl }, caption: content });
      } else {
        return await sock.sendMessage(jid, { text: content });
      }
    })();

    if (!result) throw new Error('Failed to send message');
    
    // Update lastMessageAt for sorting
    await this.leadModel.findByIdAndUpdate(lead._id, { lastMessageAt: new Date() });

    try {
      this.logger.log(`[Firestore] Saving outbound message to MongoDB...`);
      
      // Fallback content for DB if empty (for media)
      let dbContent = content;
      if (!dbContent) {
        if (messageType === 'sticker') dbContent = '[Sticker]';
        else if (messageType === 'audio') dbContent = '[Voice Note]';
        else if (messageType === 'image') dbContent = '[Image]';
      }

      const newMessage = new this.messageModel({
        channelId: channel._id,
        leadId: lead._id,
        externalNumber: cleanPhone,
        direction: 'outbound',
        content: dbContent || '',
        messageType,
        mediaUrl,
        waMessageId: result.key.id,
        timestamp: new Date(),
        status: 'sent',
        sentByAgent: new Types.ObjectId(agentId),
        sentByAgentName: agentName
      });

      await newMessage.save();
      this.logger.log(`[Firestore] Saved to MongoDB. Now saving to Firestore...`);

      // Save to Firestore
      const db = this.firebaseService.getFirestore();
      const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
      
      const firestoreData = {
        externalNumber: cleanPhone,
        leadId: lead._id.toString(),
        direction: 'outbound',
        content: dbContent || '',
        messageType,
        mediaUrl: mediaUrl || null,
        status: 'sent',
        sentByAgent: agentId,
        sentByAgentName: agentName || 'System',
        waMessageId: result.key.id,
        timestamp: FieldValue.serverTimestamp(),
      };

      await messageRef.set(firestoreData);
      this.logger.log(`[Firestore] Successfully saved message to Firestore at path: whatsappChannels/${channelId}/messages/${messageRef.id}`);

      return newMessage;
    } catch (dbError) {
      this.logger.error(`[Firestore] CRITICAL ERROR: Message sent via WhatsApp but failed to save in DBs: ${dbError.message}`);
      console.error(dbError); // Full stack trace in console
      return { success: true, waMessageId: result.key.id };
    }
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
