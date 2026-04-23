import bcrypt from "bcryptjs";
import crypto from "crypto";
import express from "express";
import mongoose from "mongoose";

import { requireAuth, signAccessToken, type AuthRequest } from "../middleware/auth.js";
import { AuthSessionModel } from "../models/AuthSession.js";
import { UserModel } from "../models/User.js";
import { PasswordResetTokenModel } from "../models/PasswordResetToken.js";
import { sendEmail, buildResetPasswordEmail, buildVerificationEmail } from "../utils/email.js";

const router = express.Router();

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
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

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

      // Send verification email
      const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
      const { subject, html, text } = buildVerificationEmail(token, baseUrl);
      
      // Fire and forget - don't fail registration if email fails
      sendEmail({ to: cleanEmail, subject, html, text }).catch((err) => {
        console.error("Failed to send verification email:", err);
      });
    });

    if (!userId) {
      res.status(500).json({ ok: false, error: "Failed to create user" });
      return;
    }

    // Return success - user must verify email before logging in
    res.status(201).json({
      ok: true,
      message: "Account created. Please check your email to verify your account before logging in.",
      email: cleanEmail,
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
    res.status(401).json({ ok: false, error: "Please verify your email before logging in. Check your inbox for the verification link." });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
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
    ip: req.ip ?? undefined,
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
    res.status(400).json({ ok: false, error: "Invalid or expired reset token" });
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
    res.status(400).json({ ok: false, error: "Invalid or expired reset token" });
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
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await PasswordResetTokenModel.create({
      userId: user._id,
      token,
      expiresAt,
    });

    const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const { subject, html, text } = buildResetPasswordEmail(token, baseUrl);
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
    res.status(400).json({ ok: false, error: "Invalid or expired verification token" });
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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await VerificationTokenModel.create({
    userId: user._id,
    email: cleanEmail,
    token,
    expiresAt,
  });

  // Send verification email
  const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
  const { subject, html, text } = buildVerificationEmail(token, baseUrl);

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
