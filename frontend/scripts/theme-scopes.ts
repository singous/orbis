import type { AtRule, ChildNode, Plugin as PostCSSPlugin, Rule } from "postcss";
import type { Plugin } from "vite";

export function themeScopes(): Plugin {
  return {
    name: "orbis:theme-scopes",
    config: () => ({ css: { postcss: { plugins: [scopedDarkUtilities()] } } }),
  };
}

function scopedDarkUtilities(): PostCSSPlugin {
  return {
    postcssPlugin: "orbis:scoped-dark-utilities",
    Once(root, { postcss }) {
      root.walkAtRules("scope", scope => {
        if (!scope.nodes) return;
        const ancestors: (Rule | AtRule)[] = [];
        let utility: Rule | undefined;
        for (let parent = scope.parent; parent && parent.type !== "root"; parent = parent.parent) {
          if (parent.type === "rule" || parent.type === "atrule") ancestors.push(parent);
          if (parent.type === "rule") utility = parent;
        }
        if (!utility?.selector.includes("dark\\:")) return;

        // 嵌在 utility 里的 @scope 会把主题误当成控件后代；须在压缩前提到 selector 外。
        let contents: ChildNode[] = scope.nodes.map(node => node.clone());
        for (const parent of ancestors) {
          const copy = parent.clone({ nodes: contents });
          if (copy.type === "rule" && parent === utility) {
            copy.selector += `, :scope:is(${utility.selector})`;
          }
          contents = [copy];
          if (parent === utility) break;
        }
        utility.before(postcss.atRule({ name: "scope", params: scope.params, nodes: contents }));
        let empty = scope.parent;
        scope.remove();
        while (empty && empty.type !== "root" && empty.nodes.length === 0) {
          const parent = empty.parent;
          empty.remove();
          empty = parent;
        }
      });
    },
  };
}
