import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { FeedbackModel } from "../models/Feedback.js";
import { InventoryItemModel } from "../models/InventoryItem.js";
import { InventoryLogModel } from "../models/InventoryLog.js";
import { InviteModel } from "../models/Invite.js";
import { OrderModel, orderStatuses, type OrderStatus } from "../models/Order.js";
import { ReorderRequestModel, reorderStatuses, type ReorderStatus } from "../models/ReorderRequest.js";
import { RfidEventModel, rfidEventTypes, type RfidEventType } from "../models/RfidEvent.js";
import { TaskSessionModel, taskSessionKinds, type TaskSessionKind } from "../models/TaskSession.js";
import { TenantAuditLogModel } from "../models/TenantAuditLog.js";
import { TenantMembershipModel } from "../models/TenantMembership.js";
import { TenantModel } from "../models/Tenant.js";
import { UserModel, userRoles, type UserRole } from "../models/User.js";
import { VendorModel } from "../models/Vendor.js";

dotenv.config();

const ADMIN_EMAIL = "equalizerjr@gmail.com";

type Args = {
  reset: boolean;
  yes: boolean;
  tenants: number;
  usersPerTenant: number;
  itemsPerTenant: number;
  ordersPerTenant: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    reset: false,
    yes: false,
    tenants: 3,
    usersPerTenant: 8,
    itemsPerTenant: 24,
    ordersPerTenant: 8,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--reset") args.reset = true;
    if (a === "--yes") args.yes = true;
    if (a === "--tenants") {
      args.tenants = Number(argv[i + 1] ?? args.tenants);
      i++;
    }
    if (a === "--users-per-tenant") {
      args.usersPerTenant = Number(argv[i + 1] ?? args.usersPerTenant);
      i++;
    }
    if (a === "--items-per-tenant") {
      args.itemsPerTenant = Number(argv[i + 1] ?? args.itemsPerTenant);
      i++;
    }
    if (a === "--orders-per-tenant") {
      args.ordersPerTenant = Number(argv[i + 1] ?? args.ordersPerTenant);
      i++;
    }
  }

  if (!Number.isFinite(args.tenants) || args.tenants < 1) args.tenants = 1;
  if (!Number.isFinite(args.usersPerTenant) || args.usersPerTenant < 0) args.usersPerTenant = 0;
  if (!Number.isFinite(args.itemsPerTenant) || args.itemsPerTenant < 1) args.itemsPerTenant = 1;
  if (!Number.isFinite(args.ordersPerTenant) || args.ordersPerTenant < 0) args.ordersPerTenant = 0;

  return args;
}

function sample<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomInt(min: number, maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function makeSku(tenantIdx: number, itemIdx: number): string {
  return `T${tenantIdx + 1}-SKU-${String(itemIdx + 1).padStart(4, "0")}`;
}

function maybeRfidTag(itemIdx: number): string | undefined {
  if (itemIdx % 4 !== 0) return undefined;
  const hex = cryptoRandomHex(8);
  return `TAG-${hex.toUpperCase()}`;
}

function cryptoRandomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256);
  return Buffer.from(b).toString("hex");
}

async function ensureAdminUser(): Promise<mongoose.Types.ObjectId> {
  const existing = await UserModel.findOne({ email: ADMIN_EMAIL.toLowerCase().trim() }).exec();
  if (existing) {
    if (existing.role !== "admin") {
      existing.role = "admin";
      await existing.save();
    }
    return existing._id;
  }

  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin123!";
  const passwordHash = await bcrypt.hash(password, 12);

  const created = await UserModel.create({
    name: "Equalizer Admin",
    email: ADMIN_EMAIL.toLowerCase().trim(),
    passwordHash,
    role: "admin",
  });

  return created._id;
}

async function resetDataPreservingAdmin(adminUserId: mongoose.Types.ObjectId): Promise<void> {
  await Promise.all([
    FeedbackModel.deleteMany({}).exec(),
    InventoryItemModel.deleteMany({}).exec(),
    InventoryLogModel.deleteMany({}).exec(),
    InviteModel.deleteMany({}).exec(),
    OrderModel.deleteMany({}).exec(),
    ReorderRequestModel.deleteMany({}).exec(),
    RfidEventModel.deleteMany({}).exec(),
    TaskSessionModel.deleteMany({}).exec(),
    TenantAuditLogModel.deleteMany({}).exec(),
    TenantMembershipModel.deleteMany({}).exec(),
    TenantModel.deleteMany({}).exec(),
    UserModel.deleteMany({ _id: { $ne: adminUserId } }).exec(),
  ]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set");
  }

  await mongoose.connect(mongoUri);

  const adminUserId = await ensureAdminUser();

  if (args.reset) {
    if (!args.yes) {
      throw new Error("Refusing to reset without --yes");
    }
    await resetDataPreservingAdmin(adminUserId);
  }

  const tenantNames = ["Dome Branch", "North Branch", "South Branch", "East Branch", "West Branch"];

  const tenants = [] as Array<{ _id: mongoose.Types.ObjectId; name: string; slug: string }>;
  for (let i = 0; i < args.tenants; i++) {
    const name = tenantNames[i] ?? `Branch ${i + 1}`;
    const slugBase = slugify(name) || `branch-${i + 1}`;
    const slug = args.tenants > 1 ? `${slugBase}-${i + 1}` : slugBase;

    const doc = await TenantModel.findOneAndUpdate(
      { slug },
      { $setOnInsert: { name, slug } },
      { upsert: true, new: true }
    ).exec();

    tenants.push({ _id: doc._id, name: doc.name, slug: doc.slug });
  }

  for (const t of tenants) {
    await TenantMembershipModel.findOneAndUpdate(
      { tenantId: t._id, userId: adminUserId },
      { $set: { role: "admin" } },
      { upsert: true, new: true }
    ).exec();
  }

  const firstNames = ["Ava", "Noah", "Liam", "Mia", "Olivia", "Ethan", "Sophia", "Lucas", "Amara", "Zoe", "Mason", "Leah"];
  const lastNames = ["Rivera", "Kim", "Patel", "Nguyen", "Smith", "Johnson", "Brown", "Garcia", "Lopez", "Davis", "Wilson"];

  const createdUsersByTenant = new Map<string, mongoose.Types.ObjectId[]>();

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti]!;
    const userIds: mongoose.Types.ObjectId[] = [];

    for (let ui = 0; ui < args.usersPerTenant; ui++) {
      const fn = sample(firstNames);
      const ln = sample(lastNames);
      const name = `${fn} ${ln}`;
      const email = `seed.${tenant.slug}.${ui + 1}@example.com`;

      const role: UserRole = ui === 0 ? "manager" : "inventory_staff";
      const passwordHash = await bcrypt.hash("Password123!", 12);

      const user = await UserModel.findOneAndUpdate(
        { email },
        { $setOnInsert: { name, email, passwordHash, role } },
        { upsert: true, new: true }
      ).exec();

      userIds.push(user._id);

      const existingMembership = await TenantMembershipModel.findOne({ tenantId: tenant._id, userId: user._id }).exec();

      await TenantMembershipModel.findOneAndUpdate(
        { tenantId: tenant._id, userId: user._id },
        { $set: { role } },
        { upsert: true, new: true }
      ).exec();

      if (!existingMembership) {
        await TenantAuditLogModel.create({
          tenantId: tenant._id,
          actorUserId: adminUserId,
          type: "membership_add",
          targetUserId: user._id,
          toRole: role,
        });
      }
    }

    createdUsersByTenant.set(String(tenant._id), userIds);
  }

  const vendorBase = ["Apex Supplies", "Northwind Vendors", "OmniWare", "Blue Ridge Distribution", "Metro Wholesale", "Sunrise Traders"];
  const locations = ["Aisle 1", "Aisle 2", "Aisle 3", "Backroom", "Front", "Cold Storage"];
  const itemNames = [
    "RFID Tags", "Handheld Scanner", "Shelf Label Roll", "Packing Tape", "Gloves", "Cleaning Wipes", "Box Cutter", "Pallet Wrap",
    "Small Box", "Medium Box", "Large Box", "Bubble Wrap", "Zip Ties", "Clip Board", "Marker Set", "Printer Paper",
    "Thermal Labels", "Battery Pack", "Charging Dock", "Safety Vest", "Hard Hat", "Flashlight", "Cable Organizer", "First Aid Kit",
  ];

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti]!;

    if (!args.reset) {
      const existingItems = await InventoryItemModel.countDocuments({ tenantId: tenant._id }).exec();
      if (existingItems > 0) {
        continue;
      }
    }

    const tenantUserIds = createdUsersByTenant.get(String(tenant._id)) ?? [];
    const actors = [adminUserId, ...tenantUserIds];

    const vendorDocs = [] as Array<{ _id: mongoose.Types.ObjectId; name: string }>;
    for (let vi = 0; vi < 4; vi++) {
      const name = `${vendorBase[(ti + vi) % vendorBase.length]!} (${tenant.slug.toUpperCase()})`;
      const vendor = await VendorModel.create({
        tenantId: tenant._id,
        name,
        contactEmail: `sales@${slugify(name)}.example.com`,
      });
      vendorDocs.push({ _id: vendor._id, name: vendor.name });
    }

    const items: Array<{ _id: mongoose.Types.ObjectId; sku: string; name: string; quantity: number; rfidTagId?: string }> = [];

    for (let ii = 0; ii < args.itemsPerTenant; ii++) {
      const name = itemNames[ii % itemNames.length]!;
      const sku = makeSku(ti, ii);
      const quantity = randomInt(0, 250);
      const reorderLevel = randomInt(5, 35);
      const vendorId = sample(vendorDocs)._id;

      const rfidTagId = maybeRfidTag(ii);

      const item = await InventoryItemModel.create({
        tenantId: tenant._id,
        name,
        sku,
        description: `${name} for daily operations`,
        location: sample(locations),
        quantity,
        reorderLevel,
        vendorId,
        rfidTagId,
      });

      items.push({ _id: item._id, sku: item.sku, name: item.name, quantity: item.quantity, rfidTagId: item.rfidTagId ?? undefined });

      await InventoryLogModel.create({
        tenantId: tenant._id,
        itemId: item._id,
        action: "create",
        previousQuantity: 0,
        newQuantity: item.quantity,
        actorUserId: sample(actors),
      });
    }

    const lowStock = items.filter((it) => it.quantity < 15);
    for (const it of lowStock.slice(0, Math.min(6, lowStock.length))) {
      const status: ReorderStatus = sample(reorderStatuses);
      await ReorderRequestModel.create({
        tenantId: tenant._id,
        itemId: it._id,
        vendorId: sample(vendorDocs)._id,
        requestedQuantity: randomInt(10, 60),
        status,
        requestedByUserId: sample(actors),
        note: status === "requested" ? "Low stock auto-check" : "Routine replenishment",
      });
    }

    for (let oi = 0; oi < args.ordersPerTenant; oi++) {
      const status: OrderStatus = sample(orderStatuses);
      const numItems = randomInt(1, 5);
      const chosen = new Set<number>();
      while (chosen.size < numItems) chosen.add(randomInt(0, items.length - 1));

      const orderItems = Array.from(chosen).map((idx) => {
        const it = items[idx]!;
        return {
          itemId: it._id,
          quantity: randomInt(1, 6),
          skuSnapshot: it.sku,
          nameSnapshot: it.name,
        };
      });

      await OrderModel.create({
        tenantId: tenant._id,
        status,
        items: orderItems,
        notes: status === "fulfilled" ? "Completed" : undefined,
        createdByUserId: sample(actors),
        fulfilledAt: status === "fulfilled" ? new Date(Date.now() - randomInt(1, 10) * 24 * 60 * 60 * 1000) : undefined,
        stockAdjusted: status === "fulfilled" ? true : false,
        stockAdjustedAt: status === "fulfilled" ? new Date() : undefined,
      });
    }

    for (let fi = 0; fi < 4; fi++) {
      await FeedbackModel.create({
        tenantId: tenant._id,
        userId: sample(actors),
        category: sample(["usability", "data_accuracy", "issue", "suggestion"] as const),
        message: sample([
          "Search could be faster on large inventories.",
          "Love the branch switching workflow.",
          "Please add barcode support alongside RFID.",
          "Found a mismatch in counts after fulfillment.",
        ]),
        rating: randomInt(3, 5),
        status: sample(["new", "reviewed", "resolved"] as const),
      });
    }

    const rfidItems = items.filter((it) => it.rfidTagId);
    for (const it of rfidItems.slice(0, Math.min(10, rfidItems.length))) {
      const eventType: RfidEventType = sample(rfidEventTypes);
      await RfidEventModel.create({
        tenantId: tenant._id,
        tagId: it.rfidTagId!,
        eventType,
        itemId: it._id,
        location: sample(locations),
        delta: eventType === "quantity" ? randomInt(-3, 3) : undefined,
        observedAt: new Date(Date.now() - randomInt(0, 14) * 24 * 60 * 60 * 1000),
        source: sample(["reader-1", "reader-2", "handheld"]),
      });
    }

    for (let si = 0; si < 6; si++) {
      const kind: TaskSessionKind = sample(taskSessionKinds);
      const startedAt = new Date(Date.now() - randomInt(1, 7) * 24 * 60 * 60 * 1000);
      const endedAt = new Date(startedAt.getTime() + randomInt(5, 90) * 60 * 1000);
      await TaskSessionModel.create({
        tenantId: tenant._id,
        userId: sample(actors),
        kind,
        startedAt,
        endedAt,
        meta: { note: "seed" },
      });
    }

    for (let ii = 0; ii < 3; ii++) {
      const code = cryptoRandomHex(16);
      await InviteModel.create({
        code,
        tenantId: tenant._id,
        email: `invitee.${tenant.slug}.${ii + 1}@example.com`,
        role: ii === 0 ? "manager" : "inventory_staff",
        createdByUserId: adminUserId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        seeded: {
          tenants: tenants.length,
          adminEmail: ADMIN_EMAIL,
          defaultSeedUserPassword: "Password123!",
          adminPassword: process.env.SEED_ADMIN_PASSWORD ? "(from SEED_ADMIN_PASSWORD)" : "Admin123!",
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.connection.close();
    } catch {}
  });
