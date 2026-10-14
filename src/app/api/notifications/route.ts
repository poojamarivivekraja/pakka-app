import { connection } from "next/server";
import { loadNotifications } from "@/lib/notifications-feed";

// Polled by the in-app toast. See loadNotifications.
export async function GET(request: Request) {
  await connection();
  try {
    return Response.json(await loadNotifications(new URL(request.url).searchParams.get("since")));
  } catch (err) {
    console.error("notifications failed:", err);
    return Response.json({ error: "Couldn't load notifications" }, { status: 500 });
  }
}
