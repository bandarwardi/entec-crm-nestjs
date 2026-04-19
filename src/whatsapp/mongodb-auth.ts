import { 
  AuthenticationState, 
  AuthenticationCreds, 
  BufferJSON, 
  initAuthCreds, 
  proto, 
  SignalDataTypeMap 
} from '@whiskeysockets/baileys';
import { Model } from 'mongoose';
import { WhatsappSessionDocument } from './schemas/whatsapp-session.schema';

export const useMongoDBAuthState = async (
  sessionModel: Model<WhatsappSessionDocument>,
  sessionId: string,
  channelId: string
): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {
  
  const writeData = async (data: any, key: string) => {
    const stringified = JSON.stringify(data, BufferJSON.replacer);
    await sessionModel.findOneAndUpdate(
      { sessionId, channelId, 'data.key': key },
      { 
        sessionId, 
        channelId, 
        data: { key, value: stringified } 
      },
      { upsert: true }
    );
  };

  const readData = async (key: string) => {
    try {
      const session = await sessionModel.findOne({ sessionId, channelId, 'data.key': key });
      return session ? JSON.parse(session.data.value, BufferJSON.reviver) : null;
    } catch (error) {
      return null;
    }
  };

  const removeData = async (key: string) => {
    await sessionModel.deleteOne({ sessionId, channelId, 'data.key': key });
  };

  // Simplified version for creds only to start with
  // A full implementation would handle pre-keys, etc.
  
  let creds: AuthenticationCreds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData(creds, 'creds');
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value as SignalDataTypeMap[T];
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    },
  };
};
