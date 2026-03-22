// React fiber tree adapter using bippy
// Loaded only when react: true is set in plugin options
// Must be imported BEFORE React to hook into the fiber tree

import {
  instrument,
  traverseFiber,
  getDisplayName,
  isCompositeFiber,
  traverseProps,
  traverseState,
  type Fiber,
} from 'bippy'

interface ComponentNode {
  name: string
  depth: number
  props?: Record<string, string>
  state?: Record<string, string>
  children: ComponentNode[]
}

interface TreeRequest {
  depth?: number
  filter_name?: string
  include_props?: boolean
  include_state?: boolean
  requestId: string
}

let fiberRoot: Fiber | null = null

// Install the fiber hook — this MUST run before React initializes
instrument({
  onCommitFiberRoot(_rendererID: number, root: Fiber) {
    fiberRoot = root
  },
})

function truncateValue(val: unknown, maxLen = 200): string {
  try {
    const s = typeof val === 'string' ? val : JSON.stringify(val)
    return s && s.length > maxLen ? s.slice(0, maxLen) + '…' : (s ?? 'undefined')
  } catch {
    return String(val)
  }
}

function buildTree(
  fiber: Fiber,
  opts: { depth: number; maxDepth: number; filterName?: string; includeProps: boolean; includeState: boolean },
): ComponentNode[] {
  if (opts.depth > opts.maxDepth) return []

  const nodes: ComponentNode[] = []

  traverseFiber(fiber, (f: Fiber) => {
    if (!isCompositeFiber(f)) return

    const name = getDisplayName(f) ?? 'Anonymous'

    // Apply name filter
    if (opts.filterName && !name.toLowerCase().includes(opts.filterName.toLowerCase())) {
      return
    }

    const node: ComponentNode = {
      name,
      depth: opts.depth,
      children: [],
    }

    if (opts.includeProps) {
      const props: Record<string, string> = {}
      traverseProps(f, (propName: string, nextValue: unknown) => {
        if (propName !== 'children') {
          props[propName] = truncateValue(nextValue)
        }
      })
      if (Object.keys(props).length > 0) {
        node.props = props
      }
    }

    if (opts.includeState) {
      const state: Record<string, string> = {}
      let stateIdx = 0
      traverseState(f, (nextValue: unknown) => {
        state[`state_${stateIdx++}`] = truncateValue(nextValue)
      })
      if (Object.keys(state).length > 0) {
        node.state = state
      }
    }

    nodes.push(node)
  })

  return nodes
}

export function getReactTree(request: TreeRequest): {
  snapshot_at: number
  total_components: number
  tree: ComponentNode[]
} {
  const maxDepth = Math.min(request.depth ?? 8, 20)

  if (!fiberRoot) {
    return {
      snapshot_at: Date.now(),
      total_components: 0,
      tree: [],
    }
  }

  const tree = buildTree(fiberRoot, {
    depth: 0,
    maxDepth,
    filterName: request.filter_name,
    includeProps: request.include_props ?? true,
    includeState: request.include_state ?? false,
  })

  return {
    snapshot_at: Date.now(),
    total_components: tree.length,
    tree,
  }
}

// Listen for tree requests from the server via HMR
if (import.meta.hot) {
  import.meta.hot.on('harness:get-react-tree', (request: TreeRequest) => {
    const result = getReactTree(request)
    import.meta.hot!.send('harness:react-tree-response', {
      ...result,
      requestId: request.requestId,
    })
  })
}
