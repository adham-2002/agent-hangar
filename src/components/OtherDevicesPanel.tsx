import { Download, Laptop, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OfferedPlugin } from "../lib/tauri";

interface Props {
  offers: OfferedPlugin[];
  /** Installing needs the claude CLI; without it the list is shown, not offered. */
  canInstall: boolean;
  busyKey: string | null;
  onInstall: (offer: OfferedPlugin) => void;
}

/**
 * Plugins the user has switched on on another computer that this one lacks,
 * read from the backup. Each install is the user's click; nothing installs
 * on its own, because plugins run code.
 */
export function OtherDevicesPanel({ offers, canInstall, busyKey, onInstall }: Props) {
  const { t } = useTranslation();
  if (offers.length === 0) return null;

  return (
    <section className="rounded-xl border border-border-subtle bg-surface p-4" aria-label={t("plugins.otherDevices.title")}>
      <div className="mb-1 flex items-center gap-2">
        <Laptop className="h-4 w-4 text-muted" />
        <h2 className="text-[14px] font-semibold text-primary">
          {t("plugins.otherDevices.title", { count: offers.length })}
        </h2>
      </div>
      <p className="mb-3 text-[12px] text-muted">
        {canInstall ? t("plugins.otherDevices.hint") : t("plugins.otherDevices.needsCli")}
      </p>
      <ul className="flex flex-col gap-2">
        {offers.map((offer) => {
          const busy = busyKey === `install:${offer.id}`;
          return (
            <li key={offer.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-primary">{offer.name}</span>
                  <span className="shrink-0 text-[12px] text-muted">{offer.marketplace}</span>
                </p>
                <p className="truncate text-[12px] text-muted">
                  {t("plugins.otherDevices.onDevices", { devices: offer.devices.join(", ") })}
                  {offer.marketplace_source
                    ? ` · ${t("plugins.otherDevices.addsMarketplace", { source: offer.marketplace_source })}`
                    : ""}
                </p>
              </div>
              {canInstall ? (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => onInstall(offer)}
                  className="app-button-secondary shrink-0"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {t("plugins.browse.install")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
