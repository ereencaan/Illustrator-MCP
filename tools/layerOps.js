import { z } from "zod";
import { runJsx } from "../bridge/comBridge.js";

const colorSchema = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex like #aabbcc"),
  z.object({ r: z.number(), g: z.number(), b: z.number() }),
  z.object({ c: z.number(), m: z.number(), y: z.number(), k: z.number() }),
]);

export const getLayers = {
  name: "get_layers",
  description: "List all layers in the active document, with their top-level page items.",
  schema: {},
  handler: async () =>
    runJsx(`
      var doc = __requireDoc();
      var out = [];
      for (var i = 0; i < doc.layers.length; i++) {
        var l = doc.layers[i];
        var items = [];
        for (var j = 0; j < l.pageItems.length; j++) {
          var it = l.pageItems[j];
          items.push({ name: it.name, type: it.typename });
        }
        out.push({ name: l.name, visible: l.visible, locked: l.locked, items: items });
      }
      __ok(out);
    `),
};

export const selectObject = {
  name: "select_object",
  description: "Select a page item in the active document by name.",
  schema: { name: z.string() },
  handler: async ({ name }) =>
    runJsx(`
      var doc = __requireDoc();
      doc.selection = null;
      var it = __findByName(${JSON.stringify(name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(name)});
      it.selected = true;
      __ok({ selected: it.name, type: it.typename });
    `),
};

export const applyGradient = {
  name: "apply_gradient",
  description: "Fill an object with a linear gradient of the given colors and angle.",
  schema: {
    object_name: z.string(),
    colors: z.array(colorSchema).min(2).describe("Two or more color stops."),
    angle: z.number().default(0).describe("Gradient angle in degrees."),
  },
  handler: async ({ object_name, colors, angle = 0 }) => {
    const a = Number(angle);
    return runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      var colorsIn = ${JSON.stringify(colors)};
      var doc = __requireDoc();

      var g = doc.gradients.add();
      g.type = GradientType.LINEAR;
      // Normalize stop count to match colorsIn (zod guarantees length >= 2).
      while (g.gradientStops.length < colorsIn.length) g.gradientStops.add();
      while (g.gradientStops.length > colorsIn.length) g.gradientStops[g.gradientStops.length - 1].remove();
      for (var i = 0; i < colorsIn.length; i++) {
        var stop = g.gradientStops[i];
        stop.color = __toColor(colorsIn[i]);
        stop.rampPoint = (i / (colorsIn.length - 1)) * 100;
      }

      var gc = new GradientColor();
      gc.gradient = g;
      gc.angle = ${a};
      it.filled = true;
      it.fillColor = gc;
      __ok({ applied: it.name, stops: colorsIn.length });
    `);
  },
};

export const applyDropShadow = {
  name: "apply_drop_shadow",
  description: "Apply a drop-shadow effect to an object.",
  schema: {
    object_name: z.string(),
    opacity: z.number().min(0).max(100).default(75),
    x_offset: z.number().default(3),
    y_offset: z.number().default(3),
    blur: z.number().default(5),
  },
  handler: async ({ object_name, opacity = 75, x_offset = 3, y_offset = 3, blur = 5 }) => {
    const op = Number(opacity) / 100;
    const dx = Number(x_offset);
    const dy = Number(y_offset);
    const bl = Number(blur);
    return runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      var xml = '<LiveEffect name="Adobe Drop Shadow">'
              + '<Dict data="R opac ${op} R dx ${dx} R dy ${dy} R blur ${bl} '
              + 'I mode 0 R csrc 0 R csrcB 0 R csrcG 0 R csrcR 0 B useNewShadow 1 "/>'
              + '</LiveEffect>';
      it.applyEffect(xml);
      __ok({ applied: it.name });
    `);
  },
};

export const applyInnerGlow = {
  name: "apply_inner_glow",
  description: "Apply an inner-glow effect to an object.",
  schema: {
    object_name: z.string(),
    color: colorSchema.default("#ffffff"),
    opacity: z.number().min(0).max(100).default(75),
    blur: z.number().default(5),
  },
  handler: async ({ object_name, color = "#ffffff", opacity = 75, blur = 5 }) => {
    const op = Number(opacity) / 100;
    const bl = Number(blur);
    return runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      var col = __toColor(${JSON.stringify(color)});
      var r = 0, g = 0, b = 0;
      if (col.typename === "RGBColor")   { r = col.red; g = col.green; b = col.blue; }
      // Inner glow uses RGB in the effect XML regardless of document color space.
      var xml = '<LiveEffect name="Adobe Inner Glow">'
              + '<Dict data="R opac ${op} R blur ${bl} R csrcR ' + (r / 255) + ' R csrcG ' + (g / 255) + ' R csrcB ' + (b / 255) + ' I mode 0 B edge 1 "/>'
              + '</LiveEffect>';
      it.applyEffect(xml);
      __ok({ applied: it.name });
    `);
  },
};

export const setStroke = {
  name: "set_stroke",
  description: "Set stroke color and width on an object.",
  schema: {
    object_name: z.string(),
    color: colorSchema,
    width: z.number().min(0).default(1),
  },
  handler: async ({ object_name, color, width = 1 }) => {
    const w = Number(width);
    return runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      it.stroked = true;
      it.strokeColor = __toColor(${JSON.stringify(color)});
      it.strokeWidth = ${w};
      __ok({ applied: it.name });
    `);
  },
};

export const layerTools = [
  getLayers,
  selectObject,
  applyGradient,
  applyDropShadow,
  applyInnerGlow,
  setStroke,
];
