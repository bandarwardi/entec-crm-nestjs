const nodemailer = require('nodemailer');
const fs = require('fs');

const t = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true,
  auth: { user: 'info@entec.store', pass: 'MohamedAli@01553576740m#' }
});

t.sendMail({
  from: '"EN TEC" <info@entec.store>',
  to: 'info@entec.store',
  subject: 'Test Invoice',
  text: 'This is a test with attachment.',
  attachments: [{
    filename: 'test.pdf',
    content: Buffer.from('JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nDPQM1Qo5ypUMFAwALJMLU31jBQsTAz1LBSKUrnCuQCBBwcXCmVuZHN0cmVhbQplbmRvYmoK', 'base64')
  }]
}).then(info => console.log('Sent', info))
  .catch(console.error)
  .finally(() => process.exit());
