"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  ActionError, chooseConflictValue, chooseOrderForMessage, clearUpdatedAfterConfirmation, closeOrder,
  confirmOrder, editField, markFlagChecked, markNoteSeen, markPaymentReceived,
} from "@/lib/order-actions";

// Thin wrappers the page calls. Each returns { error } for a problem the owner can understand,
// or {} on success, and refreshes the page.

export type ActionResult = { error?: string };

const id = z.string().uuid();
const text = z.string().max(600);

async function run(fn: () => Promise<void>, { refreshPage = true } = {}): Promise<ActionResult> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ActionError) return { error: err.message };
    if (err instanceof z.ZodError) return { error: "That didn't look right. Try again." };
    console.error("order action failed:", err);
    return { error: "Something went wrong. Try again." };
  }
  if (refreshPage) refresh();
  return {};
}

export const saveField = async (orderId: string, key: string, value: string) =>
  run(() => editField(id.parse(orderId), z.string().max(60).parse(key), text.parse(value)));

export const chooseConflict = async (orderId: string, flagId: string, value: string) =>
  run(() => chooseConflictValue(id.parse(orderId), id.parse(flagId), text.parse(value)));

export const chooseOrder = async (flagId: string, orderId: string) =>
  run(() => chooseOrderForMessage(id.parse(flagId), id.parse(orderId)));

export const markChecked = async (orderId: string, flagId: string) =>
  run(() => markFlagChecked(id.parse(orderId), id.parse(flagId)));

export const markReceived = async (orderId: string, attachmentId: string) =>
  run(() => markPaymentReceived(id.parse(orderId), id.parse(attachmentId)));

export const confirm = async (orderId: string) => run(() => confirmOrder(id.parse(orderId)));

export const markDelivered = async (orderId: string) => run(() => closeOrder(id.parse(orderId), "delivered"));

export const cancelOrder = async (orderId: string) => run(() => closeOrder(id.parse(orderId), "cancelled"));

export const gotIt = async (noteId: string) => run(() => markNoteSeen(id.parse(noteId)));

/** Runs when a confirmed order is opened. Doesn't refresh, so this view still shows what changed. */
export const clearUpdated = async (orderId: string) =>
  run(() => clearUpdatedAfterConfirmation(id.parse(orderId)), { refreshPage: false });
