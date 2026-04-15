import { z } from "zod";
import { runJsx } from "../bridge/comBridge.js";

const colorSchema = z.union([
  z.string().regex(/^#[0-9a-fA-F]{6}$/),
  z.object({ r: z.number(), g: z.number(), b: z.number() }),
  z.object({ c: z.number(), m: z.number(), y: z.number(), k: z.number() }),
]);

export const getTextObjects = {
  name: "get_text_objects",
  description: "List all text frames in the active document with their contents.",
  schema: {},
  handler: async () =>
    runJsx(`
      var doc = __requireDoc();
      var out = [];
      for (var i = 0; i < doc.textFrames.length; i++) {
        var t = doc.textFrames[i];
        out.push({
          name: t.name,
          contents: t.contents,
          layer: t.layer ? t.layer.name : null
        });
      }
      __ok(out);
    `),
};

// Illustrator uses PostScript font names (e.g. "ArialMT"). We accept a family
// name and try to match the first font whose family matches (case-insensitive).
export const setFont = {
  name: "set_font",
  description:
    "Set font family, size, and weight on a text object. font_family matches PostScript names loosely.",
  schema: {
    object_name: z.string(),
    font_family: z.string(),
    font_size: z.number().positive().default(12),
    font_weight: z
      .enum(["regular", "bold", "italic", "bold-italic"])
      .default("regular"),
  },
  handler: async ({ object_name, font_family, font_size = 12, font_weight = "regular" }) =>
    runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      if (it.typename !== "TextFrame") throw new Error("Not a text object: " + it.typename);

      var family = ${JSON.stringify(font_family)}.toLowerCase();
      var weight = ${JSON.stringify(font_weight)};
      var wantBold = (weight === "bold" || weight === "bold-italic");
      var wantItalic = (weight === "italic" || weight === "bold-italic");

      var picked = null, fallback = null;
      for (var i = 0; i < app.textFonts.length; i++) {
        var f = app.textFonts[i];
        var fam = (f.family || "").toLowerCase();
        var style = (f.style || "").toLowerCase();
        if (fam.indexOf(family) === -1) continue;
        if (!fallback) fallback = f;
        var isBold = style.indexOf("bold") !== -1;
        var isItalic = style.indexOf("italic") !== -1 || style.indexOf("oblique") !== -1;
        if (isBold === wantBold && isItalic === wantItalic) { picked = f; break; }
      }
      var font = picked || fallback;
      if (!font) throw new Error("No font found matching family: " + ${JSON.stringify(font_family)});

      var attrs = it.textRange.characterAttributes;
      attrs.textFont = font;
      attrs.size = ${font_size};
      __ok({ applied: it.name, font: font.name, size: ${font_size} });
    `),
};

export const setTextColor = {
  name: "set_text_color",
  description: "Set fill color on a text object.",
  schema: { object_name: z.string(), color: colorSchema },
  handler: async ({ object_name, color }) =>
    runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      if (it.typename !== "TextFrame") throw new Error("Not a text object: " + it.typename);
      it.textRange.characterAttributes.fillColor = __toColor(${JSON.stringify(color)});
      __ok({ applied: it.name });
    `),
};

export const applyTextGradient = {
  name: "apply_text_gradient",
  description:
    "Apply a linear gradient fill to a text object. Converts the text to outlines is NOT done — gradient is applied via appearance.",
  schema: {
    object_name: z.string(),
    colors: z.array(colorSchema).min(2),
  },
  handler: async ({ object_name, colors }) =>
    runJsx(`
      var it = __findByName(${JSON.stringify(object_name)});
      if (!it) throw new Error("Object not found: " + ${JSON.stringify(object_name)});
      if (it.typename !== "TextFrame") throw new Error("Not a text object: " + it.typename);

      var doc = __requireDoc();
      var colorsIn = ${JSON.stringify(colors)};
      var g = doc.gradients.add();
      g.type = GradientType.LINEAR;
      while (g.gradientStops.length > 2) { g.gradientStops[g.gradientStops.length - 1].remove(); }
      for (var i = 0; i < colorsIn.length; i++) {
        var stop = (i < g.gradientStops.length) ? g.gradientStops[i] : g.gradientStops.add();
        stop.color = __toColor(colorsIn[i]);
        stop.rampPoint = (i / (colorsIn.length - 1)) * 100;
      }
      var gc = new GradientColor();
      gc.gradient = g;
      it.textRange.characterAttributes.fillColor = gc;
      __ok({ applied: it.name });
    `),
};

export const textTools = [getTextObjects, setFont, setTextColor, applyTextGradient];
