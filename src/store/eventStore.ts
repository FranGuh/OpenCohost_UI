import { create } from "zustand";

export type AppEventSource =
  "model" | "profile" | "music" | "obs" | "stream" | "settings" | "ptt" | "agenda" | "motor";
export type AppEventTone = "ok" | "warn" | "danger" | "info" | "neutral"; // mirrors ToastTone

export interface AppEvent {
  id: string; // dedup key — `mut-${mutationId}` for mutation events, manual otherwise
  ts: number; // Date.now() at emit time — the interleave key ConversationPanel already sorts on
  source: AppEventSource;
  label: string; // ALWAYS template-built in appEvents.ts — never free text
  tone: AppEventTone;
}

/** Ring-buffer cap. See justification in the Item A blueprint: each event
 * becomes an alert-divider row that ConversationPanel re-sorts/re-maps on
 * every render, so list length is a per-render cost multiplier over a
 * multi-hour stream. 200 events ~= several hours of real operator actions;
 * eviction is oldest-first, which is what a "recent activity" feed wants. */
export const EVENT_CAP = 200;

export interface EventStoreState {
  events: AppEvent[];
  append(event: AppEvent): void;
}

/**
 * LOCAL UI state ONLY (same contract as switchStore/design D10): a client-side
 * feed of operator-action metadata. Never holds server truth and NEVER holds
 * dialogue/chat/body text — labels are template-built in src/lib/appEvents.ts.
 */
export const useEventStore = create<EventStoreState>((set) => ({
  events: [],
  append: (event) =>
    set((state) => {
      if (state.events.some((e) => e.id === event.id)) return state; // dedup → no-op, no rerender
      const next = [...state.events, event];
      return { events: next.length > EVENT_CAP ? next.slice(next.length - EVENT_CAP) : next };
    })
}));

export const selectEvents = (state: EventStoreState) => state.events;
