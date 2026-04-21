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
import { LeadStatus } from '../leads/lead-status.enum';
import { UsersService } from '../users/users.service';
import { FirebaseService } from '../firebase/firebase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldValue } from 'firebase-admin/firestore';
import { AiSettings, AiSettingsDocument } from './schemas/ai-settings.schema';
import { WhatsappTemplate, WhatsappTemplateDocument } from './schemas/whatsapp-template.schema';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly pinoLogger = pino({ level: 'silent' });
  private sessions = new Map<string, WASocket>();
  private lidMaps = new Map<string, Map<string, string>>();

  private genAI: GoogleGenerativeAI;

  constructor(
    @InjectModel(WhatsappChannel.name) private channelModel: Model<WhatsappChannelDocument>,
    @InjectModel(WhatsappMessage.name) private messageModel: Model<WhatsappMessageDocument>,
    @InjectModel(WhatsappSession.name) private sessionModel: Model<WhatsappSessionDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(AiSettings.name) private aiSettingsModel: Model<AiSettingsDocument>,
    @InjectModel(WhatsappTemplate.name) private templateModel: Model<WhatsappTemplateDocument>,
    private readonly usersService: UsersService,
    private readonly firebaseService: FirebaseService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    @InjectQueue('whatsapp-messages') private messageQueue: Queue,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

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
      else if (filename.endsWith('.ogg')) contentType = 'audio/ogg; codecs=opus';
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
        getMessage: async (key) => {
          const msg = await this.messageModel.findOne({ waMessageId: key.id }).exec();
          if (msg) {
            return {
              conversation: msg.content
            };
          }
          return undefined;
        },
        cachedGroupMetadata: async (jid) => {
          // Implementing group metadata cache lookup
          return undefined; // We'll improve this with a NodeCache instance later
        }
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
            if (msg.message) {
              await this.handleIncomingMessage(channelId, sessionId, msg);
            }
          }
        }
      });

      sock.ev.on('messaging-history.set', async ({ messages, chats, contacts, isLatest }) => {
        this.logger.log(`[History Sync] Received ${messages.length} messages, ${chats.length} chats, ${contacts.length} contacts. isLatest: ${isLatest}`);
        
        // Process messages in batches to avoid overwhelming the system
        for (const msg of messages) {
          try {
            await this.handleIncomingMessage(channelId, sessionId, msg);
          } catch (e) {
            // Silently fail for individual historical messages to keep sync moving
          }
        }
      });

      sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
          if (update.update.status) {
            // Mapping Baileys status to our status
            // 3 = Delivered, 4 = Read
            let status = 'sent';
            if (update.update.status === 3) status = 'delivered';
            else if (update.update.status === 4) status = 'read';
            
            if (status !== 'sent') {
              this.logger.log(`[Status Update] Message ${update.key.id} status changed to ${status}`);
              
              // Update MongoDB
              await this.messageModel.findOneAndUpdate(
                { waMessageId: update.key.id },
                { status }
              ).exec();

              // Update Firestore
              const db = this.firebaseService.getFirestore();
              const messagesRef = db.collection('whatsappChannels').doc(channelId).collection('messages');
              const snapshot = await messagesRef.where('waMessageId', '==', update.key.id).get();
              
              const batch = db.batch();
              snapshot.docs.forEach(doc => {
                batch.update(doc.ref, { status, updatedAt: FieldValue.serverTimestamp() });
              });
              await batch.commit();
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

      const isGroup = fromJid.endsWith('@g.us');

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
                      msg.message?.documentMessage?.caption ||
                      msg.message?.documentMessage?.fileName ||
                      (msg.message?.stickerMessage ? '[Sticker]' : null) ||
                      (msg.message?.audioMessage ? '[Voice Note]' : null) ||
                      (msg.message?.documentMessage ? '[Document]' : null) ||
                      '[Non-text message]';

      const messageType = msg.message?.stickerMessage ? 'sticker' : 
                         (msg.message?.imageMessage ? 'image' : 
                         (msg.message?.videoMessage ? 'video' : 
                         (msg.message?.audioMessage ? 'audio' : 
                         (msg.message?.documentMessage ? 'document' : 'text'))));

      // Extract Quote Info
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                          msg.message?.imageMessage?.contextInfo || 
                          msg.message?.videoMessage?.contextInfo || 
                          msg.message?.audioMessage?.contextInfo || 
                          msg.message?.documentMessage?.contextInfo;

      let quotedMessageId = contextInfo?.stanzaId;
      let quotedContent = '';
      let quotedMessageType = '';
      if (contextInfo?.quotedMessage) {
        const qm = contextInfo.quotedMessage;
        quotedContent = qm.conversation || qm.extendedTextMessage?.text || qm.imageMessage?.caption || qm.videoMessage?.caption || (qm.imageMessage ? '[Image]' : qm.videoMessage ? '[Video]' : qm.audioMessage ? '[Audio]' : qm.stickerMessage ? '[Sticker]' : qm.documentMessage ? '[Document]' : '');
        quotedMessageType = qm.imageMessage ? 'image' : (qm.videoMessage ? 'video' : (qm.audioMessage ? 'audio' : (qm.stickerMessage ? 'sticker' : (qm.documentMessage ? 'document' : 'text'))));
      }

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
            else if (messageType === 'audio') ext = 'ogg';
            else if (messageType === 'document') {
              const docMsg = msg.message?.documentMessage;
              const fileName = docMsg?.fileName || 'document';
              ext = fileName.split('.').pop() || 'pdf';
            }

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
        
        if (isGroup && !lead.isGroup) {
          updateData.isGroup = true;
          updateData.groupJid = fromJid;
        }

        // Only fetch profile pic if not already set or every once in a while
        if (!lead.profilePicUrl) {
          try {
            const ppUrl = await sock.profilePictureUrl(fromJid, 'image').catch(() => null);
            if (ppUrl) updateData.profilePicUrl = ppUrl;
          } catch (e) {}
        }

        if (direction === 'inbound') {
          updateData.$inc = { unreadCount: 1 };
        }

        lead = await this.leadModel.findByIdAndUpdate(lead._id, updateData, { new: true });
        
        // Update Firestore lead data
        try {
          const db = this.firebaseService.getFirestore();
          await db.collection('leads').doc(lead._id.toString()).set({
            unreadCount: lead.unreadCount,
            lastMessageAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (e) {}
      } else if (!unresolved && (phoneNumber || isGroup)) {
        // Auto-create lead for new incoming contacts or groups
        try {
          this.logger.log(`[Incoming] No lead found for ${isGroup ? 'group' : 'phone'} ${isGroup ? fromJid : phoneNumber}. Auto-creating...`);
          const channel = await this.channelModel.findById(channelId);
          
          let leadName = msg.pushName || phoneNumber;
          if (isGroup) {
            try {
              const metadata = await sock.groupMetadata(fromJid);
              leadName = metadata.subject;
            } catch (e) {
              leadName = 'WhatsApp Group';
            }
          }

          lead = new this.leadModel({
            name: leadName, 
            phone: isGroup ? fromJid : phoneNumber,
            isGroup,
            groupJid: isGroup ? fromJid : undefined,
            status: LeadStatus.NEW,
            lastMessageAt: new Date(),
            createdBy: channel?.createdBy || undefined
          });
          
          // Try to get profile pic
          try {
            const ppUrl = await sock.profilePictureUrl(fromJid, 'image').catch(() => null);
            if (ppUrl) lead.profilePicUrl = ppUrl;
          } catch (e) {}

          await lead.save();
          this.logger.log(`[Incoming] Auto-created lead for ${lead.phone}: ${lead.name}`);
        } catch (err) {
          this.logger.error(`[Incoming] Failed to auto-create lead: ${err.message}`);
        }
      } else if (unresolved) {
        this.logger.warn(`[Incoming] Message from unresolved LID ${fromJid}. Will retry later.`);
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
        lidJid: fromJid.endsWith('@lid') ? fromJid : undefined,
        senderJid: msg.key.participant || (direction === 'inbound' ? fromJid : undefined),
        senderName: msg.pushName || undefined,
        quotedMessageId,
        quotedContent,
        quotedMessageType
      });

      await newMessage.save();
      
      // Save to Firestore
      const db = this.firebaseService.getFirestore();
      const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
      
      await messageRef.set({
        externalNumber: isGroup ? fromJid : phoneNumber,
        leadId: lead?._id?.toString() || null,
        direction,
        content: content || '',
        messageType: messageType || 'text',
        mediaUrl: mediaUrl || null,
        status: 'delivered',
        waMessageId: msg.key.id,
        timestamp: FieldValue.serverTimestamp(),
        unresolvedLid: !!unresolved,
        lidJid: (fromJid.endsWith('@lid') ? fromJid : null) || null,
        isGroup,
        groupJid: isGroup ? fromJid : null,
        senderJid: isGroup ? msg.key.participant : null,
        senderName: isGroup ? (msg.pushName || 'Participant') : null,
        quotedMessageId: quotedMessageId || null,
        quotedContent: quotedContent || null,
        quotedMessageType: quotedMessageType || null
      });

      // Update lead unread count in Firestore specifically for the whatsappChannels list if we want it real-time there
      // Actually, we usually listen to 'leads' collection or have the count in the channel message metadata.
      // Let's stick to the Lead model update.

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

  async sendMessage(channelId: string, leadId: string, phoneNumber: string, content: string, agentId: string, agentName: string = 'System', messageType: string = 'text', mediaUrl?: string, quotedMessageId?: string, quotedContent?: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    let lead: any = null;
    if (leadId) {
      lead = await this.leadModel.findById(leadId);
    } else if (phoneNumber) {
      const cleanPhone = this.formatPhoneForWhatsapp(phoneNumber);
      const last8 = cleanPhone.slice(-8);
      lead = await this.leadModel.findOne({ phone: { $regex: last8 + '$' } }).exec();
      
      if (!lead) {
        lead = new this.leadModel({
          name: phoneNumber,
          phone: cleanPhone,
          status: LeadStatus.NEW,
          createdBy: new Types.ObjectId(agentId)
        });
        await lead.save();
      }
    }
    if (!lead) throw new NotFoundException('Lead not found');

    // Create a temporary message in DBs with 'pending' status for immediate UI feedback
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    let dbContent = content;
    if (!dbContent) {
      if (messageType === 'sticker') dbContent = '[Sticker]';
      else if (messageType === 'audio') dbContent = '[Voice Note]';
      else if (messageType === 'image') dbContent = '[Image]';
    }

    try {
      // 1. Save to MongoDB as pending
      const newMessage = new this.messageModel({
        channelId: channel._id,
        leadId: lead._id,
        externalNumber: lead.phone.replace(/\D/g, ''),
        direction: 'outbound',
        content: dbContent || '',
        messageType,
        mediaUrl,
        waMessageId: tempId,
        timestamp: new Date(),
        status: 'pending',
        sentByAgent: new Types.ObjectId(agentId),
        sentByAgentName: agentName
      });
      await newMessage.save();

      // 2. Save to Firestore as pending
      const db = this.firebaseService.getFirestore();
      const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
      await messageRef.set({
        externalNumber: lead.phone,
        leadId: lead._id.toString(),
        direction: 'outbound',
        content: dbContent || '',
        messageType,
        mediaUrl: mediaUrl || null,
        status: 'pending',
        sentByAgent: agentId,
        sentByAgentName: agentName || 'System',
        waMessageId: tempId,
        timestamp: FieldValue.serverTimestamp(),
        quotedMessageId: quotedMessageId || null,
        quotedContent: quotedContent || null,
        isGroup: !!lead.isGroup,
        groupJid: lead.isGroup ? lead.phone : null
      });

      // 3. Add to queue for actual sending
      const jobId = `send_${lead._id}_${Buffer.from(content.substring(0, 20)).toString('hex')}_${Date.now()}`;
      await this.messageQueue.add('send-message', {
        channelId,
        leadId: lead._id.toString(),
        content,
        agentId,
        agentName,
        messageType,
        mediaUrl,
        tempMessageId: tempId,
        quotedMessageId,
        quotedContent
      }, {
        jobId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true
      });

      return { success: true, tempId };
    } catch (error) {
      this.logger.error(`Failed to create pending message: ${error.message}`);
      throw error;
    }
  }

  async sendDirectMessage(channelId: string, leadId: string, content: string, agentId: string, agentName: string = 'System', messageType: string = 'text', mediaUrl?: string, tempMessageId?: string, quotedMessageId?: string, quotedContent?: string) {
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
    const isGroup = lead.isGroup || lead.phone.endsWith('@g.us');
    const jid = isGroup ? lead.phone : `${cleanPhone}@s.whatsapp.net`;

    const result = await (async () => {
      const options: any = {};
      if (quotedMessageId) {
        this.logger.debug(`[SendQuote] Attempting to quote message ID: ${quotedMessageId}`);
        // Find the quoted message to get its key
        const quotedMsg = await this.messageModel.findOne({ waMessageId: quotedMessageId }).exec();
        
        const finalQuotedContent = quotedMsg?.content || quotedContent || 'Message';
        const isFromMe = quotedMsg ? quotedMsg.direction === 'outbound' : false;
        
        // Resolve own JID
        const ownJid = jidNormalizedUser(sock.user?.id);

        // Determine participant JID
        // In groups, participant is mandatory. In 1:1, Baileys often expects it if we quote others.
        let participantJid = quotedMsg?.senderJid;
        if (!participantJid) {
            participantJid = isFromMe ? ownJid : jid;
        }

        options.quoted = {
          key: {
            remoteJid: jid,
            fromMe: isFromMe,
            id: quotedMessageId,
            participant: isGroup ? participantJid : (isFromMe ? undefined : participantJid)
          },
          message: { 
            conversation: finalQuotedContent 
          }
        };

        this.logger.debug(`[SendQuote] Final Quoted Data: ${JSON.stringify({
           id: options.quoted.key.id,
           fromMe: options.quoted.key.fromMe,
           participant: options.quoted.key.participant,
           remoteJid: options.quoted.key.remoteJid,
           content: finalQuotedContent.substring(0, 20)
        })}`);
      }

      if (messageType === 'sticker' && mediaUrl) {
        return await sock.sendMessage(jid, { 
          sticker: { url: mediaUrl },
          mimetype: 'image/webp'
        }, options);
      } else if (messageType === 'audio' && mediaUrl) {
        return await sock.sendMessage(jid, { 
          audio: { url: mediaUrl }, 
          mimetype: 'audio/mpeg', 
          ptt: false 
        }, options);
      } else if (messageType === 'location') {
        const [lat, lng, name, address] = content.split('|');
        return await sock.sendMessage(jid, { 
          location: { 
            degreesLatitude: parseFloat(lat) || 0, 
            degreesLongitude: parseFloat(lng) || 0,
            name: name || undefined,
            address: address || undefined
          } 
        }, options);
      } else if (messageType === 'contact') {
        const [displayName, vcard] = content.split('|');
        return await sock.sendMessage(jid, { 
          contacts: {
            displayName: displayName || 'Contact',
            contacts: [{ vcard }]
          }
        }, options);
      } else if (messageType === 'reaction') {
        return await sock.sendMessage(jid, { 
          react: { text: content, key: { remoteJid: jid, fromMe: true, id: quotedMessageId } } 
        });
      } else if (messageType === 'poll') {
        const [name, ...values] = content.split('|');
        return await sock.sendMessage(jid, { 
          poll: {
            name: name || 'Poll',
            values: values.length > 0 ? values : ['Yes', 'No'],
            selectableCount: 1
          }
        }, options);
      } else if (messageType === 'forward' && quotedMessageId) {
        const msg = await this.messageModel.findOne({ waMessageId: quotedMessageId }).exec();
        if (msg) {
          return await sock.sendMessage(jid, { forward: { key: { remoteJid: jid, fromMe: msg.direction === 'outbound', id: quotedMessageId }, message: { conversation: msg.content } } }, options);
        }
      } else if (messageType === 'edit' && quotedMessageId) {
        return await sock.sendMessage(jid, { 
          text: content, 
          edit: { remoteJid: jid, fromMe: true, id: quotedMessageId } 
        }, options);
      } else if (messageType === 'document' && mediaUrl) {
        const fileName = (content && content !== 'null') ? content : 'Document';
        return await sock.sendMessage(jid, { 
          document: { url: mediaUrl }, 
          mimetype: 'application/octet-stream',
          fileName: fileName
        }, options);
      } else if (messageType === 'video' && mediaUrl) {
        return await sock.sendMessage(jid, { 
          video: { url: mediaUrl }, 
          caption: content !== 'null' ? content : undefined 
        }, options);
      } else if (messageType === 'image' && mediaUrl) {
        return await sock.sendMessage(jid, { 
          image: { url: mediaUrl }, 
          caption: content !== 'null' ? content : undefined 
        }, options);
      } else {
        return await sock.sendMessage(jid, { text: content }, options);
      }
    })();

    if (!result) throw new Error('Failed to send message');
    
    // Update lastMessageAt for sorting
    await this.leadModel.findByIdAndUpdate(lead._id, { lastMessageAt: new Date() });

    try {
      this.logger.log(`[Firestore] Saving outbound message update...`);
      
      // Fallback content for DB if empty (for media)
      let dbContent = content;
      if (!dbContent) {
        if (messageType === 'sticker') dbContent = '[Sticker]';
        else if (messageType === 'audio') dbContent = '[Voice Note]';
        else if (messageType === 'image') dbContent = '[Image]';
      }

      if (tempMessageId) {
        // Update the existing pending message
        await this.messageModel.findOneAndUpdate(
          { waMessageId: tempMessageId },
          { 
            waMessageId: result.key.id,
            status: 'sent',
            timestamp: new Date()
          }
        );

        const db = this.firebaseService.getFirestore();
        const messagesSnapshot = await db.collection('whatsappChannels')
          .doc(channelId)
          .collection('messages')
          .where('waMessageId', '==', tempMessageId)
          .get();

        for (const doc of messagesSnapshot.docs) {
          await doc.ref.update({ 
            waMessageId: result.key.id,
            status: 'sent',
            timestamp: FieldValue.serverTimestamp()
          });
        }
      } else {
        // Fallback: Create new message if no temp ID provided
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

        const db = this.firebaseService.getFirestore();
        const messageRef = db.collection('whatsappChannels').doc(channelId).collection('messages').doc();
        await messageRef.set({
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
        });
      }

      return { success: true, waMessageId: result.key.id };
    } catch (dbError) {
      this.logger.error(`[Firestore] CRITICAL ERROR: Message sent via WhatsApp but failed to save in DBs: ${dbError.message}`);
      console.error(dbError);
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

  async checkPhoneNumber(channelId: string, phoneNumber: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');

    const sock = this.sessions.get(channel.sessionId);
    if (!sock || channel.status !== 'connected') {
      throw new Error('قناة واتساب غير متصلة');
    }

    const cleanPhone = this.formatPhoneForWhatsapp(phoneNumber);
    const jid = `${cleanPhone}@s.whatsapp.net`;
    
    try {
      const results = await sock.onWhatsApp(jid);
      if (!results || results.length === 0) return { jid, exists: false };
      return results[0];
    } catch (error) {
      this.logger.error(`Error checking WhatsApp number: ${error.message}`);
      throw new Error('فشل التحقق من الرقم في واتساب');
    }
  }

  formatPhoneForWhatsapp(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');

    // US Number: 10 digits
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }

    // Egyptian Number: 11 digits starting with 01
    if (cleaned.length === 11 && cleaned.startsWith('01')) {
      cleaned = '2' + cleaned;
    }

    return cleaned;
  }

  async getAiSettings() {
    let settings = await this.aiSettingsModel.findOne().exec();
    if (!settings) {
      settings = new this.aiSettingsModel({});
      await settings.save();
    }
    return settings;
  }

  async updateAiSettings(data: any) {
    let settings = await this.aiSettingsModel.findOne().exec();
    if (!settings) {
      settings = new this.aiSettingsModel(data);
    } else {
      Object.assign(settings, data);
    }
    return settings.save();
  }

  async generateAiSuggestion(channelId: string, phoneNumber: string) {
    try {
      this.logger.debug(`Generating AI suggestion for channel: ${channelId}, phone: ${phoneNumber}`);
      
      const settings = await this.getAiSettings();
      if (!settings.isEnabled) {
        this.logger.warn('AI Suggestion: AI is disabled in settings.');
        return { suggestion: null };
      }
      
      if (!this.genAI) {
        this.logger.error('AI Suggestion: Gemini API (genAI) is not initialized. Check GEMINI_API_KEY.');
        return { suggestion: null };
      }

      // Fetch last 10 messages for context
      // Note: Use regex to match the last 8 digits for robustness
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const last8 = cleanPhone.slice(-8);

      if (!last8) {
        this.logger.warn('AI Suggestion: Phone number is invalid or too short.');
        return { suggestion: null };
      }
      
      const messages = await this.messageModel.find({
        channelId: new Types.ObjectId(channelId),
        externalNumber: { $regex: last8 + '$' }
      })
      .sort({ timestamp: -1 })
      .limit(10)
      .exec();

      if (messages.length === 0) {
        this.logger.warn(`AI Suggestion: No messages found in MongoDB for phone ending in ${last8} on channel ${channelId}. Context is empty.`);
        return { suggestion: null };
      }

      this.logger.debug(`AI Suggestion: Found ${messages.length} messages for context.`);

      // Reverse to get chronological order
      const chatContext = messages.reverse().map(m => 
        `${m.direction === 'inbound' ? 'العميل' : 'نحن'}: ${m.content}`
      ).join('\n');

      const model = this.genAI.getGenerativeModel({ model: settings.model || 'gemini-1.5-flash' });
      
      const prompt = `التالي هو سياق آخر المحادثات في واتساب:\n${chatContext}\n\nبناءً على المعلومات التالية عن الشركة والمهمة:\n${settings.systemPrompt}\n\nاقترح رداً ذكياً وقصيراً ومهنياً ليقوم الموظف بإرساله للعميل الآن. اقترح النص فقط دون أي تعليقات جانبية.`;

      this.logger.debug('AI Suggestion: Requesting Gemini response...');
      const result = await model.generateContent(prompt);
      const suggestion = result.response.text().trim();
      
      this.logger.log('AI Suggestion: Generated successfully.');
      return { suggestion };
    } catch (error) {
      this.logger.error(`AI Suggestion Error: ${error.message}`);
      return { suggestion: null };
    }
  }

  async markAsRead(leadId: string) {
    await this.leadModel.findByIdAndUpdate(leadId, { unreadCount: 0 });
    
    // Clear in Firestore
    try {
      const db = this.firebaseService.getFirestore();
      await db.collection('leads').doc(leadId).set({
        unreadCount: 0,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {}
    
    return { success: true };
  }

  async getTemplates() {
    let templates = await this.templateModel.find({ isActive: true }).sort({ createdAt: -1 }).exec();
    
    // Seed default templates if empty
    if (templates.length === 0) {
      const defaults = [
        { title: 'الترحيب', content: 'مرحباً بك في EN TEC، كيف يمكننا مساعدتك اليوم؟' },
        { title: 'العنوان', content: 'عنواننا هو: مدينة الرياض، حي الملز، طريق صلاح الدين.' },
        { title: 'ساعات العمل', content: 'ساعات العمل الرسمية من الأحد إلى الخميس، من الساعة 9 صباحاً حتى 5 مساءً.' }
      ];
      await this.templateModel.insertMany(defaults);
      templates = await this.templateModel.find({ isActive: true }).exec();
    }
    
    return templates;
  }

  async createTemplate(data: any, userId: string) {
    const template = new this.templateModel({ ...data, createdBy: new Types.ObjectId(userId) });
    return await template.save();
  }

  async deleteTemplate(id: string) {
    return await this.templateModel.findByIdAndDelete(id).exec();
  }

  async toggleArchive(leadId: string, channelId?: string) {
    const lead = await this.leadModel.findById(leadId);
    if (!lead) throw new NotFoundException('Lead not found');
    
    const newState = !lead.isArchived;
    await this.leadModel.findByIdAndUpdate(leadId, { isArchived: newState });
    
    // If channelId is provided, try to archive it on WhatsApp too
    if (channelId) {
      try {
        await this.modifyChat(channelId, leadId, newState ? 'archive' : 'unarchive');
      } catch (e) {
        this.logger.error(`Failed to toggle archive on WhatsApp: ${e.message}`);
      }
    }

    // Sync to Firestore
    try {
      const db = this.firebaseService.getFirestore();
      await db.collection('leads').doc(leadId).set({
        isArchived: newState,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {}
    
    return { success: true, isArchived: newState };
  }

  async modifyChat(channelId: string, leadId: string, action: 'archive' | 'unarchive' | 'mute' | 'unmute' | 'pin' | 'unpin' | 'markRead' | 'markUnread' | 'delete') {
    const { sock, jid } = await this.getSocketAndJid(channelId, leadId);
    
    const lastMsg = await this.messageModel.findOne({ leadId }).sort({ timestamp: -1 }).exec();
    const lastMessages = lastMsg ? [{ 
      key: { remoteJid: jid, fromMe: lastMsg.direction === 'outbound', id: lastMsg.waMessageId }, 
      messageTimestamp: Math.floor(lastMsg.timestamp.getTime() / 1000) 
    }] : [];

    switch (action) {
      case 'archive':
        return await sock.chatModify({ archive: true, lastMessages }, jid);
      case 'unarchive':
        return await sock.chatModify({ archive: false, lastMessages }, jid);
      case 'mute':
        return await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, jid);
      case 'unmute':
        return await sock.chatModify({ mute: null }, jid);
      case 'pin':
        return await sock.chatModify({ pin: true }, jid);
      case 'unpin':
        return await sock.chatModify({ pin: false }, jid);
      case 'markRead':
        if (lastMsg) await sock.readMessages([lastMessages[0].key]);
        return { success: true };
      case 'delete':
        return await sock.chatModify({ delete: true, lastMessages }, jid);
    }
  }

  async updatePresence(channelId: string, leadId: string, presence: 'available' | 'unavailable' | 'composing' | 'recording') {
    const { sock, jid } = await this.getSocketAndJid(channelId, leadId);
    return await sock.sendPresenceUpdate(presence, jid);
  }

  async starMessage(channelId: string, leadId: string, messageId: string, star: boolean) {
    const { sock, jid } = await this.getSocketAndJid(channelId, leadId);
    const msg = await this.messageModel.findOne({ waMessageId: messageId }).exec();
    if (!msg) throw new NotFoundException('Message not found');

    return await sock.chatModify({
      star: {
        messages: [{ id: messageId, fromMe: msg.direction === 'outbound' }],
        star
      }
    }, jid);
  }

  async blockUser(channelId: string, leadId: string, action: 'block' | 'unblock') {
    const { sock, jid } = await this.getSocketAndJid(channelId, leadId);
    return await sock.updateBlockStatus(jid, action);
  }

  async requestPairingCode(channelId: string, phoneNumber: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    const cleanPhone = phoneNumber.replace(/\D/g, '');
    return await sock.requestPairingCode(cleanPhone);
  }

  async createGroup(channelId: string, subject: string, participants: string[]) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    const formattedParticipants = participants.map(p => p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`);
    return await sock.groupCreate(subject, formattedParticipants);
  }

  async updateGroupParticipants(channelId: string, groupJid: string, participants: string[], action: 'add' | 'remove' | 'promote' | 'demote') {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    const formattedParticipants = participants.map(p => p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`);
    return await sock.groupParticipantsUpdate(groupJid, formattedParticipants, action);
  }

  async updateGroupMetadata(channelId: string, groupJid: string, action: 'subject' | 'description' | 'settings', value: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    if (action === 'subject') return await sock.groupUpdateSubject(groupJid, value);
    if (action === 'description') return await sock.groupUpdateDescription(groupJid, value);
    if (action === 'settings') return await sock.groupSettingUpdate(groupJid, value as any);
  }

  async leaveGroup(channelId: string, groupJid: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    return await sock.groupLeave(groupJid);
  }

  async getGroupInviteCode(channelId: string, groupJid: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    return await sock.groupInviteCode(groupJid);
  }

  async fetchPrivacySettings(channelId: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    return await sock.fetchPrivacySettings(true);
  }

  async updatePrivacySetting(channelId: string, type: 'last' | 'online' | 'profile' | 'status' | 'read' | 'group', value: any) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    switch (type) {
      case 'last': return await sock.updateLastSeenPrivacy(value);
      case 'online': return await sock.updateOnlinePrivacy(value);
      case 'profile': return await sock.updateProfilePicturePrivacy(value);
      case 'status': return await sock.updateStatusPrivacy(value);
      case 'read': return await sock.updateReadReceiptsPrivacy(value);
      case 'group': return await sock.updateGroupsAddPrivacy(value);
    }
  }

  async sendStatusUpdate(channelId: string, content: string, messageType: string = 'text', mediaUrl?: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected');

    const statusJidList = ['status@broadcast'];
    const message: any = {};
    
    if (messageType === 'image') message.image = { url: mediaUrl };
    else if (messageType === 'video') message.video = { url: mediaUrl };
    else message.text = content;

    return await sock.sendMessage('status@broadcast', message, { statusJidList });
  }

  async fetchOldMessages(channelId: string, leadId: string, count: number = 50) {
    const { sock, jid } = await this.getSocketAndJid(channelId, leadId);
    
    // Find the oldest message we have for this lead to use as anchor
    const oldestMsg = await this.messageModel.findOne({ leadId }).sort({ timestamp: 1 }).exec();
    
    this.logger.log(`[History Fetch] Fetching ${count} messages for ${jid} before ${oldestMsg?.timestamp || 'now'}`);

    const historyResult: any = await (sock as any).fetchMessageHistory(
      count,
      oldestMsg ? { id: oldestMsg.waMessageId, fromMe: oldestMsg.direction === 'outbound' } : undefined,
      oldestMsg ? Math.floor(oldestMsg.timestamp.getTime() / 1000) : undefined
    );

    const history = Array.isArray(historyResult) ? historyResult : [];

    for (const msg of history) {
       try {
         await this.handleIncomingMessage(channelId, '', msg as any);
       } catch (e) {}
    }

    return { count: history.length };
  }

  private async getSocketAndJid(channelId: string, leadId: string) {
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    
    const lead = await this.leadModel.findById(leadId);
    if (!lead) throw new NotFoundException('Lead not found');

    const sock = this.sessions.get(channel.sessionId);
    if (!sock) throw new Error('WhatsApp session not connected (try refreshing)');

    const cleanPhone = lead.phone.replace(/\D/g, '');
    const isGroup = lead.isGroup || lead.phone.endsWith('@g.us');
    const jid = isGroup ? lead.phone : `${cleanPhone}@s.whatsapp.net`;

    return { sock, jid, isGroup };
  }
}
