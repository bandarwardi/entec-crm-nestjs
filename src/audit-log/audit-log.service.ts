import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  async log(data: {
    user: string | Types.ObjectId;
    action: string;
    resource: string;
    resourceId?: string;
    metadata?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      const logEntry = new this.auditLogModel({
        ...data,
        user: typeof data.user === 'string' ? new Types.ObjectId(data.user) : data.user,
      });
      return await logEntry.save();
    } catch (error) {
      this.logger.error(`Failed to save audit log: ${error.message}`, error.stack);
    }
  }

  async getLogs(query: { 
    userId?: string; 
    action?: string; 
    resource?: string; 
    page?: number; 
    limit?: number; 
  }) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.userId) filter.user = new Types.ObjectId(query.userId);
    if (query.action) filter.action = query.action;
    if (query.resource) filter.resource = query.resource;

    const [data, total] = await Promise.all([
      this.auditLogModel.find(filter)
        .populate('user', 'name email role')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.auditLogModel.countDocuments(filter).exec(),
    ]);

    return { data, total, page, limit };
  }
}
