import type { RehypePlugins } from "astro";
import { unified, type Parser } from "unified";
import stringify from "rehype-stringify";
// @ts-ignore
import { createProcessor } from "typstx";
import { getOrInitCompiler } from "./typst.js";

export async function rehypeIt(hast: any, rehypePipe: RehypePlugins) {
  function typParse() {
    // @ts-ignore
    this.parser = parser as Parser;

    function parser(_doc: string, _file: unknown) {
      return hast;
    }
  }
  let processor = unified().use(typParse);
  for (const plugin of rehypePipe) {
    if (Array.isArray(plugin)) processor = processor.use(...plugin);
    // @ts-ignore
    else processor = processor.use(plugin);
  }
  // @ts-ignore
  processor = processor.use(stringify);
  const html = (await processor.process()).toString();
  return html;
}

export interface TypstxResult {
  /** The converted JSX module. */
  code: string;
}

export async function rehypeTypstx(hast: any, rehypePipe: RehypePlugins): Promise<TypstxResult> {
  // Typst emits a stylesheet alongside the document. For HTML output it
  // carries the rules that lay mathematics out — MathML elements are
  // rendered by the browser's own maths engine, but the alignment, spacing
  // and case tables need those rules to be present.
  //
  // The style element is moved from the head into the body rather than
  // lifted out, so the conversion carries it through as an ordinary element
  // and Astro hoists it into the page head when it renders. Without this a
  // page of equations renders as prose with the equations invisible.
  const moveStylesToBody = (node: any, styles: any[]) => {
    if (!node?.children) return;
    node.children = node.children.filter((child: any) => {
      if (child?.tagName === "style") {
        styles.push(child);
        return false;
      }
      return true;
    });
    for (const child of node.children) moveStylesToBody(child, styles);
  };

  const styles: any[] = [];
  moveStylesToBody(hast, styles);

  if (styles.length) {
    const body = (() => {
      const find = (node: any): any => {
        if (node?.tagName === "body") return node;
        for (const child of node?.children ?? []) {
          const found = find(child);
          if (found) return found;
        }
        return undefined;
      };
      return find(hast);
    })();
    if (body) {
      body.children = [...styles, ...(body.children ?? [])];
    }
  }

  const processor = createProcessor({
    jsxImportSource: "astro",
    rehypePlugins: rehypePipe,
  }, getOrInitCompiler);
  processor.__setHast(hast);
  const html = await processor.process(hast);
  return { code: String(html.value) };
}
