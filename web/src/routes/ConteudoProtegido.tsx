import { type PropsWithChildren, type ReactNode, useEffect, useRef } from "react";

export function ConteudoProtegido({
  authenticated,
  children,
  destination,
  fallback = <div role="status">Aguardando autenticação</div>,
  message,
  onRequireAuthentication,
}: PropsWithChildren<{
  authenticated: boolean;
  destination: string;
  fallback?: ReactNode;
  message: string;
  onRequireAuthentication: (destination: string, message: string) => void;
}>): ReactNode {
  const requestedDestination = useRef<string | null>(null);
  useEffect(() => {
    if (authenticated) {
      requestedDestination.current = null;
      return;
    }
    if (requestedDestination.current === destination) return;
    requestedDestination.current = destination;
    onRequireAuthentication(destination, message);
  }, [authenticated, destination, message, onRequireAuthentication]);
  return authenticated ? children : fallback;
}
