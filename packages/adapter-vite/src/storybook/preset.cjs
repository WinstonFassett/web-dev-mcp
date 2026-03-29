// CJS wrapper for Storybook addon resolution (Storybook uses require.resolve internally)
// Storybook calls viteFinal() which is async, so dynamic import is fine here.
exports.viteFinal = async function viteFinal(config, options) {
  const mod = await import('./preset.js')
  return mod.viteFinal(config, options)
}
