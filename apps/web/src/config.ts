import { useApi } from "./api.ts";

export interface PublicConfig {
  apiUrl: string;
  webOrigin: string;
  pagesOrigin: string;
  devLogin: boolean;
}

const FALLBACK: PublicConfig = { apiUrl: "http://localhost:4000", webOrigin: location.origin, pagesOrigin: "", devLogin: false };

/** Server addresses as people's machines see them; used to show commands that work when pasted. */
export function usePublicConfig(): PublicConfig {
  return useApi<PublicConfig>("/config").data ?? FALLBACK;
}
