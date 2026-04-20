import { ArgumentsHost, Catch, ConflictException, ExceptionFilter } from '@nestjs/common';
import { MongoError } from 'mongodb';

@Catch(MongoError)
export class MongoExceptionFilter implements ExceptionFilter {
  catch(exception: MongoError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception.code === 11000) {
      // Extract the duplicate field from the error message
      const errmsg = (exception as any).errmsg || '';
      let field = 'Field';
      
      if (errmsg.includes('email_1')) {
        field = 'البريد الإلكتروني';
      } else if (errmsg.includes('phone_1')) {
        field = 'رقم الهاتف';
      } else if (errmsg.includes('name_1')) {
        field = 'الاسم';
      }

      return response.status(409).json({
        statusCode: 409,
        message: `${field} مُسجل بالفعل في النظام، يرجى استخدام قيمة مختلفة`,
        error: 'Conflict',
      });
    }

    return response.status(500).json({
      statusCode: 500,
      message: 'Internal server error',
    });
  }
}
