const nodemailer = require('nodemailer');
const t = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true,
  auth: { user: 'info@entec.store', pass: 'MohamedAli@01553576740m#' }
});
t.sendMail({
  from: '"EN TEC" <info@entec.store>',
  to: 'info@entec.store',
  subject: 'Test',
  text: 'Test'
}).then(info => console.log('Sent', info))
  .catch(console.error)
  .finally(() => process.exit());
