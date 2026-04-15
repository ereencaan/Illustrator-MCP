import { z } from "zod";
import { runJsx } from "../bridge/comBridge.js";

export const applyAppearanceEffect = {
  name: "apply_appearance_effect",
  description:
    "Apply a raw Illustrator live-effect by XML name + parameter dict. " +
    "effect_type is the Adobe effect name (e.g. 'Adobe Gaussian Blur', 'Adobe Drop Shadow'). " +
    "params is a flat key/value object inserted into the effect Dict (strings only).",
  schema: {
    object_name: z.string(),
    effect_type: z.string(),
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  },
  handler: async ({ object_name, effect_type, params = {} }) => {
    // Build the Dict data string: "TYPE key value TYPE key value ..."
    // We infer type: number -> R, integer-ish -> I, boolean -> B, string -> S
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "boolean") parts.push(`B ${k} ${v ? 1 : 0}`);
      else if (typeof v === "number") parts.push(Number.isInteger(v) ? `I ${k} ${v}` : `R ${k} ${v}`);
      else parts.push(`S ${k} ${String(v)}`);
    }
    const dictData = parts.join(" ") + (parts.length ? " " : "");
    const xml = `<LiveEffect name="${effect_type}"><Dict data="${dictData}"/></LiveEffect>`;

    return runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      it.applyEffect(${JSON.stringify(xml)});
      __ok({ applied: it.name, effect: ${JSON.stringify(effect_type)} });
    `);
  },
};

export const setOpacity = {
  name: "set_opacity",
  description: "Set an object's opacity (0-100).",
  schema: {
    object_name: z.string(),
    opacity: z.number().min(0).max(100),
  },
  handler: async ({ object_name, opacity }) =>
    runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      it.opacity = ${opacity};
      __ok({ applied: it.name, opacity: ${opacity} });
    `),
};

export const addGaussianBlur = {
  name: "add_gaussian_blur",
  description: "Apply a Gaussian blur effect with the given radius (pixels).",
  schema: {
    object_name: z.string(),
    radius: z.number().positive(),
  },
  handler: async ({ object_name, radius }) =>
    runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      var xml = '<LiveEffect name="Adobe Gaussian Blur"><Dict data="R radius ${radius} "/></LiveEffect>';
      it.applyEffect(xml);
      __ok({ applied: it.name, radius: ${radius} });
    `),
};

export const effectTools = [applyAppearanceEffect, setOpacity, addGaussianBlur];
