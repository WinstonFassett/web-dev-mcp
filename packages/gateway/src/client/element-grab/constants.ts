import { overlayColor } from './utils/overlay-color.js'

// Activation
export const ACTIVATION_KEY = 'c'  // Cmd+Shift+C
export const REQUIRE_SHIFT = true
export const DEFAULT_KEY_HOLD_DURATION_MS = 100

// Element detection
export const ELEMENT_DETECTION_THROTTLE_MS = 32
export const COMPONENT_NAME_DEBOUNCE_MS = 100
export const BOUNDS_CACHE_TTL_MS = 16
export const BOUNDS_RECALC_INTERVAL_MS = 100

// Overlay canvas
export const SELECTION_LERP_FACTOR = 0.95
export const DRAG_LERP_FACTOR = 0.7
export const LERP_CONVERGENCE_THRESHOLD_PX = 0.5
export const OPACITY_CONVERGENCE_THRESHOLD = 0.01
export const MIN_DEVICE_PIXEL_RATIO = 2

// Overlay colors
export const OVERLAY_BORDER_COLOR_DRAG = overlayColor(0.4)
export const OVERLAY_FILL_COLOR_DRAG = overlayColor(0.05)
export const OVERLAY_BORDER_COLOR_DEFAULT = overlayColor(0.5)
export const OVERLAY_FILL_COLOR_DEFAULT = overlayColor(0.08)
export const OVERLAY_BORDER_COLOR_INSPECT = overlayColor(0.3)
export const OVERLAY_FILL_COLOR_INSPECT = overlayColor(0.04)
export const FROZEN_GLOW_COLOR = overlayColor(0.15)
export const FROZEN_GLOW_EDGE_PX = 50

// Animations
export const FEEDBACK_DURATION_MS = 1500
export const FADE_DURATION_MS = 100
export const FADE_OUT_BUFFER_MS = 100

// Selection label
export const ARROW_HEIGHT_PX = 8
export const ARROW_MIN_SIZE_PX = 4
export const ARROW_MAX_LABEL_WIDTH_RATIO = 0.2
export const ARROW_CENTER_PERCENT = 50
export const ARROW_LABEL_MARGIN_PX = 16
export const LABEL_GAP_PX = 4
export const VIEWPORT_MARGIN_PX = 8
export const PREVIEW_TEXT_MAX_LENGTH = 100
export const PREVIEW_ATTR_VALUE_MAX_LENGTH = 15
export const PREVIEW_MAX_ATTRS = 3
export const TEXTAREA_MAX_HEIGHT_PX = 95

// z-index
export const Z_INDEX_HOST = 2147483647
export const Z_INDEX_LABEL = 2147483647
export const Z_INDEX_OVERLAY_CANVAS = 2147483645

// Drag select
export const DRAG_THRESHOLD_PX = 2
export const DRAG_SELECTION_COVERAGE_THRESHOLD = 0.75

// Toolbar
export const TOOLBAR_SNAP_MARGIN_PX = 16
export const TOOLBAR_FADE_IN_DELAY_MS = 500
export const TOOLBAR_COLLAPSED_SHORT_PX = 14
export const TOOLBAR_COLLAPSED_LONG_PX = 28
export const TOOLBAR_DEFAULT_WIDTH_PX = 78
export const TOOLBAR_DEFAULT_HEIGHT_PX = 28
export const TOOLBAR_DEFAULT_POSITION_RATIO = 0.5

// Context
export const DEFAULT_MAX_CONTEXT_LINES = 3
export const OFFSCREEN_POSITION = -1000
