// Permite que scripts Node (seed, testes) importem módulos marcados com "server-only".
import { register } from "node:module";

const hook = `
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`);
