import { describe, expect, it, vi } from "vitest";

import { saveCellFile } from "./save-file";

describe("saveCellFile", () => {
  it("cria o link de download no documento da janela informada para texto ou bytes", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:prism-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const clicked: string[] = [];
    const appended: unknown[] = [];
    const removed: unknown[] = [];

    const fakeDoc = {
      createElement: (tag: string) => {
        const el = {
          tag,
          href: "",
          download: "",
          rel: "",
          style: { display: "" },
          click: () => clicked.push(el.download),
          remove: () => removed.push(el),
        };
        return el;
      },
      body: {
        append: (el: unknown) => appended.push(el),
      },
    } as unknown as Document;

    saveCellFile("dados.json", '{"id":1}', "application/json;charset=utf-8", fakeDoc);
    saveCellFile("payload.bin", new Uint8Array([0xca, 0xfe]), "application/octet-stream", fakeDoc);

    expect(clicked).toEqual(["dados.json", "payload.bin"]);
    expect(appended).toHaveLength(2);
    expect(removed).toHaveLength(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    createObjectURL.mockRestore();
  });
});
