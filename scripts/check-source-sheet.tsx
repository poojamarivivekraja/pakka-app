// Renders the Source sheet to HTML and checks what the owner would see. No browser, no database.
import { renderToStaticMarkup } from "react-dom/server";
import { SourceSheet } from "@/components/order/SourceSheet";
import type { SourceModel } from "@/lib/order-detail-model";

let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  [${extra}]`}`);
  if (!ok) failed++;
}

const source: SourceModel = {
  title: 'Source for "Flavour: red velvet"',
  subtitle: "Rahul · WhatsApp chat",
  bubbles: [
    { id: "m3", direction: "in", type: "text", body: "Chocolate, 1.5 kg", imageUrl: null, at: "20 Oct, 6:25 pm", supporting: false, highlight: null },
    { id: "m4", direction: "in", type: "text", body: "make it Red Velvet instead", imageUrl: null, at: "22 Oct, 9:05 am", supporting: true, highlight: "red velvet" },
    { id: "m5", direction: "out", type: "text", body: "Ok red velvet eggless done", imageUrl: null, at: "22 Oct, 9:20 am", supporting: true, highlight: "red velvet" },
  ],
  agreed: { at: "22 Oct, 9:20 am", alsoUsedFor: ["Dietary"] },
};
const html = renderToStaticMarkup(<SourceSheet source={source} whatsappUrl="https://wa.me/919900000002" onClose={() => {}} />);
const bubbleOf = (text: string) => html.split("<div class=\"max-w-[88%]").find((s) => s.includes(text)) ?? "";

check("title is shown", html.includes("Source for &quot;Flavour: red velvet&quot;"));
check("customer · WhatsApp chat is shown under it", html.includes("Rahul · WhatsApp chat"));
check("supporting bubbles have a 1.5px ink border", bubbleOf("make it").includes("border-[1.5px] border-ink") && bubbleOf("eggless done").includes("border-[1.5px] border-ink"));
check("context bubble has only a hairline border", !bubbleOf("Chocolate, 1.5 kg").includes("border-[1.5px]"));
check("business messages are tinted green, customer messages white", bubbleOf("eggless done").includes("bg-confirmed-bg") && bubbleOf("make it").includes("bg-surface"));
check("supporting words are bold and underlined, keeping the message's own capitals", html.includes('<strong class="font-bold underline">Red Velvet</strong>'));
check("the agreed strip names the time and the other fields", html.includes("Agreed in chat by your business at 22 Oct, 9:20 am · also used for Dietary"));
check("Open in WhatsApp is a link to the chat", html.includes('href="https://wa.me/919900000002"') && html.includes("Open in WhatsApp"));
check("Close button is there", html.includes(">Close<"));
check('never says "You agreed"', !html.includes("You agreed"));

const closed = renderToStaticMarkup(<SourceSheet source={null} whatsappUrl="x" onClose={() => {}} />);
check("nothing is rendered when no source is open", closed === "");
const noStrip = renderToStaticMarkup(<SourceSheet source={{ ...source, agreed: null }} whatsappUrl="x" onClose={() => {}} />);
check("no strip when the business hasn't agreed", !noStrip.includes("Agreed in chat"));

process.exit(failed ? 1 : 0);
