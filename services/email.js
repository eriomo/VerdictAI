'use strict';

/**
 * VERDICT AI — EMAIL SERVICE
 * services/email.js
 */

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const pass = (process.env.GMAIL_APP_PASSWORD || '').trim().replace(/\s/g, '');
  if (!pass) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'trigxyfn@gmail.com', pass },
  });
  return transporter;
}

async function sendPaymentNotification({ email, plan, amount, reference, userId }) {
  const t = getTransporter();
  if (!t) return;
  try {
    await t.sendMail({
      from: '"Verdict AI Payments" <trigxyfn@gmail.com>',
      to: 'trigxyfn@gmail.com',
      subject: `💰 New Payment — ${plan} — NGN ${Number(amount).toLocaleString()}`,
      text: [
        '🎉 NEW BANK TRANSFER SUBMITTED',
        '',
        `User: ${email}`,
        `Plan: ${plan}`,
        `Amount: NGN ${Number(amount).toLocaleString()}`,
        `Ref: ${reference}`,
        `Time: ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`,
        '',
        `Set tier to: ${plan.includes('chambers') ? 'chambers' : 'solo'}`,
        'Supabase: https://supabase.com/dashboard/project/xlykbkfwgqhldxrwhwbp/editor',
      ].join('\n'),
    });
  } catch (e) {
    console.log('Email error:', e.message);
  }
}

module.exports = { sendPaymentNotification };
