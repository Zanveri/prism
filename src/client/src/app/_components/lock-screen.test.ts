import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { signInCopy } from "@/app/sign-in/_lib/sign-in.copy";
import { PrismMark } from "@/components/layout/prism-mark";
import { ApiRequestError } from "@/lib/api/prism-api";
import { Button, FormMessage, TextField } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { lockDialogHandlers } from "../_lib/lock-dialog";
import { lockCopy } from "../_lib/lock.copy";
import { IdleAnnouncer, IdleWarning } from "./idle-warning";
import { failureOf, LockDialog, LockScreenView, type LockScreenViewProps } from "./lock-screen";

const copy = lockCopy.screen;

function view(props: Partial<LockScreenViewProps> = {}) {
  return LockScreenView({ userName: "marina", titleId: "titulo", refusal: null, errors: {}, failure: null, closeState: "closed", unlocking: false, signingOut: false, onSubmit: () => {}, onSignOut: () => {}, ...props });
}

/** O texto que o usuário lê numa árvore de elementos (sem entrar nos componentes, só nas propriedades). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}

const ofType = (tree: ReactNode, type: unknown): Found[] => elementsOf(tree).filter((element) => element.type === type);
const buttonOf = (tree: ReactNode, label: string) => ofType(tree, Button).find((button) => textOf(button) === label);

describe("a tela de bloqueio mostra o que a RN-SEG-001 pede", () => {
  const tree = view();

  it("a marca inteira, o usuário do cofre, o campo de senha, Desbloquear e Sair", () => {
    expect(ofType(tree, PrismMark)).toHaveLength(1);
    expect(textOf(tree)).toContain("marina");

    const [password] = ofType(tree, TextField);
    expect(password.props).toMatchObject({ name: "password", type: "password", autoComplete: "current-password", label: copy.password });
    // Senha em campo de senha, do jeito que o gerenciador de senhas do sistema entende: só a senha, o usuário é o do cofre.
    expect(ofType(tree, TextField)).toHaveLength(1);

    expect(buttonOf(tree, "Desbloquear")?.props).toMatchObject({ type: "submit" });
    expect(buttonOf(tree, "Sair")?.props).toMatchObject({ type: "button" });
  });

  it("diz que as abas e o texto de SQL ficaram, e que os resultados não", () => {
    expect(textOf(tree)).toContain("As suas abas e o texto de SQL continuam como estavam. Os resultados foram descartados.");
  });

  it("o título liga o diálogo ao nome: o leitor de tela o anuncia", () => {
    const heading = elementsOf(tree).find((element) => element.type === "h1");

    expect(heading?.props).toMatchObject({ id: "titulo", children: "Prism bloqueado" });
  });

  it("a frase que explica o bloqueio tem o id que o diálogo usa como descrição", () => {
    const description = elementsOf(tree).find((element) => element.props.id === "titulo-description");

    expect(textOf(description)).toBe(copy.description.closed);
  });

  it("sem recusa nem falha, nenhuma mensagem", () => {
    expect(ofType(tree, FormMessage)).toHaveLength(0);
  });

  it("Sair chama o que a tela de cima ligou a ele", () => {
    const onSignOut = vi.fn();

    (buttonOf(view({ onSignOut }), "Sair")?.props.onClick as () => void)();

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe("a senha errada mostra a mesma mensagem da tela de login", () => {
  it("INVALID_CREDENTIALS: a frase do login, que não diz se o erro foi do usuário ou da senha (RN-COFRE-006)", () => {
    const [message] = ofType(view({ refusal: "INVALID_CREDENTIALS" }), FormMessage);

    expect(textOf(message)).toBe(signInCopy.signIn.invalidCredentials);
    expect(message.props.tone).toBe("error");
  });

  it("VAULT_FORMAT_UNSUPPORTED: a frase do login também, e não a de senha errada (RN-VERSAO-005)", () => {
    const [message] = ofType(view({ refusal: "VAULT_FORMAT_UNSUPPORTED" }), FormMessage);

    expect(textOf(message)).toBe(signInCopy.signIn.vaultFormatUnsupported);
  });

  it("a recusa do campo (senha vazia) vai no campo", () => {
    const [password] = ofType(view({ errors: { password: "Informe a senha." } }), TextField);

    expect(password.props.error).toBe("Informe a senha.");
  });
});

describe("falhas que o aviso central não mostraria (ele fica por baixo da tela de bloqueio)", () => {
  it("a API não respondeu ao desbloquear, ou ao sair: a frase é da própria tela", () => {
    expect(textOf(ofType(view({ failure: "unlock" }), FormMessage)[0])).toBe(copy.unlockFailed);
    expect(textOf(ofType(view({ failure: "signOut" }), FormMessage)[0])).toBe(copy.signOutFailed);
  });

  it("a API não respondeu (o prazo da chamada acabou, ou ela caiu): a frase diz que o serviço não respondeu, de cada ação", () => {
    expect(textOf(ofType(view({ failure: "unlockNoResponse" }), FormMessage)[0])).toBe(copy.unlockNoResponse);
    expect(textOf(ofType(view({ failure: "signOutNoResponse" }), FormMessage)[0])).toBe(copy.signOutNoResponse);
    expect(copy.unlockNoResponse).toContain("O serviço não respondeu");
    expect(copy.signOutNoResponse).toContain("O serviço não respondeu");
  });
});

describe("failureOf: qual falha a tela diz de uma chamada que lançou", () => {
  const apiError = (code: string) => new ApiRequestError({ status: 0, code, title: "Título", detail: null, errors: null, extensions: {} });

  it("NETWORK_ERROR (a API não respondeu: o prazo acabou, ou ela está fora do ar) vira a frase de falta de resposta, da ação que falhou", () => {
    expect(failureOf("unlock", apiError("NETWORK_ERROR"))).toBe("unlockNoResponse");
    expect(failureOf("signOut", apiError("NETWORK_ERROR"))).toBe("signOutNoResponse");
  });

  it("qualquer outra falha segue com a frase de sempre", () => {
    expect(failureOf("unlock", apiError("VAULT_UNAVAILABLE"))).toBe("unlock");
    expect(failureOf("signOut", new Error("outra coisa"))).toBe("signOut");
    expect(failureOf("unlock", undefined)).toBe("unlock");
  });
});

describe("a tela diz a verdade sobre o fechamento do cofre, e 'Desbloquear' espera por ele (Important 3)", () => {
  it("fechando: diz que está fechando, e o desbloqueio espera", () => {
    const tree = view({ closeState: "closing" });

    expect(textOf(tree)).toContain(copy.closing);
    expect(buttonOf(tree, "Desbloquear")?.props.disabled).toBe(true);
  });

  it("a chamada falhou e repete: diz com franqueza que não foi possível fechar e que tenta de novo, em tom de atenção, e o desbloqueio espera", () => {
    const tree = view({ closeState: "retrying" });
    const [message] = ofType(tree, FormMessage);

    expect(message.props.tone).toBe("warning");
    expect(textOf(message)).toBe(copy.closeRetrying);
    expect(copy.closeRetrying).toBe("Não foi possível fechar o cofre no serviço; tentando de novo.");
    expect(buttonOf(tree, "Desbloquear")?.props.disabled).toBe(true);
  });

  it("desistiu de vez: diz que o cofre pode continuar aberto no serviço e que a janela segue bloqueada, e o desbloqueio está livre (ele ainda confere a senha na API)", () => {
    const tree = view({ closeState: "gaveUp" });
    const [message] = ofType(tree, FormMessage);

    expect(message.props.tone).toBe("warning");
    expect(textOf(message)).toBe(copy.closeFailed);
    expect(buttonOf(tree, "Desbloquear")?.props.disabled).toBe(false);
  });

  it("fechou: nenhuma mensagem sobre o cofre, e o desbloqueio está livre", () => {
    const tree = view({ closeState: "closed" });

    expect(ofType(tree, FormMessage)).toHaveLength(0);
    expect(textOf(tree)).not.toContain(copy.closing);
    expect(buttonOf(tree, "Desbloquear")?.props.disabled).toBe(false);
  });
});

describe("a frase que explica o bloqueio é a do estado do fechamento: não afirma que o cofre fechou quando a própria tela diz que não conseguiu (rodada 3)", () => {
  const states = ["closing", "retrying", "closed", "gaveUp"] as const;

  it.each(states)("%s: o parágrafo que o diálogo usa como descrição leva a frase do estado", (closeState) => {
    const description = elementsOf(view({ closeState })).find((element) => element.props.id === "titulo-description");

    expect(textOf(description)).toBe(copy.description[closeState]);
  });

  it("só o estado 'fechou' diz que o Prism fechou o cofre; os que ainda tentam, ou desistiram, não", () => {
    expect(copy.description.closed).toContain("fechou o cofre");
    for (const state of ["closing", "retrying", "gaveUp"] as const) expect(copy.description[state]).not.toContain("fechou o cofre");
  });

  it("cada estado tem a sua frase (nenhuma repete a de outro)", () => {
    expect(new Set(states.map((state) => copy.description[state])).size).toBe(states.length);
  });
});

describe("enquanto um pedido está a caminho", () => {
  it("desbloqueando: o botão diz isso e nada mais pode ser clicado", () => {
    const tree = view({ unlocking: true });

    expect(buttonOf(tree, "Desbloqueando…")?.props.disabled).toBe(true);
    expect(buttonOf(tree, "Sair")?.props.disabled).toBe(true);
  });

  it("saindo: o botão diz isso e o Desbloquear fica parado", () => {
    const tree = view({ signingOut: true });

    expect(buttonOf(tree, "Saindo…")?.props.disabled).toBe(true);
    expect(buttonOf(tree, "Desbloquear")?.props.disabled).toBe(true);
  });

  it("parado, os dois estão livres", () => {
    const tree = view();

    expect(buttonOf(tree, "Desbloquear")?.props.disabled).toBe(false);
    expect(buttonOf(tree, "Sair")?.props.disabled).toBe(false);
  });
});

describe("LockDialog: o <dialog> da tela de bloqueio (RN-SEG-001)", () => {
  const handlers = lockDialogHandlers();
  const dialog = LockDialog({ dialogRef: null, titleId: "titulo", handlers, children: "conteúdo" });

  it("é um dialog que nada fecha: o usuário não o fecha de jeito nenhum (closedby none), e o papel está escrito porque o diálogo de versão nova o procura", () => {
    expect(dialog.type).toBe("dialog");
    expect(dialog.props).toMatchObject({ role: "dialog", closedby: "none", tabIndex: -1 });
  });

  it("é a tela de bloqueio: a marca que o fechamento dos portais e a conferência procuram", () => {
    expect(dialog.props["data-lock-screen"]).toBe(true);
  });

  it("tem nome e descrição (o título e a frase que explica o bloqueio), e leva o conteúdo", () => {
    expect(dialog.props["aria-labelledby"]).toBe("titulo");
    expect(dialog.props["aria-describedby"]).toBe("titulo-description");
    expect(dialog.props.children).toBe("conteúdo");
  });

  it("liga os quatro tratadores que o mantêm aberto e com o foco: cancelar, teclado, fechar e foco", () => {
    expect(dialog.props.onCancel).toBe(handlers.onCancel);
    expect(dialog.props.onKeyDown).toBe(handlers.onKeyDown);
    expect(dialog.props.onClose).toBe(handlers.onClose);
    expect(dialog.props.onFocus).toBe(handlers.onFocus);
  });
});

describe("o aviso de 60 segundos antes", () => {
  const warning = IdleWarning({ secondsLeft: 45 });

  it("diz quanto falta e como cancelar", () => {
    expect(textOf(warning)).toContain("Faltam 45 s. Mexa o mouse ou digite para continuar.");
  });

  it("a contagem que muda a cada segundo é só visual (escondida do leitor de tela, ou seria lida 60 vezes), e o aviso em si não traz a região de leitura", () => {
    const visual = elementsOf(warning).find((element) => "data-idle-warning" in element.props);

    expect(visual?.props["aria-hidden"]).toBe("true");
    expect(elementsOf(warning).some((element) => element.props.role === "status")).toBe(false);
  });

  it("não toma o ponteiro: passar o mouse por cima é mexer, e o aviso some", () => {
    expect(warning.props.className).toContain("pointer-events-none");
  });
});

describe("IdleAnnouncer: o que o leitor de tela ouve do aviso, uma vez", () => {
  it("nasce VAZIO: uma região que já nasce preenchida não é anunciada pelo leitor de tela; ela existe antes, e só depois recebe o texto", () => {
    const idle = IdleAnnouncer({ active: false });

    expect(idle.props.role).toBe("status");
    expect(idle.props.children).toBe("");
  });

  it("quando o aviso começa, recebe a frase fixa, sem número nenhum (o número que muda a cada segundo não é lido)", () => {
    const announcing = IdleAnnouncer({ active: true });

    expect(announcing.props.role).toBe("status");
    expect(announcing.props.children).toBe(lockCopy.warning.announcement);
    expect(String(announcing.props.children)).not.toMatch(/\d/);
  });

  it("fica escondida da tela (só o leitor de tela a vê)", () => {
    expect(IdleAnnouncer({ active: false }).props.className).toContain("sr-only");
  });
});
