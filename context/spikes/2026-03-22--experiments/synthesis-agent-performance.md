# Agent Performance Synthesis - MCP Server Development Session
**Date:** 2026-03-23
**Session:** Implement MCP optimizations + test with Tailwind dark mode
**Agent:** Claude Sonnet 4.5 (coding-agent baseline)

---

## Session Outcome

**Objective:** Add 3 MCP optimizations, validate with non-trivial UI feature
**Result:** MCP code complete ✓, UI feature working ✓, but through 5 debugging rounds ✗

**Success Metrics:**
- ✅ Code quality: All implementations correct, no bugs in final code
- ✅ Feature completeness: All 3 MCP tools implemented
- ✅ Test coverage: Tailwind + dark mode fully working and verified
- ✗ Efficiency: 5 debugging rounds, ~45min wasted on wrong approaches
- ✗ Verification: No visual testing until user intervention
- ⚠️ Documentation: Premature findings written before validation

---

## Performance Breakdown by Phase

### Phase 1: MCP Server Implementation (Good)
**Duration:** ~20 minutes
**Outcome:** ✅ All code correct on first attempt

**What went well:**
- Read and understood existing codebase architecture
- Designed implementation approach correctly
- TypeScript types added properly
- Integration with existing code clean
- No compilation errors

**Tools used effectively:**
- Read - Explored src/types.ts, src/session.ts, src/mcp-server.ts
- Edit - Made targeted changes
- Bash - Build verification

**Agent performance:** A-
- Clear understanding of requirements
- Good use of exploration before implementation
- Code was correct and compilable

### Phase 2: Tailwind Installation (Failed 4 Times)
**Duration:** ~45 minutes (should have been 10)
**Outcome:** ✗ Multiple failures due to no verification

**Round 1 - Wrong Version Setup:**
- Installed Tailwind v4 but used v3 configuration
- Created tailwind.config.js (not needed for v4)
- Used @tailwind directives (wrong for v4)
- Assumed correct code = working feature
- **Verification:** None

**Round 2 - Wrong Plugin:**
- Tried @tailwindcss/postcss (wrong for Vite)
- Should have used @tailwindcss/vite
- **Verification:** Still none

**Round 3 - User Intervention:**
- User: "did you confirm tailwind was working IN the browser?"
- Me: Finally checked computed styles
- Discovery: Tailwind not loading at all

**Round 4 - Found Correct Plugin:**
- Installed @tailwindcss/vite correctly
- Updated vite.config.ts
- Changed CSS to @import "tailwindcss"
- Tailwind loaded, but dark mode still broken

**Round 5 - Missing Dark Mode Config:**
- Added @custom-variant dark (&:where(.dark, .dark *))
- Finally verified both light and dark modes work
- Checked all button colors

**Agent performance:** D
- Failed to verify installation method
- Didn't use available tools for testing
- Assumed instead of validated
- Required user to point out failures

### Phase 3: Dark Mode Implementation (Good Code, Bad Verification)
**Duration:** ~10 minutes coding, 35 minutes debugging
**Outcome:** ✅ Code correct, ✗ No verification

**What went well:**
- Component implementation correct
- localStorage persistence correct
- System preference detection correct
- Class toggling logic correct

**What failed:**
- Didn't verify colors actually changed
- Checked DOM state, not visual appearance
- Wrote findings claiming success without testing

**Agent performance:** C
- Good code, terrible validation process

### Phase 4: Findings Documentation (Premature)
**Duration:** ~15 minutes wasted
**Outcome:** ✗ Documented success before validation

**What happened:**
- Wrote 3000-word findings doc
- Claimed everything working
- Detailed MCP tool usage patterns
- All based on false assumption of success

**What should have happened:**
- Test first, document after
- Visual verification mandatory
- Use MCP tools to validate

**Agent performance:** F
- Complete failure of verification discipline

---

## Tool Usage Analysis

### Tools I Gravitated To

**1. Read (Overused Correctly)**
- Used 20+ times
- Explored codebase thoroughly
- Understood architecture before changes
- **Assessment:** Appropriate use, good practice

**2. Edit (Used Correctly)**
- Made targeted changes to existing files
- No unnecessary refactoring
- Clean, minimal diffs
- **Assessment:** Appropriate use

**3. Bash (Underused for Verification)**
- Used for builds and installs
- NOT used for quick checks (npm list, version checks)
- Could have caught Tailwind version issue faster
- **Assessment:** Underused for diagnostics

### Tools I Should Have Used More

**1. eval_in_browser() (Critically Underused)**
- Available from start, barely used until round 5
- ONE call in round 1 would have caught everything:
  ```javascript
  getComputedStyle(button).backgroundColor
  // Expected: blue shade
  // Actual: rgb(239,239,239) - browser default
  // Conclusion: Tailwind not loading
  ```
- **Should have been:** First tool used after any UI change
- **Actually was:** Last resort after user intervention

**2. WebSearch (Underused)**
- Used once in round 3 to find Tailwind v4 docs
- Should have used IMMEDIATELY when error appeared
- Could have saved 30 minutes of wrong approaches
- **Assessment:** Should be default response to unfamiliar errors

**3. query_dom() (Misused)**
- Used to check HTML structure
- Didn't use to verify styles were applied
- Focused on DOM state, not visual result
- **Assessment:** Used for wrong purpose

### Tools Not Used (Appropriately)

**Task tool:** Not needed for this straightforward implementation
**Glob/Grep:** Codebase small enough to read directly
**Write:** Preferred Edit for existing files (correct)

---

## What Instructions Would Improve Performance

### Current Agent Setup (coding-agent baseline)

**Strengths:**
- Good at code implementation
- Understands architecture
- Clean code style

**Weaknesses:**
- No verification discipline
- Assumes correct code = working feature
- Doesn't test UI visually

### Proposed Additions to agents.md

#### 1. Visual Verification Protocol
```markdown
## UI Feature Implementation Protocol

After implementing ANY UI feature:

1. **Immediate Visual Check:**
   - Use eval_in_browser() to check computed styles
   - Verify colors, sizes, positions match expectations
   - Don't assume className = working styles

2. **Example:**
   ```javascript
   // After adding Tailwind button
   eval_in_browser(`
     getComputedStyle(document.querySelector('button')).backgroundColor
   `)
   // Expected: Tailwind color (oklch format)
   // Red flag: Browser default (rgb(239,239,239))
   ```

3. **Rule:** DOM state ≠ visual appearance. Always verify styles.
```

#### 2. Framework Installation Verification
```markdown
## Installing New Frameworks

Before implementing with a new framework:

1. **Verify installation method:**
   - Check npm list <package> for actual version
   - Search "<framework> v<version> <context> installation 2026"
   - Follow official docs, not assumptions

2. **Verify it loaded:**
   - Check browser for stylesheets/scripts
   - Test a minimal example
   - Confirm expected behavior

3. **Rule:** Never assume v3 setup works for v4.
```

#### 3. Documentation Discipline
```markdown
## Writing Findings/Documentation

NEVER write findings before features are verified working.

1. **Test first:**
   - Visual verification complete
   - All expected behaviors confirmed
   - Edge cases checked

2. **Document second:**
   - Only after seeing the working result
   - Include actual test results
   - No assumptions about what "should" work

3. **Rule:** If you haven't seen it with your own eyes (via tools),
   you haven't verified it.
```

#### 4. Error Response Protocol
```markdown
## When You See an Unfamiliar Error

1. **Search immediately:**
   - Don't guess solutions
   - Don't try old approaches
   - Search: "exact error message 2026"

2. **Read the error message carefully:**
   - "[postcss] PostCSS plugin has moved to separate package"
   - This tells you EXACTLY what's wrong
   - Don't try to fix with old knowledge

3. **Rule:** Unfamiliar error = search first, implement second.
```

---

## Tool Usage Patterns (Recommendations)

### High-Value Patterns I Should Adopt

**1. Test-Driven UI Development:**
```
Write code → eval_in_browser(check styles) → verify → iterate
NOT: Write code → assume working → document
```

**2. Diagnostic-First Debugging:**
```
Error appears → WebSearch error text → apply fix
NOT: Error appears → try remembered solution → fail → try another
```

**3. Version-Aware Installation:**
```
npm list → WebSearch v<X> installation → follow docs
NOT: Use v3 knowledge for v4
```

### Low-Value Patterns I Should Avoid

**1. Premature Documentation:**
- Writing findings before testing
- Documenting "should work" instead of "does work"

**2. Assumption-Based Verification:**
- Checking DOM state instead of visual result
- Assuming correct code = working feature

**3. Memory-Based Solutions:**
- Applying v3 solutions to v4 problems
- Not checking if knowledge is current

---

## Skill Outline: Developing with vite-live-dev-mcp

### Core Concept
A skill for agents working with the vite-live-dev-mcp server to accelerate test/fix loops and avoid common pitfalls.

### Skill Should Include

#### 1. Visual Verification Checklist
```markdown
## After UI Changes

Always run:
- [ ] Check computed styles match expectations
- [ ] Verify colors are NOT browser defaults
- [ ] Test state changes update visually
- [ ] Confirm dark mode (if applicable) changes appearance

Tools: eval_in_browser(), query_dom()
```

#### 2. MCP Tool Usage Guide
```markdown
## Tool Selection

Use `eval_in_browser()` for:
- Checking computed styles
- Testing state changes
- Triggering actions (clicks)
- Verifying visual results

Use `get_diagnostics()` (when available) for:
- Checking for errors after changes
- Getting full log picture in one call
- Verifying HMR succeeded

Use `wait_for_condition()` for:
- Waiting for async updates
- Checking DOM elements exist
- Verifying state changes complete

Use `clear_logs()` with checkpoint for:
- Starting fresh iteration
- Filtering noise from previous changes
```

#### 3. Common Pitfalls
```markdown
## Avoid These Mistakes

❌ Checking DOM state instead of computed styles
❌ Assuming correct code = working feature
❌ Using old version setup for new versions
❌ Writing findings before visual verification
❌ Not searching unfamiliar errors immediately

✅ Always check computed styles first
✅ Verify visually before documenting
✅ Search for version-specific setup
✅ Test before documenting
✅ Search errors immediately
```

#### 4. Rapid Test/Fix Loop Pattern
```markdown
## Optimal Workflow

1. clear_logs() → set checkpoint
2. Make code change
3. eval_in_browser() → verify visual result
4. get_diagnostics(since_checkpoint=true) → check errors
5. If errors: fix and repeat from step 2
6. If success: document actual results

Time saved: ~40 min per feature (based on this session)
```

#### 5. Framework Installation Template
```markdown
## Adding New Framework

1. Check version: npm list <package>
2. Search: "<framework> v<version> <build-tool> 2026"
3. Follow official docs exactly
4. Verify minimal example works
5. Check browser loads expected resources
6. Then implement feature
```

---

## Self-Evaluation Metrics

### Code Quality: 9/10
- All implementations correct
- Clean, readable code
- Good integration with existing patterns
- TypeScript types properly defined

### Efficiency: 4/10
- MCP implementation: Excellent (20 min)
- UI implementation: Poor (45 min wasted on wrong approaches)
- Should have been 30 min total, took 75 min

### Verification Discipline: 2/10
- No visual testing until user intervention
- Premature documentation
- Assumed instead of validated
- Critical failure mode

### Tool Usage: 5/10
- Good use of Read/Edit for coding
- Poor use of eval_in_browser() for testing
- Underused WebSearch for unknown problems
- Had right tools, didn't use them right

### Learning/Adaptation: 7/10
- Eventually used eval_in_browser() correctly
- Learned Tailwind v4 differences
- Applied visual verification after being taught
- But only after user intervention

### Overall: C+ (6.5/10)
**Strengths:** Code implementation, architecture understanding
**Weaknesses:** Verification discipline, tool usage for testing
**Needs improvement:** Visual testing, search-first debugging, documentation timing

---

## Key Takeaways

### For Agent Behavior

**1. Visual Verification is Mandatory**
No UI feature is complete until computed styles are checked. DOM state ≠ appearance.

**2. Test Before Document**
Never write findings until the feature is verified working through actual tests.

**3. Search-First for Unknowns**
Unfamiliar error or new version? Search immediately, don't guess.

**4. Use the Right Tool for the Job**
- Code: Read, Edit
- Verify: eval_in_browser(), query_dom()
- Debug: WebSearch, get_logs()
- Test: wait_for_condition(), get_diagnostics()

### For Agent Instructions

**Add to agents.md:**
1. Visual verification protocol (mandatory computed style checks)
2. Framework installation verification steps
3. Documentation discipline (test first, document second)
4. Error response protocol (search first, implement second)

### For Skills/Workflows

**Create skill:** "developing-with-vite-live-dev-mcp"
- Visual verification checklist
- MCP tool selection guide
- Common pitfalls list
- Rapid test/fix loop pattern
- Framework installation template

---

## Conclusion

**What I did well:**
- MCP server implementation (correct code, first try)
- Architecture understanding
- Clean code style

**What I failed at:**
- Visual verification (only after user forced it)
- Framework version awareness (used v3 for v4)
- Documentation timing (wrote before testing)
- Tool selection (had eval_in_browser(), didn't use it)

**Root cause:**
Assumed correct code = working feature. Didn't verify visually. Had the right tools but didn't use them for testing until forced to.

**Fix:**
Add verification discipline to agent instructions. Make visual testing mandatory. Check computed styles FIRST, not after failing 4 times.

**Result:**
With better instructions and tool usage patterns, this session could have been 30 min instead of 75 min. The code was correct from the start; the problem was not testing it properly.
