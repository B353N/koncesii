import { createContext, useContext } from "react";

/** CSP nonce-ът за инлайн скриптовете на React Router (виж entry.server.tsx). */
export const NonceContext = createContext<string | undefined>(undefined);
export const useNonce = () => useContext(NonceContext);
