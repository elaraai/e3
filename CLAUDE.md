# Overview

## Structure

This is an npm workspace monorepo containing the e3 (East Execution Engine) packages.
The directory structure is:

 - packages/e3-types - Shared type definitions for e3
 - packages/e3-core - Core business logic library (like libgit2)
 - packages/e3-cli - CLI tool (like git)
 - integration-tests - End-to-end tests for e3
 - design - design documentation

## Purpose

e3 allows users to create and execute end-to-end business solutions, tying together data integrations, simulation, optimization, machine learning and dashboards into holistic dataflow programs.

A single solution may involve NodeJS for integrations, python for machine learning and Julia for native-speed simulations.
The East language provides a structural type system and standardized serialization formats for communications between different runtimes.
An e3 repository holds and manages datasets and East programs, and automatically orchestrates dataflow tasks so the user does not need to worry about "plumbing".

## Concepts

 - **e3 repository** - a git-inspired directory structure with a SHA256 content-addressed object store
 - **package** - an immutable collection of East IR, tasks, datasets and dataflows
 - **workspace** - a package is deployed to a workspace, where input datasets can be mutated and automated dataflow executed (with consistency guarantees)
 - **runner** - a program that e3 can spawn to execute a task
 - **IR** - East's intermediate representation, representing an East program that has passed through East's front-end compiler
 - **task** - a combination of a runner (an East interpretter or JIT compiler), fixed inputs (East IR defining the task) and inputs to be provided (the input data to the task)
 - **dataset** - like git, workspace data is stored in a "tree" with datasets as the leaves - each dataset has a "path" and a fixed East type
 - **dataflow** - a combination of a task with paths to input and output dataset locations

## References

Instructions in STANDARDS.md must be followed at all times.

See USAGE.md for how to use e3.
See design/e3-mvp*.md for the current design spec.

You can find the East language implementation at ../east
