import { invoke } from "@tauri-apps/api/core";
import { toAppError } from "./errors";

/**
 * How the UI reaches the backend. Today: Tauri IPC (`invoke`). For the future online version the same
 * commands can be served as `POST /api/rpc/<command>` and a fetch-based transport swapped in here.
 */
export interface Transport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export const tauriTransport: Transport = {
  call: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
};

export function httpTransport(baseUrl: string, token?: string): Transport {
  return {
    async call<T>(command: string, args?: Record<string, unknown>) {
      const res = await fetch(`${baseUrl}/api/rpc/${command}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(args ?? {}),
      });
      const body = await res.json();
      if (!res.ok) throw body;
      return body as T;
    },
  };
}

let transport: Transport = tauriTransport;

/** Commands that only read data. Everything else changes data and refreshes what is on screen. */
const READ_ONLY =
  /^(app_(status|info|ready)|setup_defaults|auth_(session|logout)|settings_default_templates|open_folder|open_camera_settings|open_file|save_pdf|reveal_file|setup_find_backups|setup_inspect_backup)$|^(reports|dashboard)_|_(list|get|counts|quick|quick_search|find_by_code|duplicates|next_code|suggestions|preview|receipt|invoice|today|member_days|queue|status|inspect)$/;

let onWrite: (() => void) | null = null;

/** Called after every successful data-changing command (wired to the query cache). */
export function setWriteListener(listener: () => void) {
  onWrite = listener;
}

export function setTransport(next: Transport) {
  transport = next;
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  let result: T;
  try {
    result = await transport.call<T>(command, args);
  } catch (e) {
    throw toAppError(e);
  }
  if (!READ_ONLY.test(command)) onWrite?.();
  return result;
}
