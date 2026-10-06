import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type UserRole = "requester" | "attorney" | "server";

export interface MeResponse {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: UserRole | null;
  isAdmin: boolean;
  /**
   * True when the user has a row in `serversTable` linked to their account
   * (either an admin added them, or a pending invite has linked on signup).
   * Used by the role chooser to gate the "Switch to Server" option.
   */
  hasServerProfile: boolean;
}

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useMe(opts: { enabled?: boolean } = {}) {
  return useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: () => fetchJson<MeResponse>("/me"),
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: UserRole) =>
      fetchJson<MeResponse>("/me/role", {
        method: "POST",
        body: JSON.stringify({ role }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
    },
  });
}
