import type { Rule } from 'eslint';

/**
 * ESLint rule: warn when a selector includes keys that are never destructured.
 *
 * Zero-config. Two detection paths:
 * - `useStoreSelector(store, [...])` — recognized by name, checked strictly.
 * - Any other `use*`-named hook called with a selector-style array (string keys /
 *   `{ key: compareFn }` entries) whose result is destructured. To leave foreign
 *   hooks alone, these only warn when at least one selected key IS destructured —
 *   the overlap is the proof it's a selector call.
 *
 * Warnings require provability: the call's result must be destructured inline.
 * A `...rest` element only counts as consuming the remaining keys when the rest
 * variable is actually read somewhere; an unused rest is ignored. Anything short
 * of proof is skipped rather than guessed at.
 */
const noUnusedSelectorKeys: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Warn when a selector includes keys that are never destructured or used.',
      recommended: true,
    },
    schema: [],
    messages: {
      unusedKey:
        "'{{key}}' is selected but never destructured. Remove it from the selector, or destructure and use it.",
    },
  },

  create(context) {
    function selectedKeysOf(array: any): Array<{ node: any; name: string }> {
      const out: Array<{ node: any; name: string }> = [];
      for (const el of array.elements) {
        if (!el) continue;
        if (el.type === 'Literal' && typeof el.value === 'string') {
          out.push({ node: el, name: el.value });
        } else if (el.type === 'ObjectExpression') {
          for (const p of el.properties) {
            if (p.type !== 'Property' || p.computed) continue;
            const name =
              p.key.type === 'Identifier'
                ? p.key.name
                : p.key.type === 'Literal'
                  ? String(p.key.value)
                  : null;
            if (name) out.push({ node: p.key, name });
          }
        }
        // spread / identifier / dynamic elements: not analyzable, skip
      }
      return out;
    }

    function restIsUsed(declarator: any, restProp: any): boolean {
      if (restProp.argument.type !== 'Identifier') return true; // exotic pattern — assume used
      const name = restProp.argument.name;
      const variable = context.sourceCode
        .getDeclaredVariables(declarator)
        .find((v) => v.name === name);
      if (!variable) return true; // can't resolve — assume used
      return variable.references.some((ref) => ref.isRead());
    }

    function check(call: any, array: any, requireOverlap: boolean): void {
      const parent = call.parent;
      if (!parent || parent.type !== 'VariableDeclarator' || parent.id.type !== 'ObjectPattern') {
        return; // not destructured → can't tell what's used
      }
      const pattern = parent.id;
      const rest = pattern.properties.find((p: any) => p.type === 'RestElement');
      if (rest && restIsUsed(parent, rest)) return; // a read `...rest` may use anything

      const selected = selectedKeysOf(array);
      if (selected.length === 0) return;

      const used = new Set<string>();
      for (const prop of pattern.properties) {
        if (prop.type !== 'Property' || prop.computed) continue;
        if (prop.key.type === 'Identifier') used.add(prop.key.name);
        else if (prop.key.type === 'Literal') used.add(String(prop.key.value));
      }

      // For hooks matched by shape rather than name, at least one selected key must
      // be destructured — otherwise this is some unrelated hook that takes an array.
      if (requireOverlap && !selected.some(({ name }) => used.has(name))) return;

      for (const { node, name } of selected) {
        if (!used.has(name)) {
          context.report({ node, messageId: 'unusedKey', data: { key: name } });
        }
      }
    }

    return {
      CallExpression(node: any) {
        if (node.callee.type !== 'Identifier') return;
        const name = node.callee.name;

        // useStoreSelector(store, [...]) → selector is the 2nd arg, checked strictly
        if (name === 'useStoreSelector') {
          const arr = node.arguments[1];
          if (arr?.type === 'ArrayExpression') check(node, arr, false);
          return;
        }

        // any other use*-named hook with a selector-style array as the 1st arg
        if (/^use[A-Z0-9]/.test(name)) {
          const arr = node.arguments[0];
          if (arr?.type === 'ArrayExpression') check(node, arr, true);
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'voltix' },
  rules: { 'no-unused-selector-keys': noUnusedSelectorKeys },
  configs: {} as Record<string, unknown>,
};

// Flat-config preset: `...voltix.configs.recommended`
plugin.configs.recommended = {
  plugins: { voltix: plugin },
  rules: { 'voltix/no-unused-selector-keys': 'warn' },
};

export { noUnusedSelectorKeys };
export default plugin;
