import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupportLinks } from "./SupportLinks.js";
import { REPORT_ISSUE_URL, SPONSOR_URL } from "./supportUrls.js";

const open = vi.hoisted(() => vi.fn());
vi.mock("../../lib/openUrl.js", () => ({ openExternalUrl: (url: string) => open(url) }));

beforeEach(() => open.mockReset());

describe("SupportLinks", () => {
  it("opens the issue tracker and the sponsors page through openExternalUrl", async () => {
    render(<SupportLinks />);
    await userEvent.click(screen.getByRole("button", { name: /reportar un problema/i }));
    await userEvent.click(screen.getByRole("button", { name: /patrocinar/i }));
    expect(open).toHaveBeenNthCalledWith(1, REPORT_ISSUE_URL);
    expect(open).toHaveBeenNthCalledWith(2, SPONSOR_URL);
  });

  it("can hide the sponsor entry", () => {
    render(<SupportLinks showSponsor={false} />);
    expect(screen.queryByRole("button", { name: /patrocinar/i })).not.toBeInTheDocument();
  });

  it("never prefills the issue URL with a body", () => {
    expect(REPORT_ISSUE_URL).not.toContain("?");
  });
});
