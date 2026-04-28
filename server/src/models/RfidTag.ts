import mongoose, { type InferSchemaType } from "mongoose";
import { type InventoryItemDocument } from "./InventoryItem.js";

const rfidTagSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    tagId: { type: String, required: true, trim: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", default: null },
    itemBarcode: { type: String, default: null },
    itemName: { type: String, default: null },
    itemSku: { type: String, default: null },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    assignedAt: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

rfidTagSchema.index({ tenantId: 1, tagId: 1 }, { unique: true });
rfidTagSchema.index({ tenantId: 1, status: 1 });
rfidTagSchema.index({ tenantId: 1, itemId: 1 });

export type RfidTag = InferSchemaType<typeof rfidTagSchema>;
export type RfidTagDocument = mongoose.HydratedDocument<RfidTag>;

export const RfidTagModel = mongoose.model<RfidTag>("RfidTag", rfidTagSchema);

/** Upsert a RfidTag record when a tag is assigned to or removed from an item */
export async function upsertRfidTag(tenantId: string, tagId: string, item?: InventoryItemDocument | null) {
  if (!item) {
    await RfidTagModel.findOneAndUpdate(
      { tenantId, tagId },
      {
        $set: { tagId, status: "inactive", deactivatedAt: new Date() },
        $unset: { itemId: "", itemBarcode: "", itemName: "", itemSku: "", assignedAt: "" },
      },
      { upsert: true, new: true }
    );
    return;
  }
  await RfidTagModel.findOneAndUpdate(
    { tenantId, tagId },
    {
      $set: {
        tagId,
        itemId: item._id,
        itemBarcode: item.barcode,
        itemName: item.name,
        itemSku: item.sku,
        status: "active",
        assignedAt: new Date(),
        deactivatedAt: null,
      },
    },
    { upsert: true, new: true }
  );
}
