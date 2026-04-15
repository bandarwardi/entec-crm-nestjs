import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data');
import fetch from 'node-fetch';

@Injectable()
export class UploadProxyService {
  private readonly logger = new Logger(UploadProxyService.name);
  private readonly uploadUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.uploadUrl = this.configService.get<string>('UPLOAD_API_URL', 'https://entec.store/api/upload.php');
    this.apiKey = this.configService.get<string>('UPLOAD_API_KEY', '');
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const form = new FormData();
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
      knownLength: file.size,
    });

    this.logger.log(`Uploading file "${file.originalname}" (${Math.round(file.size / 1024)}KB) to ${this.uploadUrl}`);

    let response: any;
    try {
      response = await fetch(this.uploadUrl, {
        method: 'POST',
        headers: {
          ...form.getHeaders(),
        },
        body: form,
      });
    } catch (err) {
      this.logger.error(`Network error while uploading to PHP API: ${err.message}`);
      throw new InternalServerErrorException('Upload service unreachable');
    }

    const data: any = await response.json();

    if (!response.ok) {
      this.logger.error(`PHP API returned ${response.status}: ${data?.error}`);
      throw new InternalServerErrorException(data?.error ?? 'Upload failed');
    }

    this.logger.log(`File uploaded successfully: ${data.url}`);
    return data.url;
  }
}
