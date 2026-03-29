let cachedP3: boolean | null = null

const supportsDisplayP3 = (): boolean => {
  if (cachedP3 !== null) return cachedP3
  try {
    cachedP3 = window.matchMedia('(color-gamut: p3)').matches
  } catch {
    cachedP3 = false
  }
  return cachedP3
}

const SRGB_COMPONENTS = '210, 57, 192'
const P3_COMPONENTS = '0.84 0.19 0.78'

export const overlayColor = (alpha: number): string =>
  supportsDisplayP3()
    ? `color(display-p3 ${P3_COMPONENTS} / ${alpha})`
    : `rgba(${SRGB_COMPONENTS}, ${alpha})`
