// CJS wrapper for Storybook's require()-based preset loading
async function viteFinal(config, options) {
  const mod = await import('./preset.js')
  return mod.viteFinal(config, options)
}

module.exports = { viteFinal }
