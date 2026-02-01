import { Node, mergeAttributes } from '@tiptap/core'
import { HELPDOC_ICONS } from '@/lib/helpIcons'

/** Inline-иконка в справке: хранит имя иконки, в редакторе и при просмотре рендерится как SVG */
export const HelpIcon = Node.create({
  name: 'helpIcon',

  group: 'inline',

  inline: true,

  atom: true,

  addAttributes() {
    return {
      name: {
        default: 'info',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-icon') || 'info',
        renderHTML: (attrs) => (attrs.name ? { 'data-icon': attrs.name } : {}),
      },
      color: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-icon-color') || null,
        renderHTML: (attrs) => (attrs.color ? { 'data-icon-color': attrs.color } : {}),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-icon]' },
      { tag: 'span.help-inline-icon[data-icon]' },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const out: Record<string, string> = {
      class: 'help-inline-icon',
      'data-icon': node.attrs.name || 'info',
    }
    if (node.attrs.color) {
      out['data-icon-color'] = node.attrs.color
      out.style = `color:${node.attrs.color}`
    }
    return ['span', mergeAttributes(HTMLAttributes, out)]
  },

  addNodeView() {
    return ({ node }) => {
      const span = document.createElement('span')
      span.className = 'help-inline-icon'
      span.setAttribute('data-icon', node.attrs.name || 'info')
      if (node.attrs.color) {
        span.setAttribute('data-icon-color', node.attrs.color)
        span.style.color = node.attrs.color
      }
      const svg = HELPDOC_ICONS[node.attrs.name]
      if (svg) span.innerHTML = svg
      return { dom: span }
    }
  },

  addCommands() {
    return {
      insertHelpIcon:
        (name: string, color?: string | null) =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name, attrs: { name, color: color || null } }),
      setHelpIconColor:
        (color: string | null) =>
        ({ commands }: any) =>
          commands.updateAttributes(this.name, { color }),
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType = any> {
    helpIcon: {
      insertHelpIcon: (name: string, color?: string | null) => ReturnType
      setHelpIconColor: (color: string | null) => ReturnType
    }
  }
}

/** Цветные блоки для выделения фрагментов текста в справке */
export const BlockHighlight = Node.create({
  name: 'blockHighlight',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      color: {
        default: 'amber',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-color') || 'amber',
        renderHTML: (attrs) => (attrs.color ? { 'data-color': attrs.color } : {}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="block-highlight"]',
        getAttrs: (el) => ({ color: (el as HTMLElement).getAttribute('data-color') || 'amber' }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const color = node.attrs.color || 'amber'
    const classes: Record<string, string> = {
      amber: 'help-block-highlight help-block-amber',
      blue: 'help-block-highlight help-block-blue',
      green: 'help-block-highlight help-block-green',
      red: 'help-block-highlight help-block-red',
      violet: 'help-block-highlight help-block-violet',
      slate: 'help-block-highlight help-block-slate',
    }
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'block-highlight',
        'data-color': color,
        class: classes[color] || classes.amber,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setBlockHighlight:
        (color: string) =>
        ({ commands }: any) =>
          commands.wrapIn(this.name, { color }),
      toggleBlockHighlight:
        (color: string) =>
        ({ commands }: any) =>
          commands.toggleWrap(this.name, { color }),
      unsetBlockHighlight:
        () =>
        ({ commands }: any) =>
          commands.lift(this.name),
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType = any> {
    blockHighlight: {
      setBlockHighlight: (color: string) => ReturnType
      toggleBlockHighlight: (color: string) => ReturnType
      unsetBlockHighlight: () => ReturnType
    }
  }
}
