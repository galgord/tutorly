// Banned Tailwind utility prefixes/suffixes that hardcode physical direction.
// Use logical-property equivalents instead:
//   ml-* / mr-*  ->  ms-* / me-*
//   pl-* / pr-*  ->  ps-* / pe-*
//   left-* / right-*  ->  start-* / end-*
//   text-left / text-right  ->  text-start / text-end
//   border-l-* / border-r-*  ->  border-s-* / border-e-*
//   rounded-l-* / rounded-r-*  ->  rounded-s-* / rounded-e-*
const PHYSICAL_CLASS_REGEX =
  /(^|\s)(?:ml-|mr-|pl-|pr-|left-|right-|text-(?:left|right)|border-l(?:-|$)|border-r(?:-|$)|rounded-l(?:-|$)|rounded-r(?:-|$))/;

const SUGGESTIONS = {
  ml: 'ms',
  mr: 'me',
  pl: 'ps',
  pr: 'pe',
  left: 'start',
  right: 'end',
  'text-left': 'text-start',
  'text-right': 'text-end',
  'border-l': 'border-s',
  'border-r': 'border-e',
  'rounded-l': 'rounded-s',
  'rounded-r': 'rounded-e',
};

function findOffendingClass(value) {
  if (typeof value !== 'string') return null;
  for (const cls of value.split(/\s+/)) {
    if (PHYSICAL_CLASS_REGEX.test(' ' + cls)) return cls;
  }
  return null;
}

function suggestionFor(cls) {
  const compoundKeys = ['text-left', 'text-right', 'border-l', 'border-r', 'rounded-l', 'rounded-r'];
  for (const key of compoundKeys) {
    if (cls === key || cls.startsWith(key + '-')) {
      return cls.replace(key, SUGGESTIONS[key]);
    }
  }
  const m = cls.match(/^(ml|mr|pl|pr|left|right)(-.*)?$/);
  if (m) return SUGGESTIONS[m[1]] + (m[2] || '');
  return null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Tailwind physical-direction utilities (ml-, mr-, pl-, pr-, text-left, etc.) in favor of logical properties (ms-, me-, ps-, pe-, text-start, text-end). Breaks RTL layouts.',
    },
    schema: [],
    messages: {
      banned:
        'Direction utility "{{cls}}" breaks RTL. Use the logical equivalent "{{replacement}}" instead.',
      bannedNoSuggestion:
        'Direction utility "{{cls}}" breaks RTL. Use the logical equivalent (ms-/me-/ps-/pe-/text-start/text-end/border-s-/border-e-/rounded-s-/rounded-e-/start-/end-) instead.',
    },
  },
  create(context) {
    function report(node, cls) {
      const replacement = suggestionFor(cls);
      context.report({
        node,
        messageId: replacement ? 'banned' : 'bannedNoSuggestion',
        data: { cls, replacement: replacement || '' },
      });
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== 'className') return;
        if (node.value && node.value.type === 'Literal') {
          const cls = findOffendingClass(node.value.value);
          if (cls) report(node, cls);
        }
        if (
          node.value &&
          node.value.type === 'JSXExpressionContainer' &&
          node.value.expression.type === 'Literal'
        ) {
          const cls = findOffendingClass(node.value.expression.value);
          if (cls) report(node, cls);
        }
      },
      Literal(node) {
        // Catch usages inside cn()/clsx()/classNames() helpers.
        if (typeof node.value !== 'string') return;
        const parent = node.parent;
        if (!parent || parent.type !== 'CallExpression') return;
        const callee = parent.callee;
        const calleeName =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
            ? callee.property.name
            : null;
        if (calleeName && /^(cn|clsx|classNames|cva|tw)$/.test(calleeName)) {
          const cls = findOffendingClass(node.value);
          if (cls) report(node, cls);
        }
      },
    };
  },
};

module.exports = {
  rules: {
    'no-physical-direction-classes': rule,
  },
};
