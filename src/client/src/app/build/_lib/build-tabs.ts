export type BuildTabsState = {
  open: string[];
  active: string | null;
};

export type BuildLayoutState = {
  sidebarHidden: boolean;
};

const defaultTabs: BuildTabsState = { open: [], active: null };
const defaultLayout: BuildLayoutState = { sidebarHidden: false };

function normalizeUser(user: string): string {
  return user.trim().toLowerCase();
}

export function buildTabsKey(user: string): string {
  return `prism:build-tabs:${normalizeUser(user)}`;
}

export function buildLayoutKey(user: string): string {
  return `prism:build-layout:${normalizeUser(user)}`;
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readBuildTabs(
  user: string,
  storage?: Storage,
): BuildTabsState {
  const store = resolveStorage(storage);
  if (!store || !user.trim()) return { open: [], active: null };

  try {
    const raw = store.getItem(buildTabsKey(user));
    if (!raw) return { open: [], active: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { open: [], active: null };
    }
    const { open, active } = parsed as { open?: unknown; active?: unknown };
    if (!Array.isArray(open)) {
      return { open: [], active: null };
    }
    const validOpen: string[] = [];
    for (const item of open) {
      if (typeof item === "string" && item.trim() !== "" && !validOpen.includes(item)) {
        validOpen.push(item);
      }
    }
    const validActive =
      typeof active === "string" && validOpen.includes(active)
        ? active
        : active === null
          ? null
          : (validOpen[0] ?? null);
    return { open: validOpen, active: validActive };
  } catch {
    return { ...defaultTabs, open: [] };
  }
}

export function writeBuildTabs(
  user: string,
  tabs: BuildTabsState,
  storage?: Storage,
): void {
  const store = resolveStorage(storage);
  if (!store || !user.trim()) return;
  try {
    store.setItem(
      buildTabsKey(user),
      JSON.stringify({
        open: tabs.open,
        active: tabs.active,
      }),
    );
  } catch {
    // Armazenamento indisponível ou cheio: segue em memória.
  }
}

export function readBuildLayout(
  user: string,
  storage?: Storage,
): BuildLayoutState {
  const store = resolveStorage(storage);
  if (!store || !user.trim()) return { ...defaultLayout };

  try {
    const raw = store.getItem(buildLayoutKey(user));
    if (!raw) return { ...defaultLayout };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...defaultLayout };
    }
    const { sidebarHidden } = parsed as { sidebarHidden?: unknown };
    return { sidebarHidden: sidebarHidden === true };
  } catch {
    return { ...defaultLayout };
  }
}

export function writeBuildLayout(
  user: string,
  layout: BuildLayoutState,
  storage?: Storage,
): void {
  const store = resolveStorage(storage);
  if (!store || !user.trim()) return;
  try {
    store.setItem(
      buildLayoutKey(user),
      JSON.stringify({ sidebarHidden: layout.sidebarHidden === true }),
    );
  } catch {
    // Armazenamento indisponível ou cheio: segue em memória.
  }
}
