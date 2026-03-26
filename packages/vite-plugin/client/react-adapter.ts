// React fiber tree adapter using bippy
// Loaded only when react: true is set in plugin options
// Must be imported BEFORE React to hook into the fiber tree
//
// NOTE: This file is served as a virtual module — must be valid JavaScript.

import {
  instrument,
  traverseFiber,
  getDisplayName,
  isCompositeFiber,
  traverseProps,
  traverseState,
} from 'bippy'

let fiberRoot = null

// Install the fiber hook — this MUST run before React initializes
instrument({
  onCommitFiberRoot(_rendererID, root) {
    fiberRoot = root
  },
})

function truncateValue(val, maxLen = 200) {
  try {
    const s = typeof val === 'string' ? val : JSON.stringify(val)
    return s && s.length > maxLen ? s.slice(0, maxLen) + '…' : (s ?? 'undefined')
  } catch {
    return String(val)
  }
}

function buildTree(fiber, opts) {
  if (opts.depth > opts.maxDepth) return []

  const nodes = []

  traverseFiber(fiber, (f) => {
    if (!isCompositeFiber(f)) return

    const name = getDisplayName(f) ?? 'Anonymous'

    // Apply name filter
    if (opts.filterName && !name.toLowerCase().includes(opts.filterName.toLowerCase())) {
      return
    }

    const node = {
      name,
      depth: opts.depth,
      children: [],
    }

    if (opts.includeProps) {
      const props = {}
      traverseProps(f, (propName, nextValue) => {
        if (propName !== 'children') {
          props[propName] = truncateValue(nextValue)
        }
      })
      if (Object.keys(props).length > 0) {
        node.props = props
      }
    }

    if (opts.includeState) {
      const state = {}
      let stateIdx = 0
      traverseState(f, (nextValue) => {
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

function getReactTree(request) {
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
  import.meta.hot.on('harness:get-react-tree', (request) => {
    const result = getReactTree(request)
    import.meta.hot.send('harness:react-tree-response', {
      ...result,
      requestId: request.requestId,
    })
  })
}
