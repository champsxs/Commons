import { StrictMode, Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { Button, CommonsProvider, Spinner, cn } from "@commons/ui";
import "./index.css";
import { api, type Me } from "./api.ts";
import { Login } from "./routes/Login.tsx";
import { Home } from "./routes/Home.tsx";
import { DatasetList } from "./routes/DatasetList.tsx";
import { NewDataset } from "./routes/NewDataset.tsx";
import { DatasetDetail } from "./routes/DatasetDetail.tsx";
import { RecordPage } from "./routes/RecordPage.tsx";
import { Settings } from "./routes/Settings.tsx";
import { SearchBox } from "./components/SearchBox.tsx";
import { PageList } from "./routes/PageList.tsx";
import { PageView } from "./routes/PageView.tsx";
import { CliLogin } from "./routes/CliLogin.tsx";
// Help (and its Markdown renderer) loads only when someone opens it
const Help = lazy(() => import("./routes/Help.tsx").then((m) => ({ default: m.Help })));

const MeCtx = createContext<{ me: Me; refresh: () => void } | null>(null);
export const useMe = () => useContext(MeCtx)!;

function Shell({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const nav = (to: string, label: string) => (
    <NavLink to={to} end={to === "/"}
      className={({ isActive }) => cn("rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors", isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label}
    </NavLink>
  );
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <svg viewBox="0 0 32 32" className="size-5"><circle cx="12" cy="13" r="4.5" fill="currentColor" /><circle cx="21" cy="20" r="4.5" fill="currentColor" opacity=".7" /></svg>
            </span>
            <span className="hidden sm:inline">Commons</span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav("/datasets", "Datasets")}
            {nav("/pages", "Pages")}
            {nav("/help", "Help")}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <SearchBox className="hidden md:block w-72" />
            <button onClick={() => navigate("/settings")} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted" title="Settings">
              <span className="grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-primary">
                {me.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
              </span>
              <span className="hidden lg:inline text-muted-foreground">{me.name.split(" ")[0]}</span>
            </button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useCallback(() => {
    api<Me>("/me").then(setMe, () => setMe(null));
  }, []);
  useEffect(refresh, [refresh]);

  const commons = useMemo(
    () => ({
      graphqlUrl: "/graphql",
      registryUrl: "/api",
      linkTo: (dataset: string, id: string) => `/datasets/${dataset}/records/${id}`,
      navigate: (href: string) => navigate(href),
    }),
    [navigate],
  );

  if (me === undefined) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  if (me === null) return <Login onSignedIn={refresh} />;

  return (
    <MeCtx.Provider value={{ me, refresh }}>
      <CommonsProvider {...commons}>
        <Shell>
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/datasets" element={<DatasetList />} />
            <Route path="/datasets/new" element={<NewDataset />} />
            <Route path="/datasets/:slug" element={<DatasetDetail />} />
            <Route path="/datasets/:slug/:tab" element={<DatasetDetail />} />
            <Route path="/datasets/:slug/records/:id" element={<RecordPage />} />
            <Route path="/pages" element={<PageList />} />
            <Route path="/pages/:slug" element={<PageView />} />
            <Route path="/pages/:slug/v/:version" element={<PageView />} />
            <Route path="/pages/:slug/:tab" element={<PageView />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/cli-login" element={<CliLogin />} />
            <Route path="/help" element={<Suspense><Help /></Suspense>} />
            <Route path="/help/:section" element={<Suspense><Help /></Suspense>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Shell>
      </CommonsProvider>
    </MeCtx.Provider>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-7xl px-8 py-16 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link to="/"><Button className="mt-4">Go home</Button></Link>
    </div>
  );
}

if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
