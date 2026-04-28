import bcrypt from "bcryptjs";
import crypto from "crypto";
import express from "express";
import mongoose from "mongoose";

import { requireAuth, signAccessToken, type AuthRequest } from "../middleware/auth.js";
import { AuthSessionModel } from "../models/AuthSession.js";
import { LoginAlertModel } from "../models/LoginAlert.js";
import { UserModel } from "../models/User.js";
import { PasswordResetTokenModel } from "../models/PasswordResetToken.js";
import { resolveAppBaseUrl } from "../utils/appUrl.js";
import { ACCOUNT_RECOVERY_OTP_MINUTES, EMAIL_VERIFICATION_EXPIRES_MINUTES, LOGIN_ALERT_EXPIRES_MINUTES, PASSWORD_RESET_EXPIRES_MINUTES } from "../utils/authTiming.js";
import { buildLoginAlertEmail, buildRecoveryOtpEmail, buildResetPasswordEmail, buildVerificationEmail, sendEmail } from "../utils/email.js";

const router = express.Router();

function getApiBaseUrl(req: express.Request): string {
  const protocol = req.protocol || "http";
  const host = req.get("host")?.trim();
  if (host) {
    return `${protocol}://${host}`;
  }
  return `http://localhost:${process.env.PORT ?? 4000}`;
}

function formatClientIp(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "Unavailable";

  const first = value.split(",")[0]!.trim();
  const normalized = first.startsWith("::ffff:") ? first.slice(7) : first;

  if (normalized === "::1" || normalized === "127.0.0.1") {
    return "Local device (localhost)";
  }

  if (normalized.startsWith("192.168.") || normalized.startsWith("10.") || normalized.startsWith("172.")) {
    return `${normalized} (private network)`;
  }

  return normalized;
}

function getClientIp(req: express.Request): string {
  const forwarded = req.header("x-forwarded-for");
  return formatClientIp(forwarded || req.ip || "");
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function createRecoveryOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

async function issueRecoveryOtp(alert: mongoose.HydratedDocument<any>, userEmail: string, appBaseUrl: string): Promise<boolean> {
  const otp = createRecoveryOtp();
  const now = new Date();
  alert.recoveryOtpHash = hashOtp(otp);
  alert.recoveryOtpExpiresAt = new Date(now.getTime() + ACCOUNT_RECOVERY_OTP_MINUTES * 60 * 1000);
  alert.recoveryOtpSentAt = now;
  await alert.save();

  const recoveryUrl = `${appBaseUrl}/recover-account?token=${encodeURIComponent(alert.token)}`;
  const { subject, html, text } = buildRecoveryOtpEmail({
    recoveryUrl,
    otp,
    expiresMinutes: ACCOUNT_RECOVERY_OTP_MINUTES,
  });

  return sendEmail({ to: userEmail, subject, html, text });
}

// Dev-only: register a pre-verified user (bypasses email verification)
// Use X-Dev-Secret: dev-secret header or ?secret=dev-secret query param
router.post("/register-dev", async (req, res) => {
  const secret = req.header("X-Dev-Secret") ?? req.query.secret ?? "";
  const devSecret = process.env.DEV_BYPASS_SECRET ?? "dev-bypass-123";
  if (secret !== devSecret) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };
  if (!name || !email || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }
  const cleanEmail = email.toLowerCase().trim();
  const existing = await UserModel.findOne({ email: cleanEmail }).exec();
  if (existing) {
    const ok = await bcrypt.compare(password, existing.passwordHash);
    if (ok) {
      existing.emailVerified = true;
      await existing.save();
      const jti = crypto.randomUUID();
      const now = new Date();
      await AuthSessionModel.create({
        userId: existing._id.toString(),
        jti,
        createdAt: now,
        lastSeenAt: now,
      });
      const token = signAccessToken({ id: existing._id.toString(), role: existing.role, jti });
      res.json({ ok: true, token, user: { id: existing._id.toString(), name: existing.name, email: existing.email, role: existing.role } });
      return;
    }
    res.status(409).json({ ok: false, error: "Email already in use" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await UserModel.create({ name: name.trim(), email: cleanEmail, passwordHash, emailVerified: true });
  const jti = crypto.randomUUID();
  const now = new Date();
  await AuthSessionModel.create({ userId: user._id.toString(), jti, createdAt: now, lastSeenAt: now });
  const token = signAccessToken({ id: user._id.toString(), role: user.role, jti });
  res.json({ ok: true, token, user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role } });
});

router.get("/", async (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      register: "POST /auth/register",
      login: "POST /auth/login",
      me: "GET /auth/me (Bearer token)",
    },
  });
});

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const existing = await UserModel.findOne({ email: cleanEmail }).exec();
  if (existing) {
    res.status(409).json({ ok: false, error: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const session = await mongoose.startSession();
  try {
    let userId: string | null = null;
    let verificationEmail:
      | { to: string; subject: string; html: string; text: string }
      | null = null;

    await session.withTransaction(async () => {
      const user = await UserModel.create(
        [
          {
            name: name.trim(),
            email: cleanEmail,
            passwordHash,
            emailVerified: false,
          },
        ],
        { session }
      );

      userId = user[0]!._id.toString();

      // Create verification token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRES_MINUTES * 60 * 1000);

      // Import VerificationTokenModel here to avoid circular dependency issues
      const { VerificationTokenModel } = await import("../models/VerificationToken.js");
      await VerificationTokenModel.create(
        [
          {
            userId: user[0]!._id,
            email: cleanEmail,
            token,
            expiresAt,
          },
        ],
        { session }
      );

      const baseUrl = resolveAppBaseUrl(req) ?? `http://localhost:${process.env.PORT ?? 4000}`;
      const { subject, html, text } = buildVerificationEmail(token, baseUrl, EMAIL_VERIFICATION_EXPIRES_MINUTES);
      verificationEmail = { to: cleanEmail, subject, html, text };
    });

    if (!userId) {
      res.status(500).json({ ok: false, error: "Failed to create user" });
      return;
    }

    const emailSent = verificationEmail ? await sendEmail(verificationEmail) : false;

    res.status(201).json({
      ok: true,
      message: emailSent
        ? "Account created. Please check your email to verify your account before logging in."
        : "Account created, but we could not send the verification email just now. Please use resend verification from the login flow.",
      email: cleanEmail,
      emailSent,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Registration failed" });
  } finally {
    session.endSession();
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
  if (!user) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  // Check if email is verified (skip for super admin)
  const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? "equalizerjr@gmail.com").toLowerCase().trim();
  const isSuperAdmin = user.email.toLowerCase().trim() === superAdminEmail;
  if (!user.emailVerified && !isSuperAdmin) {
    res.status(401).json({
      ok: false,
      error: "Please verify your email before logging in. Check your inbox for the latest verification email or resend a new one from this screen.",
    });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  if ((user as any).accountRecoveryRequiredAt) {
    res.status(403).json({
      ok: false,
      error: "This account is locked for recovery. Check your email for the security alert and recovery code before signing in again.",
    });
    return;
  }

  const jti = crypto.randomUUID();
  const now = new Date();
  await AuthSessionModel.create({
    userId: user._id.toString(),
    jti,
    createdAt: now,
    lastSeenAt: now,
    userAgent: req.header("user-agent") ?? undefined,
    ip: getClientIp(req),
  });

  const alertToken = crypto.randomBytes(32).toString("hex");
  const loginAlertExpiresAt = new Date(now.getTime() + LOGIN_ALERT_EXPIRES_MINUTES * 60 * 1000);
  await LoginAlertModel.create({
    userId: user._id,
    sessionJti: jti,
    token: alertToken,
    loginAt: now,
    userAgent: req.header("user-agent") ?? "",
    ip: getClientIp(req),
    expiresAt: loginAlertExpiresAt,
  });

  const protectUrl = `${getApiBaseUrl(req)}/auth/login-alert/protect?token=${encodeURIComponent(alertToken)}`;
  const loginAlertEmail = buildLoginAlertEmail({
    protectUrl,
    loginAt: now,
    ip: getClientIp(req),
    userAgent: req.header("user-agent") ?? "",
    expiresMinutes: LOGIN_ALERT_EXPIRES_MINUTES,
  });
  sendEmail({ to: user.email, subject: loginAlertEmail.subject, html: loginAlertEmail.html, text: loginAlertEmail.text }).catch((err) => {
    console.error(`Failed to send login alert email to ${user.email}:`, err);
  });

  const token = signAccessToken({ id: user._id.toString(), role: user.role, jti });

  res.json({
    ok: true,
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean((user as any).mustChangePassword),
    },
  });
});

router.get("/login-alert/protect", async (req, res) => {
  const { token } = req.query as { token?: string };
  const appBaseUrl = resolveAppBaseUrl(req) ?? `http://localhost:${process.env.PORT ?? 4000}`;
  const redirectUrl = (status?: string) =>
    `${appBaseUrl}/recover-account${token ? `?token=${encodeURIComponent(token)}` : ""}${status ? `${token ? "&" : "?"}status=${encodeURIComponent(status)}` : ""}`;

  if (!token) {
    res.redirect(302, redirectUrl("missing-token"));
    return;
  }

  const loginAlert = await LoginAlertModel.findOne({
    token: token.trim(),
    expiresAt: { $gt: new Date() },
    recoveryCompletedAt: null,
  }).exec();

  if (!loginAlert) {
    res.redirect(302, redirectUrl("invalid-token"));
    return;
  }

  const user = await UserModel.findById(loginAlert.userId).exec();
  if (!user) {
    res.redirect(302, redirectUrl("missing-user"));
    return;
  }

  const now = new Date();
  loginAlert.protectClickedAt = now;
  await AuthSessionModel.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: now, revokedByRole: "security_alert" } }
  ).exec();

  (user as any).accountRecoveryRequiredAt = now;
  await user.save();

  const otpSent = await issueRecoveryOtp(loginAlert, user.email, appBaseUrl);
  res.redirect(302, `${redirectUrl(otpSent ? "otp-sent" : "otp-failed")}`);
});

router.get("/recover-account/:token", async (req, res) => {
  const { token } = req.params;

  if (!token) {
    res.status(400).json({ ok: false, error: "Token is required" });
    return;
  }

  const loginAlert = await LoginAlertModel.findOne({
    token: token.trim(),
    expiresAt: { $gt: new Date() },
    recoveryCompletedAt: null,
  }).exec();

  if (!loginAlert || !loginAlert.protectClickedAt) {
    res.status(400).json({
      ok: false,
      error: "Recovery session is invalid or expired. Use the latest security email to start again.",
    });
    return;
  }

  const user = await UserModel.findById(loginAlert.userId).select({ email: 1 }).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  res.json({
    ok: true,
    email: user.email,
    otpRequired: true,
    otpSentAt: loginAlert.recoveryOtpSentAt,
    otpExpiresAt: loginAlert.recoveryOtpExpiresAt,
    recoverySessionExpiresAt: loginAlert.expiresAt,
    loginAt: loginAlert.loginAt,
    ip: loginAlert.ip,
    userAgent: loginAlert.userAgent,
  });
});

router.post("/recover-account/resend-otp", async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ ok: false, error: "Token is required" });
    return;
  }

  const loginAlert = await LoginAlertModel.findOne({
    token: token.trim(),
    expiresAt: { $gt: new Date() },
    recoveryCompletedAt: null,
  }).exec();

  if (!loginAlert || !loginAlert.protectClickedAt) {
    res.status(400).json({ ok: false, error: "Recovery session is invalid or expired" });
    return;
  }

  const user = await UserModel.findById(loginAlert.userId).select({ email: 1 }).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  const appBaseUrl = resolveAppBaseUrl(req) ?? `http://localhost:${process.env.PORT ?? 4000}`;
  const sent = await issueRecoveryOtp(loginAlert, user.email, appBaseUrl);

  res.json({
    ok: true,
    message: sent
      ? "A new recovery code has been sent to your email."
      : "We could not send a new recovery code right now. Please try again shortly.",
    sent,
  });
});

router.post("/recover-account", async (req, res) => {
  const { token, otp, password } = req.body as { token?: string; otp?: string; password?: string };

  if (!token || !otp || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    return;
  }

  const loginAlert = await LoginAlertModel.findOne({
    token: token.trim(),
    expiresAt: { $gt: new Date() },
    recoveryCompletedAt: null,
  }).exec();

  if (!loginAlert || !loginAlert.protectClickedAt) {
    res.status(400).json({
      ok: false,
      error: "Recovery session is invalid or expired. Use the latest security email to start again.",
    });
    return;
  }

  if (!loginAlert.recoveryOtpHash || !loginAlert.recoveryOtpExpiresAt || loginAlert.recoveryOtpExpiresAt.getTime() <= Date.now()) {
    res.status(400).json({
      ok: false,
      error: "Recovery code is invalid or expired. Please use the latest code from your email or resend a new one.",
    });
    return;
  }

  if (hashOtp(otp.trim()) !== loginAlert.recoveryOtpHash) {
    res.status(400).json({
      ok: false,
      error: "Recovery code is invalid or expired. Please use the latest code from your email or resend a new one.",
    });
    return;
  }

  const user = await UserModel.findById(loginAlert.userId).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  user.passwordHash = await bcrypt.hash(password, 12);
  (user as any).mustChangePassword = false;
  (user as any).accountRecoveryRequiredAt = null;
  await user.save();

  const now = new Date();
  loginAlert.recoveryCompletedAt = now;
  loginAlert.recoveryOtpHash = null;
  loginAlert.recoveryOtpExpiresAt = null;
  await loginAlert.save();

  await AuthSessionModel.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: now, revokedByRole: "account_recovery" } }
  ).exec();

  await PasswordResetTokenModel.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: now } }).exec();

  res.json({
    ok: true,
    message: "Your account has been secured. You can now sign in with your new password.",
  });
});

router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ ok: false, error: "Invalid password" });
    return;
  }

  const user = await UserModel.findById(auth.id).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  (user as any).mustChangePassword = false;
  await user.save();

  res.json({
    ok: true,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean((user as any).mustChangePassword),
    },
  });
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const user = await UserModel.findById(auth.id).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  let token: string | undefined = undefined;
  if (!auth.jti) {
    const jti = crypto.randomUUID();
    const now = new Date();
    await AuthSessionModel.create({
      userId: user._id.toString(),
      jti,
      createdAt: now,
      lastSeenAt: now,
      userAgent: req.header("user-agent") ?? undefined,
      ip: req.ip ?? undefined,
    });
    token = signAccessToken({ id: user._id.toString(), role: user.role, jti });
  }

  res.json({
    ok: true,
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean((user as any).mustChangePassword),
    },
  });
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    res.status(400).json({ ok: false, error: "Missing required fields" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    return;
  }

  const resetToken = await PasswordResetTokenModel.findOne({
    token: token.trim(),
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).exec();

  if (!resetToken) {
    res.status(400).json({
      ok: false,
      error: "Invalid or expired reset token. Please request a new password reset email.",
    });
    return;
  }

  const user = await UserModel.findById(resetToken.userId).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  // Mark token as used
  resetToken.usedAt = new Date();
  await resetToken.save();

  // Update password
  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();

  // Revoke all existing sessions for this user for security
  await AuthSessionModel.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedByRole: "password_reset" } }
  ).exec();

  res.json({
    ok: true,
    message: "Password has been reset. Please sign in with your new password.",
  });
});

router.get("/reset-password/:token", async (req, res) => {
  const { token } = req.params;

  if (!token) {
    res.status(400).json({ ok: false, error: "Token is required" });
    return;
  }

  const resetToken = await PasswordResetTokenModel.findOne({
    token: token.trim(),
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).exec();

  if (!resetToken) {
    res.status(400).json({
      ok: false,
      error: "Invalid or expired reset token. Please request a new password reset email.",
    });
    return;
  }

  const user = await UserModel.findById(resetToken.userId).select({ email: 1, name: 1 }).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  res.json({
    ok: true,
    valid: true,
    email: user.email,
  });
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ ok: false, error: "Email is required" });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const user = await UserModel.findOne({ email: cleanEmail }).exec();

  // Always return success to prevent email enumeration attacks
  // But only send email if user exists
  if (user) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000);

    await PasswordResetTokenModel.create({
      userId: user._id,
      token,
      expiresAt,
    });

    const baseUrl = resolveAppBaseUrl(req) ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const { subject, html, text } = buildResetPasswordEmail(token, baseUrl, PASSWORD_RESET_EXPIRES_MINUTES);
    const sent = await sendEmail({ to: user.email, subject, html, text });

    if (!sent) {
      console.error(`Failed to send password reset email to ${user.email}`);
    }
  }

  // Return success regardless to prevent email enumeration
  res.json({
    ok: true,
    message: "If an account with that email exists, we've sent a password reset link.",
  });
});

// Verify email with token
router.get("/verify-email", async (req, res) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    res.status(400).json({ ok: false, error: "Token is required" });
    return;
  }

  const { VerificationTokenModel } = await import("../models/VerificationToken.js");

  const resetToken = await VerificationTokenModel.findOne({
    token: token.trim(),
    expiresAt: { $gt: new Date() },
  }).exec();

  if (!resetToken) {
    res.status(400).json({
      ok: false,
      error: "Invalid or expired verification token. Please use the latest verification email or request a new one.",
    });
    return;
  }

  const user = await UserModel.findById(resetToken.userId).exec();
  if (!user) {
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  // Mark user as verified
  user.emailVerified = true;
  await user.save();

  // Mark token as used (delete it)
  await VerificationTokenModel.deleteOne({ _id: resetToken._id }).exec();

  res.json({
    ok: true,
    message: "Email verified successfully. You can now log in to your account.",
  });
});

// Resend verification email
router.post("/resend-verification", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ ok: false, error: "Email is required" });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const user = await UserModel.findOne({ email: cleanEmail }).exec();

  // Always return success to prevent email enumeration
  if (!user || user.emailVerified) {
    res.json({
      ok: true,
      message: "If an account with that email exists and is unverified, we've sent a new verification link.",
    });
    return;
  }

  // Delete any existing verification tokens
  const { VerificationTokenModel } = await import("../models/VerificationToken.js");
  await VerificationTokenModel.deleteMany({ userId: user._id }).exec();

  // Create new verification token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRES_MINUTES * 60 * 1000);

  await VerificationTokenModel.create({
    userId: user._id,
    email: cleanEmail,
    token,
    expiresAt,
  });

  // Send verification email
  const baseUrl = resolveAppBaseUrl(req) ?? `http://localhost:${process.env.PORT ?? 4000}`;
  const { subject, html, text } = buildVerificationEmail(token, baseUrl, EMAIL_VERIFICATION_EXPIRES_MINUTES);

  const sent = await sendEmail({ to: cleanEmail, subject, html, text });
  if (!sent) {
    console.error(`Failed to send verification email to ${cleanEmail}`);
  }

  res.json({
    ok: true,
    message: "If an account with that email exists and is unverified, we've sent a new verification link.",
  });
});

export default router;
