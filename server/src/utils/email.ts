import nodemailer from "nodemailer";
import { formatMinutesLabel } from "./authTiming.js";

const VDL_LOGO_URL = "https://vdlfulfilment.com/wp-content/uploads/2023/05/cropped-VDL-Logo-compositions-15-300x141.png";

type MailTransportConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

type ParsedSender = {
  name?: string;
  email: string;
};

function parseSenderAddress(value: string): ParsedSender | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1]?.trim().replace(/^"|"$/g, "");
    const email = match[2]?.trim();
    if (email) {
      return {
        name: name || undefined,
        email,
      };
    }
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { email: trimmed };
  }

  return null;
}

function resolveBrevoSender(): ParsedSender | null {
  const email = (process.env.BREVO_FROM_EMAIL ?? "").trim();
  const name = (process.env.BREVO_FROM_NAME ?? "VDL Fulfilment Ops").trim();
  if (email) {
    return { email, name: name || undefined };
  }

  const from = (process.env.BREVO_FROM ?? "").trim() || resolveFromAddress();
  return parseSenderAddress(from);
}

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
  const timeoutMs = getSmtpTimeoutMs();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

function getSmtpTimeoutMs(): number {
  const parsed = Number(process.env.SMTP_TIMEOUT_MS ?? 12000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 12000;
  }
  return Math.max(4000, Math.min(parsed, 15000));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function resolveFromAddress(): string {
  const configured = (process.env.SMTP_FROM ?? "").trim();
  const smtpUser = (process.env.SMTP_USER ?? "").trim();

  if (!configured || /@example\.com>?$/i.test(configured)) {
    return smtpUser || "noreply@rfid-ims.example.com";
  }

  return configured;
}

async function sendWithBrevo(options: SendEmailOptions): Promise<boolean> {
  const apiKey = (process.env.BREVO_API_KEY ?? "").trim();
  if (!apiKey) return false;

  const sender = resolveBrevoSender();
  if (!sender) {
    console.error("Brevo sender not configured. Set BREVO_FROM_EMAIL or BREVO_FROM.");
    return false;
  }

  const timeoutMs = getSmtpTimeoutMs();
  const apiUrl = (process.env.BREVO_API_URL ?? "https://api.brevo.com/v3/smtp/email").trim();
  try {
    const response = await withTimeout(
      fetch(apiUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email: options.to }],
          subject: options.subject,
          htmlContent: options.html,
          textContent: options.text ?? options.html.replace(/<[^>]*>/g, ""),
        }),
      }),
      timeoutMs,
      "Brevo email delivery"
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Brevo email delivery failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
      return false;
    }

    console.log(`Email sent successfully to ${options.to} via Brevo`);
    return true;
  } catch (err) {
    console.error("Brevo email delivery failed:", err);
    return false;
  }
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
  if ((process.env.BREVO_API_KEY ?? "").trim()) {
    const delivered = await sendWithBrevo(options);
    if (delivered) return true;
    console.error("Falling back to SMTP after Brevo delivery failed.");
  }

  const configs = getTransportConfigs();
  if (!configs.length) {
    console.error("Email transporter not configured. Set BREVO_API_KEY + BREVO_FROM_EMAIL, or SMTP_HOST + SMTP_USER + SMTP_PASS.");
    return false;
  }

  const from = resolveFromAddress();
  let lastError: unknown = null;
  const timeoutMs = getSmtpTimeoutMs();

  for (const config of configs) {
    const transporter = createTransporter(config);

    try {
      await withTimeout(
        transporter.sendMail({
          from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text ?? options.html.replace(/<[^>]*>/g, ""),
        }),
        timeoutMs,
        `Email delivery via ${config.host}:${config.port}`
      );
      console.log(`Email sent successfully to ${options.to} via ${config.host}:${config.port} secure=${config.secure}`);
      return true;
    } catch (err) {
      lastError = err;
      console.error(`Failed to send email via ${config.host}:${config.port} secure=${config.secure}:`, err);
    } finally {
      transporter.close();
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

type ProvisionedAccountEmailInput = {
  email: string;
  loginUrl: string;
  roleLabel: string;
  temporaryPassword: string;
  tenantName?: string | null;
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
    .footer { padding: 18px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer-logo { width: 92px; height: auto; opacity: 0.82; }
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
    </div>
    <div class="footer">
      <img class="footer-logo" src="${VDL_LOGO_URL}" alt="VDL Fulfilment" />
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

VDL Fulfilment Ops
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
    .footer { padding: 18px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer-logo { width: 92px; height: auto; opacity: 0.82; }
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
    </div>
    <div class="footer">
      <img class="footer-logo" src="${VDL_LOGO_URL}" alt="VDL Fulfilment" />
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
    .footer { padding: 18px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer-logo { width: 92px; height: auto; opacity: 0.82; }
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
    </div>
    <div class="footer">
      <img class="footer-logo" src="${VDL_LOGO_URL}" alt="VDL Fulfilment" />
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
    .footer { padding: 18px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer-logo { width: 92px; height: auto; opacity: 0.82; }
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
    </div>
    <div class="footer">
      <img class="footer-logo" src="${VDL_LOGO_URL}" alt="VDL Fulfilment" />
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

VDL Fulfilment Ops
`;

  return { subject, html, text };
}

export function buildProvisionedAccountEmail(input: ProvisionedAccountEmailInput): { subject: string; html: string; text: string } {
  const subject = "Your VDL Fulfilment Ops account is ready";
  const escapedEmail = escapeHtml(input.email);
  const escapedRole = escapeHtml(input.roleLabel);
  const escapedPassword = escapeHtml(input.temporaryPassword);
  const escapedLoginUrl = escapeHtml(input.loginUrl);
  const escapedTenant = input.tenantName ? escapeHtml(input.tenantName) : null;
  const branchLine = escapedTenant ? `<div class="detail-row"><span class="detail-label">Branch:</span> ${escapedTenant}</div>` : "";
  const textBranchLine = input.tenantName ? `Branch: ${input.tenantName}\n` : "";

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
    .password-box { background: #0B0F17; color: #ffffff; border-radius: 10px; padding: 16px; margin: 20px 0; text-align: center; font-size: 22px; font-weight: 800; letter-spacing: 2px; }
    .button { display: inline-block; background: #0B0F17; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 16px 0; }
    .footer { padding: 18px 24px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer-logo { width: 92px; height: auto; opacity: 0.82; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>VDL Fulfilment Ops</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>An administrator created your VDL Fulfilment Ops account. Sign in with the temporary password below, then set a new password before continuing.</p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Email:</span> ${escapedEmail}</div>
        <div class="detail-row"><span class="detail-label">Access:</span> ${escapedRole}</div>
        ${branchLine}
      </div>
      <div class="password-box">${escapedPassword}</div>
      <p style="text-align: center;"><a href="${escapedLoginUrl}" class="button">Open Sign In</a></p>
    </div>
    <div class="footer">
      <img class="footer-logo" src="${VDL_LOGO_URL}" alt="VDL Fulfilment" />
    </div>
  </div>
</body>
</html>
`;

  const text = `VDL Fulfilment Ops - Account Ready

Hello,

An administrator created your VDL Fulfilment Ops account. Sign in with the temporary password below, then set a new password before continuing.

Email: ${input.email}
Access: ${input.roleLabel}
${textBranchLine}Temporary password: ${input.temporaryPassword}

Sign in: ${input.loginUrl}
`;

  return { subject, html, text };
}
