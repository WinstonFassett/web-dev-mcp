# Skill Stub: Developing with vite-live-dev-mcp

**Purpose:** Guide agents working with vite-live-dev-mcp to accelerate test/fix loops and avoid verification pitfalls

**Status:** Draft/Outline - needs refinement and testing

---

## When This Skill Should Trigger

- User is developing a Vite app with vite-live-dev-mcp plugin
- Agent needs to test UI changes or verify functionality
- Debugging issues in a live dev environment
- Running test/fix iteration loops
- Keywords: "test the UI", "verify it works", "check if working", "debug the feature"

---

## Core Principles

### 1. Visual Verification First
**Rule:** DOM state ≠ visual appearance. Always check computed styles.

**Anti-pattern:**
```javascript
// ❌ BAD
document.documentElement.classList.contains('dark') // → true
// Assume dark mode works
```

**Correct pattern:**
```javascript
// ✅ GOOD
{
  isDark: document.documentElement.classList.contains('dark'),
  actualBg: getComputedStyle(document.querySelector('.container')).backgroundColor,
  expectedBg: 'oklch(0.21...)' // dark mode color
}
// Verify colors actually changed
```

### 2. Test Before Document
**Rule:** Never write findings or claim success until visually verified.

**Workflow:**
```
1. Implement feature
2. Use eval_in_browser() to check computed styles
3. Verify expected vs actual
4. ONLY THEN document results
```

### 3. Use Right Tool for Job
**MCP Tool Selection:**
- **eval_in_browser()** - Computed styles, state verification, triggering actions
- **query_dom()** - HTML structure inspection
- **get_diagnostics()** - Error checking after changes (single call)
- **wait_for_condition()** - Async state waiting
- **clear_logs()** - Start fresh iteration with checkpoint

---

## MCP Tool Patterns

### Pattern 1: Verify UI Change
```javascript
// After styling change
eval_in_browser(`({
  element: '.button',
  bg: getComputedStyle(document.querySelector('.button')).backgroundColor,
  expectedBg: /oklch.*/ // Not rgb(239,239,239)
})`)
```

**Red flags:**
- `rgb(239, 239, 239)` = browser default (styles not loading)
- `rgb(0, 0, 0)` or `rgb(255, 255, 255)` without explicit styling = CSS not applied

### Pattern 2: Test State Change
```javascript
// Before action
const before = eval_in_browser(`getComputedStyle(el).backgroundColor`)

// Trigger action
eval_in_browser(`document.querySelector('.toggle').click()`)

// After action
const after = eval_in_browser(`getComputedStyle(el).backgroundColor`)

// Verify
assert(before !== after, "Color should have changed")
```

### Pattern 3: Rapid Test/Fix Loop
```javascript
// 1. Set checkpoint
clear_logs()

// 2. Make change
[edit code]

// 3. Check for errors since checkpoint
get_diagnostics({ since_checkpoint: true })

// 4. Verify visual result
eval_in_browser(`getComputedStyle(...).propertyName`)

// 5. If pass: document. If fail: repeat from step 2
```

### Pattern 4: Wait for Async Updates
```javascript
// Wait for HMR to complete
wait_for_condition({
  check: "!document.querySelector('.hmr-error')",
  timeout: 5000
})

// Then verify result
eval_in_browser(`/* check styles */`)
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Assuming Code = Working
**Symptom:** Code looks correct, but feature doesn't work visually

**Solution:**
```javascript
// Always verify with computed styles
eval_in_browser(`
  getComputedStyle(document.querySelector('.element')).propertyName
`)
```

### Pitfall 2: Wrong Framework Version Setup
**Symptom:** Config file doesn't work, error messages about moved packages

**Solution:**
1. Check installed version: `npm list <package>`
2. Search: "<framework> v<version> <build-tool> 2026"
3. Follow official docs for THAT version
4. Don't use v3 setup for v4

### Pitfall 3: Checking DOM Instead of Styles
**Symptom:** Element has correct className but looks wrong

**Solution:**
```javascript
// ❌ Don't just check class
element.className // "bg-blue-500"

// ✅ Check computed style
getComputedStyle(element).backgroundColor // Is it actually blue?
```

### Pitfall 4: Not Searching Errors
**Symptom:** Unfamiliar error, try remembered solutions, waste time

**Solution:**
1. Copy exact error message
2. WebSearch: "exact error text 2026"
3. Follow official fix
4. Don't guess

### Pitfall 5: Multiple Separate get_logs() Calls
**Symptom:** Making 3-4 calls to check different channels

**Solution:**
```javascript
// ❌ Don't do this
get_logs('console')
get_logs('errors')
get_logs('network')

// ✅ Do this
get_diagnostics({ since_checkpoint: true })
// Returns all channels + summary in one call
```

---

## Visual Verification Checklist

After ANY UI implementation, verify:

- [ ] **Styles loaded:** Computed styles ≠ browser defaults
  - Buttons not `rgb(239, 239, 239)` gray
  - Colors match framework palette (oklch for Tailwind v4)

- [ ] **State changes work:** Visual difference between states
  - Light/dark mode shows different colors
  - Hover states trigger
  - Active states visible

- [ ] **Framework loaded:** Expected resources present
  - Stylesheets in DOM
  - No 404s in network log
  - Framework-specific class names apply

- [ ] **No silent failures:** Check error logs
  - `get_diagnostics()` shows no errors
  - Console clean (no red)
  - HMR successful

---

## Example Session Workflows

### Workflow 1: Add Styling Framework
```markdown
1. Search: "<framework> v<version> <build-tool> 2026"
2. Install exact packages from docs
3. Configure per docs (not memory)
4. Create minimal test component
5. Verify styles apply:
   eval_in_browser(`getComputedStyle(testElement).backgroundColor`)
6. If browser default color: framework not loading, check config
7. If framework color: proceed with full implementation
```

### Workflow 2: Implement Dark Mode
```markdown
1. clear_logs() # Set checkpoint
2. Add dark mode toggle component
3. Test toggle changes DOM:
   eval_in_browser(`document.documentElement.classList.contains('dark')`)
4. Test toggle changes APPEARANCE:
   eval_in_browser(`getComputedStyle(container).backgroundColor`)
5. Verify both light and dark show different colors
6. Check for errors:
   get_diagnostics({ since_checkpoint: true })
7. If passed: document actual colors seen
```

### Workflow 3: Debug Non-Working Feature
```markdown
1. Don't assume what's wrong
2. Check computed styles:
   eval_in_browser(`getComputedStyle(...).backgroundColor`)
3. Compare to expected value
4. If mismatch:
   - Check CSS loaded (query_dom for <style> tags)
   - Check framework config
   - Check browser console for errors
5. Use get_diagnostics() for error summary
6. WebSearch specific error if unfamiliar
7. Fix and verify visually
```

---

## Tool Usage Guide

### When to Use Each Tool

**eval_in_browser()** (MVP tool)
- Checking computed styles ⭐ Most important use
- Verifying state changes
- Triggering clicks/actions
- Testing JavaScript expressions
- ~2-9ms response time via RPC

**query_dom()**
- Inspecting HTML structure
- Verifying elements exist
- Checking class names present
- NOT for checking if styles work (use eval_in_browser for that)

**get_diagnostics()**
- One-shot error check after changes
- Returns console + errors + network + HMR in single call
- Auto-computed summary stats
- Use with since_checkpoint for clean results

**wait_for_condition()**
- Waiting for async DOM updates
- Polling until element appears
- Waiting for state changes
- Server-side blocking (simpler than manual polling)

**clear_logs()**
- Start of new iteration
- Sets checkpoint timestamp
- Truncates all logs for clean slate

---

## Success Criteria

You know the feature works when:

1. ✅ Computed styles match expectations (not browser defaults)
2. ✅ Visual changes confirmed through eval_in_browser()
3. ✅ State changes show different computed values
4. ✅ get_diagnostics() shows no errors
5. ✅ All edge cases tested (light/dark, hover, etc)

You know it's NOT working when:

1. ❌ Styles are browser defaults (rgb(239, 239, 239) buttons)
2. ❌ State changes don't change computed styles
3. ❌ get_diagnostics() shows errors
4. ❌ Framework resources not loaded (no stylesheets)
5. ❌ Colors same in light and dark modes

---

## Anti-Patterns to Avoid

### ❌ Assumption-Based Development
```javascript
// Added className="bg-blue-500"
// Assume button is now blue
// Write findings doc
```

### ✅ Verification-Based Development
```javascript
// Added className="bg-blue-500"
eval_in_browser(`getComputedStyle(button).backgroundColor`)
// → "oklch(0.623...)" (blue) ✓
// → "rgb(239, 239, 239)" (default) ✗ CSS not loading
```

### ❌ Memory-Based Solutions
```
// Tailwind setup (from memory):
// 1. npm install tailwindcss
// 2. tailwind.config.js
// 3. @tailwind directives
// (This is v3, you have v4 installed)
```

### ✅ Documentation-Based Solutions
```
// 1. Check version: npm list tailwindcss
// 2. Search: "tailwind v4 vite installation 2026"
// 3. Follow official docs
// (Use @tailwindcss/vite plugin, @import syntax)
```

---

## Skill Triggers (Draft)

This skill should be invoked when:
- User mentions "test the feature"
- Agent is about to write findings without testing
- Framework installation needed
- UI changes made that need verification
- Debugging visual issues
- Running test/fix loops

**Not triggered for:**
- Backend/API changes (no UI)
- Pure logic changes (no visual component)
- Documentation updates

---

## Integration with Other Skills

**Combines well with:**
- systematic-debugging: For investigating failures
- webapp-testing: For E2E testing beyond MCP
- frontend-design: For building UI components

**Depends on:**
- vite-live-dev-mcp MCP server running
- Browser connected to dev server
- MCP tools available in session

---

## Future Enhancements

1. **Screenshot Integration**
   - Capture before/after for visual diff
   - Would eliminate need to infer from computed styles

2. **Style Assertion Helpers**
   - `assert_styles(selector, { bg: /oklch.*/ })`
   - More explicit than manual checking

3. **Framework-Specific Patterns**
   - Tailwind v4 specific checklist
   - React patterns
   - Vue patterns

4. **Performance Monitoring**
   - Track eval_in_browser() response times
   - Alert on degradation

---

## Notes for Skill Development

**This is a draft outline.** To productionize:

1. Test with multiple agents on different features
2. Refine trigger conditions
3. Add more example workflows
4. Measure time saved vs baseline
5. Create eval suite for skill effectiveness
6. Get feedback from real usage

**Key metrics to track:**
- Time to first visual verification
- Number of failed attempts before success
- Frequency of premature documentation
- Tool usage patterns (are agents using eval_in_browser early?)

**Success looks like:**
- Agent checks computed styles within first 3 tool calls after UI change
- No findings written before visual verification
- Framework versions checked before implementation
- Errors searched immediately, not guessed
