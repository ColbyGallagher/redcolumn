// The test hook redcolumn sets in development and VITE_E2E builds (apps/web/src/App.tsx). Typed
// loosely: the tests only reach into what they assert on.
interface NbMarkup {
  id: string;
  type: string;
  pageIndex: number;
}

interface NbCommand {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
  checked?: boolean;
  run: () => void;
}

interface Window {
  __nb: {
    viewer: {
      currentPageIndex: number;
      pageToClient(p: [number, number], pageIndex: number): [number, number];
      fit(): void;
      goToPage(i: number): void;
      zoomFor(pageIndex: number): number;
      getView(): { pageIndex: number; zoom: number; mode: string };
      pageView(): { pageIndex: number; zoom: number; rotation: number };
    };
    tools: {
      setTool(tool: string): void;
      getState(): { tool: string; selected: Set<string>; measuring: unknown; textSelection: { text: string; pageIndex: number } | null };
      select(ids: string[]): void;
      setRouteOf(id: string, route: 'elbow' | 'straight' | 'reset'): void;
      store: {
        all(): NbMarkup[];
        remove(ids: string[]): void;
        hasScale(pageIndex: number): boolean;
      };
    };
    commands(): ReadonlyMap<string, NbCommand>;
    assistant(method: string, params: unknown): Promise<unknown>;
  };
}
