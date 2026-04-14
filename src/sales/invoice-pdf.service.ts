import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
import { Order } from './schemas/order.schema';
import { InvoiceSettings } from './schemas/invoice-settings.schema';

@Injectable()
export class InvoicePdfService {
  async generateInvoiceBuffer(order: Order, settings: InvoiceSettings): Promise<Buffer> {
    const templatePath = path.resolve(process.cwd(), 'entec-invoice-template.html');
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');

    // Compile template
    const template = handlebars.compile(templateHtml);

    // Prepare data
    const data = {
      orderId: (order as any)._id,
      customerName: (order.customer as any).name,
      customerEmail: (order.customer as any).email,
      customerPhone: (order.customer as any).phone,
      orderDate: DateTime.fromJSDate(new Date(order.createdAt)).toFormat('yyyy-MM-dd'),
      expirationDate: order.appExpiryDate ? DateTime.fromJSDate(new Date(order.appExpiryDate)).toFormat('yyyy-MM-dd') : 'N/A',
      serverExpiryDate: order.serverExpiryDate ? DateTime.fromJSDate(new Date(order.serverExpiryDate)).toFormat('yyyy-MM-dd') : 'N/A',
      paymentMethod: order.paymentMethod,
      amount: order.amount,
      serverName: order.serverName || 'N/A',
      appType: order.appType || 'IBO Player',
      appYears: order.appYears || 1,
      notes: order.notes,
      devices: order.devices || [],
      attachments: this.processAttachments(order.attachments || []),
      backgroundImage: this.getImageBase64('src/assets/imgs/invoice-bg.png'),
      logoImage: this.getImageBase64('src/assets/imgs/logo.jpeg'),
      
      // Dynamic settings from database
      companyName: settings.companyName,
      tagline: settings.tagline,
      companyEmail: settings.email,
      companyPhone: settings.phone,
      referralRule1: settings.referralRule1,
      referralRule2: settings.referralRule2,
      noticeText: settings.noticeText.replace(/\n/g, '<br>'),
    };

    console.log(`[Invoice] Generating PDF for Order #${order.id}`);
    console.log(`[Invoice] Background image loaded: ${!!data.backgroundImage} (Length: ${data.backgroundImage.length})`);
    console.log(`[Invoice] Logo image loaded: ${!!data.logoImage} (Length: ${data.logoImage.length})`);
    console.log(`[Invoice] Attachments count: ${data.attachments.length}`);

    const html = template(data);

    // Launch puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      
      // We set landscape: true in pdf options because the template is 297x210mm
      await page.setViewport({ width: 1122, height: 794 }); // A4 at 96 DPI
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        landscape: true,
        displayHeaderFooter: false,
        margin: {
          top: '0px',
          right: '0px',
          bottom: '0px',
          left: '0px',
        },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  private processAttachments(attachments: string[]): string[] {
    return attachments.map((attr) => {
      // If it's already a full URL or base64, keep it
      if (attr.startsWith('http') || attr.startsWith('data:')) {
        return attr;
      }

      // If it's a relative path starting with /uploads/, resolve it to the filesystem
      if (attr.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), attr);
        if (fs.existsSync(filePath)) {
          const fileData = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
          return `data:${mime};base64,${fileData.toString('base64')}`;
        }
      }

      // If it's just a filename in the uploads folder
      const uploadsPath = path.join(process.cwd(), 'uploads', attr);
      if (fs.existsSync(uploadsPath)) {
        const fileData = fs.readFileSync(uploadsPath);
        const ext = path.extname(uploadsPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
        return `data:${mime};base64,${fileData.toString('base64')}`;
      }

      return attr;
    });
  }

  private getImageBase64(relativeFilePath: string): string {
    const pathsToTry = [
      path.resolve(process.cwd(), relativeFilePath),
      path.resolve(__dirname, '..', '..', relativeFilePath), // relative to dist/sales
      path.resolve(process.cwd(), 'src', 'assets', 'imgs', path.basename(relativeFilePath)),
      path.resolve(process.cwd(), 'uploads', path.basename(relativeFilePath))
    ];

    for (const filePath of pathsToTry) {
      if (fs.existsSync(filePath)) {
        try {
          const fileData = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
          const base64 = `data:${mime};base64,${fileData.toString('base64')}`;
          console.log(`[Invoice] SUCCESS: Image loaded from: ${filePath} (Size: ${Math.round(fileData.length / 1024)}KB)`);
          return base64;
        } catch (err) {
          console.error(`[Invoice] Error reading file at ${filePath}:`, err);
        }
      }
    }

    console.error(`[Invoice] FAILED: Could not find image ${relativeFilePath} in any of:`, pathsToTry);
    return '';
  }
}

