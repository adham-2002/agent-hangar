// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, mount } from "../test-utils/mount";
import { Plugins } from "./Plugins";
import type { PluginDetail, PluginInfo } from "../lib/tauri";

const api = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  getPluginDetail: vi.fn(),
  setPluginEnabled: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, o?: { count?: number }) => (o?.count !== undefined ? `${key}:${o.count}` : key) }),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("../lib/tauri", () => api);

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: "seo@market",
  name: "seo",
  marketplace: "market",
  version: "2.6.2",
  scope: "user",
  enabled: true,
  install_path: "/p/seo",
  installed: true,
  files_present: true,
  ...over,
});

const detail: PluginDetail = {
  description: "SEO tools",
  author: "Ada",
  skills: ["audit", "page"],
  commands: [],
  agents: ["helper"],
  hooks: false,
  mcp_servers: [],
};

const flush = () => act(async () => { await Promise.resolve(); });
const text = (c: HTMLElement) => c.textContent ?? "";

async function render() {
  const c = mount(<Plugins />);
  await flush();
  await flush();
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getPluginDetail.mockResolvedValue(detail);
  api.setPluginEnabled.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("Plugins view", () => {
  it("renders rows with name, marketplace and version", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    const c = await render();
    expect(text(c)).toContain("seo");
    expect(text(c)).toContain("market");
    expect(text(c)).toContain("2.6.2");
    expect(text(c)).toContain("plugins.skillsCount:2");
  });

  it("toggle calls setPluginEnabled and flips the switch", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    const c = await render();
    const sw = c.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => sw.click());
    await flush();
    expect(api.setPluginEnabled).toHaveBeenCalledWith("seo@market", false);
    expect(c.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  });

  it("a failed toggle reverts the switch and shows an error", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    api.setPluginEnabled.mockRejectedValue(new Error("settings.json is not valid JSON"));
    const c = await render();
    await act(async () => (c.querySelector('[role="switch"]') as HTMLButtonElement).click());
    await flush();
    expect(c.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(toast.error).toHaveBeenCalledWith("settings.json is not valid JSON");
  });

  it("shows the empty state when no plugins are installed", async () => {
    api.listPlugins.mockResolvedValue([]);
    const c = await render();
    expect(text(c)).toContain("plugins.empty");
  });

  it("labels a stale enabled entry as not installed", async () => {
    api.listPlugins.mockResolvedValue([
      plugin({ id: "ghost@m", name: "ghost", installed: false, files_present: false, install_path: null }),
    ]);
    const c = await render();
    expect(text(c)).toContain("plugins.notInstalled");
    expect(api.getPluginDetail).not.toHaveBeenCalled();
  });

  it("search filters rows", async () => {
    api.listPlugins.mockResolvedValue([plugin(), plugin({ id: "x@m", name: "other", version: "9.9.9", install_path: "/p/x" })]);
    const c = await render();
    const input = c.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "oth");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(text(c)).toContain("other");
    expect(text(c)).toContain("9.9.9");
    expect(text(c)).not.toContain("2.6.2");
  });

  it("shows a load error banner", async () => {
    api.listPlugins.mockRejectedValue(new Error("boom"));
    const c = await render();
    expect(text(c)).toContain("plugins.loadFailed");
    expect(text(c)).toContain("boom");
  });

  it("clicking a row opens the detail sheet with its contents", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    const c = await render();
    const rowButton = c.querySelector("li button:not([role])") as HTMLButtonElement;
    await act(async () => rowButton.click());
    expect(document.body.textContent).toContain("SEO tools");
    expect(document.body.textContent).toContain("audit");
    expect(document.body.textContent).toContain("helper");
  });
});
