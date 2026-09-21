import { useEffect, useRef } from "react";

import { readStatisticsStatus, syncStatisticsSnapshot } from "../../services/statistics.js";

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

export function StatisticsAutoSync({ serverUrl, onSchedule }: { serverUrl: string; onSchedule: (at: number) => void }) {
  const running = useRef(false);

  useEffect(() => {
    let disposed = false;

    const tick = async (): Promise<void> => {
      if (disposed || running.current) return;
      running.current = true;
      try {
        const status = await readStatisticsStatus(serverUrl).catch(() => null);
        if (disposed || status?.busy) return;

        await syncStatisticsSnapshot(serverUrl).catch(() => undefined);
      } finally {
        running.current = false;
      }
    };

    onSchedule(Date.now() + AUTO_SYNC_INTERVAL_MS);
    const interval = window.setInterval(() => {
      onSchedule(Date.now() + AUTO_SYNC_INTERVAL_MS);
      void tick();
    }, AUTO_SYNC_INTERVAL_MS);
    void tick();

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [serverUrl, onSchedule]);

  return null;
}
