import nodemailer from "nodemailer";

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = String(process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) {
    console.error("Email transporter not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in environment.");
    return false;
  }

  const from = process.env.SMTP_FROM ?? "noreply@rfid-ims.example.com";

  try {
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text ?? options.html.replace(/<[^>]*>/g, ""),
    });
    console.log(`Email sent successfully to ${options.to}`);
    return true;
  } catch (err) {
    console.error("Failed to send email:", err);
    return false;
  }
}

export function buildResetPasswordEmail(token: string, baseUrl: string): { subject: string; html: string; text: string } {
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  const subject = "Reset your RFID-IMS password";
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
    .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #0B0F17; padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .content p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .button { display: inline-block; background: #0B0F17; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .button:hover { background: #1a2332; }
    .footer { padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .footer p { color: #9ca3af; font-size: 13px; margin: 0; }
    .token-box { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 13px; color: #374151; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>VDL Fulfilment Ops</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>You requested to reset your password. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <p style="text-align: center;"><a href="${resetUrl}" class="button">Reset Password</a></p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
      <p>Or copy and paste this link into your browser:</p>
      <div class="token-box">${resetUrl}</div>
    </div>
    <div class="footer">
      <p>This is an automated message from RFID Inventory Management System.</p>
    </div>
  </div>
</body>
</html>
`;
  const text = `
VDL Fulfilment Ops - Password Reset

Hello,

You requested to reset your password. Click the link below to set a new password. This link expires in 1 hour.

${resetUrl}

If you didn't request a password reset, you can safely ignore this email.

This is an automated message from RFID Inventory Management System.
`;

  return { subject, html, text };
}

export function buildVerificationEmail(token: string, baseUrl: string): { subject: string; html: string; text: string } {
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
  const subject = "Verify your VDL Fulfilment Ops account";
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
    .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #0B0F17; padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .content p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .button { display: inline-block; background: #0B0F17; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .button:hover { background: #1a2332; }
    .footer { padding: 16px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .footer p { color: #9ca3af; font-size: 13px; margin: 0; }
    .token-box { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 13px; color: #374151; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>VDL Fulfilment Ops</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Thank you for creating an account. Please verify your email address by clicking the button below. This link expires in <strong>24 hours</strong>.</p>
      <p style="text-align: center;"><a href="${verifyUrl}" class="button">Verify Email</a></p>
      <p>If you didn't create an account, you can safely ignore this email.</p>
      <p>Or copy and paste this link into your browser:</p>
      <div class="token-box">${verifyUrl}</div>
    </div>
    <div class="footer">
      <p>This is an automated message from RFID Inventory Management System.</p>
    </div>
  </div>
</body>
</html>
`;
  const text = `
VDL Fulfilment Ops - Email Verification

Hello,

Thank you for creating an account. Please verify your email address by clicking the link below. This link expires in 24 hours.

${verifyUrl}

If you didn't create an account, you can safely ignore this email.

This is an automated message from RFID Inventory Management System.
`;

  return { subject, html, text };
}
