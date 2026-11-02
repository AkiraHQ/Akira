---
trigger: always_on
description: Guidance for using Understand Anything to analyze, navigate, and visualize the Akira codebase.
---

## Understand Anything

This project is configured with [Understand Anything](https://github.com/Egonex-AI/Understand-Anything) for multi-agent codebase analysis, interactive knowledge graph visualization, and architecture exploration.

### Available Skills & Commands

- `/understand`: Analyze the codebase and generate/incrementally update the knowledge graph (`.ua/knowledge-graph.json`).
- `/understand-dashboard`: Launch the interactive web dashboard to explore the visual knowledge graph, components, and layers.
- `/understand-chat <query>`: Ask questions about the codebase architecture, control flows, and modules.
- `/understand-diff`: Analyze the impact of current staged/unstaged changes across the codebase.
- `/understand-explain <path>`: Generate a deep-dive explanation for a specific module, file, or function.
- `/understand-domain`: Extract business domains, user lifecycles, and operational workflows.
- `/understand-onboard`: Generate structured onboarding tours and dependency-ordered reading guides.
