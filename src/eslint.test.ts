import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';
import { noUnusedSelectorKeys } from './eslint';

// Run ESLint's RuleTester under vitest's test hooks.
const RT = RuleTester as unknown as Record<string, unknown>;
RT.afterAll = afterAll;
RT.describe = describe;
RT.it = it;
RT.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('no-unused-selector-keys', noUnusedSelectorKeys, {
  valid: [
    // every selected key destructured
    "const { a, b } = useStoreSelector(store, ['a', 'b']);",
    "const { a } = useStoreSelector(store, ['a']);",
    // aliased destructure still counts as used
    "const { a: x, b } = useStoreSelector(store, ['a', 'b']);",
    // a rest element that is actually read consumes everything
    "const { a, ...rest } = useStoreSelector(store, ['a', 'b']); console.log(rest);",
    // unused rest, but every key is accounted for by name — nothing to flag
    "const { a, ...rest } = useStoreSelector(store, ['a']);",
    // custom-compare entry, destructured
    "const { tasks } = useStoreSelector(store, [{ tasks: (x, y) => x === y }]);",
    // not destructured → usage is unknowable, don't flag
    "const slice = useStoreSelector(store, ['a', 'b']);",
    // useStoreKey is not a multi-key selector (arg is not an array)
    "const a = useStoreKey(store, 'a');",
    // bound hook found by shape, all keys used
    "const { a, b } = useStore(['a', 'b']);",
    "const { a } = useMyStore(['a']);",
    // a use*-hook whose destructured names share nothing with the array is not a
    // selector call — some other hook that happens to take a string array
    "const { data } = useQueries(['users', 'posts']);",
    // not use*-prefixed → never treated as a selector hook
    "const { a } = whatever(['a', 'b']);",
    "const { a } = useless(['a', 'b']);",
    // dynamic selector array → not analyzable, no false positive
    "const keys = ['a', 'b']; const { a } = useStoreSelector(store, keys);",
    // shape-matched hook, not destructured → skipped
    "const slice = useCart(['items', 'total']);",
  ],

  invalid: [
    {
      code: "const { a } = useStoreSelector(store, ['a', 'b']);",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    {
      code: "const { a } = useStoreSelector(store, ['a', 'b', 'c']);",
      errors: [
        { messageId: 'unusedKey', data: { key: 'b' } },
        { messageId: 'unusedKey', data: { key: 'c' } },
      ],
    },
    // aliased 'a' is used; 'b' is not
    {
      code: "const { a: x } = useStoreSelector(store, ['a', 'b']);",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    // unused custom-compare entry
    {
      code: "const { a } = useStoreSelector(store, ['a', { b: (x, y) => x === y }]);",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    // bound hooks from any file, matched by shape — the 'a' overlap is the proof
    {
      code: "const { a } = useStore(['a', 'b']);",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    {
      code: "const { items } = useCart(['items', 'total']);",
      errors: [{ messageId: 'unusedKey', data: { key: 'total' } }],
    },
    // inside a component, same shape
    {
      code: "function C() { const { a } = useStore(['a', 'b']); return a; }",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    // custom-compare entry through a shape-matched hook
    {
      code: "const { a } = useMyStore(['a', { b: (x, y) => x === y }]);",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    // a rest element nobody reads hides nothing
    {
      code: "const { a, ...rest } = useStoreSelector(store, ['a', 'b']);",
      errors: [{ messageId: 'unusedKey', data: { key: 'b' } }],
    },
    {
      code: "const { items, ...rest } = useCart(['items', 'total']);",
      errors: [{ messageId: 'unusedKey', data: { key: 'total' } }],
    },
  ],
});
