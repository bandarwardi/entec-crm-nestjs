import { Injectable, OnModuleInit, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';
import { SalesScenario } from './entities/sales-scenario.entity';

@Injectable()
export class AiChatService implements OnModuleInit {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(
    private configService: ConfigService,
    @InjectRepository(AiConversation)
    private readonly conversationRepo: Repository<AiConversation>,
    @InjectRepository(AiMessage)
    private readonly messageRepo: Repository<AiMessage>,
    @InjectRepository(SalesScenario)
    private readonly scenarioRepo: Repository<SalesScenario>,
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

  async createConversation(userId: number, title?: string) {
    const conversation = this.conversationRepo.create({
      userId,
      title: title || 'محادثة جديدة'
    });
    return this.conversationRepo.save(conversation);
  }

  async getUserConversations(userId: number) {
    return this.conversationRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' }
    });
  }

  async getConversationMessages(conversationId: number, userId: number) {
    const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    if (conversation.userId !== userId) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه المحادثة');

    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' }
    });
  }

  async sendMessage(userId: number, conversationId: number, content: string) {
    const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    if (conversation.userId !== userId) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه المحادثة');

    // 1. Save User Message
    const userMsg = this.messageRepo.create({
      conversationId,
      role: 'user',
      content
    });
    await this.messageRepo.save(userMsg);

    // Update title if it was default
    if (conversation.title === 'محادثة جديدة') {
      conversation.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
    }
    conversation.updatedAt = new Date();
    await this.conversationRepo.save(conversation);

    // 2. Get History for Gemini
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' }
    });

    const history = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.content }]
    }));

    // 3. Get Gemini Response
    try {
      if (!this.model) {
        throw new Error('الذكاء الاصطناعي غير مفعل حالياً. يرجى التأكد من إعدادات النظام.');
      }

      const chat = this.model.startChat({
        history: history.slice(0, -1), // History excluding the last message we just added
      });

      const result = await chat.sendMessage(content);
      const aiResponse = result.response.text();

      // 4. Save AI Message
      const aiMsg = this.messageRepo.create({
        conversationId,
        role: 'model',
        content: aiResponse
      });
      return this.messageRepo.save(aiMsg);
    } catch (error) {
      console.error('Gemini API Error:', error);
      // Save an error message for the user so they see what happened
      const errorMsg = this.messageRepo.create({
        conversationId,
        role: 'model',
        content: 'عذراً، حدث خطأ أثناء الاتصال بالذكاء الاصطناعي: ' + (error.message || 'خطأ غير معروف')
      });
      return this.messageRepo.save(errorMsg);
    }
  }

  async deleteConversation(conversationId: number, userId: number) {
    const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('المحادثة غير موجودة');
    if (conversation.userId !== userId) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه المحادثة');

    return this.conversationRepo.remove(conversation);
  }

  // --- Sales Scenarios ---

  async getAllScenarios(onlyActive = true) {
    return this.scenarioRepo.find({
      where: onlyActive ? { isActive: true } : {},
      order: { sortOrder: 'ASC' }
    });
  }

  async getScenario(id: number) {
    return this.scenarioRepo.findOne({ where: { id } });
  }

  async createScenario(data: Partial<SalesScenario>) {
    const scenario = this.scenarioRepo.create(data);
    return this.scenarioRepo.save(scenario);
  }

  async updateScenario(id: number, data: Partial<SalesScenario>) {
    await this.scenarioRepo.update(id, data);
    return this.getScenario(id);
  }

  async deleteScenario(id: number) {
    return this.scenarioRepo.delete(id);
  }

  private async seedScenarios() {
    const count = await this.scenarioRepo.count();
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

    await this.scenarioRepo.save(scenarios);
  }
}
