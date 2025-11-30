---
description: Invoke MobExecute skill for complex multi-phase project execution
---
Activate the mob-execute skill for this project.

## Target Plan
$ARGUMENTS

## Default Behavior
If no plan is specified, look for (in order):
1. docs/architecture.md
2. PLAN.md
3. README.md roadmap section

## Your Task

1. **Read the plan** - Identify all phases and their tasks
2. **Identify current phase** - What phase should we work on?
3. **Classify tasks** - Mark each as SETUP, USER-PAIRING, or AGENT-EXECUTABLE
4. **Present summary** - Show the user what you found and your classification
5. **Begin execution** - Start with the first task, following MobExecute protocol

## Classification Guide

**SETUP** (handle interactively):
- Tool/environment setup
- External service configuration
- Credentials and API keys
- Database setup

**USER-PAIRING** (work together):
- High-ambiguity tasks
- Deployment and CI/CD
- External integrations

**AGENT-EXECUTABLE** (delegate to task-executor):
- Well-defined code implementation
- Refactoring with clear patterns
- Test writing
- Documentation

Think hard about the best approach for each task.
