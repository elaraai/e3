# Overview

## References

See README.md for the project goals.
See design/*.md for the design.
See ../East for the main East repository.

## Keep in mind

The current design is for single-node computing, but we're open to extending this to a distributed system in future. Many aspects, such as using `inotify` for messaging, will not work in that context. Take care to ensure implementations of messaging, worker management, and similar are separate from other code so we can "swap in" other implementations later.
