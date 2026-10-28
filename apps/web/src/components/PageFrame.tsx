import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ErrorState, Skeleton } from "@commons/ui";
import { api } from "../api.ts";

interface View {
  versionId: string;
  token: string;
  origin: string;
  url: string;
}

/**
 * Shows a page's code in a sandboxed iframe on the page origin. The iframe has no access to this
 * app; it gets a short-lived token that lets it query data as the viewer, and talks back only
 * through postMessage (its height, link clicks, crashes).
 */
export function PageFrame({ slug, version }: { slug: string; version?: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<Error>();
  const [height, setHeight] = useState(600);
  const [crash, setCrash] = useState<string>();

  useEffect(() => {
    setView(undefined);
    setError(undefined);
    setCrash(undefined);
    api<View>(`/pages/${slug}/view`, { method: "POST", json: { version } }).then(setView, setError);
  }, [slug, version]);

  useEffect(() => {
    if (!view) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data;
      if (m?.type === "commons:height" && typeof m.height === "number") setHeight(Math.max(200, Math.min(m.height, 20000)));
      if (m?.type === "commons:navigate" && typeof m.href === "string" && m.href.startsWith("/") && !m.href.startsWith("//")) navigate(m.href);
      if (m?.type === "commons:error") setCrash(String(m.message));
    };
    window.addEventListener("message", onMessage);
    // Page tokens last 30 minutes; hand over a fresh one well before that
    const refresh = setInterval(async () => {
      const next = await api<View>(`/pages/${slug}/view`, { method: "POST", json: { version } }).catch(() => null);
      if (next) frame.current?.contentWindow?.postMessage({ type: "commons:token", token: next.token }, "*");
    }, 20 * 60 * 1000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(refresh);
    };
  }, [view, slug, version, navigate]);

  if (error) return <ErrorState error={error} />;
  if (!view) return <Skeleton className="h-[600px]" />;
  const dark = document.documentElement.classList.contains("dark") ? "1" : "0";
  const src = `${view.url}#token=${encodeURIComponent(view.token)}&app=${encodeURIComponent(location.origin)}&dark=${dark}`;
  return (
    <div className="flex flex-col gap-3">
      {crash && <ErrorState error={`The page's code crashed: ${crash}`} />}
      {/* allow-forms lets <form onSubmit> run in page code; the page's CSP (form-action 'none') still stops forms posting anywhere */}
      <iframe ref={frame} key={view.versionId} src={src} title={slug} sandbox="allow-scripts allow-forms"
        className="-mx-4 w-[calc(100%+2rem)] sm:-mx-6 sm:w-[calc(100%+3rem)] lg:-mx-8 lg:w-[calc(100%+4rem)]" style={{ height }} />
    </div>
  );
}
