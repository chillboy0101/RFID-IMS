import { ExitAuthorizationModel } from "../models/ExitAuthorization.js";
import { type InventoryItemDocument } from "../models/InventoryItem.js";
import { InventoryUnitModel, type InventoryUnitStatus } from "../models/InventoryUnit.js";

const onHandUnitStatuses = new Set<InventoryUnitStatus>(["received", "in_stock", "reserved", "picked", "packed"]);

export type InventoryFlowSummary = {
  trackedUnits: number;
  untrackedUnits: number;
  awaitingTagUnits: number;
  taggedUnits: number;
  reservedUnits: number;
  pickedUnits: number;
  dispatchedUnits: number;
  activeExitAuthorizations: number;
  barcodeReady: boolean;
  exitReadyUnits: number;
  missingExitTrackingUnits: number;
  nextStep: string;
};

function buildNextStep(input: {
  quantity: number;
  status?: string | null;
  activeExitAuthorizations: number;
  reservedUnits: number;
  pickedUnits: number;
  untrackedUnits: number;
  awaitingTagUnits: number;
  barcodeReady: boolean;
  missingExitTrackingUnits: number;
}): string {
  const normalizedStatus = (input.status ?? "active").trim().toLowerCase();

  if (normalizedStatus === "inactive") return "Inactive";
  if (input.quantity <= 0) return "Receive stock";
  if (input.activeExitAuthorizations > 0) return "Gate exit in progress";
  if (input.pickedUnits > 0) return "Verify exit scans";
  if (input.reservedUnits > 0) return "Authorize gate exit";
  if (input.untrackedUnits > 0) {
    return input.barcodeReady ? "Backfill unit tracking in RFID Hub" : "Add barcode or receive tagged units";
  }
  if (input.awaitingTagUnits > 0) {
    return input.barcodeReady ? "Ready via barcode, tags recommended" : "Assign RFID tags";
  }
  if (input.missingExitTrackingUnits > 0) return "Add barcode or RFID tags";
  return "Ready for picking";
}

export async function buildInventoryFlowSummaryMap(
  tenantId: string,
  items: InventoryItemDocument[]
): Promise<Map<string, InventoryFlowSummary>> {
  const summaryByItemId = new Map<string, InventoryFlowSummary>();
  if (items.length === 0) return summaryByItemId;

  const itemIds = items.map((item) => item._id);
  const itemById = new Map(items.map((item) => [item._id.toString(), item]));

  const units = await InventoryUnitModel.find({ tenantId, itemId: { $in: itemIds } })
    .select({ itemId: 1, tagId: 1, status: 1 })
    .exec();

  const unitsByItemId = new Map<string, typeof units>();
  const tagToItemId = new Map<string, string>();

  for (const unit of units) {
    const key = unit.itemId.toString();
    const bucket = unitsByItemId.get(key) ?? [];
    bucket.push(unit);
    unitsByItemId.set(key, bucket);

    const unitTag = unit.tagId?.trim();
    if (unitTag) tagToItemId.set(unitTag, key);
  }

  for (const item of items) {
    const legacyTag = item.rfidTagId?.trim();
    if (legacyTag && !tagToItemId.has(legacyTag)) {
      tagToItemId.set(legacyTag, item._id.toString());
    }
  }

  const barcodes = items.map((item) => item.barcode?.trim()).filter((value): value is string => !!value);
  const tagIds = Array.from(tagToItemId.keys());
  const now = new Date();

  const authMatch = [];
  if (tagIds.length > 0) authMatch.push({ tagId: { $in: tagIds } });
  if (barcodes.length > 0) authMatch.push({ barcode: { $in: barcodes } });

  const activeAuthorizations =
    authMatch.length > 0
      ? await ExitAuthorizationModel.find({
          tenantId,
          status: "active",
          expiresAt: { $gt: now },
          $or: authMatch,
        })
          .select({ tagId: 1, barcode: 1, unitId: 1 })
          .exec()
      : [];

  const authCountByItemId = new Map<string, number>();
  for (const auth of activeAuthorizations) {
    let itemId = "";

    if (auth.unitId) {
      const unit = units.find((candidate) => candidate._id.equals(auth.unitId as any));
      itemId = unit?.itemId.toString() ?? "";
    }

    if (!itemId && auth.tagId) {
      itemId = tagToItemId.get(auth.tagId) ?? "";
    }

    if (!itemId && auth.barcode) {
      const item = items.find((candidate) => candidate.barcode === auth.barcode);
      itemId = item?._id.toString() ?? "";
    }

    if (!itemId) continue;
    authCountByItemId.set(itemId, (authCountByItemId.get(itemId) ?? 0) + 1);
  }

  for (const [itemId, item] of itemById.entries()) {
    const lineUnits = unitsByItemId.get(itemId) ?? [];
    const onHandUnits = lineUnits.filter((unit) => onHandUnitStatuses.has(unit.status));
    const trackedUnits = onHandUnits.length;
    const taggedUnitsFromUnits = onHandUnits.filter((unit) => !!unit.tagId).length;
    const legacyTaggedUnits = taggedUnitsFromUnits === 0 && item.rfidTagId?.trim() && item.quantity > 0 ? 1 : 0;
    const taggedUnits = Math.min(item.quantity, taggedUnitsFromUnits + legacyTaggedUnits);
    const awaitingTagUnits = onHandUnits.filter((unit) => !unit.tagId).length;
    const reservedUnits = onHandUnits.filter((unit) => unit.status === "reserved").length;
    const pickedUnits = onHandUnits.filter((unit) => unit.status === "picked" || unit.status === "packed").length;
    const dispatchedUnits = lineUnits.filter((unit) => unit.status === "dispatched").length;
    const barcodeReady = !!item.barcode?.trim();
    const untrackedUnits = Math.max(0, item.quantity - trackedUnits);
    const exitReadyUnits = barcodeReady ? item.quantity : taggedUnits;
    const missingExitTrackingUnits = Math.max(0, item.quantity - exitReadyUnits);
    const activeExitAuthorizations = authCountByItemId.get(itemId) ?? 0;

    summaryByItemId.set(itemId, {
      trackedUnits,
      untrackedUnits,
      awaitingTagUnits,
      taggedUnits,
      reservedUnits,
      pickedUnits,
      dispatchedUnits,
      activeExitAuthorizations,
      barcodeReady,
      exitReadyUnits,
      missingExitTrackingUnits,
      nextStep: buildNextStep({
        quantity: item.quantity,
        status: item.status,
        activeExitAuthorizations,
        reservedUnits,
        pickedUnits,
        untrackedUnits,
        awaitingTagUnits,
        barcodeReady,
        missingExitTrackingUnits,
      }),
    });
  }

  return summaryByItemId;
}
