import { TopBar } from "@/components/layout/top-bar";

import { buildCopy } from "./_lib/build.copy";

const copy = buildCopy;

/** A página do modo Construir (`/build`, RN-CONSTRUIR-001). */
export function BuildPage() {
  return (
    <div className="flex h-full flex-col bg-canvas text-body">
      <TopBar />
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted">{copy.emptyModels}</div>
    </div>
  );
}
