import { z } from "zod";

/**
 * A política de conteúdo do app não permite `eval` (RN-SHELL-001). Ao criar um `z.object`, o Zod
 * testa `new Function("")` para decidir se compila o schema; a política recusa, ele segue sem
 * compilar, mas cada recusa fica no console como violação da política. Dito de antemão que não
 * há `eval`, ele nem tenta.
 *
 * Precisa valer antes do primeiro schema: é o primeiro import de `main.tsx`.
 */
z.config({ jitless: true });
