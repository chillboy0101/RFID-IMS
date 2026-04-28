import nodemailer from "nodemailer";
import { formatMinutesLabel } from "./authTiming.js";

type MailTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function getTransportConfigs(): MailTransportConfig[] {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = String(process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return [];
  }

  const configs: MailTransportConfig[] = [{ host, port, secure, user, pass }];
  const isGmailHost = /(^|\.)gmail\.com$/i.test(host.trim());

  if (isGmailHost && (port !== 465 || !secure)) {
    configs.push({
      host,
      port: 465,
      secure: true,
      user,
      pass,
    });
  }

  return configs.filter(
    (config, index, items) =>
      index ===
      items.findIndex(
        (item) =>
          item.host === config.host &&
          item.port === config.port &&
          item.secure === config.secure &&
          item.user === config.user
      )
  );
}

function createTransporter(config: MailTransportConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

function resolveFromAddress(): string {
  const configured = (process.env.SMTP_FROM ?? "").trim();
  const smtpUser = (process.env.SMTP_USER ?? "").trim();

  if (!configured || /@example\.com>?$/i.test(configured)) {
    return smtpUser || "noreply@rfid-ims.example.com";
  }

  return configured;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDetail(value: string | undefined | null, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const configs = getTransportConfigs();
  if (!configs.length) {
    console.error("Email transporter not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in environment.");
    return false;
  }

  const from = resolveFromAddress();
  let lastError: unknown = null;

  for (const config of configs) {
    const transporter = createTransporter(config);

    try {
      await transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text ?? options.html.replace(/<[^>]*>/g, ""),
      });
      console.log(`Email sent successfully to ${options.to} via ${config.host}:${config.port} secure=${config.secure}`);
      return true;
    } catch (err) {
      lastError = err;
      console.error(`Failed to send email via ${config.host}:${config.port} secure=${config.secure}:`, err);
    }
  }

  console.error("All email delivery attempts failed.", lastError);
  return false;
}

type LoginAlertEmailInput = {
  protectUrl: string;
  loginAt: Date;
  ip?: string;
  userAgent?: string;
  expiresMinutes: number;
};

type RecoveryOtpEmailInput = {
  recoveryUrl: string;
  otp: string;
  expiresMinutes: number;
};

export function buildResetPasswordEmail(token: string, baseUrl: string, expiresMinutes: number): { subject: string; html: string; text: string } {
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  const subject = "Reset your RFID-IMS password";
  const expiresLabel = formatMinutesLabel(expiresMinutes);
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
      <p>You requested to reset your password. Click the button below to set a new password. This link expires in <strong>${expiresLabel}</strong>.</p>
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

You requested to reset your password. Click the link below to set a new password. This link expires in ${expiresLabel}.

${resetUrl}

If you didn't request a password reset, you can safely ignore this email.

This is an automated message from RFID Inventory Management System.
`;

  return { subject, html, text };
}

export function buildLoginAlertEmail(input: LoginAlertEmailInput): { subject: string; html: string; text: string } {
  const subject = "New sign-in to your VDL Fulfilment Ops account";
  const loginTime = input.loginAt.toUTCString();
  const ip = formatDetail(input.ip, "Unavailable");
  const userAgent = formatDetail(input.userAgent, "Unavailable");
  const expiresLabel = formatMinutesLabel(input.expiresMinutes);
  const escapedIp = escapeHtml(ip);
  const escapedUserAgent = escapeHtml(userAgent);
  const escapedTime = escapeHtml(loginTime);
  const escapedProtectUrl = escapeHtml(input.protectUrl);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #0B0F17; padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .content p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .detail-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin: 18px 0; }
    .detail-row { margin-bottom: 10px; color: #0f172a; font-size: 14px; line-height: 1.5; word-break: break-word; }
    .detail-row:last-child { margin-bottom: 0; }
    .detail-label { font-weight: 700; color: #475569; }
    .button { display: inline-block; background: #b91c1c; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 15px; margin: 16px 0; }
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
      <p>We noticed a sign-in to your account.</p>
      <p>If this was you, you can safely ignore this email.</p>
      <p>If this was not you, click the button below right away. We will sign out every active session and send a recovery OTP to help you secure the account. This protection link expires in <strong>${expiresLabel}</strong>.</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Time:</span> ${escapedTime}</div>
        <div class="detail-row"><span class="detail-label">IP address:</span> ${escapedIp}</div>
        <div class="detail-row"><span class="detail-label">Device:</span> ${escapedUserAgent}</div>
      </div>
      <p style="text-align: center;"><a href="${input.protectUrl}" class="button">Protect My Account</a></p>
      <p>Or copy and paste this link into your browser:</p>
      <div class="token-box">${escapedProtectUrl}</div>
    </div>
    <div class="footer">
      <p>This is an automated security message from RFID Inventory Management System.</p>
    </div>
  </div>
</body>
</html>
`;
  const text = `VDL Fulfilment Ops - New Sign-In\n\nWe noticed a sign-in to your account.\n\nTime: ${loginTime}\nIP address: ${ip}\nDevice: ${userAgent}\n\nIf this was you, you can safely ignore this email.\n\nIf this was not you, open this link right away. We will sign out every active session and send a recovery OTP to help you secure the account. This protection link expires in ${expiresLabel}.\n\n${input.protectUrl}\n`;

  return { subject, html, text };
}

export function buildRecoveryOtpEmail(input: RecoveryOtpEmailInput): { subject: string; html: string; text: string } {
  const subject = "Your VDL Fulfilment Ops account recovery code";
  const escapedOtp = escapeHtml(input.otp);
  const escapedRecoveryUrl = escapeHtml(input.recoveryUrl);
  const expiresLabel = formatMinutesLabel(input.expiresMinutes);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f4f5; margin: 0; padding: 20px; }
    .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #0B0F17; padding: 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .content p { color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .otp-box { background: #0B0F17; color: #ffffff; border-radius: 10px; padding: 18px; margin: 20px 0; text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 4px; }
    .button { display: inline-block; background: #0B0F17; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
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
      <p>We locked the account because someone reported this sign-in as suspicious.</p>
      <p>Use the one-time code below to confirm it is really you and set a new password. This code expires in <strong>${expiresLabel}</strong>.</p>
      <div class="otp-box">${escapedOtp}</div>
      <p style="text-align: center;"><a href="${input.recoveryUrl}" class="button">Open Recovery Page</a></p>
      <p>Or copy and paste this link into your browser:</p>
      <div class="token-box">${escapedRecoveryUrl}</div>
    </div>
    <div class="footer">
      <p>This is an automated security message from RFID Inventory Management System.</p>
    </div>
  </div>
</body>
</html>
`;
  const text = `VDL Fulfilment Ops - Account Recovery Code\n\nWe locked the account because someone reported this sign-in as suspicious.\n\nUse this one-time code to confirm it is really you and set a new password. This code expires in ${expiresLabel}.\n\nCode: ${input.otp}\n\nRecovery page: ${input.recoveryUrl}\n`;

  return { subject, html, text };
}

export function buildVerificationEmail(token: string, baseUrl: string, expiresMinutes: number): { subject: string; html: string; text: string } {
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
  const subject = "Verify your VDL Fulfilment Ops account";
  const expiresLabel = formatMinutesLabel(expiresMinutes);
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
      <p>Thank you for creating an account. Please verify your email address by clicking the button below. This link expires in <strong>${expiresLabel}</strong>.</p>
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

Thank you for creating an account. Please verify your email address by clicking the link below. This link expires in ${expiresLabel}.

${verifyUrl}

If you didn't create an account, you can safely ignore this email.

This is an automated message from RFID Inventory Management System.
`;

  return { subject, html, text };
}
