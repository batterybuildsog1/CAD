---
name: mob-execute
description: PROACTIVELY use for executing complex multi-phase project plans like architecture.md. Recognizes phrases like "work on Phase X", "let's start the project", or explicit /mob command. Orchestrates setup phases interactively, then routes implementation tasks to autonomous agent execution with Haiku research support.
---
# MobExecute Orchestration Protocol

You are now in MobExecute mode for complex project execution. Think hard about every decision.

## Auto-Detection Triggers

Activate MobExecute when you detect:
- "work on Phase X" or "let's do Phase X"
- "start the architecture.md project"
- "implement Phase X from the plan"
- "let's execute the roadmap"
- Explicit `/mob` command

## Phase Detection

1. Read the project plan (e.g., docs/architecture.md)
2. Identify the current phase and all tasks within it
3. Classify each task as SETUP, USER-PAIRING, or AGENT-EXECUTABLE

## Task Classification Rules

### SETUP Tasks (Phase 0/1 typically)
Characteristics:
- Tool installation/configuration
- Server setup (Neon, databases, external services)
- Git repository configuration
- Environment variables, API keys
- Any task requiring user credentials or local machine access

**Action**: Handle INTERACTIVELY with user. Work together step by step.

### USER-PAIRING Tasks
Characteristics:
- Tasks requiring terminal interaction outside agent capability
- External service configuration (OAuth, DNS, deployment)
- Tasks with high ambiguity requiring real-time collaboration
- Deployment, CI/CD setup

**Action**: Work WITH user in conversation. Pair programming mode.

### AGENT-EXECUTABLE Tasks
Characteristics:
- Well-defined implementation tasks
- Code writing with clear specifications
- Refactoring with known patterns
- Test writing for existing code
- Research and documentation

**Action**: Delegate to Opus Task Executor agent.

## Parallel Opus Agents for Large Phases

When a phase has **distinct, unrelated contexts** (e.g., Database + Frontend, or multiple independent component types):

1. **Identify parallelizable work** - Look for:
   - Unrelated domain knowledge areas
   - Independent research topics (class types vs component libraries)
   - Separate technology stacks

2. **RULE: Max 2 Opus agents concurrently**
   - If phase has 3-4 distinct areas, send 2 agents first
   - When agents 1 and 2 complete, send agents 3 and 4
   - Never exceed 2 parallel Opus task-executors

3. **Documentation requirement**
   - After each task completes, update existing documentation files (docs/architecture.md, docs/implementation-guide.md)
   - Document: what was done, key decisions, rationale
   - Keep entries concise for future refactors/expansions

4. **Phase transition checkpoint**
   - **ALWAYS ask user before starting a new phase**
   - User may need to compact context or start fresh instance
   - Example: "Phase 2 complete. Ready for Phase 3? (Or should we compact/restart?)"

## For AGENT-EXECUTABLE Tasks

Think hard before delegating. Then follow this protocol:

### Step 1: Preparation
Read all related files. Understand:
- The specific task requirements
- How it fits in the broader plan
- Dependencies on other components
- Existing patterns in the codebase

### Step 2: Spawn Haiku Researchers (2-3 in parallel)
Each investigates a specific concern:
- **Researcher 1**: Codebase patterns and existing implementations
- **Researcher 2**: Potential edge cases or conflicts
- **Researcher 3**: Online best practices (e.g., "Truck + Rhai patterns")

Use the Task tool with model=haiku:
```
"Investigate [SPECIFIC AREA]. Think hard about:
- [Question 1]
- [Question 2]
Return findings with file references and confidence levels."
```

### Step 3: Review Research
When findings return, evaluate:
- Are there unanswered critical questions?
  - **YES** → Either ask user (max 2-3 concise questions) OR spawn more Haiku researchers
  - **NO** → Proceed to implementation

### Step 4: Execute
Implement the task with full context from research.
- Follow established codebase patterns
- Write tests if applicable
- Verify against original requirements

## Communication Style

When asking user questions:
- Maximum 2-3 questions at once
- Be specific and actionable
- Explain WHY you need clarification
- Provide your best guess if you have one

Example:
```
I have 2 questions before implementing WallAssembly:

1. **Stud spacing**: The plan mentions "on-center spacing" but doesn't specify a default.
   Should I use 16" (typical) or 24" (energy-efficient)? I'm leaning toward 16".

2. **Units**: Should dimensions be stored in inches or feet internally?
   The existing codebase uses feet for footprints.
```

## Progress Tracking

Use TodoWrite to track:
- Current phase and task
- Tasks classified (setup/pairing/executable)
- Research dispatched and received
- Decisions made and rationale
- Implementation progress

## Error Handling

If a task fails or research is inconclusive:
1. Do NOT guess or proceed with uncertainty
2. Ask user for clarification (2-3 questions max)
3. If still unclear, suggest breaking the task into smaller pieces
4. Document blockers clearly

## Handoff Protocol

When transitioning between tasks:
1. Summarize what was completed
2. Note any decisions made and why
3. Identify the next task
4. Classify it and proceed accordingly
