import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultI18nState, i18nStateHandler } from "../../test/handlers.js";
import { PronunciationCard } from "./PronunciationCard.js";

const LIMITS = { max_entries: 200, match_max: 64, replace_max: 128 };
const FORBIDDEN_MSG = "Cannot contain . ! ? … < > * or line breaks";
type Entry = { match: string; replace: string };

function renderCard({ expanded = true }: { expanded?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PronunciationCard))
  );
  // The card is collapsed by default; behavioral tests expand it first.
  if (expanded) fireEvent.click(screen.getByRole("button", { name: /Pronunciation/ }));
  return view;
}

function serve(initial: Entry[]) {
  const state = { entries: initial, puts: [] as Entry[][], says: [] as unknown[] };
  server.use(
    http.get(`${API_BASE_URL}/api/tts/pronunciation`, () => HttpResponse.json({ entries: state.entries, limits: LIMITS })),
    http.put(`${API_BASE_URL}/api/tts/pronunciation`, async ({ request }) => {
      const body = (await request.json()) as { entries: Entry[] };
      state.puts.push(body.entries);
      state.entries = body.entries;
      return HttpResponse.json({ entries: body.entries, limits: LIMITS });
    }),
    http.post(`${API_BASE_URL}/api/speech/say`, async ({ request }) => {
      state.says.push(await request.json());
      return HttpResponse.json({ job_id: 1 });
    })
  );
  return state;
}

describe("PronunciationCard", () => {
  // Test default locale is es; assert on the en copy.
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("is collapsed by default, keeps title and hint visible, and expands from the toggle", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    renderCard({ expanded: false });
    const toggle = screen.getByRole("button", { name: /Pronunciation/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "Pronunciation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add entry" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("button", { name: "Add entry" })).toBeInTheDocument();
  });

  it("expands when the hint text or the header row is clicked, not only the title", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    renderCard({ expanded: false });
    const toggle = screen.getByRole("button", { name: /Pronunciation/ });
    fireEvent.click(screen.getByText(/Fix how Kira says/));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("heading", { name: "Pronunciation" }).parentElement as HTMLElement);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls");
  });

  it("toggles with Enter and Space from the keyboard", async () => {
    serve([]);
    renderCard({ expanded: false });
    const toggle = screen.getByRole("button", { name: /Pronunciation/ });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(toggle, { key: " " });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows an empty state with an example when there are no entries", async () => {
    serve([]);
    renderCard();
    expect(await screen.findByText(/o be ese/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add entry" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("renders saved rows as editable inputs", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    renderCard();
    expect(await screen.findByLabelText("Written as, row 1")).toHaveValue("OBS");
    expect(screen.getByLabelText("Spoken as, row 1")).toHaveValue("o be ese");
  });

  it("add, edit and save sends the full list and clears the dirty state", async () => {
    const state = serve([]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 1"), "GG");
    await user.type(screen.getByLabelText("Spoken as, row 1"), "bien jugado");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.puts).toEqual([[{ match: "GG", replace: "bien jugado" }]]));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("delete removes the row and Discard restores the saved list", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Delete row 1" }));
    expect(screen.queryByLabelText("Written as, row 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Written as, row 1")).toHaveValue("OBS");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("Clear all asks for confirmation, then empties the draft", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Clear all" }));
    expect(screen.getByLabelText("Written as, row 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Written as, row 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear all" }));
    expect(screen.queryByLabelText("Written as, row 1")).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("shows client-side messages per cell and does not PUT an invalid list", async () => {
    const state = serve([]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Spoken as, row 1"), "bad.");
    expect(await screen.findByText(FORBIDDEN_MSG)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(state.puts).toEqual([]);
  });

  it("flags a case-insensitive duplicate match", async () => {
    serve([{ match: "OBS", replace: "a" }]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 2"), "obs");
    expect(await screen.findByText("Already in the list")).toBeInTheDocument();
  });

  it("maps a server 422 to the row and field by index", async () => {
    serve([]);
    server.use(
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, () =>
        HttpResponse.json(
          { detail: "invalid_pronunciation", errors: [{ index: 1, field: "replace", code: "forbidden_char" }] },
          { status: 422 }
        )
      )
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 1"), "A");
    await user.click(screen.getByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 2"), "B");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const cell = (await screen.findByLabelText("Spoken as, row 2")).closest("[data-cell]") as HTMLElement;
    expect(within(cell).getByText(FORBIDDEN_MSG)).toBeInTheDocument();
    expect(screen.getByLabelText("Spoken as, row 2")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Spoken as, row 1")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows a save-failed alert on 503", async () => {
    serve([]);
    server.use(
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, () =>
        HttpResponse.json({ detail: "pronunciation_write_failed" }, { status: 503 })
      )
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 1"), "A");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the dictionary");
  });

  it("preview is disabled for unsaved rows with a hint and enabled for saved rows", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByRole("button", { name: "Test row 1" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 2"), "GG");
    const unsaved = screen.getByRole("button", { name: "Test row 2" });
    expect(unsaved).toBeDisabled();
    expect(unsaved).toHaveAttribute("title", "Save to test");
    await user.type(screen.getByLabelText("Spoken as, row 1"), "x");
    expect(screen.getByRole("button", { name: "Test row 1" })).toBeDisabled();
  });

  it("preview calls speech/say with the match in now mode", async () => {
    const state = serve([{ match: "OBS", replace: "o be ese" }]);
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Test row 1" }));
    await waitFor(() => expect(state.says).toEqual([{ text: "OBS", mode: "now" }]));
  });

  it("shows a brief message when preview is blocked or unavailable", async () => {
    serve([{ match: "OBS", replace: "o be ese" }]);
    server.use(
      http.post(`${API_BASE_URL}/api/speech/say`, () =>
        HttpResponse.json({ detail: { error: "GUARD_BLOCKED", rule: "r" } }, { status: 422 })
      )
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Test row 1" }));
    expect(await screen.findByText("The output guard blocked this text")).toBeInTheDocument();
    server.use(http.post(`${API_BASE_URL}/api/speech/say`, () => new HttpResponse(null, { status: 503 })));
    await user.click(screen.getByRole("button", { name: "Test row 1" }));
    expect(await screen.findByText("Speech is not available right now")).toBeInTheDocument();
  });

  it("binds to backend active_locale even when UI locale differs (UI en + active_locale es reads/writes es)", async () => {
    const stores: Record<string, Entry[]> = {
      es: [{ match: "GG", replace: "ye ye" }],
      en: [{ match: "API", replace: "ey pee eye" }]
    };
    const getLocales: string[] = [];
    const putLocales: string[] = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "es", persisted_locale: "en", pending_restart: true }),
      http.get(`${API_BASE_URL}/api/tts/pronunciation`, ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        getLocales.push(loc);
        return HttpResponse.json({ entries: stores[loc] ?? [], limits: LIMITS });
      }),
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, async ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        putLocales.push(loc);
        const body = (await request.json()) as { entries: Entry[] };
        stores[loc] = body.entries;
        return HttpResponse.json({ entries: body.entries, limits: LIMITS });
      })
    );

    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByLabelText("Written as, row 1")).toHaveValue("GG");
    expect(getLocales).toEqual(["es"]);

    await user.click(screen.getByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 2"), "XP");
    await user.type(screen.getByLabelText("Spoken as, row 2"), "equis pe");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putLocales).toEqual(["es"]));
    expect(stores.en).toEqual([{ match: "API", replace: "ey pee eye" }]);
  });

  it("isolates normalized en-US pronunciation dictionary from es when backend active_locale is en-US", async () => {
    const stores: Record<string, Entry[]> = {
      es: [{ match: "GG", replace: "ye ye" }],
      en: [{ match: "API", replace: "ey pee eye" }]
    };
    const putLocales: string[] = [];
    server.use(
      i18nStateHandler({ ...defaultI18nState, active_locale: "en-US", persisted_locale: "en-US" }),
      http.get(`${API_BASE_URL}/api/tts/pronunciation`, ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        return HttpResponse.json({ entries: stores[loc] ?? [], limits: LIMITS });
      }),
      http.put(`${API_BASE_URL}/api/tts/pronunciation`, async ({ request }) => {
        const loc = new URL(request.url).searchParams.get("locale") ?? "missing";
        putLocales.push(loc);
        const body = (await request.json()) as { entries: Entry[] };
        stores[loc] = body.entries;
        return HttpResponse.json({ entries: body.entries, limits: LIMITS });
      })
    );

    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByLabelText("Written as, row 1")).toHaveValue("API");

    await user.click(screen.getByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Written as, row 2"), "BTW");
    await user.type(screen.getByLabelText("Spoken as, row 2"), "by the way");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putLocales).toEqual(["en"]));
    expect(stores.es).toEqual([{ match: "GG", replace: "ye ye" }]);
  });
});
