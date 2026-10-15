import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { shownProtections, type ShownProtections } from "@/app/connections/_lib/protections";

import type { CommandQuestion, ConfirmationContext } from "./command-confirmation";

/** O aviso aberto, como o `ConfirmCommandDialog` o desenha: a pergunta, de quem ela é e as duas respostas. */
export type OpenConfirmation = { question: CommandQuestion; context: ConfirmationContext; onConfirm: () => void; onCancel: () => void };

/** Monta a pergunta com as proteções que valem agora (`commandQuestion`, `scriptQuestion`, `saveQuestion`, `autoRefreshQuestion`); nula é "não pergunta". */
export type MakeQuestion = (protections: ShownProtections) => CommandQuestion | null;

export type CommandConfirmation = {
  /**
   * Pergunta antes de executar, se a proteção da conexão pede (RN-PROT-001). Sem pergunta, `proceed` roda na hora, na mesma chamada (o comando sai como
   * sairia sem a proteção); com ela, roda no "Executar mesmo assim", e `cancelled` no "Cancelar" (o Esc, o X, o clique fora): nada é executado.
   */
  confirm: (make: MakeQuestion, proceed: () => void, cancelled?: () => void) => void;
  /** O mesmo, para quem espera a resposta (o Salvar da grade): verdadeiro na hora quando não pergunta; senão, a resposta da pessoa. */
  confirmed: (make: MakeQuestion) => true | Promise<boolean>;
  /** O aviso aberto, ou nulo. */
  open: OpenConfirmation | null;
};

type Waiting = { proceed: () => void; cancelled?: () => void };

/** A resposta do `confirm` como valor: a que vem na mesma chamada (sem pergunta) volta na hora; a que vem depois resolve a promessa. */
function answerOf(confirm: CommandConfirmation["confirm"], make: MakeQuestion): true | Promise<boolean> {
  const box: { answer: boolean | null; resolve: ((confirmed: boolean) => void) | null } = { answer: null, resolve: null };
  const answer = (value: boolean) => (box.resolve === null ? (box.answer = value) : box.resolve(value));
  confirm(
    make,
    () => answer(true),
    () => answer(false),
  );
  if (box.answer === true) return true;
  return box.answer === false ? Promise.resolve(false) : new Promise<boolean>((done) => (box.resolve = done));
}

/**
 * O aviso de confirmação de uma aba (RN-PROT-001), na conexão e no banco dela. As proteções que valem são as da lista de conexões do cache
 * (`connectionsQuery`, o `protections` da API, com a pasta de onde vem cada uma pela lista de pastas): mudar a proteção, no formulário ou numa pasta acima, vale
 * para o comando seguinte, depois do `invalidateLists`. A pergunta é feita na hora do pedido, com o que vale então. Sem a conexão na lista (a aba sem
 * conexão, a lista que ainda não chegou), nada pergunta: a aba sem conexão não executa, e a recusa do somente leitura é da API de todo jeito.
 *
 * Um aviso por vez: o pedido novo com outro aberto cancela o de antes. Desmontar a vista (fechar a aba, o bloqueio) também cancela: nada fica esperando.
 */
export function useCommandConfirmation(connectionId: string | null, database: string | undefined): CommandConfirmation {
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const [asking, setAsking] = useState<{ question: CommandQuestion; context: ConfirmationContext } | null>(null);
  const waiting = useRef<Waiting | null>(null);

  const connection = connectionId === null ? null : (connections.data?.find((candidate) => candidate.id === connectionId) ?? null);
  const current = useMemo(() => {
    if (connection === null) return null;
    const list = folders.data ?? [];
    return { connection, protections: shownProtections(connection.protections, list), environment: environmentLookup(list).connection(connection) };
  }, [connection, folders.data]);
  const latest = useRef({ current, database });
  useEffect(() => {
    latest.current = { current, database };
  });

  /** A resposta da pessoa: o que esperava sai da fila antes de rodar, e o aviso fecha. */
  const settle = useCallback((confirmed: boolean) => {
    const answer = waiting.current;
    waiting.current = null;
    setAsking(null);
    if (confirmed) answer?.proceed();
    else answer?.cancelled?.();
  }, []);

  const confirm = useCallback((make: MakeQuestion, proceed: () => void, cancelled?: () => void) => {
    const { current: now, database: shownDatabase } = latest.current;
    const question = now === null ? null : make(now.protections);
    const level = now?.protections.confirm ?? null;
    if (now === null || question === null || level === null) return proceed();

    // Um aviso por vez: o de antes é cancelado.
    const previous = waiting.current;
    waiting.current = { proceed, cancelled };
    previous?.cancelled?.();
    setAsking({ question, context: { connection: now.connection.name, database: shownDatabase ?? now.connection.database, environment: now.environment, level: level.level, from: level.from } });
  }, []);

  const confirmed = useCallback((make: MakeQuestion) => answerOf(confirm, make), [confirm]);

  // A vista que sai de cena não deixa ninguém esperando a resposta.
  useEffect(
    () => () => {
      const answer = waiting.current;
      waiting.current = null;
      answer?.cancelled?.();
    },
    [],
  );

  return { confirm, confirmed, open: asking === null ? null : { question: asking.question, context: asking.context, onConfirm: () => settle(true), onCancel: () => settle(false) } };
}
