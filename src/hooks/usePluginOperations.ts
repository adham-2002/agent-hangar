import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CliOutcome, ShownCommand } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";

/** An operation that, run again with the approved hash, may run that command. */
type Operation = (acceptCommand?: string) => Promise<CliOutcome>;

export interface PendingCommand {
  /** What the user asked for, e.g. "Install superpowers". */
  label: string;
  command: ShownCommand;
  run: () => Promise<void>;
}

/**
 * Runs `claude plugin …` operations one at a time, with one summary toast each.
 *
 * When a marketplace wants to run its own command, the CLI stops and reports
 * it. The command is then put in front of the user (`pending`), and only on
 * their approval is the operation repeated with that command's hash — so the
 * app never runs a marketplace command nobody saw.
 */
export function usePluginOperations(onChanged: () => void | Promise<void>) {
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const busyRef = useRef(false);

  const finish = useCallback(
    async (outcome: CliOutcome, success: string) => {
      if (outcome.ok) {
        toast.success(success, { description: t("plugins.ops.restartNote") });
        await onChanged();
      } else {
        toast.error(outcome.message || t("plugins.ops.failed"));
      }
    },
    [onChanged, t]
  );

  const run = useCallback(
    async (key: string, label: string, success: string, op: Operation) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusyKey(key);
      try {
        const outcome = await op();
        if (outcome.shown_command) {
          const command = outcome.shown_command;
          setPending({
            label,
            command,
            run: async () => {
              busyRef.current = true;
              setBusyKey(key);
              try {
                await finish(await op(command.sha256), success);
              } catch (e) {
                toast.error(getErrorMessage(e, t("plugins.ops.failed")));
              } finally {
                busyRef.current = false;
                setBusyKey(null);
                setPending(null);
              }
            },
          });
          return;
        }
        await finish(outcome, success);
      } catch (e) {
        toast.error(getErrorMessage(e, t("plugins.ops.failed")));
      } finally {
        busyRef.current = false;
        setBusyKey(null);
      }
    },
    [finish, t]
  );

  return { busyKey, run, pending, dismissPending: () => setPending(null) };
}
