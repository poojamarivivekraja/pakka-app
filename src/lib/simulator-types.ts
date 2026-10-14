// Shapes sent from the simulator API to the simulator page (no secrets, no server-only imports).

export type SimBubble = {
  id: string;
  direction: "in" | "out";
  type: "text" | "image" | "edit" | "revoke" | "unsupported";
  body: string | null;
  mediaPath: string | null;
  sentAt: string;
  status: string;
};

export type SimOrder = {
  id: string;
  status: string;
  updatedAfterConfirmation: boolean;
  fields: { key: string; label: string; value: string; confidence: "high" | "low"; previous: string | null }[];
  flags: { id: string; type: string; detail: string; resolved: boolean }[];
  notes: { id: string; text: string }[];
  pending: { id: string; field: string; requestedValue: string; resolved: string | null }[];
  attachments: { id: string; kind: string; description: string | null; amount: number | null; reference: string | null; payee: string | null; markedReceived: boolean }[];
  balance: number | null;
};

export type SimState = {
  scenario: {
    id: string;
    name: string;
    continues: string | null;
    total: number;
    sent: number;
    next: string | null;
    /** Why "Send next message" can't run right now (e.g. the scenario it continues hasn't been run). */
    blocked: string | null;
  };
  customer: { name: string; waId: string } | null;
  chat: SimBubble[];
  orders: SimOrder[];
  customerFlags: { id: string; type: string; detail: string }[];
  lastResult: { messageType: string | null; orderIds: string[]; newFlags: string[] } | null;
};
