import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURES } from "@/sim/fixture";
import { DURATION } from "@/sim/sim";
import { routeTree } from "@/routeTree.gen";

// jsdom has no canvas: give the player a drawing context that accepts every call.
beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountEmbed(search: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/embed${search}`] }),
    context: { queryClient: new QueryClient() },
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

const post = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: window.parent }));
  });
const seekInput = () => screen.getByLabelText("Seek") as HTMLInputElement;

describe("/embed", () => {
  it("opens on the sample week with the play bar, without being redirected to a canonical URL", async () => {
    const router = await mountEmbed("?demo=1");
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeInTheDocument();
    expect(screen.getByText("BUTTER FACTORY")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/week of 20\d\d-\d\d-\d\d/)).toBeInTheDocument());
    // TanStack rewrites the URL when validated search differs from the request.
    expect(router.state.location.search).toEqual({ demo: 1 });
  });

  it("plays and pauses from the buttons", async () => {
    await mountEmbed("?demo=1");
    fireEvent.click(await screen.findByRole("button", { name: "PLAY" }));
    expect(await screen.findByRole("button", { name: "PAUSE" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PAUSE" }));
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeInTheDocument();
  });

  it("starts on its own with ?autoplay=1", async () => {
    await mountEmbed("?demo=1&autoplay=1");
    expect(await screen.findByRole("button", { name: "PAUSE" })).toBeInTheDocument();
  });

  it("does not autoplay for a viewer who prefers reduced motion", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as never);
    await mountEmbed("?demo=1&autoplay=1");
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeInTheDocument();
  });

  it("hides the title and the controls on request", async () => {
    await mountEmbed("?demo=1&title=0&controls=0");
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /Butter Factory replay of/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText("BUTTER FACTORY")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PLAY" })).not.toBeInTheDocument();
  });

  it("obeys commands from the framing window", async () => {
    await mountEmbed("?demo=1");
    await screen.findByRole("button", { name: "PLAY" });
    post({ target: "butter-factory", command: "play" });
    expect(await screen.findByRole("button", { name: "PAUSE" })).toBeInTheDocument();
    post({ target: "butter-factory", command: "pause" });
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeInTheDocument();
    post({ target: "butter-factory", command: "seek", t: 30 });
    await waitFor(() => expect(Number(seekInput().value)).toBe(30));
    post({ target: "butter-factory", command: "seek", t: 99999 });
    await waitFor(() => expect(Number(seekInput().value)).toBe(DURATION));
    post({ target: "butter-factory", command: "speed", value: 4 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "4x" })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("ignores malformed commands and messages from other windows", async () => {
    await mountEmbed("?demo=1");
    await screen.findByRole("button", { name: "PLAY" });
    post({ target: "butter-factory", command: "explode" });
    post("play");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { target: "butter-factory", command: "play" },
          source: null,
        }),
      );
    });
    expect(screen.getByRole("button", { name: "PLAY" })).toBeInTheDocument();
  });

  it("loads the newest published week from index.json at runtime", async () => {
    const snap = FIXTURES[0]!.make();
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/index.json"))
        return new Response(
          JSON.stringify({ latest: "2026-W41", weeks: ["2026-W40", "2026-W41"] }),
        );
      if (u.endsWith("/2026-W41.json")) return new Response(JSON.stringify(snap));
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountEmbed("");
    expect(await screen.findByRole("button", { name: "PLAY" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/week of /)).toBeInTheDocument());
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toMatch(/\/Mantequilla-Soft\/index\.json$/);
    expect(urls[1]).toMatch(/\/Mantequilla-Soft\/2026-W41\.json$/);
  });

  it("shows a readable error with a retry when no snapshot is published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await mountEmbed("");
    expect(await screen.findByRole("alert")).toHaveTextContent(/was not found/);
    expect(screen.getByRole("button", { name: "TRY AGAIN" })).toBeInTheDocument();
  });

  it("refuses a snapshot address on an unlisted host and never fetches it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await mountEmbed("?snapshot=https%3A%2F%2Fevil.example%2Fx.json");
    expect(await screen.findByRole("alert")).toHaveTextContent(/not on an allowed host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
