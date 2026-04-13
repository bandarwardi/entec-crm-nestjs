import { Injectable, OnModuleInit, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { AiConversation, AiConversationDocument } from './schemas/ai-conversation.schema';
import { AiMessage, AiMessageDocument } from './schemas/ai-message.schema';
import { SalesScenario, SalesScenarioDocument } from './schemas/sales-scenario.schema';

@Injectable()
export class AiChatService implements OnModuleInit {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(
    private configService: ConfigService,
    @InjectModel(AiConversation.name)
    private readonly conversationModel: Model<AiConversationDocument>,
    @InjectModel(AiMessage.name)
    private readonly messageModel: Model<AiMessageDocument>,
    @InjectModel(SalesScenario.name)
    private readonly scenarioModel: Model<SalesScenarioDocument>,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not defined. AI Chat features will be disabled.');
      return;
    }
    
    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      const systemPrompt = `أنت مساعد ذكي لفريق مبيعات شركة EN TEC المتخصصة في بيع خدمات IPTV. 
      ساعد الموظفين في:
      - تقنيات البيع والإقناع.
      - الرد على اعتراضات العملاء (مثل السعر، جودة البث، إلخ).
      - صياغة رسائل متابعة احترافية للعملاء.
      - حساب الأسعار والعروض (بناءً على المعلومات التي يقدمها الموظف).
      - أي استفسار متعلق بمجال الـ IPTV والمبيعات بشكل عام.
      تحدث دائماً بلهجة مهنية وودودة باللغة العربية.`;

      const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
      this.model = this.genAI.getGenerativeModel({ 
        model: modelName,
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemPrompt }]
        }
      });
    } catch (error) {
      console.error('Failed to initialize Gemini AI:', error);
    }
  }

  async onModuleInit() {
    try {
      await this.seedScenarios();
    } catch (error) {
      console.error('Failed to seed sales scenarios:', error);
    }
  }

  // --- Conversations & Messages ---

  async createConversation(userId: string, title?: string) {
    const conversation = new this.conversationModel({
      user: new Types.ObjectId(userId),
      title: title || 'محادثة جديدة'
    });
    return conversation.save();
  }

  async getUserConversations(userId: string) {
    return this.conversationModel.find({ user: userId })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async getConversationMessages(conversationId: string, userId: string) {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    if (conversation.user.toString() !== userId) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه المحادثة');

    return this.messageModel.find({ conversation: conversationId })
      .sort({ createdAt: 1 })
      .exec();
  }

  async sendMessage(userId: string, conversationId: string, content: string) {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    if (conversation.user.toString() !== userId) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه المحادثة');

    console.log(`AI Chat: Saving user message for conversation ${conversationId}`);
    // 1. Save User Message
    const userMsg = new this.messageModel({
      conversation: new Types.ObjectId(conversationId),
      role: 'user',
      content
    });
    const savedUserMsg = await userMsg.save();
    console.log('AI Chat: User message saved:', savedUserMsg._id);

    // Update title if it was default
    if (conversation.title === 'محادثة جديدة') {
      conversation.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      await conversation.save();
    }

    // 2. Get History for Gemini
    const messages = await this.messageModel.find({ conversation: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .exec();

    const history = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    // 3. Get Gemini Response
    try {
      if (!this.model) {
        throw new Error('الذكاء الاصطناعي غير مفعل حالياً. يرجى التأكد من إعدادات النظام.');
      }

      console.log('AI Chat: Requesting Gemini response...');
      const chat = this.model.startChat({
        history: history.slice(0, -1),
      });

      const result = await chat.sendMessage(content);
      const aiResponse = result.response.text();
      console.log('AI Chat: Gemini responded successfully');

      // 4. Save AI Message
      const aiMsg = new this.messageModel({
        conversation: new Types.ObjectId(conversationId),
        role: 'model',
        content: aiResponse
      });
      const savedAiMsg = await aiMsg.save();
      console.log('AI Chat: AI message saved:', savedAiMsg._id);
      return savedAiMsg;
    } catch (error) {
      console.error('Gemini API Error:', error);
      const errorMsg = new this.messageModel({
        conversation: new Types.ObjectId(conversationId),
        role: 'model',
        content: 'عذراً، حدث خطأ أثناء الاتصال بالذكاء الاصطناعي: ' + (error.message || 'خطأ غير معروف')
      });
      return errorMsg.save();
    }
  }

  async deleteConversation(conversationId: string, userId: string) {
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    if (conversation.user.toString() !== userId) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه المحادثة');

    // Also delete messages
    await this.messageModel.deleteMany({ conversation: conversationId }).exec();
    return this.conversationModel.findByIdAndDelete(conversationId).exec();
  }

  // --- Sales Scenarios ---

  async getAllScenarios(onlyActive = true) {
    return this.scenarioModel.find(onlyActive ? { isActive: true } : {})
      .sort({ sortOrder: 1 })
      .exec();
  }

  async getScenario(id: string) {
    return this.scenarioModel.findById(id).exec();
  }

  async createScenario(data: Partial<SalesScenario>) {
    const scenario = new this.scenarioModel(data);
    return scenario.save();
  }

  async updateScenario(id: string, data: Partial<SalesScenario>) {
    return this.scenarioModel.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async deleteScenario(id: string) {
    return this.scenarioModel.findByIdAndDelete(id).exec();
  }

  private async seedScenarios() {
    const count = await this.scenarioModel.countDocuments().exec();
    if (count > 0) return;

    const scenarios = [
      {
        title: 'الاعتراض على السعر',
        description: 'عندما يقول العميل أن السعر مرتفع مقارنة بالمنافسين.',
        category: 'objections',
        icon: 'pi pi-money-bill',
        sortOrder: 1,
        prompt: 'العميل يقول أن سعر الاشتراك مرتفع جداً مقارنة بمواقع أخرى. اشرح لي كيف أقنعه بجودة الخدمة واستقرار البث وتعدد السيرفرات لدينا لتبرير السعر.'
      },
      {
        title: 'جودة البث والتقطيع',
        description: 'العميل متخوف من تقطيع البث أثناء المباريات الكبيرة.',
        category: 'objections',
        icon: 'pi pi-video',
        sortOrder: 2,
        prompt: 'العميل متخوف من التقطيع وقت ضغط المباريات. اشرح لي كيف أطمئنه بشأن سيرفراتنا القوية وتقنية الـ 4K ووجود جودات مختلفة تناسب سرعات الإنترنت الضعيفة.'
      },
      {
        title: 'إغلاق البيع (Closing)',
        description: 'كيفية تحفيز العميل على اتخاذ قرار الشراء الآن.',
        category: 'closing',
        icon: 'pi pi-check-circle',
        sortOrder: 3,
        prompt: 'العميل متردد الآن. اقترح علي 3 جمل قوية لإغلاق البيع واستخدام "عرض محدود" أو "باقة خاصة لفترة محدودة" لتحفيزه.'
      },
      {
        title: 'متابعة عميل لم يرد',
        description: 'رسالة احترافية لعميل استفسر سابقاً ولم يكمل الشراء.',
        category: 'follow-up',
        icon: 'pi pi-send',
        sortOrder: 4,
        prompt: 'لدي عميل تواصل معي قبل يومين وسأل عن الأسعار ولم يرد بعدها. صغ لي رسالة متابعة مهنية ولطيفة تذكره بالعرض وتدعوه لتجربة الخدمة.'
      },
      {
        title: 'مقارنة مع المنافسين',
        description: 'عندما يذكر العميل اسم شركة منافسة.',
        category: 'objections',
        icon: 'pi pi-directions',
        sortOrder: 5,
        prompt: 'العميل يقارن بيننا وبين منافس آخر ويقول أن لديهم قنوات أكثر. كيف أوضح له أن الجودة والاستقرار أهم من عدد القنوات غير المفيدة؟'
      },
      {
        title: 'العميل الغاضب',
        description: 'كيفية التعامل مع عميل يشتكي من مشكلة فنية.',
        category: 'support',
        icon: 'pi pi-exclamation-circle',
        sortOrder: 6,
        prompt: 'عميل تواصل معي وهو غاضب بسبب توقف القناة لديه. كيف أمتص غضبه وأحل المشكلة بمهنية وأحوله لعميل راضٍ مرة أخرى؟'
      }
    ];

    await this.scenarioModel.insertMany(scenarios);
  }
}
