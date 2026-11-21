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
  getClaudeCliStatus: vi.fn(),
  getPluginCatalog: vi.fn(),
  installPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  listMarketplaces: vi.fn(),
  addMarketplace: vi.fn(),
  removeMarketplace: vi.fn(),
  updateMarketplaces: vi.fn(),
  getPluginSkillDocument: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
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
  latest_version: null,
  update_available: false,
  source_repo: null,
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
  api.getClaudeCliStatus.mockResolvedValue({ available: true, path: "/bin/claude" });
  api.getPluginCatalog.mockResolvedValue([]);
  api.listMarketplaces.mockResolvedValue([]);
});

const ok = { ok: true, outcome: "installed", message: null, failure_code: null, shown_command: null };
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const openTab = async (label: string) => {
  await act(async () => button(label).click());
  await flush();
  await flush();
};
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

  it("installs a catalog plugin and reloads the list", async () => {
    api.listPlugins.mockResolvedValue([]);
    api.getPluginCatalog.mockResolvedValue([
      { plugin_id: "superpowers@obra", name: "superpowers", description: "Plans", marketplace: "obra", install_count: 9, installed: false },
    ]);
    api.installPlugin.mockResolvedValue(ok);
    await render();
    await openTab("plugins.tabs.browse");
    expect(document.body.textContent).toContain("superpowers");
    await act(async () => button("plugins.browse.install").click());
    await flush();
    expect(api.installPlugin).toHaveBeenCalledWith("superpowers@obra", undefined);
    expect(toast.success).toHaveBeenCalled();
    expect(api.listPlugins).toHaveBeenCalledTimes(2);
  });

  it("runs a marketplace-declared command only with the approved hash", async () => {
    api.listPlugins.mockResolvedValue([]);
    api.getPluginCatalog.mockResolvedValue([
      { plugin_id: "risky@m", name: "risky", description: null, marketplace: "m", install_count: null, installed: false },
    ]);
    const hash = "f".repeat(64);
    api.installPlugin
      .mockResolvedValueOnce({ ...ok, ok: false, outcome: "failed", shown_command: { text: "npx risky-installer", sha256: hash } })
      .mockResolvedValueOnce(ok);
    await render();
    await openTab("plugins.tabs.browse");
    await act(async () => button("plugins.browse.install").click());
    await flush();
    // Nothing ran yet: the command is shown and waits for the user.
    expect(api.installPlugin).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("npx risky-installer");
    await act(async () => button("plugins.ops.commandRun").click());
    await flush();
    expect(api.installPlugin).toHaveBeenLastCalledWith("risky@m", hash);
    expect(toast.success).toHaveBeenCalled();
  });

  it("asks before uninstalling and passes the plugin's scope", async () => {
    api.listPlugins.mockResolvedValue([plugin({ scope: "project" })]);
    api.uninstallPlugin.mockResolvedValue({ ...ok, outcome: "uninstalled" });
    const c = await render();
    await act(async () => (c.querySelector('li button[aria-haspopup], li button[aria-label="plugins.ops.menu"]') as HTMLButtonElement | null)?.click());
    const menu = button("plugins.ops.uninstall");
    expect(menu).toBeTruthy();
    await act(async () => menu.click());
    expect(api.uninstallPlugin).not.toHaveBeenCalled();
    const confirm = [...document.body.querySelectorAll("button")].filter((b) => b.textContent === "plugins.ops.uninstall").pop()!;
    await act(async () => confirm.click());
    await flush();
    expect(api.uninstallPlugin).toHaveBeenCalledWith("seo@market", "project");
  });

  it("shows a CLI failure message instead of a success", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    api.updatePlugin.mockResolvedValue({ ...ok, ok: false, outcome: "failed", message: "network down" });
    const c = await render();
    await act(async () => (c.querySelector('li button[aria-label="plugins.ops.menu"]') as HTMLButtonElement).click());
    await act(async () => button("plugins.ops.update").click());
    await flush();
    expect(toast.error).toHaveBeenCalledWith("network down");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("explains a missing claude command and offers no install actions", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    api.getClaudeCliStatus.mockResolvedValue({ available: false, path: null });
    const c = await render();
    expect(c.querySelector('li button[aria-label="plugins.ops.menu"]')).toBeNull();
    await openTab("plugins.tabs.browse");
    expect(document.body.textContent).toContain("plugins.cli.missing");
    expect(api.getPluginCatalog).not.toHaveBeenCalled();
  });

  it("adds a marketplace from the form", async () => {
    api.listPlugins.mockResolvedValue([]);
    api.addMarketplace.mockResolvedValue({ ...ok, outcome: "added" });
    await render();
    await openTab("plugins.tabs.marketplaces");
    const input = document.body.querySelector('input[aria-label="plugins.markets.addPlaceholder"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " obra/superpowers-marketplace ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("plugins.markets.add").click());
    await flush();
    expect(api.addMarketplace).toHaveBeenCalledWith("obra/superpowers-marketplace");
    expect(api.listMarketplaces).toHaveBeenCalledTimes(2);
  });

  it("shows a claude.ai-synced plugin as managed, with nothing to change", async () => {
    api.listPlugins.mockResolvedValue([
      plugin({ id: "design@synced", name: "design", marketplace: "synced", scope: "synced", install_path: "/p/d" }),
    ]);
    const c = await render();
    expect(text(c)).toContain("plugins.syncedBadge");
    expect(c.querySelector('[role="switch"]')).toBeNull();
    expect(c.querySelector('li button[aria-label="plugins.ops.menu"]')).toBeNull();
  });

  it("flags an available update and offers it first in the menu", async () => {
    api.listPlugins.mockResolvedValue([plugin({ update_available: true, latest_version: "2.7.0" })]);
    const c = await render();
    expect(text(c)).toContain("plugins.updates.badgeVersion");
    await act(async () => (c.querySelector('li button[aria-label="plugins.ops.menu"]') as HTMLButtonElement).click());
    expect(button("plugins.updates.updateNow")).toBeTruthy();
  });

  it("opens a bundled skill's document from the plugin's detail", async () => {
    api.listPlugins.mockResolvedValue([plugin()]);
    api.getPluginSkillDocument.mockResolvedValue({ filename: "SKILL.md", content: "# Audit\n\nChecks the site." });
    const c = await render();
    await act(async () => (c.querySelector("li button:not([role])") as HTMLButtonElement).click());
    await act(async () => button("audit").click());
    await flush();
    expect(api.getPluginSkillDocument).toHaveBeenCalledWith("/p/seo", "audit");
    expect(document.body.textContent).toContain("Checks the site.");
  });
});
