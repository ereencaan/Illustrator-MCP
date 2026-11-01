import { z } from "zod";
import { runJsx } from "../bridge/comBridge.js";

export const runJsxTool = {
  name: "run_jsx",
  description:
    "Escape hatch: run raw ExtendScript JSX code inside Illustrator. The snippet must " +
    "`return` a JSON-serializable value. Has access to `app`, `app.activeDocument`, and " +
    "the prelude helpers __requireDoc(), __findByName() and __toColor().",
  schema: {
    code: z
      .string()
      .min(1)
      .describe("ExtendScript source. Must return a JSON-serializable value."),
  },
  // The snippet is arbitrary code by design, so there is nothing to quote here —
  // unlike every other tool, whose parameters are escaped into a fixed template.
  // It runs inside an IIFE so that a top-level `return` is valid.
  handler: async ({ code }) =>
    runJsx(`
      var __result = (function () {
        ${code}
      })();
      __ok(__result === undefined ? null : __result);
    `),
};

export const rawTools = [runJsxTool];
