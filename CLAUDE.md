# Overview

## Structure

This is an npm workspace monorepo containing the E3 (East Execution Engine) packages:

 - e3cli - CLI tool (like git)
 - e3-runner-node - task execution runner for NodeJS runtime
 - e3dk - E3 development kit, TypeScript library containing platform functions including `execute`
 - e3-types - Shared type definitions for E3
 - design - design documentation

## References

See README.md for the project goals.
See USAGE.md for how to use e3.
See design/*.md for the design.
See ../East for the main East repository.

## Keep in mind

The current design is for single-node computing, but we're open to extending this to a distributed system in future. Many aspects, such as using `inotify` for messaging, will not work in that context. Take care to ensure implementations of messaging, worker management, and similar are separate from other code so we can "swap in" other implementations later.
